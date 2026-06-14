import { createAudioInput } from '../shared/audio.js';
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
  METER_MAX, METER_MAX_SOLO,
  nextVelocity, scoreAttempt, finalScore,
  pipeSpeed, pipeSpawnFrames, pipeGap,
} from '../shared/flappy-logic.js';
import { warmupSecondsLeft } from '../shared/warmup-logic.js';

mountTopbar({ activePage: 'games' });
const session = resolveSession();
// Individuals (solo) mode: input is voice with no choice, just solo briefing
// copy instead of "the whole team yells" (#41). Resolved from lobby meta at boot.
let individuals = false;
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const writer = firebaseWriter({ db, ref, update, push });
const catalogHref = session
  ? `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`
  : '../games.html';

const GAME_CODE = 'FL';
const MAX_ATTEMPTS = 5;
const CANVAS_W = 960, CANVAS_H = 540;
const PIPE_W = 80, ORB_R = 18, ORB_X = 220;
const CALIB_MS = 1500;

const PHASES = ['setup', 'loading', 'intro', 'play', 'attempt-end', 'final'];
const phaseEnter = {};
let activeCleanup = null;

const state = {
  teamId: session?.teamId ?? 0,
  audio: null,
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

// SETUP
$('startBtn').addEventListener('click', () => {
  state.attempts = [];
  state.attemptIdx = 0;
  goto('loading');
});

// LOADING
phaseEnter.loading = async () => {
  try {
    if (!state.audio) state.audio = await createAudioInput({ smoothing: 0.85 });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
      showDenialModal('microphone');
    } else {
      alert('Failed to start microphone: ' + (e.message || e));
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
  // Solo lobby uses a lower volume threshold so one player needn't shout.
  const meterMax = individuals ? METER_MAX_SOLO : METER_MAX;

  const canvas = $('flappyCanvas');
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

  $('scoreLabel').textContent = '0';
  $('attemptLabel').textContent = `${state.attemptIdx + 1} / ${MAX_ATTEMPTS}`;
  $('timerLabel').textContent = '0.0';

  const g = {
    y: CANVAS_H / 2, vy: 0, score: 0, r: ORB_R, _thrusting: false,
    pipes: [], spawnTimer: 0,
    floor: 0, calibrating: true, calibStart: performance.now(), calibSamples: [],
    warming: false, warmStartMs: 0, startMs: 0,
  };

  let rafId = null, cancelled = false, prevTs = performance.now(), hiddenAt = 0;
  let fpsFrames = 0, fpsLast = performance.now(), slowTicks = 0;

  const calibOverlay = $('calibOverlay');
  calibOverlay.classList.remove('hidden');

  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if (g.calibrating) g.calibStart += delta;
      else if (g.warming) g.warmStartMs += delta;   // pause the warmup countdown
      else if (g.startMs) g.startMs += delta;       // pause the scored clock
      prevTs = performance.now();
      hiddenAt = 0;
    }
  };
  document.addEventListener('visibilitychange', onVis);

  // Mic device-loss mid-run (e.g. USB headset unplugged): end the attempt with a
  // clear message instead of the orb silently free-falling. Mirrors dino's camera
  // 'ended' handler.
  const track = state.audio?.track;
  const onMicEnded = () => endAttempt(true, '🎤 Microphone disconnected');
  track?.addEventListener('ended', onMicEnded);

  function endAttempt(died, msg) {
    if (cancelled) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    track?.removeEventListener('ended', onMicEnded);
    document.removeEventListener('visibilitychange', onVis);
    const timeSec = g.startMs ? (performance.now() - g.startMs) / 1000 : 0;
    const score = scoreAttempt({ completed: g.score });
    state.attempts.push({ score, completed: g.score, timeSec, died, msg });
    goto('attempt-end');
  }

  function spawnPipe(elapsedSec) {
    const gap = pipeGap(elapsedSec);
    const minY = 80;
    const maxY = CANVAS_H - 80 - gap;
    const topH = minY + Math.random() * (maxY - minY);
    g.pipes.push({ x: CANVAS_W + PIPE_W, topH, gap, passed: false });
  }

  function updateMeter(amp) {
    const pct = Math.max(0, Math.min(100, (amp / meterMax) * 100));
    $('voiceFill').style.width = `${pct}%`;
    $('floorLine').style.left = `${Math.min(100, (g.floor / meterMax) * 100)}%`;
  }

  function step(dt, elapsedSec) {
    const amp = state.audio.amplitude();
    updateMeter(amp);
    // Real-time control: vy chases a sound-driven target speed (no momentum coast).
    g.vy = nextVelocity(g.vy, amp, g.floor, dt, meterMax);
    g.y += g.vy * dt;
    // One radius drives BOTH the drawn orb and its hitbox: rising → pulse bigger.
    // (Previously the orb was drawn at ORB_R*1.1 while thrusting but the hitbox
    // stayed ORB_R, so a thrusting orb visibly overlapped pipes without crashing.)
    g._thrusting = g.vy < 0;
    const r = g._thrusting ? ORB_R * 1.1 : ORB_R;
    g.r = r;
    // Clamp to the play area: the orb gets stuck against the top/bottom edge
    // instead of failing the attempt. Pipe collisions still end it.
    if (g.y < r) { g.y = r; if (g.vy < 0) g.vy = 0; }
    else if (g.y > CANVAS_H - r) { g.y = CANVAS_H - r; if (g.vy > 0) g.vy = 0; }

    // Endless difficulty ramps with elapsed time (mirrors dino).
    const speed = pipeSpeed(elapsedSec);
    if (!g.warming) {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) { spawnPipe(elapsedSec); g.spawnTimer = pipeSpawnFrames(elapsedSec); }
    }

    for (const p of g.pipes) {
      p.x -= speed * dt;
      if (!p.passed && p.x + PIPE_W < ORB_X) {
        p.passed = true;
        g.score += 1;
        $('scoreLabel').textContent = `${g.score}`;
      }
      const inX = ORB_X + r > p.x && ORB_X - r < p.x + PIPE_W;
      if (inX) {
        const inGap = g.y - r > p.topH && g.y + r < p.topH + p.gap;
        if (!inGap) { endAttempt(true); return; }
      }
    }
    g.pipes = g.pipes.filter(p => p.x + PIPE_W > 0);
  }

  function draw() {
    ctx.fillStyle = css('--bg');
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (const p of g.pipes) {
      ctx.fillStyle = css('--card');
      ctx.strokeStyle = css('--accent');
      ctx.lineWidth = 2;
      ctx.fillRect(p.x, 0, PIPE_W, p.topH);
      ctx.strokeRect(p.x, 0, PIPE_W, p.topH);
      const by = p.topH + p.gap;
      ctx.fillRect(p.x, by, PIPE_W, CANVAS_H - by);
      ctx.strokeRect(p.x, by, PIPE_W, CANVAS_H - by);
    }
    // Same radius the hitbox uses (set in step) so drawing and collision agree.
    const r = g.r ?? ORB_R;
    ctx.fillStyle = css('--accent');
    ctx.beginPath();
    ctx.arc(ORB_X, g.y, r, 0, Math.PI * 2);
    ctx.fill();
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

    if (g.calibrating) {
      g.calibSamples.push(state.audio.amplitude());
      if (now - g.calibStart >= CALIB_MS) {
        g.calibSamples.sort((a, b) => a - b);
        const median = g.calibSamples[Math.floor(g.calibSamples.length / 2)] || 0;
        // Loud-room guard: cap the noise floor below METER_MAX so a usable rise
        // range always remains. Without this, a noisy room calibrates the floor
        // at/above the meter max and the orb can only ever fall (unwinnable).
        g.floor = Math.min(median, meterMax * 0.7);
        g.calibrating = false;
        g.warming = true;
        g.warmStartMs = now;
        prevTs = now;
        calibOverlay.classList.add('hidden');
      }
      draw();
      rafId = requestAnimationFrame(loop);
      return;
    }

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
    track?.removeEventListener('ended', onMicEnded);
    document.removeEventListener('visibilitychange', onVis);
    calibOverlay.classList.add('hidden');
  };
};

