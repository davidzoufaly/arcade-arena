import { createCamStream, createHandTracker, isPalmOpen, isFist, isVictorySign } from '../shared/vision.js';
import { showDenialModal } from '../shared/perms.js';
import { mountTopbar } from '../shared/topbar.js';
import { resolveSession } from '../shared/lobby.js';
import { requireAdmin } from '../shared/admin-gate.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, update, push, get } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
import { isGameLockedFor, renderLockedScreen } from '../shared/game-gate.js';
import {
  PALM_COUNT_WINDOW,
  palmCountToJumpStrength, scoreAttempt, finalScore,
  runSpeed, spawnIntervalFrames, highObstacleProb,
} from '../shared/dino-logic.js';
import { warmupSecondsLeft } from '../shared/warmup-logic.js';

mountTopbar({ activePage: 'games' });
const session = resolveSession();
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const writer = firebaseWriter({ db, ref, update, push });
const catalogHref = session
  ? `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`
  : '../games.html';

const GAME_CODE = 'DN';
const MAX_ATTEMPTS = 3;
const CANVAS_W = 960, CANVAS_H = 540;
const GROUND_Y = Math.round(CANVAS_H * 0.78);
const RUNNER_X = 240, RUNNER_W = 30, RUNNER_H = 60, LEG_LEN = 10;
const GRAVITY = 0.8;

const PHASES = ['setup', 'loading', 'intro', 'play', 'attempt-end', 'final'];
const phaseEnter = {};
let activeCleanup = null;

const state = {
  teamId: session?.teamId ?? 0,
  tracker: null, stream: null, video: null,
  attemptIdx: 0, attempts: [],
};

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();

function goto(phase) {
  if (activeCleanup) { try { activeCleanup(); } catch {} activeCleanup = null; }
  $('phase-boot').classList.add('hidden');
  for (const p of PHASES) $(`phase-${p}`).classList.add('hidden');
  $(`phase-${phase}`).classList.remove('hidden');
  $('briefing').classList.toggle('hidden', phase !== 'setup');
  phaseEnter[phase]?.();
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Solo-dev debug: with ?debug in the URL, hold keys 0-8 to force palm count
// (keyup clears it, so each press re-triggers a jump like raising/lowering hands).
const DEBUG = new URLSearchParams(location.search).has('debug');
let debugPalms = null;
if (DEBUG) {
  window.addEventListener('keydown', (e) => { if (e.key >= '0' && e.key <= '8') debugPalms = Number(e.key); });
  window.addEventListener('keyup', (e) => { if (e.key >= '0' && e.key <= '8') debugPalms = null; });
}

// Pre-build 8 palm pips
const palmDotsEl = $('palmDots');
for (let i = 0; i < 8; i++) {
  const d = document.createElement('div');
  d.className = 'pip';
  palmDotsEl.appendChild(d);
}
function updatePalmHud(n) {
  const pips = palmDotsEl.children;
  for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < n);
  $('jumpFill').style.width = `${(palmCountToJumpStrength(n) / 20) * 100}%`;
}

// Live control-state chip so players see jump-armed vs ducking vs ready.
function updatePoseHud(eff, fist, ready) {
  const el = $('poseState');
  if (!el) return;
  if (fist) { el.textContent = '✊ DUCK'; el.className = 'pose-state duck'; }
  else if (eff > 0) { el.textContent = `✋ JUMP ×${eff}`; el.className = 'pose-state jump'; }
  else if (ready) { el.textContent = '✌️ READY'; el.className = 'pose-state ready'; }
  else { el.textContent = 'SHOW HANDS'; el.className = 'pose-state'; }
}

// SETUP
$('startBtn').addEventListener('click', () => {
  state.attempts = [];
  state.attemptIdx = 0;
  goto('loading');
});

// LOADING
phaseEnter.loading = async () => {
  try {
    if (!state.stream) {
      const { video, stream } = await createCamStream({ width: 480, height: 360 });
      state.video = video;
      state.stream = stream;
      state.tracker = await createHandTracker(video, { numHands: 8, minRunMs: 0 });
    }
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
      showDenialModal('camera');
    } else {
      alert('Failed to start camera/AI: ' + (e.message || e));
    }
    goto('setup');
    return;
  }
  goto('intro');
};

