import { fadeOverlay, withGlow, ScreenShake } from '../shared/neon-fx.js';
import { createAudioInput } from '../shared/audio.js';
import { showDenialModal } from '../shared/perms.js';
import { createStageManager } from '../shared/stages.js';
import { generateCode, renderEndScreen, saveRun, showDebugIfRequested } from '../shared/score-panel.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const titleEl = document.getElementById('title');
const hudEl = document.getElementById('hud');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

const PIPE_W = 80;
const METER_MAX = 0.30; // amp value mapped to 100% on the meter
const shake = new ScreenShake();

function showLoadFailure(what) {
  const overlay = document.createElement('div');
  overlay.className = 'denial-overlay';
  overlay.innerHTML = `
    <div class="denial-box">
      <h1>COULD NOT LOAD ${what.toUpperCase()}</h1>
      <p>Network or asset load failed. Check your connection and reload.</p>
      <button onclick="location.reload()">RELOAD</button>
    </div>
  `;
  document.body.appendChild(overlay);
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

let lastSoundAt = performance.now();

const TRAIL_MAX = 250;

const state = {
  scroll: 0,
  orb: { x: 200, y: 0, vy: 0, r: 18 },
  audio: null,
  running: false,
  dead: false,
  score: 0,
  pipes: [],
  spawnTimer: 0,
  speed: 4,
  gap: 220,
  triggerThreshold: 0.03,
  trail: [],
  pulseT: 0
};

const STAGE_CFG = [
  { gap: 340, speed: 2.4, spawn: 180, mode: 'discrete' }, // S1 Whisper
  { gap: 280, speed: 3.4, spawn: 150, mode: 'continuous' }, // S2 Loudness
  { gap: 230, speed: 4.2, spawn: 130, mode: 'sustain' }, // S3 Sustain
  { gap: 190, speed: 5.0, spawn: 115, mode: 'chant' }, // S4 Chant
];

const bannerEl = document.getElementById('banner');
const stageDots = document.querySelectorAll('#stages .dot');
const stageProgressEl = document.getElementById('stage-progress');
const stageNameEl = document.getElementById('stage-name');
const stageCountEl = document.getElementById('stage-count');
const FLAPPY_LABELS = ['WHISPER', 'LOUDER', 'SUSTAIN', 'CHANT'];
const FLAPPY_THRESHOLDS = [0, 5, 13, 23, 31];
const debugEl = document.getElementById('debug');
const noiseFill = document.getElementById('noise-fill');
let fpsLast = performance.now();
let fpsFrames = 0;
let fpsValue = 0;

function updateStageProgress() {
  if (!stageProgressEl) return;
  const stage = state.currentStage || 1;
  const lo = FLAPPY_THRESHOLDS[stage - 1];
  const hi = FLAPPY_THRESHOLDS[stage];
  const within = state.score - lo;
  const range = hi - lo;
  const pct = Math.max(0, Math.min(100, (within / range) * 100));
  stageProgressEl.style.width = `${pct}%`;
  if (stageNameEl) stageNameEl.textContent = FLAPPY_LABELS[stage - 1];
  if (stageCountEl) stageCountEl.textContent = `${Math.max(0, within)}/${range}`;
}

function setStage(n) {
  const cfg = STAGE_CFG[n - 1];
  state.gap = cfg.gap;
  state.speed = cfg.speed;
  state.spawnEvery = cfg.spawn;
  state.mode = cfg.mode;
  bannerEl.textContent = `STAGE ${n}: ${['WHISPER', 'LOUDER', 'SUSTAIN', 'CHANT'][n - 1]}`;
  const stageEls = document.querySelectorAll('#stages .stage');
  stageEls.forEach((s, i) => s.classList.toggle('active', i < n));
  stageDots.forEach((d, i) => d.classList.toggle('active', i < n));
  setTimeout(() => { if (state.currentStage === n) bannerEl.textContent = ''; }, 2200);
  state.currentStage = n;
  updateStageProgress();
}

state.currentStage = 1;
state.spawnEvery = 90;
state.mode = 'discrete';
const stageMgr = createStageManager([5, 13, 23], setStage);
setStage(1);

function reset() {
  state.orb.y = canvas.height / 2;
  state.orb.vy = 0;
  state.score = 0;
  state.pipes = [];
  state.spawnTimer = 0;
  state.speed = 4;
  state.gap = 220;
  state.dead = false;
  state.trail = [];
  state.pulseT = 0;
  state.worldX = 0;
  stageMgr.reset();
  setStage(1);
  hudEl.textContent = 'SCORE 0';
  lastSoundAt = performance.now();
}
reset();

async function start() {
  titleEl.style.display = 'none';
  try {
    state.audio = await createAudioInput();
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
      showDenialModal('microphone');
    } else {
      showLoadFailure('microphone');
    }
    return;
  }
  // Calibrate: measure ambient noise floor for ~1.5s while showing prompt
  bannerEl.textContent = 'CALIBRATING... STAY QUIET';
  let samples = [];
  const calibrateStart = performance.now();
  const calibrate = () => {
    const elapsed = performance.now() - calibrateStart;
    if (elapsed < 1500) {
      samples.push(state.audio.amplitude());
      requestAnimationFrame(calibrate);
      return;
    }
    // Compute noise floor (median is robust to spikes)
    samples.sort((a, b) => a - b);
    const floor = samples[Math.floor(samples.length / 2)] || 0;
    state.triggerThreshold = Math.max(0.025, floor + 0.02);
    state.audio.setSustainThreshold(Math.max(0.10, floor + 0.08));
    bannerEl.textContent = 'MAKE NOISE TO START';
    const wait = () => {
      if (state.audio.amplitude() > state.triggerThreshold * 1.5) {
        bannerEl.textContent = '';
        reset();
        state.running = true;
      } else {
        requestAnimationFrame(wait);
      }
    };
    wait();
  };
  calibrate();
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    if (!state.running && !state.dead) start();
    else if (state.dead) { reset(); state.running = true; }
  }
});

