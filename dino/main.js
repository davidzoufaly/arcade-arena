import { drawGridFloor, fadeOverlay } from '../shared/neon-fx.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
resize();
window.addEventListener('resize', resize);

let scroll = 0;
function frame() {
  fadeOverlay(ctx, 0.2);
  drawGridFloor(ctx, scroll, '#ff00ff'); // magenta dunes
  scroll += 0.02;
  requestAnimationFrame(frame);
}
frame();
