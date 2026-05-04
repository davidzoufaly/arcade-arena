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
const stageProgressEl = document.getElementById('stage-progress');
const stageNameEl = document.getElementById('stage-name');
const stageCountEl = document.getElementById('stage-count');
const DINO_LABELS = ['FINGER', 'HAND', 'ARM', 'BODY'];
const DINO_THRESHOLDS = [0, 8, 16, 23, 31];
const fingerDotsEl = document.getElementById('finger-dots');
const jumpFillEl = document.getElementById('jump-fill');
const jumpLabelEl = document.getElementById('jump-label');

// Pre-populate 10 finger pips (max two open hands)
if (fingerDotsEl) {
  for (let i = 0; i < 10; i++) {
    const d = document.createElement('div');
    d.className = 'finger-pip';
    d.style.cssText = 'width:10px;height:14px;border:1px solid rgba(255,255,0,0.3);border-radius:3px;background:rgba(255,255,0,0.05);transition:background 0.05s';
    fingerDotsEl.appendChild(d);
  }
}

function updateFingerHud(fingers) {
  if (!fingerDotsEl) return;
  const pips = fingerDotsEl.children;
  for (let i = 0; i < pips.length; i++) {
    pips[i].style.background = i < fingers
      ? (i < 5 ? '#ffff00' : '#ff5a3c')
      : 'rgba(255,255,0,0.05)';
    pips[i].style.boxShadow = i < fingers ? '0 0 6px currentColor' : 'none';
  }
  if (jumpFillEl) {
    const strength = Math.min(20, 8 + fingers * 1.5);
    const pct = ((strength - 8) / (20 - 8)) * 100; // 0% at base, 100% at max
    jumpFillEl.style.width = `${Math.max(2, pct)}%`;
  }
  if (jumpLabelEl) {
    if (fingers === 0) jumpLabelEl.textContent = 'SHOW FINGERS = JUMP';
    else if (fingers <= 2) jumpLabelEl.textContent = 'SMALL HOP';
    else if (fingers <= 5) jumpLabelEl.textContent = 'BIG JUMP';
    else jumpLabelEl.textContent = 'MAX HEIGHT';
  }
}
let fpsLast = performance.now();
let fpsFrames = 0;
let fpsValue = 0;

state.pose = null;
state.poseBaseline = null;

function updateStageProgress() {
  if (!stageProgressEl) return;
  const stage = state.currentStage || 1;
  const lo = DINO_THRESHOLDS[stage - 1];
  const hi = DINO_THRESHOLDS[stage];
  const within = state.score - lo;
  const range = hi - lo;
  const pct = Math.max(0, Math.min(100, (within / range) * 100));
  stageProgressEl.style.width = `${pct}%`;
  if (stageNameEl) stageNameEl.textContent = DINO_LABELS[stage - 1];
  if (stageCountEl) stageCountEl.textContent = `${Math.max(0, within)}/${range}`;
}

async function setStage(n) {
  const cfg = STAGE_CFG[n - 1];
  state.mode = cfg.mode;
  state.speed = cfg.speed;
  state.spawnEvery = cfg.spawnEvery;
  state.allowHigh = cfg.allowHigh;
  bannerEl.textContent = `STAGE ${n}: ${cfg.label}`;
  const stageEls = document.querySelectorAll('#stages .stage');
  stageEls.forEach((s, i) => s.classList.toggle('active', i < n));
  stageDots.forEach((d, i) => d.classList.toggle('active', i < n));
  if (n < 4) {
    setTimeout(() => { if (state.currentStage === n) bannerEl.textContent = ''; }, 2200);
  }
  state.currentStage = n;

  if (n === 4 && !state.pose) {
    state.pose = await createPoseTracker(camEl);
    bannerEl.textContent = 'JUMPER TO CENTER · CROUCH + JUMP';
  }
  updateStageProgress();
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
  const meterEl = document.getElementById('finger-meter');
  if (meterEl) meterEl.style.display = state.mode === 'finger' ? 'block' : 'none';

  const hands = state.hand.latest().hands;
  let jump = false, duck = false;

  if (state.mode === 'finger') {
    let totalFingers = 0;
    for (const h of hands) totalFingers += countFingersUp(h);
    state._fingers = totalFingers;
    updateFingerHud(totalFingers);
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
    updateStageProgress();
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
  const ducking = k.ducking;
  const baseW = k.w;
  const baseH = ducking ? k.h * 0.55 : k.h;
  const top = k.y + (k.h - baseH);
  const cx = k.x + baseW / 2;
  const onGround = k.y + k.h >= groundY() - 0.5;
  const runPhase = state.scroll * 8; // legs swing by scroll

  ctx.save();

  if (ducking) {
    // Crouched: rounded armored ball, shield up
    drawArmoredBall(cx, top, baseW, baseH);
  } else {
    drawCape(cx, top, baseW, baseH, runPhase);
    drawLegs(cx, top, baseW, baseH, runPhase, onGround);
    drawTorso(cx, top, baseW, baseH);
    drawShield(cx, top, baseW, baseH);
    drawSword(cx, top, baseW, baseH);
    drawHelmet(cx, top, baseW);
  }

  ctx.restore();
}

function drawCape(cx, top, w, h, phase) {
  ctx.save();
  ctx.strokeStyle = '#ff00ff';
  ctx.globalAlpha = 0.55;
  ctx.lineWidth = 3;
  const wave = Math.sin(phase) * 4;
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.4, top + 2);
  ctx.bezierCurveTo(cx - w * 0.9 + wave, top + h * 0.3, cx - w * 0.7 - wave, top + h * 0.7, cx - w * 0.3, top + h);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(cx - w * 0.2, top + 2);
  ctx.bezierCurveTo(cx - w * 0.6 + wave, top + h * 0.35, cx - w * 0.5 - wave, top + h * 0.75, cx - w * 0.1, top + h);
  ctx.stroke();
  ctx.restore();
}