function spawnPipe() {
  const minY = 80;
  const maxY = canvas.height - 80 - state.gap;
  const topH = minY + Math.random() * (maxY - minY);
  state.pipes.push({ x: canvas.width + PIPE_W, topH, passed: false });
}

function step() {
  const amp = state.audio.amplitude();
  if (noiseFill) {
    // Linear: 0..METER_MAX → 0..100%
    const pct = Math.max(0, Math.min(100, (amp / METER_MAX) * 100));
    noiseFill.style.height = `${pct}%`;
    // peak-hold cap with decay
    const peakEl = document.getElementById('noise-peak');
    if (peakEl) {
      state._noisePeak = Math.max(pct, (state._noisePeak ?? 0) - 0.5);
      peakEl.style.bottom = `${state._noisePeak}%`;
    }
  }
  if (amp > 0.05) lastSoundAt = performance.now();
  if (performance.now() - lastSoundAt > 10000) {
    showToast('CHECK MIC?');
    lastSoundAt = performance.now();
  }
  let thrust = 0;
  if (state.mode === 'discrete') {
    thrust = amp > state.triggerThreshold ? 4.5 : 0;
  } else if (state.mode === 'continuous') {
    thrust = amp * 14;
  } else if (state.mode === 'sustain') {
    thrust = amp * 12 + (state.audio.isSustained() ? 4 : 0);
  } else if (state.mode === 'chant') {
    // demand sustained chant: if not sustained, extra gravity
    thrust = amp * 12 + (state.audio.isSustained() ? 6 : 0);
    if (!state.audio.isSustained()) state.orb.vy += 0.6;
  }
  state.orb.vy += 0.3;
  state.orb.vy -= thrust;
  state.orb.vy = Math.max(-9, Math.min(9, state.orb.vy));
  state.orb.y += state.orb.vy;
  if (state.orb.y < state.orb.r || state.orb.y > canvas.height - state.orb.r) die();

  state.worldX += state.speed;
  state.trail.push({ worldX: state.worldX, y: state.orb.y });
  // drop points that have scrolled off the left edge
  while (state.trail.length > 0 && state.orb.x - (state.worldX - state.trail[0].worldX) < -40) {
    state.trail.shift();
  }
  if (state.trail.length > TRAIL_MAX) state.trail.shift();
  state.pulseT += 0.06;

  state.spawnTimer -= 1;
  if (state.spawnTimer <= 0) {
    spawnPipe();
    state.spawnTimer = state.spawnEvery;
  }

  for (const p of state.pipes) {
    p.x -= state.speed;
    if (!p.passed && p.x + PIPE_W < state.orb.x) {
      p.passed = true;
      state.score = Math.min(30, state.score + 1);
      hudEl.textContent = `SCORE ${state.score}`;
      updateStageProgress();
      stageMgr.update(state.score);
    }
    const inX = state.orb.x + state.orb.r > p.x && state.orb.x - state.orb.r < p.x + PIPE_W;
    if (inX) {
      const inGap = state.orb.y - state.orb.r > p.topH && state.orb.y + state.orb.r < p.topH + state.gap;
      if (!inGap) die();
    }
  }
  if (debugEl) {
    debugEl.innerHTML = `fps: ${fpsValue}<br>mode: ${state.mode}<br>amp: ${state.audio.amplitude().toFixed(3)}<br>sustained: ${state.audio.isSustained() ? 'YES' : 'no'}<br>vy: ${state.orb.vy.toFixed(2)}`;
  }
  state.pipes = state.pipes.filter(p => p.x + PIPE_W > 0);
}

