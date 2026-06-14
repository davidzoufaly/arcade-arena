import { createCamStream, createHandTracker, isPalmOpen, isFist } from '../shared/vision.js';
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
  PALM_COUNT_WINDOW, TRACKER_CEILING, TRACKER_BUFFER,
  CALIB_TOTAL_S, CALIB_GRACE_S, FALLBACK_N, MIN_N,
  palmCountToJumpStrength, pickCalibratedHandCount, effectivePalmCount,
  scoreAttempt, finalScore,
  runSpeed, spawnIntervalFrames, highObstacleProb,
  SEGMENT_PLAY_S, rotateSecondsLeft, segmentSecondsLeft,
  SOLO_JUMP_STRENGTH, PEAK_JUMP_STRENGTH,
  TEAM_JUMP_STRENGTH, TEAM_DOUBLE_JUMP_STRENGTH, doubleJumpThreshold,
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
const MAX_ATTEMPTS = 5;
const CANVAS_W = 960, CANVAS_H = 540;
const GROUND_Y = Math.round(CANVAS_H * 0.78);
const RUNNER_X = 240, RUNNER_W = 30, RUNNER_H = 60, LEG_LEN = 10;
const GRAVITY = 0.8;

const PHASES = ['setup', 'loading', 'calibrate', 'intro', 'play', 'attempt-end', 'final'];
const phaseEnter = {};
let activeCleanup = null;

// Individuals (solo) mode: one player, no hand-count calibration, no rotate
// breaks, one-hand jump, tighter difficulty. Resolved from lobby meta at boot.
let individuals = false;

const state = {
  teamId: session?.teamId ?? 0,
  tracker: null, stream: null, video: null,
  teamN: null,
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

// Solo-dev debug: with ?debug in the URL, hold keys 0-9 for exact palm count;
// shift+0..9 maps to 10..19 (TRACKER_CEILING=20 is not reachable by keyboard).
// Keyup clears, so each press re-triggers a jump like raising/lowering hands.
const DEBUG = new URLSearchParams(location.search).has('debug');
let debugPalms = null;
if (DEBUG) {
  const parseKey = (e) => {
    if (e.key >= '0' && e.key <= '9') return e.shiftKey ? 10 + Number(e.key) : Number(e.key);
    return null;
  };
  window.addEventListener('keydown', (e) => {
    const n = parseKey(e);
    // Read state.teamN inside the handler so the bound updates after lock-in.
    const upper = state.teamN ?? TRACKER_CEILING;
    if (n !== null && n <= upper) debugPalms = n;
  });
  window.addEventListener('keyup', (e) => { if (parseKey(e) !== null) debugPalms = null; });
}

// ?debug&team=N forces state.teamN at boot and skips the calibrate phase.
// Useful for solo testing where a single user can't supply >2 hands.
// Guarded by DEBUG so a production URL with a stray `team` query param cannot
// accidentally skip calibration.
const DEBUG_TEAM_N = DEBUG ? (() => {
  const raw = new URLSearchParams(location.search).get('team');
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_N || n > TRACKER_CEILING) return null;
  return Math.floor(n);
})() : null;
if (DEBUG_TEAM_N !== null) state.teamN = DEBUG_TEAM_N;

// Players actually at the camera per wave. Calibration measures the FULL team
// size (state.teamN) only to decide whether to rotate — but a team lobby always
// runs exactly two players at once (a 2-player team plays together; a 3+ team
// rotates pairs in). Solo (#43) is one. The HUD, jump scaling and double-jump
// threshold all key off this, not the full team size.
const ACTIVE_PLAYERS_TEAM = 2;
const activePlayers = () => (individuals ? 1 : ACTIVE_PLAYERS_TEAM);