// INTRO
phaseEnter.intro = () => {
  $('introNum').textContent = state.attemptIdx + 1;
  $('introStartBtn').onclick = () => goto('play');
};

// PLAY
phaseEnter.play = () => {
  const canvas = $('dinoCanvas');
  const ctx = canvas.getContext('2d');
  // Size the backing store to the on-screen size × DPR so the canvas stays
  // crisp on HiDPI / upscaled displays, then scale the context so all drawing
  // keeps using the 960×540 logical coordinate space.
  (function sizeCanvas() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round((rect.width || CANVAS_W) * dpr);
    canvas.height = Math.round((rect.height || CANVAS_H) * dpr);
    ctx.setTransform(canvas.width / CANVAS_W, 0, 0, canvas.height / CANVAS_H, 0, 0);
  })();
  $('camPreview').srcObject = state.stream;

  $('scoreLabel').textContent = '0';
  $('attemptLabel').textContent = `${state.attemptIdx + 1} / ${MAX_ATTEMPTS}`;
  $('timerLabel').textContent = '0.0';

  const g = {
    y: GROUND_Y - RUNNER_H, vy: 0, ducking: false,
    score: 0, obs: [], spawnTimer: 0, runPhase: 0,
    palmWindow: [], lastEff: 0,
    warming: true, warmStartMs: performance.now(), startMs: 0,
    // Parallax speck field — scrolls with run speed so forward motion reads
    // even in warmup (no obstacles yet). z = depth → speed, size, brightness.
    particles: Array.from({ length: 28 }, () => ({
      x: Math.random() * CANVAS_W,
      y: Math.random() * GROUND_Y,
      z: 0.35 + Math.random() * 0.65,
    })),
  };

  let rafId = null, cancelled = false, prevTs = performance.now(), hiddenAt = 0;
  let fpsFrames = 0, fpsLast = performance.now(), slowTicks = 0;

  const track = state.stream.getVideoTracks()[0];
  const onEnded = () => endAttempt(true, '📷 Camera disconnected');
  track?.addEventListener('ended', onEnded);

  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if (g.warming) g.warmStartMs += delta;   // pause the warmup countdown
      else g.startMs += delta;                 // pause the scored clock
      hiddenAt = 0;
      prevTs = performance.now();
    }
  };
  document.addEventListener('visibilitychange', onVis);

  function readInput() {
    const hands = state.tracker.latest().hands;
    const palms = hands.filter(isPalmOpen).length;
    g.palmWindow.push(palms);
    if (g.palmWindow.length > PALM_COUNT_WINDOW) g.palmWindow.shift();
    const eff = DEBUG ? (debugPalms ?? 0) : Math.max(0, ...g.palmWindow);
    const fist = hands.some(isFist);
    const ready = hands.some(isVictorySign);
    updatePalmHud(eff);
    updatePoseHud(eff, fist, ready);
    return { eff, fist };
  }

  function spawnObstacle(elapsedSec) {
    const high = Math.random() < highObstacleProb(elapsedSec);
    if (high) g.obs.push({ x: CANVAS_W, y: GROUND_Y - 90, w: 36, h: 45, type: 'high' });
    else g.obs.push({ x: CANVAS_W, y: GROUND_Y - 30, w: 28, h: 30, type: 'low' });
  }

  function intersects(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function endAttempt(died, msg) {
    if (cancelled) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    track?.removeEventListener('ended', onEnded);
    document.removeEventListener('visibilitychange', onVis);
    const timeSec = g.startMs ? (performance.now() - g.startMs) / 1000 : 0;
    const score = scoreAttempt({ completed: g.score });
    state.attempts.push({ score, completed: g.score, timeSec, died, msg });
    goto('attempt-end');
  }

  function step(dt, elapsedSec) {
    const { eff, fist } = readInput();
    const onGround = g.y + RUNNER_H >= GROUND_Y - 0.5;
    if (onGround && eff > 0 && g.lastEff === 0) g.vy = -palmCountToJumpStrength(eff);
    g.lastEff = eff;
    g.ducking = fist && onGround;
    g.vy += GRAVITY * dt;
    g.y += g.vy * dt;
    if (g.y + RUNNER_H > GROUND_Y) { g.y = GROUND_Y - RUNNER_H; g.vy = 0; }

    const speed = runSpeed(elapsedSec);
    g.runPhase += 0.3 * dt;

    for (const p of g.particles) {
      p.x -= speed * p.z * dt;
      if (p.x < -2) { p.x = CANVAS_W + Math.random() * 40; p.y = Math.random() * GROUND_Y; }
    }

    if (!g.warming) {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) {
        spawnObstacle(elapsedSec);
        g.spawnTimer = spawnIntervalFrames(elapsedSec) + Math.random() * 30;
      }
    }

    for (const o of g.obs) {
      o.x -= speed * dt;
      if (!o.passed && o.x + o.w < RUNNER_X) {
        o.passed = true;
        g.score += 1;
        $('scoreLabel').textContent = `${g.score}`;
      }
    }
    g.obs = g.obs.filter(o => o.x + o.w > 0);

    const kh = g.ducking ? RUNNER_H * 0.55 : RUNNER_H;
    const box = { x: RUNNER_X, y: g.y + (RUNNER_H - kh), w: RUNNER_W, h: kh };
    for (const o of g.obs) { if (intersects(box, o)) { endAttempt(true); return; } }
  }

  function drawRunner() {
    const kh = g.ducking ? RUNNER_H * 0.55 : RUNNER_H;
    const top = g.y + (RUNNER_H - kh);
    // Legs occupy the bottom LEG_LEN of the silhouette so the feet land on
    // GROUND_Y instead of dangling below it. Ducking = tucked, no legs.
    const bodyH = g.ducking ? kh : kh - LEG_LEN;
    const footY = top + kh;
    ctx.fillStyle = css('--text');
    ctx.beginPath();
    ctx.roundRect(RUNNER_X, top, RUNNER_W, bodyH, 6);
    ctx.fill();
    ctx.fillStyle = css('--accent');
    ctx.beginPath();
    ctx.arc(RUNNER_X + RUNNER_W - 8, top + 12, 3, 0, Math.PI * 2);
    ctx.fill();
    if (!g.ducking) {
      const swing = Math.sin(g.runPhase) * 6;
      ctx.strokeStyle = css('--text');
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(RUNNER_X + 8, top + bodyH);
      ctx.lineTo(RUNNER_X + 8 - swing, footY);
      ctx.moveTo(RUNNER_X + RUNNER_W - 8, top + bodyH);
      ctx.lineTo(RUNNER_X + RUNNER_W - 8 + swing, footY);
      ctx.stroke();
    }
  }

  function drawParticles() {
    ctx.fillStyle = css('--accent');
    for (const p of g.particles) {
      ctx.globalAlpha = 0.08 + p.z * 0.16;
      const s = 1 + p.z * 2;
      ctx.fillRect(p.x, p.y, s, s);
    }
    ctx.globalAlpha = 1;
  }

  function draw() {
    ctx.fillStyle = css('--bg');
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawParticles();
    ctx.strokeStyle = css('--accent');
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(0, GROUND_Y);
    ctx.lineTo(CANVAS_W, GROUND_Y);
    ctx.stroke();
    for (const o of g.obs) {
      ctx.fillStyle = css('--bg-2');
      ctx.strokeStyle = o.type === 'high' ? css('--bad') : css('--accent');
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(o.x, o.y, o.w, o.h, 4);
      ctx.fill();
      ctx.stroke();
    }
    drawRunner();
  }

  function drawWarmupBanner(secondsLeft) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--accent');
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('WARM UP · practice!', CANVAS_W / 2, 70);
    ctx.fillStyle = css('--text');
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`obstacles in ${secondsLeft}`, CANVAS_W / 2, 104);
    ctx.restore();
  }

  function loop() {
    if (cancelled) return;
    const now = performance.now();
    const dt = Math.min(2.5, (now - prevTs) / 16.6667);
    prevTs = now;

    fpsFrames++;
    if (now - fpsLast > 1000) {
      const fps = (fpsFrames * 1000) / (now - fpsLast);
      fpsFrames = 0; fpsLast = now;
      if (fps < 40) { slowTicks++; if (slowTicks >= 3) { showToast('Low frame rate — moves may feel slow'); slowTicks = 0; } }
      else slowTicks = 0;
    }

    if (g.warming) {
      const left = warmupSecondsLeft((now - g.warmStartMs) / 1000);
      if (left <= 0) {
        // Transition to live play this same frame; falls through below.
        g.warming = false;
        g.startMs = now;
        g.spawnTimer = 0;
      } else {
        $('timerLabel').textContent = 'WARM UP';
        step(dt, 0);
        if (cancelled) return;
        draw();
        drawWarmupBanner(left);
        rafId = requestAnimationFrame(loop);
        return;
      }
    }

    const elapsed = (now - g.startMs) / 1000;
    $('timerLabel').textContent = elapsed.toFixed(1);

    step(dt, elapsed);
    if (cancelled) return;
    draw();
    rafId = requestAnimationFrame(loop);
  }

  rafId = requestAnimationFrame(loop);

  activeCleanup = () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    track?.removeEventListener('ended', onEnded);
    document.removeEventListener('visibilitychange', onVis);
  };
};