function die() {
  if (state.dead) return;
  state.dead = true;
  state.running = false;
  shake.trigger(8, 12);
  showEndScreen();
}

function showEndScreen() {
  const code = generateCode(state.score, Date.now());
  saveRun('flappy', state.score, code);
  const overlay = document.createElement('div');
  overlay.className = 'end-overlay';
  overlay.id = 'end';
  document.body.appendChild(overlay);
  renderEndScreen(overlay, {
    score: state.score,
    code,
    message: `CUSTOMERS RESCUED: ${state.score}`
  });
  const onKey = (e) => {
    if (e.code === 'Space') {
      overlay.remove();
      window.removeEventListener('keydown', onKey);
      reset();
      state.running = true;
    }
  };
  window.addEventListener('keydown', onKey);
}

function drawDashboardGrid() {
  const w = canvas.width, h = canvas.height;
  // horizontal grid
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.10)';
  ctx.lineWidth = 1;
  const rows = 5;
  for (let i = 1; i < rows; i++) {
    const y = (i / rows) * h;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // scrolling vertical grid
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.06)';
  const colSpacing = 80;
  const offset = (state.scroll * 50) % colSpacing;
  for (let x = -offset; x < w; x += colSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
  }
  // Y-axis ticks/labels on right edge
  ctx.fillStyle = 'rgba(0, 255, 255, 0.5)';
  ctx.font = "10px 'Courier New', monospace";
  ctx.textAlign = 'right';
  const labels = ['100', '75', '50', '25', '0'];
  for (let i = 0; i < labels.length; i++) {
    const y = (i / (labels.length - 1)) * h;
    ctx.fillText(labels[i], w - 8, Math.max(12, Math.min(h - 4, y + 4)));
  }
  ctx.restore();
}