const palmDotsEl = $('palmDots');
// One pip per ACTIVE player (not the whole team) so the HUD never implies more
// than two hands are in play. Rebuilt once the active count is known.
function rebuildPips(count) {
  palmDotsEl.innerHTML = '';
  for (let i = 0; i < count; i++) {
    const d = document.createElement('div');
    d.className = 'pip';
    palmDotsEl.appendChild(d);
  }
}
// Until the mode is resolved at boot, show two placeholder pips (the team
// default); the solo/loading paths rebuild to the real active count.
rebuildPips(DEBUG_TEAM_N !== null ? Math.min(DEBUG_TEAM_N, ACTIVE_PLAYERS_TEAM) : ACTIVE_PLAYERS_TEAM);
function updatePalmHud(n) {
  const pips = palmDotsEl.children;
  for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < n);
  // Solo: a single palm = a fixed-strength jump (#42), so the meter just reads
  // armed/idle (100% / 0%). Teams: scale against the two active players so both
  // palms up fills the bar (and arms the mid-air double jump).
  const pct = individuals
    ? (n > 0 ? 100 : 0)
    : (palmCountToJumpStrength(n, activePlayers()) / PEAK_JUMP_STRENGTH) * 100;
  $('jumpFill').style.width = `${pct}%`;
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
      state.tracker = await createHandTracker(video, {
        numHands: DEBUG_TEAM_N !== null
          ? Math.min(TRACKER_CEILING, DEBUG_TEAM_N + TRACKER_BUFFER)
          : TRACKER_CEILING,
        minRunMs: 0,
      });
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
  // Individuals mode: no hand-count locking (#43) — one player, jump strength is
  // fixed, so skip the calibrate phase entirely and start the run.
  if (individuals) { state.teamN = 1; rebuildPips(1); goto('intro'); return; }
  goto('calibrate');
};

// CALIBRATE — separate big-video phase before the game (mirrors gesture-lock).
// Runs once, right after Start game / loading. Attempts 2+ never re-enter
// (attempt-end → intro). The ?debug&team=N path sets state.teamN at boot, so
// calibrate is a no-op and jumps straight to the intro.
phaseEnter.calibrate = () => {
  if (state.teamN !== null) { goto('intro'); return; }

  // Big preview of the player's framing. The continuously-running tracker
  // (bound to state.video in loading) keeps reading hands; calibVideo just
  // mirrors the same stream for display.
  const previewVideo = $('calibVideo');
  previewVideo.srcObject = state.stream;
  previewVideo.play().catch(e => console.warn('Dino calibration: preview play() failed', e));

  const g = {
    startedMs: performance.now(),
    samples: [],       // hands.length per frame, only after grace
    liveBuf: [],       // last ~20 frames for smoothed banner count
    liveMax: 0,
    locking: false,    // re-entrancy guard while async lock-in is in flight
  };
  let cancelled = false;
  let rafId = null;

  async function lockIn() {
    g.locking = true;
    const detected = pickCalibratedHandCount(g.samples);
    const newCap = Math.min(TRACKER_CEILING, detected + TRACKER_BUFFER);

    // Open the new tracker BEFORE closing the old one. If construction throws,
    // the old tracker stays live and the team plays with the ceiling cap.
    let newTracker = null;
    try {
      newTracker = await createHandTracker(state.video, { numHands: newCap, minRunMs: 0 });
    } catch (e) {
      console.warn('Dino calibration: tracker recreate failed, keeping ceiling cap', e);
    }

    if (cancelled) {
      try { newTracker?.stop(); } catch {}
      g.locking = false;
      return;
    }

    if (newTracker) {
      try { state.tracker.stop(); } catch {}
      state.tracker = newTracker;
    }

    state.teamN = detected;

    // HUD shows one pip per ACTIVE player (always two for a team), not the full
    // detected team — only two play per wave; the rest rotate in.
    rebuildPips(activePlayers());

    console.info('Dino calibration: locked', {
      teamN: state.teamN,
      activePlayers: activePlayers(),
      rotates: state.teamN > ACTIVE_PLAYERS_TEAM,
      cap: newTracker ? newCap : TRACKER_CEILING,
      samples: g.samples.length,
      recreateOk: !!newTracker,
    });

    g.locking = false;
    goto('intro');
  }

  function tick() {
    if (cancelled) return;
    const now = performance.now();
    const elapsed = (now - g.startedMs) / 1000;

    if (!g.locking) {
      const handsNow = state.tracker.latest().hands.length;
      g.liveBuf.push(handsNow);
      if (g.liveBuf.length > 20) g.liveBuf.shift();
      g.liveMax = g.liveBuf.reduce((m, v) => v > m ? v : m, 0);
      if (elapsed >= CALIB_GRACE_S) g.samples.push(handsNow);
    }

    $('calibCount').textContent = String(g.liveMax);
    $('calibTimer').textContent = String(Math.max(0, Math.ceil(CALIB_TOTAL_S - elapsed)));

    if (elapsed >= CALIB_TOTAL_S && !g.locking) {
      lockIn(); // fire-and-forget; RAF chain stops here, lockIn() calls goto('intro')
      return;
    }
    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  // #36 — let the team lock in early instead of waiting the full 20s. The 20s
  // auto-lock in tick() remains as a fallback if nobody clicks. If clicked
  // before any post-grace samples exist, fall back to the live buffer so the
  // detected count still reflects what the camera currently sees.
  const confirmBtn = $('calibConfirmBtn');
  const onConfirm = () => {
    if (g.locking || cancelled) return;
    if (rafId) cancelAnimationFrame(rafId);
    if (!g.samples.length) g.samples = g.liveBuf.slice();
    lockIn();
  };
  confirmBtn?.addEventListener('click', onConfirm);

  activeCleanup = () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    confirmBtn?.removeEventListener('click', onConfirm);
  };
};