// ATTEMPT-END
phaseEnter['attempt-end'] = () => {
  const last = state.attempts[state.attempts.length - 1];
  $('attemptResultTitle').textContent = last.msg ? last.msg : '💥 Crashed';
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
  if (state.audio) { try { state.audio.stop(); } catch {} state.audio = null; }

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
    if (!await requireAdmin(session?.lobbyId, { promptText: 'Something went wrong? Enter admin password to restart:', force: true })) return;
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
function applyIndividualsCopy() {
  if (!individuals) return;
  const who = $('flappyGoalWho');
  if (who) who.textContent = 'yell';
  const introWho = $('flappyIntroWho');
  if (introWho) introWho.textContent = 'When the run starts, yell to fly.';
  const vol = $('flappyVolLabel');
  if (vol) vol.textContent = 'Volume';
  const lbl = $('resTeamLabel');
  if (lbl) lbl.textContent = 'Player';
}

async function boot() {
  if (session?.lobbyId) {
    try {
      const modeSnap = await get(ref(db, `lobbies/${session.lobbyId}/meta/mode`));
      individuals = modeSnap.exists() && modeSnap.val() === 'individuals';
    } catch (e) { console.error('mode read failed', e); }
  }
  const params = new URLSearchParams(location.search);
  if (params.has('debug') && params.has('individuals')) individuals = true;
  applyIndividualsCopy();
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
