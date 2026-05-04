import { drawGridFloor, fadeOverlay, withGlow, ScreenShake } from '../shared/neon-fx.js';
import { createAudioInput } from '../shared/audio.js';
import { showDenialModal } from '../shared/perms.js';
import { createStageManager } from '../shared/stages.js';
import { generateCode, renderEndScreen } from '../shared/score-panel.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const titleEl = document.getElementById('title');
const hudEl = document.getElementById('hud');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

const PIPE_W = 80;
const shake = new ScreenShake();

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
  gap: 220
};

const STAGE_CFG = [
  { gap: 240, speed: 3.0, spawn: 110, mode: 'discrete' }, // S1 Whisper
  { gap: 200, speed: 4.0, spawn: 90, mode: 'continuous' }, // S2 Loudness
  { gap: 170, speed: 4.6, spawn: 80, mode: 'sustain' }, // S3 Sustain
  { gap: 140, speed: 5.2, spawn: 70, mode: 'chant' }, // S4 Chant
];

const bannerEl = document.getElementById('banner');
const stageDots = document.querySelectorAll('#stages .dot');

function setStage(n) {
  const cfg = STAGE_CFG[n - 1];
  state.gap = cfg.gap;
  state.speed = cfg.speed;
  state.spawnEvery = cfg.spawn;
  state.mode = cfg.mode;
  bannerEl.textContent = `STAGE ${n}: ${['WHISPER', 'LOUDER', 'SUSTAIN', 'CHANT'][n - 1]}`;
  stageDots.forEach((d, i) => d.classList.toggle('active', i < n));
  setTimeout(() => { if (state.currentStage === n) bannerEl.textContent = ''; }, 2200);
  state.currentStage = n;
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
  stageMgr.reset();
  setStage(1);
  hudEl.textContent = 'SCORE 0';
}
reset();

async function start() {
  titleEl.style.display = 'none';
  try {
    state.audio = await createAudioInput();
  } catch {
    showDenialModal('microphone');
    return;
  }
  reset();
  state.running = true;
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
  let thrust = 0;
  if (state.mode === 'discrete') {
    thrust = amp > 0.08 ? 4.5 : 0;
  } else if (state.mode === 'continuous') {
    thrust = amp * 14;
  } else if (state.mode === 'sustain') {
    thrust = amp * 12 + (state.audio.isSustained() ? 4 : 0);
  } else if (state.mode === 'chant') {
    // demand sustained chant: if not sustained, extra gravity
    thrust = amp * 12 + (state.audio.isSustained() ? 6 : 0);
    if (!state.audio.isSustained()) state.orb.vy += 0.6;
  }
  state.orb.vy += 0.4;
  state.orb.vy -= thrust;
  state.orb.vy = Math.max(-8, Math.min(10, state.orb.vy));
  state.orb.y += state.orb.vy;
  if (state.orb.y < state.orb.r || state.orb.y > canvas.height - state.orb.r) die();

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
      stageMgr.update(state.score);
    }
    const inX = state.orb.x + state.orb.r > p.x && state.orb.x - state.orb.r < p.x + PIPE_W;
    if (inX) {
      const inGap = state.orb.y - state.orb.r > p.topH && state.orb.y + state.orb.r < p.topH + state.gap;
      if (!inGap) die();
    }
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

function draw() {
  ctx.save();
  shake.apply(ctx);
  fadeOverlay(ctx, 0.2);
  drawGridFloor(ctx, state.scroll);
  // pipes
  withGlow(ctx, '#ff00ff', 16, () => {
    ctx.fillStyle = '#ff00ff';
    for (const p of state.pipes) {
      ctx.fillRect(p.x, 0, PIPE_W, p.topH);
      ctx.fillRect(p.x, p.topH + state.gap, PIPE_W, canvas.height - p.topH - state.gap);
    }
  });
  // orb
  withGlow(ctx, '#ffff00', 24, () => {
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.arc(state.orb.x, state.orb.y, state.orb.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function frame() {
  if (state.running) step();
  draw();
  state.scroll += state.running ? 0.04 : 0.01;
  requestAnimationFrame(frame);
}
frame();