function drawLegs(cx, top, w, h, phase, onGround) {
  const hipY = top + h * 0.7;
  const footY = top + h;
  const swing = onGround ? Math.sin(phase) * 6 : 4;
  ctx.save();
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  // back leg
  ctx.beginPath();
  ctx.moveTo(cx - 4, hipY);
  ctx.lineTo(cx - 4 - swing, footY);
  ctx.stroke();
  // front leg
  ctx.beginPath();
  ctx.moveTo(cx + 4, hipY);
  ctx.lineTo(cx + 4 + swing, footY);
  ctx.stroke();
  ctx.restore();
}

function drawTorso(cx, top, w, h) {
  // Cuirass: trapezoid w/ bar-chart engraving
  const torsoY = top + h * 0.32;
  const torsoH = h * 0.4;
  withGlow(ctx, '#ffff00', 8, () => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2, torsoY);
    ctx.lineTo(cx + w / 2, torsoY);
    ctx.lineTo(cx + w / 2 - 2, torsoY + torsoH);
    ctx.lineTo(cx - w / 2 + 2, torsoY + torsoH);
    ctx.closePath();
    ctx.fill();
  });
  // Bar-chart engraving (3 vertical bars in increasing height)
  ctx.save();
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(cx - 6, torsoY + torsoH - 6, 3, 4);
  ctx.fillRect(cx - 1, torsoY + torsoH - 8, 3, 6);
  ctx.fillRect(cx + 4, torsoY + torsoH - 11, 3, 9);
  ctx.restore();
}

