import { drawGridFloor, fadeOverlay, withGlow } from '../shared/neon-fx.js';
import { createAudioInput } from '../shared/audio.js';
import { showDenialModal } from '../shared/perms.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const titleEl = document.getElementById('title');
const hudEl = document.getElementById('hud');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

const state = {
  scroll: 0,
  orb: { x: 200, y: 0, vy: 0, r: 18 },
  audio: null,
  running: false
};

function reset() {
  state.orb.y = canvas.height / 2;
  state.orb.vy = 0;
}
reset();

async function start() {
  titleEl.style.display = 'none';
  try {
    state.audio = await createAudioInput();
  } catch (e) {
    showDenialModal('microphone');
    return;
  }
  state.running = true;
}

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && !state.running) start();
});

function step() {
  const amp = state.audio ? state.audio.amplitude() : 0;
  // amplitude maps to upward thrust; gravity pulls down
  state.orb.vy += 0.4; // gravity
  state.orb.vy -= amp * 14; // thrust
  state.orb.vy = Math.max(-8, Math.min(10, state.orb.vy));
  state.orb.y += state.orb.vy;
  if (state.orb.y < state.orb.r) { state.orb.y = state.orb.r; state.orb.vy = 0; }
  if (state.orb.y > canvas.height - state.orb.r) { state.orb.y = canvas.height - state.orb.r; state.orb.vy = 0; }
}

function draw() {
  fadeOverlay(ctx, 0.2);
  drawGridFloor(ctx, state.scroll);
  withGlow(ctx, '#ffff00', 24, () => {
    ctx.fillStyle = '#ffff00';
    ctx.beginPath();
    ctx.arc(state.orb.x, state.orb.y, state.orb.r, 0, Math.PI * 2);
    ctx.fill();
  });
}

function frame() {
  if (state.running) step();
  draw();
  state.scroll += state.running ? 0.04 : 0.01;
  requestAnimationFrame(frame);
}
frame();