// ATTEMPT-END
phaseEnter['attempt-end'] = () => {
  const last = state.attempts[state.attempts.length - 1];
  $('attemptResultTitle').textContent = last.msg || '💥 Crashed';
  $('attemptCompleted').textContent = last.completed;
  $('attemptTime').textContent = last.timeSec.toFixed(1);

  const attemptsLeft = MAX_ATTEMPTS - state.attempts.length;
  const tryAgain = $('attemptTryAgain');
  tryAgain.classList.toggle('hidden', attemptsLeft <= 0);
  tryAgain.onclick = () => { state.attemptIdx++; goto('intro'); };
  $('attemptFinish').onclick = () => goto('final');
};

// FINAL
phaseEnter.final = () => {
  if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
  if (state.tracker) { try { state.tracker.stop(); } catch {} state.tracker = null; }

  const score = finalScore(state.attempts);
  $('finalTitle').textContent = '🏁 Run complete';
  $('resTeam').textContent = state.teamId;
  $('resScore').textContent = score;

  const status = $('saveStatus');
  $('finalReturnLink').href = catalogHref;
  status.className = 'save-status';
  status.textContent = 'SAVING…';
  const trySubmit = async () => {
    if (await isGameLockedFor({ db, ref, get, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE })) {
      const err = new Error('locked'); err.locked = true; throw err;
    }
    return submitScore({
      writer, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
    });
  };
  trySubmit().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    if (e.locked) {
      status.className = 'save-status bad';
      status.textContent = 'LOCKED — score not saved';
      status.onclick = null;
      return;
    }
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });

  wireRestart();
};