function drawTrail() {
  if (state.trail.length < 2) return;
  ctx.save();
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  // Single gradient pass: stroke segment-by-segment with interpolated color
  const n = state.trail.length;
  for (let i = 1; i < n; i++) {
    const t = i / (n - 1); // 0..1, newer = larger
    const a = state.trail[i - 1];
    const b = state.trail[i];
    // color transitions orange → yellow → cyan from oldest to newest
    let r, g, bl;
    if (t < 0.5) {
      const k = t / 0.5;
      r = 255; g = 90 + (255 - 90) * k; bl = 60 - 60 * k; // ff5a3c → ffff00
    } else {
      const k = (t - 0.5) / 0.5;
      r = 255 - 255 * k; g = 255; bl = 255 * k; // ffff00 → 00ffff
    }
    const alpha = 0.15 + 0.65 * t; // older = fainter
    ctx.strokeStyle = `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(bl)}, ${alpha})`;
    const ax = state.orb.x - (state.worldX - a.worldX);
    const bx = state.orb.x - (state.worldX - b.worldX);
    ctx.beginPath();
    ctx.moveTo(ax, a.y);
    ctx.lineTo(bx, b.y);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDataPoint() {
  const x = state.orb.x;
  const y = state.orb.y;
  const r = state.orb.r;
  // pulsing outer ring
  const pulse = 1 + Math.sin(state.pulseT) * 0.18;
  ctx.save();
  ctx.strokeStyle = 'rgba(255, 255, 0, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, r * 1.7 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(255, 255, 0, 0.25)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(x, y, r * 2.4 * pulse, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
  // Solid filled point on top
  withGlow(ctx, '#ffff00', 14, () => {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  });
  // Inner dot
  ctx.save();
  ctx.fillStyle = '#0a0a1a';
  ctx.beginPath();
  ctx.arc(x, y, r * 0.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// Stable per-pipe seed so the bars don't flicker every frame
function p_for_band_seed(x) {
  // Use the pipe x rounded down to an integer, then into [0..1)
  const v = Math.abs(Math.floor(x * 1000)) % 10000;
  return v / 10000;
}

function drawBand(x, y, w, h, side) {
  // Gradient: faint at far edge, opaque toward the gap edge
  ctx.save();
  const grad = side === 'top'
    ? ctx.createLinearGradient(0, y, 0, y + h)
    : ctx.createLinearGradient(0, y + h, 0, y);
  grad.addColorStop(0, 'rgba(255, 0, 255, 0.15)');
  grad.addColorStop(1, 'rgba(255, 0, 255, 0.85)');
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);

  // 2px bright edge along the gap side
  ctx.fillStyle = '#ff00ff';
  if (side === 'top') ctx.fillRect(x, y + h - 2, w, 2);
  else ctx.fillRect(x, y, w, 2);

  // Mini bar-chart bars inside the band — 3 vertical bars hinting at "data anomaly"
  ctx.fillStyle = 'rgba(255, 255, 255, 0.55)';
  const barCount = 3;
  const barW = 6;
  const barSpace = (w - barCount * barW) / (barCount + 1);
  for (let i = 0; i < barCount; i++) {
    const bx = x + barSpace + i * (barW + barSpace);
    const seed = (Math.floor((p_for_band_seed(x) + i * 31) * 7919) % 100) / 100;
    const bh = Math.max(8, Math.min(h - 8, 12 + seed * (h * 0.4)));
    let by;
    if (side === 'top') by = y + h - bh - 4; else by = y + 4;
    ctx.fillRect(bx, by, barW, bh);
  }
  ctx.restore();
}

function drawAnomalyBands() {
  // For each pipe, draw the top band + bottom band as gradient anomaly zones
  for (const p of state.pipes) {
    drawBand(p.x, 0, PIPE_W, p.topH, 'top');
    drawBand(p.x, p.topH + state.gap, PIPE_W, canvas.height - p.topH - state.gap, 'bottom');
  }
}

function draw() {
  ctx.save();
  shake.apply(ctx);
  fadeOverlay(ctx, 0.95);
  drawDashboardGrid();
  drawAnomalyBands();
  drawTrail();
  drawDataPoint();
  ctx.restore();
}

function frame() {
  fpsFrames++;
  const fpsNow = performance.now();
  if (fpsNow - fpsLast > 500) {
    fpsValue = Math.round((fpsFrames * 1000) / (fpsNow - fpsLast));
    fpsFrames = 0;
    fpsLast = fpsNow;
  }
  if (state.running) step();
  draw();
  state.scroll += state.running ? 0.04 : 0.01;
  requestAnimationFrame(frame);
}
frame();

showDebugIfRequested('flappy');
