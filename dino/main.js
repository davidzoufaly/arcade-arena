import { drawGridFloor, fadeOverlay, withGlow, ScreenShake } from '../shared/neon-fx.js';
import { createCamStream, createHandTracker, isFingerUp, isPalmOpen, isFist } from '../shared/vision.js';
import { showDenialModal } from '../shared/perms.js';
import { generateCode, renderEndScreen } from '../shared/score-panel.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const camEl = document.getElementById('cam');
const titleEl = document.getElementById('title');
const hudEl = document.getElementById('hud');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

const GROUND_Y_RATIO = 0.78;
const shake = new ScreenShake();

const state = {
  knight: { x: 240, y: 0, vy: 0, h: 60, w: 30, ducking: false },
  scroll: 0,
  running: false,
  dead: false,
  score: 0,
  meters: 0,
  speed: 6,
  hand: null,
  pose: null,
  mode: 'finger', // finger | hand | arm | body
  obs: [],
  spawnTimer: 0,
  spawnEvery: 90,
  allowHigh: false, // S2+ enables high obstacles
};

function groundY() { return canvas.height * GROUND_Y_RATIO; }
function reset() {
  state.knight.y = groundY() - state.knight.h;
  state.knight.vy = 0;
  state.knight.ducking = false;
  state.score = 0;
  state.meters = 0;
  state.speed = 6;
  state.dead = false;
  state.obs = [];
  state.spawnTimer = 0;
  hudEl.textContent = 'SCORE 0';
}
reset();

function spawnObstacle() {
  const high = state.allowHigh && Math.random() < 0.4;
  if (high) {
    state.obs.push({ x: canvas.width, y: groundY() - 110, w: 36, h: 30, type: 'high' });
  } else {
    state.obs.push({ x: canvas.width, y: groundY() - 30, w: 28, h: 30, type: 'low' });
  }
}

function intersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

async function start() {
  titleEl.style.display = 'none';
  try {
    const { video, stream } = await createCamStream();
    camEl.srcObject = stream;
    state.hand = await createHandTracker(video);
  } catch {
    showDenialModal('camera');
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

function readInput() {
  const hands = state.hand.latest().hands;
  let jump = false, duck = false;
  for (const h of hands) {
    if (state.mode === 'finger' && isFingerUp(h)) jump = true;
    if (state.mode === 'hand') {
      if (isPalmOpen(h)) jump = true;
      if (isFist(h)) duck = true;
    }
  }
  return { jump, duck };
}

function step() {
  const { jump, duck } = readInput();
  const onGround = state.knight.y + state.knight.h >= groundY() - 0.5;
  if (jump && onGround) state.knight.vy = -14;
  state.knight.ducking = duck && onGround;
  state.knight.vy += 0.8;
  state.knight.y += state.knight.vy;
  if (state.knight.y + state.knight.h > groundY()) {
    state.knight.y = groundY() - state.knight.h;
    state.knight.vy = 0;
  }
  state.meters += state.speed * 0.06;

  state.spawnTimer -= 1;
  if (state.spawnTimer <= 0) {
    spawnObstacle();
    state.spawnTimer = state.spawnEvery + Math.random() * 30;
  }
  for (const o of state.obs) o.x -= state.speed;
  state.obs = state.obs.filter(o => o.x + o.w > 0);

  const k = state.knight;
  const kh = k.ducking ? k.h * 0.55 : k.h;
  const ky = k.y + (k.h - kh);
  const knightBox = { x: k.x, y: ky, w: k.w, h: kh };
  for (const o of state.obs) {
    if (intersects(knightBox, o)) die();
  }

  const newScore = Math.min(30, Math.floor(state.meters / 100));
  if (newScore !== state.score) {
    state.score = newScore;
    hudEl.textContent = `SCORE ${state.score}`;
  }
}

function drawKnight() {
  const k = state.knight;
  const h = k.ducking ? k.h * 0.55 : k.h;
  const yTop = k.y + (k.h - h);
  withGlow(ctx, '#ffff00', 16, () => {
    ctx.fillStyle = '#ffff00';
    ctx.fillRect(k.x, yTop, k.w, h);
    // diamond head
    ctx.beginPath();
    ctx.moveTo(k.x + k.w / 2, yTop - 14);
    ctx.lineTo(k.x + k.w, yTop);
    ctx.lineTo(k.x + k.w / 2, yTop + 14);
    ctx.lineTo(k.x, yTop);
    ctx.closePath();
    ctx.fill();
  });
}

function draw() {
  ctx.save();
  shake.apply(ctx);
  fadeOverlay(ctx, 0.2);
  drawGridFloor(ctx, state.scroll, '#ff00ff');
  drawKnight();
  drawObstacles();
  ctx.restore();
}

function die() {
  if (state.dead) return;
  state.dead = true;
  state.running = false;
  shake.trigger(8, 12);
  const code = generateCode(state.score, Date.now());
  const overlay = document.createElement('div');
  overlay.className = 'end-overlay';
  document.body.appendChild(overlay);
  renderEndScreen(overlay, {
    score: state.score,
    code,
    message: `KNIGHT FALLEN AT ${Math.floor(state.meters)}m`
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

function drawObstacles() {
  withGlow(ctx, '#ff00ff', 14, () => {
    ctx.fillStyle = '#ff00ff';
    for (const o of state.obs) ctx.fillRect(o.x, o.y, o.w, o.h);
  });
}

function frame() {
  if (state.running) step();
  draw();
  state.scroll += state.running ? 0.06 : 0.02;
  requestAnimationFrame(frame);
}
frame();
