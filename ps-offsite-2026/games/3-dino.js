import { createCamStream, createHandTracker, isPalmOpen, isFist } from '../shared/vision.js';
import { showDenialModal } from '../shared/perms.js';
import { mountTopbar } from '../shared/topbar.js';
import { resolveSession } from '../shared/lobby.js';
import { requireAdmin } from '../shared/admin-gate.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, update, push } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
import {
  MAX_OBSTACLES, ATTEMPT_CAP_S, PALM_COUNT_WINDOW,
  palmCountToJumpStrength, scoreAttempt, finalScore,
} from '../shared/dino-logic.js';

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
const RUNNER_X = 240, RUNNER_W = 30, RUNNER_H = 60;
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
  for (const p of PHASES) $(`phase-${p}`).classList.add('hidden');
  $(`phase-${phase}`).classList.remove('hidden');
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
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  $('camPreview').srcObject = state.stream;

  $('scoreLabel').textContent = `0 / ${MAX_OBSTACLES}`;
  $('attemptLabel').textContent = `${state.attemptIdx + 1} / ${MAX_ATTEMPTS}`;
  $('timerLabel').textContent = '0.0';

  const g = {
    y: GROUND_Y - RUNNER_H, vy: 0, ducking: false,
    meters: 0, score: 0, obs: [], spawnTimer: 0, runPhase: 0,
    palmWindow: [], lastEff: 0, startMs: performance.now(),
  };

  let rafId = null, cancelled = false, prevTs = performance.now(), hiddenAt = 0;
  let fpsFrames = 0, fpsLast = performance.now(), slowTicks = 0;

  const track = state.stream.getVideoTracks()[0];
  const onEnded = () => endAttempt(true, '📷 Camera disconnected');
  track?.addEventListener('ended', onEnded);

  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) { g.startMs += performance.now() - hiddenAt; hiddenAt = 0; prevTs = performance.now(); }
  };
  document.addEventListener('visibilitychange', onVis);

  function readInput() {
    const hands = state.tracker.latest().hands;
    const palms = hands.filter(isPalmOpen).length;
    g.palmWindow.push(palms);
    if (g.palmWindow.length > PALM_COUNT_WINDOW) g.palmWindow.shift();
    const eff = (DEBUG && debugPalms !== null) ? debugPalms : Math.max(0, ...g.palmWindow);
    const fist = hands.some(isFist);
    updatePalmHud(eff);
    return { eff, fist };
  }

  function spawnObstacle() {
    const high = g.score >= 4 && Math.random() < 0.4;
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
    const timeSec = (performance.now() - g.startMs) / 1000;
    const score = scoreAttempt({ completed: g.score, timeSec });
    state.attempts.push({ score, completed: g.score, timeSec, died, msg });
    goto('attempt-end');
  }

  function step(dt) {
    const { eff, fist } = readInput();
    const onGround = g.y + RUNNER_H >= GROUND_Y - 0.5;
    if (onGround && eff > 0 && g.lastEff === 0) g.vy = -palmCountToJumpStrength(eff);
    g.lastEff = eff;
    g.ducking = fist && onGround;
    g.vy += GRAVITY * dt;
    g.y += g.vy * dt;
    if (g.y + RUNNER_H > GROUND_Y) { g.y = GROUND_Y - RUNNER_H; g.vy = 0; }

    const speed = Math.min(9, 4 + g.meters * 0.02);
    g.meters += speed * 0.06 * dt;
    g.runPhase += 0.3 * dt;

    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      spawnObstacle();
      g.spawnTimer = Math.max(60, 110 - g.meters * 0.3) + Math.random() * 30;
    }

    for (const o of g.obs) {
      o.x -= speed * dt;
      if (!o.passed && o.x + o.w < RUNNER_X) {
        o.passed = true;
        g.score = Math.min(MAX_OBSTACLES, g.score + 1);
        $('scoreLabel').textContent = `${g.score} / ${MAX_OBSTACLES}`;
        if (g.score >= MAX_OBSTACLES) { endAttempt(false); return; }
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
    ctx.fillStyle = css('--text');
    ctx.beginPath();
    ctx.roundRect(RUNNER_X, top, RUNNER_W, kh, 6);
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
      ctx.moveTo(RUNNER_X + 8, top + kh);
      ctx.lineTo(RUNNER_X + 8 - swing, top + kh + 10);
      ctx.moveTo(RUNNER_X + RUNNER_W - 8, top + kh);
      ctx.lineTo(RUNNER_X + RUNNER_W - 8 + swing, top + kh + 10);
      ctx.stroke();
    }
  }

  function draw() {
    ctx.fillStyle = css('--bg');
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
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

    const elapsed = (now - g.startMs) / 1000;
    $('timerLabel').textContent = elapsed.toFixed(1);
    if (elapsed > ATTEMPT_CAP_S) { endAttempt(false); return; }

    step(dt);
    if (cancelled) return;
    draw();
    rafId = requestAnimationFrame(loop);
  }

  $('playAbort').onclick = () => endAttempt(true, 'Aborted');
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
  $('attemptResultTitle').textContent =
    last.msg ? last.msg
    : last.completed >= MAX_OBSTACLES ? '🏁 Course cleared!'
    : '💥 Crashed';
  $('attemptCompleted').textContent = last.completed;
  $('attemptTime').textContent = last.timeSec.toFixed(1);
  $('attemptScoreVal').textContent = last.score;

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
  $('finalTitle').textContent = score >= 100 ? '🏆 Perfect run!' : '🏁 Run complete';
  $('resTeam').textContent = state.teamId;
  $('resScore').textContent = score;

  const status = $('saveStatus');
  $('finalReturnLink').href = catalogHref;
  status.className = 'save-status';
  status.textContent = 'SAVING…';
  const trySubmit = () => submitScore({
    writer, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
  });
  trySubmit().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });

  $('finalPlayAgain').onclick = async () => {
    if (!await requireAdmin(session?.lobbyId, { promptText: 'Admin password required to replay:' })) return;
    state.attempts = [];
    state.attemptIdx = 0;
    goto('setup');
  };
};

// Bootstrap
goto('setup');
