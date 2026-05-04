import { drawGridFloor, fadeOverlay, withGlow, ScreenShake } from '../shared/neon-fx.js';
import { createCamStream, createHandTracker, createPoseTracker, isFingerUp, isPalmOpen, isFist, isArmOverhead, isJumpingPose, isCrouchingPose, countFingersUp } from '../shared/vision.js';
import { createStageManager } from '../shared/stages.js';
import { showDenialModal } from '../shared/perms.js';
import { generateCode, renderEndScreen, saveRun, showDebugIfRequested } from '../shared/score-panel.js';

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

const STAGE_CFG = [
  { mode: 'finger',  speed: 5.0, spawnEvery: 110, allowHigh: false, label: 'FINGER' },
  { mode: 'hand',    speed: 6.0, spawnEvery: 95,  allowHigh: true,  label: 'HAND' },
  { mode: 'arm',     speed: 6.8, spawnEvery: 85,  allowHigh: true,  label: 'ARM' },
  { mode: 'body',    speed: 7.4, spawnEvery: 75,  allowHigh: true,  label: 'BODY' },
];

const bannerEl = document.getElementById('banner');
const debugEl = document.getElementById('debug');
const stageDots = document.querySelectorAll('#stages .dot');
let fpsLast = performance.now();
let fpsFrames = 0;
let fpsValue = 0;

state.pose = null;
state.poseBaseline = null;

async function setStage(n) {
  const cfg = STAGE_CFG[n - 1];
  state.mode = cfg.mode;
  state.speed = cfg.speed;
  state.spawnEvery = cfg.spawnEvery;
  state.allowHigh = cfg.allowHigh;
  bannerEl.textContent = `STAGE ${n}: ${cfg.label}`;
  stageDots.forEach((d, i) => d.classList.toggle('active', i < n));
  if (n < 4) {
    setTimeout(() => { if (state.currentStage === n) bannerEl.textContent = ''; }, 2200);
  }
  state.currentStage = n;

  if (n === 4 && !state.pose) {
    state.pose = await createPoseTracker(camEl);
    bannerEl.textContent = 'JUMPER TO CENTER · CROUCH + JUMP';
  }
}

state.currentStage = 1;
const stageMgr = createStageManager([8, 16, 23], setStage);
setStage(1);

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
  state.poseBaseline = null;
  hudEl.textContent = 'SCORE 0';
  stageMgr.reset();
  setStage(1);
}
reset();

function spawnObstacle() {
  const high = state.allowHigh && Math.random() < 0.4;
  if (high) {
    state.obs.push({ x: canvas.width, y: groundY() - 75, w: 36, h: 45, type: 'high' });
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
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
      showDenialModal('camera');
    } else {
      showLoadFailure('camera or vision models');
    }
    return;
  }
  bannerEl.textContent = 'WAVE A HAND TO START...';
  const calibrate = () => {
    if (state.hand.latest().hands.length > 0) {
      bannerEl.textContent = '';
      reset();
      state.running = true;
    } else {
      requestAnimationFrame(calibrate);
    }
  };
  calibrate();
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

  if (state.mode === 'finger') {
    let totalFingers = 0;
    for (const h of hands) totalFingers += countFingersUp(h);
    state._fingers = totalFingers;
    if (totalFingers > 0) jump = true;
  } else if (state.mode === 'hand') {
    for (const h of hands) {
      if (isPalmOpen(h)) jump = true;
      if (isFist(h)) duck = true;
    }
  } else if (state.mode === 'arm') {
    for (const h of hands) {
      if (isArmOverhead(h)) jump = true;
      if (isPalmOpen(h) && h[0].y > 0.6) duck = true;
    }
  } else if (state.mode === 'body') {
    const pose = state.pose ? state.pose.latest().pose : null;
    if (pose) {
      if (!state.poseBaseline) {
        state.poseBaseline = {
          shoulderY: (pose[11].y + pose[12].y) / 2,
          hipY: (pose[23].y + pose[24].y) / 2
        };
      }
      if (isJumpingPose(pose, state.poseBaseline.shoulderY)) jump = true;
      if (isCrouchingPose(pose, state.poseBaseline.hipY)) duck = true;
    }
  }
  if (debugEl) {
    const hand0 = hands[0];
    const tipY = hand0?.[8]?.y?.toFixed(2) ?? '--';
    const pipY = hand0?.[6]?.y?.toFixed(2) ?? '--';
    const wristY = hand0?.[0]?.y?.toFixed(2) ?? '--';
    const fingers = state._fingers ?? 0;
    debugEl.innerHTML = `fps: ${fpsValue}<br>mode: ${state.mode}<br>hands: ${hands.length}<br>fingers: ${fingers}<br>tip Y: ${tipY}<br>pip Y: ${pipY}<br>wrist Y: ${wristY}<br>jump: ${jump ? 'YES' : 'no'}<br>duck: ${duck ? 'YES' : 'no'}`;
  }
  return { jump, duck };
}