// INTRO
phaseEnter.intro = () => {
  $('introNum').textContent = state.attemptIdx + 1;
  if (individuals) {
    $('introBrief').innerHTML =
      '<strong>Solo run</strong> — make the runner 🌀 jump ⬆️ and duck ⬇️ past obstacles 🌵; it keeps speeding up 💨.<br>' +
      'Each run opens with a <strong>~10s warm-up</strong> to practise the gestures — no obstacles until it ends.<br>' +
      '✋ Open palm = jump · ✊ Fist = duck · ✌️ Victory = stay ready between jumps<br>' +
      'Score = obstacles passed. Best of <strong>5 attempts</strong> counts 🏆.';
  }
  $('introStartBtn').onclick = () => goto('play');
};

// PLAY
phaseEnter.play = () => {
  // Only two players play per wave. A 2-player team is the whole team, so it
  // plays one continuous endless run (nobody to swap in). A 3+ team rotates the
  // extra players in during the 10s breaks. Solo (#42) never rotates.
  const rotates = !individuals && (state.teamN ?? FALLBACK_N) > ACTIVE_PLAYERS_TEAM;

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

  // Mirror the canvas-only WARM UP / ROTATE / GO banners into a polite live
  // region so screen-reader users hear phase changes. Called only on the few
  // transitions, never per frame, so it stays out of the hot loop.
  const announce = (msg) => { const el = $('phaseAnnounce'); if (el) el.textContent = msg; };
  announce('Warm-up — practise the gestures. No obstacles yet.');

  const g = {
    y: GROUND_Y - RUNNER_H, vy: 0, ducking: false,
    score: 0, obs: [], spawnTimer: 0, runPhase: 0,
    palmWindow: [], lastEff: 0, dblUsed: false,
    // Sub-phase machine. Team size is already locked by the calibrate phase
    // (which runs before play), so play always starts in 'warmup'.
    subPhase: 'warmup',
    warmStartMs: performance.now(),
    liveBankMs: 0,        // banked play-ms from completed segments (drives difficulty + survival time)
    segStartMs: 0,        // start of current play segment
    rotateStartMs: 0,     // start of current rotate break
    // Parallax speck field — scrolls with run speed so forward motion reads
    // even in warmup (no obstacles yet). z = depth → speed, size, brightness.
    particles: Array.from({ length: 28 }, () => ({
      x: Math.random() * CANVAS_W,
      y: Math.random() * GROUND_Y,
      z: 0.35 + Math.random() * 0.65,
    })),
  };

  // Cumulative live play seconds (banked segments + current segment), the input
  // to all difficulty ramps and the survival time. Rotate breaks never count.
  const livePlaySec = (now) =>
    (g.liveBankMs + (g.subPhase === 'play' ? now - g.segStartMs : 0)) / 1000;

  let rafId = null, cancelled = false, prevTs = performance.now(), hiddenAt = 0;
  let fpsFrames = 0, fpsLast = performance.now(), slowTicks = 0;

  const track = state.stream.getVideoTracks()[0];
  const onEnded = () => endAttempt(true, '📷 Camera disconnected');
  track?.addEventListener('ended', onEnded);

  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if      (g.subPhase === 'warmup') g.warmStartMs   += delta;
      else if (g.subPhase === 'rotate') g.rotateStartMs += delta;
      else                              g.segStartMs    += delta;
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
    const eff = DEBUG ? (debugPalms ?? 0) : effectivePalmCount(g.palmWindow);
    const fist = hands.some(isFist);
    updatePalmHud(eff);
    return { eff, fist };
  }

  function spawnObstacle(elapsedSec) {
    const high = Math.random() < highObstacleProb(elapsedSec, individuals);
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
    const timeSec = livePlaySec(performance.now());
    const score = scoreAttempt({ completed: g.score });
    state.attempts.push({ score, completed: g.score, timeSec, died, msg });
    goto('attempt-end');
  }

  function step(dt, elapsedSec, controllable) {
    let eff = 0, fist = false;
    if (controllable) { ({ eff, fist } = readInput()); }
    const onGround = g.y + RUNNER_H >= GROUND_Y - 0.5;
    if (controllable && onGround && eff > 0 && g.lastEff === 0) {
      // Solo: any open palm = a fixed-strength jump (#42). Teams: a lowered
      // single jump that fires on the FIRST player's palm so it stays snappy.
      g.vy = -(individuals ? SOLO_JUMP_STRENGTH : TEAM_JUMP_STRENGTH);
      g.dblUsed = false; // a fresh takeoff re-arms the mid-air double jump
    }
    // Team double jump: once per airtime, a SECOND player joining the gesture
    // mid-air (palm count reaches the whole-team threshold while airborne) kicks
    // the runner higher. Threshold ≥ 2 means one player re-raising their own
    // palm can never trigger it — it always needs another hand.
    if (controllable && !individuals && !onGround && !g.dblUsed &&
        eff >= doubleJumpThreshold(activePlayers())) {
      g.vy = -TEAM_DOUBLE_JUMP_STRENGTH;
      g.dblUsed = true;
    }
    g.lastEff = eff;
    g.ducking = controllable && fist && onGround;
    g.vy += GRAVITY * dt;
    g.y += g.vy * dt;
    if (g.y + RUNNER_H > GROUND_Y) { g.y = GROUND_Y - RUNNER_H; g.vy = 0; g.dblUsed = false; }

    const speed = runSpeed(elapsedSec, individuals);
    g.runPhase += 0.3 * dt;

    for (const p of g.particles) {
      p.x -= speed * p.z * dt;
      if (p.x < -2) { p.x = CANVAS_W + Math.random() * 40; p.y = Math.random() * GROUND_Y; }
    }

    if (g.subPhase === 'play') {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) {
        spawnObstacle(elapsedSec);
        g.spawnTimer = spawnIntervalFrames(elapsedSec, individuals) + Math.random() * 30;
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

    if (controllable) {
      const kh = g.ducking ? RUNNER_H * 0.55 : RUNNER_H;
      const box = { x: RUNNER_X, y: g.y + (RUNNER_H - kh), w: RUNNER_W, h: kh };
      for (const o of g.obs) { if (intersects(box, o)) { endAttempt(true); return; } }
    }
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

  function drawRotateBanner(secondsLeft) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--good');
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('🔄 ROTATE — swap players', CANVAS_W / 2, 70);
    ctx.fillStyle = css('--text');
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`resume in ${secondsLeft}`, CANVAS_W / 2, 104);
    ctx.restore();
  }

  function drawSegmentHint(secondsLeft) {
    ctx.save();
    ctx.textAlign = 'center';
    const txt = `↻ rotate in ${secondsLeft}`;
    // Dark halo behind the text so it stays readable over particles/obstacles,
    // then the bright accent fill — bigger + higher contrast than the old muted
    // 20px so players actually notice the rotate is coming.
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.lineWidth = 6;
    ctx.strokeStyle = css('--bg');
    ctx.strokeText(txt, CANVAS_W / 2, 48);
    ctx.fillStyle = css('--accent');
    ctx.fillText(txt, CANVAS_W / 2, 48);
    ctx.restore();
  }

  function tickWarmup(dt, now) {
    const left = warmupSecondsLeft((now - g.warmStartMs) / 1000);
    if (left <= 0) {
      g.subPhase = 'play';
      g.segStartMs = now;
      g.spawnTimer = 0;
      // Reset the rising-edge tracker (mirrors the rotate→play fix below) so a
      // player who held an open palm through the warmup isn't denied their first
      // real jump — jumps fire only on eff>0 && g.lastEff===0.
      g.lastEff = 0;
      g.palmWindow = [];
      announce('Go! Obstacles incoming.');
      return false; // caller falls through to tickPlay this same frame
    }
    $('timerLabel').textContent = 'WARM UP';
    step(dt, 0, true);
    if (cancelled) return true;
    draw();
    drawWarmupBanner(left);
    return true; // handled this frame
  }

  function tickPlay(dt, now) {
    // Teams (3+): segment expired → switch to rotate. The collision check below
    // never runs this frame (we return first), so a crash on the exact boundary
    // frame is voided — the rotate break wins the tie. Rotate rendering begins
    // next frame. Solo (#42) and 2-player teams: no rotate breaks — play is one
    // continuous run.
    if (rotates && (now - g.segStartMs) / 1000 >= SEGMENT_PLAY_S) {
      g.liveBankMs += now - g.segStartMs;
      g.subPhase = 'rotate';
      g.rotateStartMs = now;
      g.ducking = false;
      g.lastEff = 0; // so the first jump after the break isn't suppressed
      announce('Rotate — swap players.');
      return false;
    }
    const elapsed = livePlaySec(now);
    $('timerLabel').textContent = elapsed.toFixed(1);
    step(dt, elapsed, true);
    if (cancelled) return true;
    draw();
    if (rotates) {
      const segLeft = segmentSecondsLeft((now - g.segStartMs) / 1000);
      if (segLeft <= 5) drawSegmentHint(segLeft);
    }
    return true;
  }

  function tickRotate(dt, now) {
    const left = rotateSecondsLeft((now - g.rotateStartMs) / 1000);
    if (left <= 0) {
      g.subPhase = 'play';
      g.segStartMs = now;
      g.spawnTimer = 0;
      announce('Go! Obstacles incoming.');
      return false; // fall through to tickPlay this same frame
    }
    $('timerLabel').textContent = 'ROTATE';
    step(dt, livePlaySec(now), false);
    if (cancelled) return true;
    draw();
    drawRotateBanner(left);
    return true;
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

    if (g.subPhase === 'warmup') {
      const handled = tickWarmup(dt, now);
      if (cancelled) return;
      if (handled) { rafId = requestAnimationFrame(loop); return; }
      // warmup expired → fall through to play this frame
    }

    if (g.subPhase === 'rotate') {
      const handled = tickRotate(dt, now);
      if (cancelled) return;
      if (handled) { rafId = requestAnimationFrame(loop); return; }
      // rotate expired → fall through to play this frame
    }

    tickPlay(dt, now);
    if (cancelled) return;
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
  $('resScore').textContent = score;

  const status = $('saveStatus');
  $('finalReturnLink').href = catalogHref;

  // No lobby session → there's no real team/player to label or submit for
  // (state.teamId defaults to 0). Hide the participant row and the save chip
  // instead of printing "Team 0" and writing a score for a phantom team 0.
  if (!session) {
    $('resTeamRow').classList.add('hidden');
    status.classList.add('hidden');
    wireRestart();
    return;
  }

  $('resTeamRow').classList.remove('hidden');
  $('resTeam').textContent = state.teamId;
  status.classList.remove('hidden');
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
    // Tear down the camera/tracker so the next loading phase reopens a fresh
    // tracker at TRACKER_CEILING. Defensive — phaseEnter.final already does
    // the same teardown, but wireRestart is also wired from enterAlreadyPlayed
    // where final didn't run.
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
    if (state.tracker) { try { state.tracker.stop(); } catch {} state.tracker = null; }
    state.teamN = null;
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
  // Only reachable with a real lobby session (boot guards this), so the
  // participant row + save chip are always meaningful here.
  $('resTeamRow').classList.remove('hidden');
  $('resTeam').textContent = state.teamId;
  $('resScore').textContent = existing;
  const status = $('saveStatus');
  status.classList.remove('hidden');
  status.className = 'save-status ok';
  status.textContent = 'SAVED ✓';
  status.onclick = null;
  $('finalReturnLink').href = catalogHref;
  wireRestart();
}

