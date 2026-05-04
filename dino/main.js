import { drawGridFloor, fadeOverlay, withGlow, ScreenShake } from '../shared/neon-fx.js';
import { createCamStream, createHandTracker, isFingerUp, isPalmOpen, isFist } from '../shared/vision.js';
import { showDenialModal } from '../shared/perms.js';

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
  hudEl.textContent = 'SCORE 0';
}
reset();

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
  ctx.restore();
}

function frame() {
  if (state.running) step();
  draw();
  state.scroll += state.running ? 0.06 : 0.02;
  requestAnimationFrame(frame);
}
frame();
