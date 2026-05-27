import { createAudioInput } from '../shared/audio.js';
import { showDenialModal } from '../shared/perms.js';
import { mountTopbar } from '../shared/topbar.js';
import { resolveSession } from '../shared/lobby.js';
import { requireAdmin } from '../shared/admin-gate.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, update, push, get } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
import {
  MAX_PIPES, ATTEMPT_CAP_S, GAIN, GRAVITY,
  ampToThrust, scoreAttempt, finalScore,
} from '../shared/flappy-logic.js';

mountTopbar({ activePage: 'games' });
const session = resolveSession();
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const writer = firebaseWriter({ db, ref, update, push });
const catalogHref = session
  ? `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`
  : '../games.html';

const GAME_CODE = 'FL';
const MAX_ATTEMPTS = 3;
const CANVAS_W = 960, CANVAS_H = 540;
const PIPE_W = 80, GAP_H = 240, ORB_R = 18, ORB_X = 220;
const METER_MAX = 0.30;
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
    if (!state.audio) state.audio = await createAudioInput({ smoothing: 0.7 });
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
  const canvas = $('flappyCanvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  $('scoreLabel').textContent = `0 / ${MAX_PIPES}`;
  $('attemptLabel').textContent = `${state.attemptIdx + 1} / ${MAX_ATTEMPTS}`;
  $('timerLabel').textContent = '0.0';

  const g = {
    y: CANVAS_H / 2, vy: 0, score: 0,
    pipes: [], spawnTimer: 0, worldX: 0,
    floor: 0, calibrating: true, calibStart: performance.now(), calibSamples: [],
    startMs: 0,
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
      else if (g.startMs) g.startMs += delta;
      prevTs = performance.now();
      hiddenAt = 0;
    }
  };
  document.addEventListener('visibilitychange', onVis);

  function endAttempt(died, msg) {
    if (cancelled) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', onVis);
    const timeSec = g.startMs ? (performance.now() - g.startMs) / 1000 : 0;
    const score = scoreAttempt({ completed: g.score, timeSec });
    state.attempts.push({ score, completed: g.score, timeSec, died, msg });
    goto('attempt-end');
  }

  function spawnPipe() {
    const minY = 80;
    const maxY = CANVAS_H - 80 - GAP_H;
    const topH = minY + Math.random() * (maxY - minY);
    g.pipes.push({ x: CANVAS_W + PIPE_W, topH, passed: false });
  }

  function updateMeter(amp) {
    const pct = Math.max(0, Math.min(100, (amp / METER_MAX) * 100));
    $('voiceFill').style.height = `${pct}%`;
    $('floorLine').style.bottom = `${Math.min(100, (g.floor / METER_MAX) * 100)}%`;
  }

  function step(dt) {
    const amp = state.audio.amplitude();
    updateMeter(amp);
    const thrust = ampToThrust(amp, g.floor);
    g.vy += GRAVITY * dt;
    g.vy -= thrust * dt;
    g.vy = Math.max(-10, Math.min(10, g.vy));
    g.y += g.vy * dt;
    // Clamp to the play area: the orb gets stuck against the top/bottom edge
    // instead of failing the attempt. Pipe collisions still end it.
    if (g.y < ORB_R) { g.y = ORB_R; if (g.vy < 0) g.vy = 0; }
    else if (g.y > CANVAS_H - ORB_R) { g.y = CANVAS_H - ORB_R; if (g.vy > 0) g.vy = 0; }

    const speed = Math.min(6, 3 + g.score * 0.12);
    g.worldX += speed * dt;
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) { spawnPipe(); g.spawnTimer = Math.max(100, 160 - g.score * 2); }

    for (const p of g.pipes) {
      p.x -= speed * dt;
      if (!p.passed && p.x + PIPE_W < ORB_X) {
        p.passed = true;
        g.score = Math.min(MAX_PIPES, g.score + 1);
        $('scoreLabel').textContent = `${g.score} / ${MAX_PIPES}`;
        if (g.score >= MAX_PIPES) { endAttempt(false); return; }
      }
      const inX = ORB_X + ORB_R > p.x && ORB_X - ORB_R < p.x + PIPE_W;
      if (inX) {
        const inGap = g.y - ORB_R > p.topH && g.y + ORB_R < p.topH + GAP_H;
        if (!inGap) { endAttempt(true); return; }
      }
    }
    g.pipes = g.pipes.filter(p => p.x + PIPE_W > 0);
    g._thrusting = thrust > 0;
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
      const by = p.topH + GAP_H;
      ctx.fillRect(p.x, by, PIPE_W, CANVAS_H - by);
      ctx.strokeRect(p.x, by, PIPE_W, CANVAS_H - by);
    }
    const r = g._thrusting ? ORB_R * 1.1 : ORB_R;
    ctx.fillStyle = css('--accent');
    ctx.beginPath();
    ctx.arc(ORB_X, g.y, r, 0, Math.PI * 2);
    ctx.fill();
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
        g.floor = g.calibSamples[Math.floor(g.calibSamples.length / 2)] || 0;
        g.calibrating = false;
        g.startMs = now;
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
    document.removeEventListener('visibilitychange', onVis);
    calibOverlay.classList.add('hidden');
  };
};

// ATTEMPT-END
phaseEnter['attempt-end'] = () => {
  const last = state.attempts[state.attempts.length - 1];
  $('attemptResultTitle').textContent =
    last.msg ? last.msg
    : last.completed >= MAX_PIPES ? '🏁 All gates cleared!'
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
  if (state.audio) { try { state.audio.stop(); } catch {} state.audio = null; }

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
  }
  goto('setup');
}
for (const p of PHASES) $(`phase-${p}`).classList.add('hidden');
boot();