// Solo mode has no rotation, no hand calibration and a fixed jump — rewrite the
// team-centric briefing/setup copy so a single player sees no "team" wording.
function applyIndividualsCopy() {
  if (!individuals) return;
  const lbl = document.getElementById('resTeamLabel');
  if (lbl) lbl.textContent = 'Player';
  const brief = document.getElementById('briefing');
  if (brief) brief.innerHTML =
    "Control the runner 🦖 with your hand in front of the laptop camera. The faster it goes, the trickier it gets.<br><br>" +
    "<strong>Goal:</strong> <strong>Open palm ✋ = jump ⬆️</strong>, make a fist ✊ to duck ⬇️ past obstacles 🌵, and hold a victory sign ✌️ to stay ready (no jump, no duck) — useful between obstacles so an idle palm doesn't trigger a false jump. The game keeps speeding up 💨; your score is the number of obstacles passed. <strong>5 attempts</strong>, best score counts 🏆.";
  const hint = document.getElementById('setupHint');
  if (hint) hint.textContent = 'Allow camera access when prompted. Get yourself in frame.';
}

// Bootstrap
async function boot() {
  if (session?.lobbyId) {
    try {
      const modeSnap = await get(ref(db, `lobbies/${session.lobbyId}/meta/mode`));
      individuals = modeSnap.exists() && modeSnap.val() === 'individuals';
    } catch (e) { console.error('mode read failed', e); }
  }
  // Solo-dev: ?debug&individuals forces solo mode without a live lobby.
  if (DEBUG && new URLSearchParams(location.search).has('individuals')) individuals = true;
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