function step() {
  const { jump, duck } = readInput();
  const onGround = state.knight.y + state.knight.h >= groundY() - 0.5;
  if (jump && onGround) {
    const fingers = state.mode === 'finger' ? (state._fingers || 1) : 5;
    const strength = Math.min(20, 8 + fingers * 1.5);
    state.knight.vy = -strength;
  }
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
    stageMgr.update(state.score);
  }

  if (state.mode === 'body' && state.pose) {
    const pose = state.pose.latest().pose;
    if (!pose) {
      if (!state._noPoseAt) state._noPoseAt = performance.now();
      if (performance.now() - state._noPoseAt > 5000) {
        showToast('STAND BACK / CHECK LIGHT');
        state._noPoseAt = performance.now();
      }
    } else {
      state._noPoseAt = null;
    }
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
  drawSky();
  drawGridFloor(ctx, state.scroll, '#ff00ff');
  drawGround();
  drawDunes();
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
  saveRun('dino', state.score, code);
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

function drawSky() {
  // Magenta sun + glow
  const cx = canvas.width * 0.78;
  const cy = canvas.height * 0.32;
  const r = Math.min(canvas.width, canvas.height) * 0.13;
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  grad.addColorStop(0, '#ff00ff');
  grad.addColorStop(0.6, '#aa0066');
  grad.addColorStop(1, 'rgba(170,0,102,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Distant stars
  ctx.fillStyle = '#ffff00';
  ctx.globalAlpha = 0.6;
  for (let i = 0; i < 30; i++) {
    const x = ((i * 137.5) % canvas.width);
    const y = (i * 41.3) % (canvas.height * 0.45);
    ctx.fillRect(x, y, 2, 2);
  }
  ctx.globalAlpha = 1;
}

function drawGround() {
  const gy = groundY();
  // Solid ground band beneath horizon
  ctx.fillStyle = 'rgba(20, 8, 40, 0.85)';
  ctx.fillRect(0, gy, canvas.width, canvas.height - gy);
  // Bright horizon line
  ctx.strokeStyle = '#ff5a3c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, gy);
  ctx.lineTo(canvas.width, gy);
  ctx.stroke();
  // halo
  ctx.strokeStyle = 'rgba(255, 90, 60, 0.4)';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.moveTo(0, gy);
  ctx.lineTo(canvas.width, gy);
  ctx.stroke();
  ctx.lineWidth = 2;
}

function drawDunes() {
  // Two dune silhouettes parallax-scrolling
  const baseY = groundY();
  ctx.fillStyle = 'rgba(80, 0, 80, 0.4)';
  ctx.beginPath();
  const offset = (state.scroll * 30) % canvas.width;
  ctx.moveTo(-offset, baseY);
  for (let x = 0; x <= canvas.width + 100; x += 60) {
    const h = 24 + Math.sin((x + offset) * 0.012) * 18;
    ctx.lineTo(x - offset, baseY - h);
  }
  ctx.lineTo(canvas.width, baseY);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = 'rgba(140, 0, 110, 0.3)';
  ctx.beginPath();
  const offset2 = (state.scroll * 60) % canvas.width;
  ctx.moveTo(-offset2, baseY);
  for (let x = 0; x <= canvas.width + 100; x += 40) {
    const h = 14 + Math.sin((x + offset2) * 0.02 + 1.5) * 10;
    ctx.lineTo(x - offset2, baseY - h);
  }
  ctx.lineTo(canvas.width, baseY);
  ctx.closePath();
  ctx.fill();
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
  state.scroll += state.running ? 0.06 : 0.02;
  requestAnimationFrame(frame);
}
frame();

showDebugIfRequested('dino');