function drawShield(cx, top, w, h) {
  // Shield on left (in front of player from screen perspective)
  const sx = cx - w / 2 - 4;
  const sy = top + h * 0.4;
  ctx.save();
  ctx.fillStyle = '#ff5a3c';
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(sx - 6, sy, 10, 16, 3);
  ctx.fill();
  ctx.stroke();
  // Dashboard ring glyph
  ctx.strokeStyle = '#0a0a1a';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(sx - 1, sy + 8, 3, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(sx - 1, sy + 8, 1, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawSword(cx, top, w, h) {
  // Sword raised: from right shoulder, up and slightly back
  const handX = cx + w / 2 - 2;
  const handY = top + h * 0.36;
  const tipX = handX + 14;
  const tipY = top - 14;
  withGlow(ctx, '#ffff00', 12, () => {
    ctx.lineWidth = 3;
    ctx.lineCap = 'round';
    ctx.strokeStyle = '#ffff00';
    ctx.beginPath();
    ctx.moveTo(handX, handY);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
  });
  // Crossguard
  ctx.save();
  ctx.strokeStyle = '#ff5a3c';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(handX - 3, handY + 1);
  ctx.lineTo(handX + 6, handY - 5);
  ctx.stroke();
  ctx.restore();
}

function drawHelmet(cx, top, w) {
  // Helmet body
  withGlow(ctx, '#ffff00', 8, () => {
    ctx.beginPath();
    ctx.moveTo(cx - w / 2 + 2, top + 16);
    ctx.lineTo(cx - w / 2 + 4, top + 4);
    ctx.lineTo(cx - 4, top - 2);
    ctx.lineTo(cx + 4, top - 2);
    ctx.lineTo(cx + w / 2 - 4, top + 4);
    ctx.lineTo(cx + w / 2 - 2, top + 16);
    ctx.closePath();
    ctx.fill();
  });
  // Visor slit
  ctx.save();
  ctx.fillStyle = '#0a0a1a';
  ctx.fillRect(cx - 8, top + 6, 16, 3);
  // Magenta glow eye through visor
  ctx.fillStyle = '#ff00ff';
  ctx.shadowColor = '#ff00ff';
  ctx.shadowBlur = 8;
  ctx.fillRect(cx - 4, top + 6, 8, 3);
  ctx.shadowBlur = 0;
  ctx.restore();
  // Crest spike
  ctx.save();
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(cx, top - 2);
  ctx.lineTo(cx, top - 10);
  ctx.stroke();
  ctx.restore();
}

function drawArmoredBall(cx, top, w, h) {
  // Crouched armored ball
  withGlow(ctx, '#ffff00', 10, () => {
    ctx.beginPath();
    ctx.arc(cx, top + h * 0.5, Math.max(w, h) * 0.55, 0, Math.PI * 2);
    ctx.fill();
  });
  // Shield raised over head
  ctx.save();
  ctx.fillStyle = '#ff5a3c';
  ctx.strokeStyle = '#ffff00';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.roundRect(cx - 14, top - 4, 28, 8, 3);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function draw() {
  ctx.save();
  shake.apply(ctx);
  fadeOverlay(ctx, 0.95);
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
  for (const o of state.obs) {
    if (o.type === 'high') drawAlertPopup(o);
    else drawStackTraceBars(o);
  }
}

function drawAlertPopup(o) {
  ctx.save();
  // Card background
  ctx.fillStyle = 'rgba(10, 10, 26, 0.85)';
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(o.x, o.y, o.w, o.h, 4);
  ctx.fill();
  ctx.stroke();
  // Top alert bar (red)
  ctx.fillStyle = '#ff5a3c';
  ctx.fillRect(o.x, o.y, o.w, 4);
  // Exclamation icon
  ctx.fillStyle = '#ff5a3c';
  ctx.font = `bold ${Math.round(o.h * 0.6)}px 'Courier New', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('!', o.x + o.w / 2, o.y + o.h * 0.6);
  ctx.restore();
}

function drawStackTraceBars(o) {
  ctx.save();
  // Spawn 4 vertical magenta bars of varying heights inside obstacle bbox
  const bars = 4;
  const gap = 2;
  const barW = (o.w - gap * (bars - 1)) / bars;
  // Stable per-obstacle pattern: hash by integer x-position
  const seed = Math.abs(Math.floor(o.x / 7)) % 1000;
  ctx.fillStyle = '#ff00ff';
  for (let i = 0; i < bars; i++) {
    const h = 8 + ((seed * 13 + i * 31) % Math.max(8, Math.floor(o.h * 0.85)));
    const bx = o.x + i * (barW + gap);
    const by = o.y + (o.h - h);
    withGlow(ctx, '#ff00ff', 8, () => {
      ctx.beginPath();
      ctx.rect(bx, by, barW, h);
      ctx.fill();
    });
  }
  // Tiny baseline tick under all bars
  ctx.strokeStyle = '#ff00ff';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y + o.h);
  ctx.lineTo(o.x + o.w, o.y + o.h);
  ctx.stroke();
  ctx.restore();
}

function drawSky() {
  const w = canvas.width, h = canvas.height;
  // chart-style horizontal gridlines (only sky portion)
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.05)';
  ctx.lineWidth = 1;
  const skyH = groundY();
  const rows = 5;
  for (let i = 1; i < rows; i++) {
    const y = (i / rows) * skyH;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  ctx.restore();

  // Rotating donut/gauge chart in upper-right
  const cx = w * 0.78;
  const cy = h * 0.28;
  const radius = Math.min(w, h) * 0.10;
  const phase = state.scroll * 0.5;
  ctx.save();
  // outer ring
  ctx.strokeStyle = 'rgba(255, 0, 255, 0.4)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();
  // arc segments
  const segments = 5;
  for (let i = 0; i < segments; i++) {
    const start = (i / segments) * Math.PI * 2 + phase;
    const end = start + (Math.PI * 2 / segments) * 0.8;
    ctx.strokeStyle = i % 2 === 0 ? '#ff00ff' : '#00ffff';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, start, end);
    ctx.stroke();
  }
  // inner value
  ctx.fillStyle = '#ffff00';
  ctx.font = `bold ${Math.round(radius * 0.5)}px 'Courier New', monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(`${state.score}`, cx, cy);
  ctx.restore();

  // Drifting widget cards (procedural, fixed seeds based on slot index)
  const numCards = 6;
  for (let i = 0; i < numCards; i++) {
    const seed = i * 137.5;
    const baseX = (seed % w);
    const baseY = ((seed * 0.31) % (skyH * 0.7)) + 30;
    const driftX = (baseX - state.scroll * (10 + (i % 3) * 6)) % (w + 200) - 50;
    drawWidgetCard(driftX, baseY, i);
  }
}

function drawWidgetCard(x, y, idx) {
  const w = 70, h = 36;
  if (x + w < 0 || x > canvas.width) return;
  ctx.save();
  ctx.globalAlpha = 0.5;
  ctx.fillStyle = 'rgba(10, 10, 26, 0.7)';
  ctx.strokeStyle = idx % 2 === 0 ? 'rgba(0, 255, 255, 0.5)' : 'rgba(255, 0, 255, 0.5)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 4);
  ctx.fill();
  ctx.stroke();

  // Mini visualisation per card type (cycle by idx % 3)
  const t = idx % 3;
  if (t === 0) {
    // sparkline
    ctx.strokeStyle = '#ffff00';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const px = x + 6 + (i / 7) * (w - 12);
      const py = y + h - 6 - ((Math.sin(i * 0.9 + idx) + 1) / 2) * (h - 12);
      if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
    }
    ctx.stroke();
  } else if (t === 1) {
    // bar chart
    const bars = 5;
    const barW = 6;
    const gap = 2;
    for (let i = 0; i < bars; i++) {
      const bx = x + 8 + i * (barW + gap);
      const bh = 6 + ((i * 13 + idx * 7) % (h - 14));
      ctx.fillStyle = i % 2 === 0 ? '#ff5a3c' : '#ff00ff';
      ctx.fillRect(bx, y + h - 6 - bh, barW, bh);
    }
  } else {
    // gauge
    const cx = x + w / 2;
    const cy = y + h - 6;
    const r = Math.min(w / 2 - 6, h - 12);
    ctx.strokeStyle = 'rgba(0, 255, 255, 0.3)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, 0);
    ctx.stroke();
    ctx.strokeStyle = '#00ffff';
    ctx.lineWidth = 3;
    const fill = ((idx * 0.27) % 1);
    ctx.beginPath();
    ctx.arc(cx, cy, r, Math.PI, Math.PI + Math.PI * fill);
    ctx.stroke();
  }
  ctx.restore();
}

function drawDunes() {
  // Replace the old desert dunes with two parallax silhouette layers of data pipelines + server racks
  const baseY = groundY();
  const w = canvas.width;

  // Distant racks layer
  ctx.save();
  ctx.fillStyle = 'rgba(40, 0, 80, 0.5)';
  const off1 = (state.scroll * 30) % 200;
  for (let x = -off1; x < w + 200; x += 200) {
    drawRackSilhouette(x, baseY, 90, 38, 'far');
  }
  ctx.restore();

  // Closer pipeline layer
  ctx.save();
  ctx.fillStyle = 'rgba(80, 0, 100, 0.55)';
  ctx.strokeStyle = 'rgba(255, 0, 255, 0.5)';
  ctx.lineWidth = 2;
  const off2 = (state.scroll * 60) % 300;
  for (let x = -off2; x < w + 300; x += 300) {
    drawPipelineSilhouette(x, baseY);
  }
  ctx.restore();
}

function drawRackSilhouette(x, baseY, w, h, depth) {
  ctx.fillRect(x, baseY - h, w, h);
  // Slot lines (server units)
  ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
  const slots = 5;
  for (let i = 1; i < slots; i++) {
    ctx.fillRect(x + 4, baseY - h + (i / slots) * h, w - 8, 1);
  }
  ctx.fillStyle = depth === 'far' ? 'rgba(40, 0, 80, 0.5)' : 'rgba(80, 0, 100, 0.55)';
  // Indicator LED
  ctx.fillStyle = '#00ffff';
  ctx.fillRect(x + w - 8, baseY - h + 4, 3, 3);
  ctx.fillStyle = depth === 'far' ? 'rgba(40, 0, 80, 0.5)' : 'rgba(80, 0, 100, 0.55)';
}

function drawPipelineSilhouette(x, baseY) {
  // Rack
  ctx.fillRect(x, baseY - 56, 60, 56);
  ctx.strokeRect(x, baseY - 56, 60, 56);
  // Connecting pipe to next rack
  ctx.fillRect(x + 60, baseY - 38, 240, 4);
  ctx.strokeRect(x + 60, baseY - 38, 240, 4);
  // Pipe blob (data flowing) — magenta dot
  const blobOffset = (state.scroll * 100) % 240;
  ctx.fillStyle = '#ff00ff';
  ctx.fillRect(x + 60 + blobOffset, baseY - 41, 6, 10);
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

  // Faint vertical chart gridlines on ground (x-axis ticks)
  ctx.save();
  ctx.strokeStyle = 'rgba(0, 255, 255, 0.10)';
  ctx.lineWidth = 1;
  const colSpacing = 80;
  const offset = (state.scroll * 50) % colSpacing;
  for (let x = -offset; x < canvas.width; x += colSpacing) {
    ctx.beginPath();
    ctx.moveTo(x, gy);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
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
  state.scroll += state.running ? 0.06 : 0.02;
  requestAnimationFrame(frame);
}
frame();

showDebugIfRequested('dino');