function wireRestart() {
  $('finalPlayAgain').onclick = async () => {
    if (!await requireAdmin(session?.lobbyId, { promptText: 'Something went wrong? Enter admin password to restart:' })) return;
    state.attempts = [];
    state.attemptIdx = 0;
    goto('setup');
  };
}

// Already-played view: show saved score + admin-gated restart, without re-submitting.
function enterAlreadyPlayed(existing) {
  $('phase-boot').classList.add('hidden');
  for (const p of PHASES) $(`phase-${p}`).classList.add('hidden');
  $('phase-final').classList.remove('hidden');
  $('briefing').classList.add('hidden');
  $('finalTitle').textContent = '✅ Already submitted';
  $('resTeam').textContent = state.teamId;
  $('resScore').textContent = existing;
  const status = $('saveStatus');
  status.className = 'save-status ok';
  status.textContent = 'SAVED ✓';
  status.onclick = null;
  $('finalReturnLink').href = catalogHref;
  wireRestart();
}

// Bootstrap
async function boot() {
  if (session?.lobbyId) {
    try {
      const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${state.teamId}/${GAME_CODE}`));
      if (snap.exists()) { enterAlreadyPlayed(snap.val()); return; }
    } catch (e) { console.error('score check failed', e); }
    if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: state.teamId, gameKey: GAME_CODE })) {
      renderLockedScreen(catalogHref);
      return;
    }
  }
  goto('setup');
}
for (const p of PHASES) $(`phase-${p}`).classList.add('hidden');
boot();
