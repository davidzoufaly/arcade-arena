# PS Offsite Voice & Gesture Games — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two browser-based party games — voice-controlled flappy ("Save the Customer") and gesture-controlled dino ("Wizard Quest") — for a 10-station team-building offsite. 0–30 score scale, neon arcade visuals, laptop-only setup.

**Architecture:** Two standalone static HTML+JS games sharing a `shared/` utils folder (pure-logic + Web Audio + MediaPipe wrappers + neon theme). Vanilla ES modules. Canvas 2D rendering. No bundler for production. Vite for dev.

**Tech Stack:** Vanilla JS (ES modules), Canvas 2D, Web Audio API, MediaPipe Tasks Vision (`HandLandmarker`, `PoseLandmarker`), Vitest (unit tests for pure logic), Vite (dev server).

**Spec:** [docs/superpowers/specs/2026-05-04-voice-gesture-games-design.md](../specs/2026-05-04-voice-gesture-games-design.md)

---

## File Structure

```
ps-offsite/
├── flappy/
│   ├── index.html
│   ├── main.js              # game loop, pipes, orb, stages wiring
│   └── style.css
├── dino/
│   ├── index.html
│   ├── main.js              # game loop, obstacles, knight, stages wiring
│   └── style.css
├── shared/
│   ├── neon.css             # palette tokens, fonts, glow utilities
│   ├── neon-fx.js           # canvas glow / trail / shake helpers
│   ├── audio.js             # Web Audio amplitude + sustain detector
│   ├── vision.js            # MediaPipe HandLandmarker + PoseLandmarker wrappers
│   ├── stages.js            # pure stage progression state machine
│   ├── score-panel.js       # end screen renderer + verification code
│   └── perms.js             # mic / cam permission flow + denial modal
├── tests/
│   ├── stages.test.js
│   ├── score-panel.test.js
│   └── audio.test.js
├── docs/
├── .gitignore
├── package.json             # vite + vitest dev deps
└── README.md
```

**Module boundaries:**

- `shared/stages.js` — pure: `createStageManager(thresholds, onChange)`. Score in, stage transitions out. No DOM, no time. Easy unit tests.
- `shared/score-panel.js` — pure for `generateCode(score, timestamp)`. DOM-touching `renderEndScreen()` separate.
- `shared/audio.js` — `createAudioInput()` returns `{amplitude(), sustainedFor(ms), stop()}`. Internal logic (RMS, smoothing, sustain detection) split into pure helper `analyseSamples(samples, opts)` for unit tests; outer wrapper handles `AudioContext`.
- `shared/vision.js` — `createHandTracker()`, `createPoseTracker()` return `{latest(), stop()}`. Manual smoke test only (MediaPipe needs real video).
- `shared/perms.js` — `requestMic()`, `requestCam()` returning streams, plus `showDenialModal()` UI.
- `shared/neon-fx.js` — `applyGlow(ctx, fn, color, blur)`, `drawScanlines(ctx)`, `screenShake(ctx, frames)`.
- Game `main.js` files own their game-specific state (orb / knight, pipes / obstacles, scroll speed) and wire shared modules.

---

## Task 1: Bootstrap repo

**Files:**
- Create: `package.json`
- Create: `vite.config.js`
- Create: `tests/.gitkeep`
- Create: `README.md`
- Create: `flappy/.gitkeep`, `dino/.gitkeep`, `shared/.gitkeep`

- [ ] **Step 1: Create folder skeleton + `.gitkeep` files**

```bash
mkdir -p flappy dino shared tests
touch flappy/.gitkeep dino/.gitkeep shared/.gitkeep tests/.gitkeep
```

- [ ] **Step 2: Write `package.json`**

```json
{
  "name": "ps-offsite-games",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 3: Write `vite.config.js`**

```js
import { defineConfig } from 'vite';

export default defineConfig({
  root: '.',
  server: { port: 5173, open: '/flappy/' },
  build: { outDir: 'dist' }
});
```

- [ ] **Step 4: Write minimal `README.md`**

```md
# PS Offsite Games

Two browser games for a team-building offsite. See [design spec](docs/superpowers/specs/2026-05-04-voice-gesture-games-design.md).

## Run locally

    npm install
    npm run dev

Open `http://localhost:5173/flappy/` or `/dino/`.

## Run tests

    npm test
```

- [ ] **Step 5: Install deps + verify**

```bash
npm install
```

Expected: `node_modules/` populated. `npm test` exits 0 (no tests yet but shouldn't error — Vitest exits cleanly with "no test files found").

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vite.config.js README.md flappy dino shared tests
echo "node_modules/" >> .gitignore
echo "dist/" >> .gitignore
git add .gitignore
git commit -m "chore: bootstrap repo with vite + vitest"
```

---

## Task 2: `shared/stages.js` — pure stage manager

**Files:**
- Create: `tests/stages.test.js`
- Create: `shared/stages.js`

- [ ] **Step 1: Write the failing test**

`tests/stages.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { createStageManager } from '../shared/stages.js';

describe('createStageManager', () => {
  it('starts at stage 1', () => {
    const sm = createStageManager([5, 13, 23], () => {});
    expect(sm.currentStage()).toBe(1);
  });

  it('advances when score crosses threshold', () => {
    const onChange = vi.fn();
    const sm = createStageManager([5, 13, 23], onChange);
    sm.update(4);
    expect(sm.currentStage()).toBe(1);
    sm.update(5);
    expect(sm.currentStage()).toBe(2);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('skips multiple stages if score jumps', () => {
    const onChange = vi.fn();
    const sm = createStageManager([5, 13, 23], onChange);
    sm.update(20);
    expect(sm.currentStage()).toBe(3);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('caps at last stage', () => {
    const sm = createStageManager([5, 13, 23], () => {});
    sm.update(100);
    expect(sm.currentStage()).toBe(4);
  });

  it('does not fire onChange if stage unchanged', () => {
    const onChange = vi.fn();
    const sm = createStageManager([5, 13, 23], onChange);
    sm.update(2);
    sm.update(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reset returns to stage 1', () => {
    const sm = createStageManager([5, 13, 23], () => {});
    sm.update(20);
    sm.reset();
    expect(sm.currentStage()).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/stages.test.js`
Expected: FAIL with "Cannot find module '../shared/stages.js'".

- [ ] **Step 3: Write minimal implementation**

`shared/stages.js`:

```js
export function createStageManager(thresholds, onChange) {
  let stage = 1;

  function compute(score) {
    let s = 1;
    for (const t of thresholds) {
      if (score >= t) s += 1;
    }
    return s;
  }

  return {
    currentStage() { return stage; },
    update(score) {
      const next = compute(score);
      while (stage < next) {
        stage += 1;
        onChange(stage);
      }
    },
    reset() { stage = 1; }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/stages.test.js`
Expected: 6 PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/stages.js tests/stages.test.js
git commit -m "feat(shared): add stage progression state machine"
```

---

## Task 3: `shared/score-panel.js` — verification code generation

**Files:**
- Create: `tests/score-panel.test.js`
- Create: `shared/score-panel.js`

- [ ] **Step 1: Write the failing test**

`tests/score-panel.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { generateCode } from '../shared/score-panel.js';

describe('generateCode', () => {
  it('produces a 4-character alphanumeric code', () => {
    const code = generateCode(15, 1700000000000);
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = generateCode(15, 1700000000000);
    const b = generateCode(15, 1700000000000);
    expect(a).toBe(b);
  });

  it('changes when score changes', () => {
    const a = generateCode(15, 1700000000000);
    const b = generateCode(16, 1700000000000);
    expect(a).not.toBe(b);
  });

  it('changes when timestamp changes', () => {
    const a = generateCode(15, 1700000000000);
    const b = generateCode(15, 1700000060000);
    expect(a).not.toBe(b);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/score-panel.test.js`
Expected: FAIL with "Cannot find module '../shared/score-panel.js'".

- [ ] **Step 3: Write minimal implementation**

`shared/score-panel.js`:

```js
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no ambiguous (I/O/0/1)

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function generateCode(score, timestamp) {
  let h = fnv1a(`${score}|${timestamp}`);
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += ALPHABET[h % ALPHABET.length];
    h = Math.floor(h / ALPHABET.length);
    if (h === 0) h = fnv1a(`${score}|${timestamp}|${i}`);
  }
  return out;
}

export function renderEndScreen(container, { score, code, message }) {
  container.innerHTML = `
    <div class="end-screen">
      <h1>${message}</h1>
      <div class="score">SCORE: ${score} / 30</div>
      <div class="code">CODE: ${code}</div>
      <div class="hint">PRESS SPACE TO PLAY AGAIN</div>
    </div>
  `;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/score-panel.test.js`
Expected: 4 PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/score-panel.js tests/score-panel.test.js
git commit -m "feat(shared): add verification code generator + end screen"
```

---

## Task 4: `shared/audio.js` — amplitude + sustain analyser

Two layers: a pure `analyseSamples()` for unit tests, and the `createAudioInput()` wrapper that owns `AudioContext`. Tests cover the pure logic.

**Files:**
- Create: `tests/audio.test.js`
- Create: `shared/audio.js`

- [ ] **Step 1: Write the failing test**

`tests/audio.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { rms, smooth, SustainTracker } from '../shared/audio.js';

describe('rms', () => {
  it('returns 0 for zeros', () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0);
  });
  it('returns ~1 for full-scale square wave', () => {
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1);
  });
});

describe('smooth', () => {
  it('averages over window', () => {
    const s = smooth(0.5);
    expect(s.next(0)).toBeCloseTo(0); // first sample
    expect(s.next(1)).toBeCloseTo(0.5); // (0+1)/2
  });
});

describe('SustainTracker', () => {
  it('reports sustained when amplitude stays above threshold for window ms', () => {
    const t = new SustainTracker({ threshold: 0.3, windowMs: 1000 });
    t.feed(0.5, 0);
    t.feed(0.5, 500);
    expect(t.isSustained()).toBe(false);
    t.feed(0.5, 1000);
    expect(t.isSustained()).toBe(true);
  });

  it('resets when amplitude drops below threshold', () => {
    const t = new SustainTracker({ threshold: 0.3, windowMs: 1000 });
    t.feed(0.5, 0);
    t.feed(0.1, 500); // drop below threshold, restart pending
    t.feed(0.5, 1000); // restart timer at 1000
    t.feed(0.5, 1900); // 900ms elapsed since restart
    expect(t.isSustained()).toBe(false);
    t.feed(0.5, 2000); // 1000ms elapsed → sustained
    expect(t.isSustained()).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/audio.test.js`
Expected: FAIL "Cannot find module".

- [ ] **Step 3: Write minimal implementation**

`shared/audio.js`:

```js
export function rms(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}

export function smooth(alpha) {
  let val = null;
  return {
    next(x) {
      if (val === null) { val = x; return x; }
      val = alpha * x + (1 - alpha) * val;
      return val;
    },
    value() { return val ?? 0; },
    reset() { val = null; }
  };
}

export class SustainTracker {
  constructor({ threshold, windowMs }) {
    this.threshold = threshold;
    this.windowMs = windowMs;
    this.startedAt = null;
    this.lastNow = 0;
  }
  feed(amp, nowMs) {
    this.lastNow = nowMs;
    if (amp >= this.threshold) {
      if (this.startedAt === null) this.startedAt = nowMs;
    } else {
      this.startedAt = null;
    }
  }
  isSustained() {
    return this.startedAt !== null && this.lastNow - this.startedAt >= this.windowMs;
  }
  reset() { this.startedAt = null; }
}

export async function createAudioInput({ smoothing = 0.4, sustainThreshold = 0.25, sustainMs = 1000 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const ctx = new AudioContext();
  const src = ctx.createMediaStreamSource(stream);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  src.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  const sm = smooth(smoothing);
  const sus = new SustainTracker({ threshold: sustainThreshold, windowMs: sustainMs });

  function tick() {
    analyser.getFloatTimeDomainData(buf);
    const x = rms(buf);
    sm.next(x);
    sus.feed(sm.value(), performance.now());
  }

  let raf;
  function loop() { tick(); raf = requestAnimationFrame(loop); }
  loop();

  return {
    amplitude() { return sm.value(); },
    isSustained() { return sus.isSustained(); },
    stop() { cancelAnimationFrame(raf); stream.getTracks().forEach(t => t.stop()); ctx.close(); }
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/audio.test.js`
Expected: 5 PASS (rms 2, smooth 1, sustain 2).

- [ ] **Step 5: Commit**

```bash
git add shared/audio.js tests/audio.test.js
git commit -m "feat(shared): add Web Audio amplitude + sustain detector"
```

---

## Task 5: `shared/vision.js` — MediaPipe Hand + Pose wrappers

No automated tests — MediaPipe needs real webcam frames. Smoke-tested manually in Tasks 14–15.

**Files:**
- Create: `shared/vision.js`

- [ ] **Step 1: Implement Hand + Pose wrappers**

`shared/vision.js`:

```js
const MP_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';

let visionPromise;
async function loadVision() {
  if (!visionPromise) {
    visionPromise = (async () => {
      const mod = await import(MP_URL);
      const fileset = await mod.FilesetResolver.forVisionTasks(WASM_URL);
      return { mod, fileset };
    })();
  }
  return visionPromise;
}

export async function createCamStream() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' }
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
  await video.play();
  return { video, stream };
}

export async function createHandTracker(video) {
  const { mod, fileset } = await loadVision();
  const tracker = await mod.HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    numHands: 4,
    runningMode: 'VIDEO'
  });

  let latest = { hands: [] };
  let raf;
  function loop() {
    const ts = performance.now();
    if (video.readyState >= 2) {
      const result = tracker.detectForVideo(video, ts);
      latest = { hands: result.landmarks ?? [] };
    }
    raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    latest() { return latest; },
    stop() { cancelAnimationFrame(raf); tracker.close(); }
  };
}

export async function createPoseTracker(video) {
  const { mod, fileset } = await loadVision();
  const tracker = await mod.PoseLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
      delegate: 'GPU'
    },
    numPoses: 1,
    runningMode: 'VIDEO'
  });

  let latest = { pose: null };
  let raf;
  let lastTs = 0;
  function loop() {
    const ts = performance.now();
    if (video.readyState >= 2 && ts - lastTs > 33) {
      lastTs = ts;
      const result = tracker.detectForVideo(video, ts);
      latest = { pose: result.landmarks?.[0] ?? null };
    }
    raf = requestAnimationFrame(loop);
  }
  loop();

  return {
    latest() { return latest; },
    stop() { cancelAnimationFrame(raf); tracker.close(); }
  };
}

// Helpers used by dino/main.js for gesture interpretation
export function isFingerUp(hand) {
  // landmark 8 = index tip, 6 = index PIP. tip Y < PIP Y (Y grows down).
  if (!hand || !hand[8] || !hand[6]) return false;
  return hand[8].y < hand[6].y - 0.05;
}

export function isPalmOpen(hand) {
  if (!hand) return false;
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  return tips.every((t, i) => hand[t].y < hand[pips[i]].y);
}

export function isFist(hand) {
  if (!hand) return false;
  const tips = [8, 12, 16, 20];
  const pips = [6, 10, 14, 18];
  return tips.every((t, i) => hand[t].y > hand[pips[i]].y);
}

export function isArmOverhead(hand) {
  if (!hand || !hand[0]) return false;
  return hand[0].y < 0.3; // wrist in upper third of frame
}

export function isJumpingPose(pose, baselineShoulderY) {
  if (!pose) return false;
  const shoulderY = (pose[11].y + pose[12].y) / 2;
  return shoulderY < baselineShoulderY - 0.08;
}

export function isCrouchingPose(pose, baselineHipY) {
  if (!pose) return false;
  const hipY = (pose[23].y + pose[24].y) / 2;
  return hipY > baselineHipY + 0.06;
}
```

- [ ] **Step 2: Smoke test in browser**

Create `shared/_vision-smoke.html` (temporary, deleted later):

```html
<!doctype html>
<html><body>
<video id="v" autoplay muted playsinline style="width:320px"></video>
<pre id="out"></pre>
<script type="module">
  import { createCamStream, createHandTracker, isFingerUp, isPalmOpen } from './vision.js';
  const { video } = await createCamStream();
  document.getElementById('v').srcObject = video.srcObject;
  const tracker = await createHandTracker(video);
  setInterval(() => {
    const { hands } = tracker.latest();
    document.getElementById('out').textContent = JSON.stringify({
      n: hands.length,
      finger: hands[0] ? isFingerUp(hands[0]) : null,
      palm: hands[0] ? isPalmOpen(hands[0]) : null
    }, null, 2);
  }, 100);
</script>
</body></html>
```

Run `npm run dev`, open `http://localhost:5173/shared/_vision-smoke.html`. Allow cam. Confirm: hand count updates, fingerUp toggles when raising index, palm toggles when opening hand.

- [ ] **Step 3: Delete the smoke file**

```bash
rm shared/_vision-smoke.html
```

- [ ] **Step 4: Commit**

```bash
git add shared/vision.js
git commit -m "feat(shared): add MediaPipe Hand + Pose tracker wrappers"
```

---

## Task 6: `shared/perms.js` — permission flow + denial modal

**Files:**
- Create: `shared/perms.js`

- [ ] **Step 1: Implement perms helpers**

`shared/perms.js`:

```js
export async function requestMic() {
  return navigator.mediaDevices.getUserMedia({ audio: true });
}

export async function requestCam() {
  return navigator.mediaDevices.getUserMedia({
    video: { width: 640, height: 480, facingMode: 'user' }
  });
}

export function showDenialModal(kind) {
  const overlay = document.createElement('div');
  overlay.className = 'denial-overlay';
  overlay.innerHTML = `
    <div class="denial-box">
      <h1>${kind.toUpperCase()} ACCESS NEEDED</h1>
      <p>This game needs your ${kind}. Click the lock icon in the address bar, allow ${kind}, then reload.</p>
      <button onclick="location.reload()">RELOAD</button>
    </div>
  `;
  document.body.appendChild(overlay);
}
```

- [ ] **Step 2: Commit**

```bash
git add shared/perms.js
git commit -m "feat(shared): add permission helpers + denial modal"
```

---

## Task 7: `shared/neon.css` + `shared/neon-fx.js` — theme + canvas FX

**Files:**
- Create: `shared/neon.css`
- Create: `shared/neon-fx.js`

- [ ] **Step 1: Write `shared/neon.css`**

```css
@import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&display=swap');

:root {
  --bg: #0a0a1a;
  --grid: #00ffff;
  --player: #ffff00;
  --hazard: #ff00ff;
  --title: #ff00ff;
  --score: #00ffff;
  --brand: #ff5a3c;
  --text: #ffffff;
}

* { box-sizing: border-box; }
html, body {
  margin: 0;
  padding: 0;
  height: 100%;
  background: var(--bg);
  color: var(--text);
  font-family: 'Press Start 2P', 'Courier New', monospace;
  overflow: hidden;
}

canvas { display: block; width: 100vw; height: 100vh; }

.hud {
  position: fixed;
  top: 16px; left: 16px;
  font-size: 24px;
  color: var(--score);
  text-shadow: 0 0 12px var(--score);
  pointer-events: none;
  z-index: 10;
}

.banner {
  position: fixed;
  top: 16px; left: 50%;
  transform: translateX(-50%);
  font-size: 18px;
  color: var(--title);
  text-shadow: 0 0 16px var(--title);
  letter-spacing: 0.1em;
  z-index: 10;
  pointer-events: none;
}

.stage-track {
  position: fixed;
  bottom: 16px; left: 50%;
  transform: translateX(-50%);
  display: flex; gap: 12px;
  z-index: 10;
}
.stage-track .dot {
  width: 12px; height: 12px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
}
.stage-track .dot.active { background: var(--brand); box-shadow: 0 0 12px var(--brand); }

.title-overlay, .end-overlay, .denial-overlay {
  position: fixed; inset: 0;
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  background: rgba(10, 10, 26, 0.92);
  z-index: 100;
  text-align: center;
  padding: 24px;
}
.title-overlay h1, .end-overlay h1, .denial-overlay h1 {
  color: var(--title);
  text-shadow: 0 0 24px var(--title);
  font-size: 36px;
  margin-bottom: 24px;
}
.end-overlay .score, .end-overlay .code { font-size: 24px; margin: 12px 0; }
.end-overlay .code { color: var(--brand); text-shadow: 0 0 12px var(--brand); }
.end-overlay .hint, .title-overlay .hint { font-size: 14px; color: var(--score); margin-top: 32px; }

.denial-box { max-width: 560px; }
.denial-box button {
  margin-top: 16px;
  padding: 12px 24px;
  background: transparent;
  color: var(--brand);
  border: 2px solid var(--brand);
  font-family: inherit;
  font-size: 16px;
  cursor: pointer;
}

.scanlines {
  position: fixed; inset: 0;
  background: repeating-linear-gradient(
    0deg, rgba(255,255,255,0.02) 0 1px, transparent 1px 3px
  );
  pointer-events: none;
  z-index: 50;
}

.toast {
  position: fixed;
  bottom: 80px; left: 50%;
  transform: translateX(-50%);
  padding: 12px 20px;
  background: rgba(255, 0, 255, 0.15);
  border: 1px solid var(--hazard);
  color: var(--hazard);
  text-shadow: 0 0 8px var(--hazard);
  font-size: 12px;
  z-index: 20;
}
```

- [ ] **Step 2: Write `shared/neon-fx.js`**

```js
export function withGlow(ctx, color, blur, fn) {
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
  fn();
  ctx.restore();
}

export function fadeOverlay(ctx, alpha = 0.15) {
  ctx.fillStyle = `rgba(10, 10, 26, ${alpha})`;
  ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
}

export function drawGridFloor(ctx, scrollOffset, color = '#00ffff') {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const horizonY = h * 0.55;
  ctx.strokeStyle = color;
  ctx.globalAlpha = 0.3;
  ctx.lineWidth = 1.5;
  // horizontal lines (perspective)
  for (let i = 0; i < 12; i++) {
    const t = (i + (scrollOffset % 1)) / 12;
    const y = horizonY + t * t * (h - horizonY);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }
  // vertical lines
  for (let i = -10; i <= 10; i++) {
    const x = w / 2 + i * (w * 0.08);
    ctx.beginPath();
    ctx.moveTo(x, horizonY);
    ctx.lineTo(w / 2 + i * w * 0.6, h);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

export class ScreenShake {
  constructor() { this.frames = 0; this.intensity = 0; }
  trigger(frames = 5, intensity = 8) { this.frames = frames; this.intensity = intensity; }
  apply(ctx) {
    if (this.frames <= 0) return;
    const dx = (Math.random() - 0.5) * this.intensity;
    const dy = (Math.random() - 0.5) * this.intensity;
    ctx.translate(dx, dy);
    this.frames -= 1;
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add shared/neon.css shared/neon-fx.js
git commit -m "feat(shared): add neon theme + canvas FX helpers"
```

---

## Task 8: Flappy — HTML scaffold + canvas + bg loop

**Files:**
- Create: `flappy/index.html`
- Create: `flappy/style.css`
- Create: `flappy/main.js`

- [ ] **Step 1: Write `flappy/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Save the Customer</title>
  <link rel="stylesheet" href="../shared/neon.css">
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <canvas id="game"></canvas>
  <div class="hud" id="hud">SCORE 0</div>
  <div class="banner" id="banner"></div>
  <div class="stage-track" id="stages">
    <div class="dot active"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div>
  </div>
  <div class="scanlines"></div>
  <div class="title-overlay" id="title">
    <h1>SAVE THE CUSTOMER</h1>
    <p>Customer's dashboard exploded.<br>Fly insights home through corrupted pipes.</p>
    <p style="color:var(--brand);text-shadow:0 0 12px var(--brand)">YELL TO FLY</p>
    <p class="hint">PRESS SPACE TO START</p>
  </div>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `flappy/style.css`**

```css
/* flappy-specific overrides only */
.hud { color: var(--brand); text-shadow: 0 0 12px var(--brand); }
```

- [ ] **Step 3: Write `flappy/main.js` minimal — bg + grid floor loop**

```js
import { drawGridFloor, fadeOverlay } from '../shared/neon-fx.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

function resize() {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
}
resize();
window.addEventListener('resize', resize);

let scroll = 0;

function frame() {
  fadeOverlay(ctx, 0.2);
  drawGridFloor(ctx, scroll);
  scroll += 0.01;
  requestAnimationFrame(frame);
}
frame();
```

- [ ] **Step 4: Smoke test**

Run `npm run dev`, open `http://localhost:5173/flappy/`. Expected: title overlay visible, neon grid floor scrolling beneath it.

- [ ] **Step 5: Commit**

```bash
git add flappy/
git commit -m "feat(flappy): scaffold HTML + bg grid loop"
```

---

## Task 9: Flappy — orb + amplitude → thrust + start gate

**Files:**
- Modify: `flappy/main.js`

- [ ] **Step 1: Replace `flappy/main.js` with orb logic + start gate**

```js
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
```

- [ ] **Step 2: Smoke test**

Run `npm run dev`. Open flappy. Press SPACE, allow mic. Expected: orb falls. Make noise (clap, talk, yell) → orb rises. Silence → orb falls.

- [ ] **Step 3: Commit**

```bash
git add flappy/main.js
git commit -m "feat(flappy): add orb physics driven by mic amplitude"
```

---

## Task 10: Flappy — pipes spawn, scroll, collision, score

**Files:**
- Modify: `flappy/main.js`

- [ ] **Step 1: Add pipe spawning + collision + score to `flappy/main.js`**

Replace the contents of `flappy/main.js` with:

```js
import { drawGridFloor, fadeOverlay, withGlow, ScreenShake } from '../shared/neon-fx.js';
import { createAudioInput } from '../shared/audio.js';
import { showDenialModal } from '../shared/perms.js';

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

function reset() {
  state.orb.y = canvas.height / 2;
  state.orb.vy = 0;
  state.score = 0;
  state.pipes = [];
  state.spawnTimer = 0;
  state.speed = 4;
  state.gap = 220;
  state.dead = false;
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
  state.orb.vy += 0.4;
  state.orb.vy -= amp * 14;
  state.orb.vy = Math.max(-8, Math.min(10, state.orb.vy));
  state.orb.y += state.orb.vy;
  if (state.orb.y < state.orb.r || state.orb.y > canvas.height - state.orb.r) die();

  state.spawnTimer -= 1;
  if (state.spawnTimer <= 0) {
    spawnPipe();
    state.spawnTimer = 90;
  }

  for (const p of state.pipes) {
    p.x -= state.speed;
    if (!p.passed && p.x + PIPE_W < state.orb.x) {
      p.passed = true;
      state.score = Math.min(30, state.score + 1);
      hudEl.textContent = `SCORE ${state.score}`;
    }
    // collision
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
  // Will be filled in Task 12. For now, brief overlay.
  const overlay = document.createElement('div');
  overlay.className = 'end-overlay';
  overlay.id = 'end';
  overlay.innerHTML = `
    <h1>CUSTOMER RESCUED: ${state.score}/30</h1>
    <div class="hint">PRESS SPACE TO PLAY AGAIN</div>
  `;
  document.body.appendChild(overlay);
  const remove = () => { overlay.remove(); window.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.code === 'Space') remove(); };
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
```

- [ ] **Step 2: Smoke test**

Run dev, open flappy, SPACE → noise → fly through pipes. Score increments. Crash into pipe → end overlay shows. SPACE again → restart.

- [ ] **Step 3: Commit**

```bash
git add flappy/main.js
git commit -m "feat(flappy): pipes, collision, score, end screen stub"
```

---

## Task 11: Flappy — wire stages + difficulty escalation

**Files:**
- Modify: `flappy/main.js`

- [ ] **Step 1: Integrate stage manager + per-stage tuning**

Update `flappy/main.js`. Add at top of imports:

```js
import { createStageManager } from '../shared/stages.js';
```

Add stage config + manager (replace/extend the `state` block + add update logic):

```js
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
```

In `reset()`, also reset stages:

```js
function reset() {
  // ...existing fields...
  stageMgr.reset();
  setStage(1);
}
```

In `step()`, update stage manager + change thrust per mode + adjust spawn timer:

Replace the body of `step()` with:

```js
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
```

- [ ] **Step 2: Smoke test**

Play to score 5 → banner "STAGE 2: LOUDER", gap shrinks. Continue to 13 → S3. To 23 → S4.

- [ ] **Step 3: Commit**

```bash
git add flappy/main.js
git commit -m "feat(flappy): wire 4-stage difficulty progression"
```

---

## Task 12: Flappy — proper end screen with score + code

**Files:**
- Modify: `flappy/main.js`

- [ ] **Step 1: Replace `showEndScreen()` body**

In `flappy/main.js` add import:

```js
import { generateCode, renderEndScreen } from '../shared/score-panel.js';
```

Replace `showEndScreen()` with:

```js
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
```

Also remove the old end-overlay logic from previous task.

- [ ] **Step 2: Smoke test**

Die. Confirm overlay shows score + 4-char code (e.g. `7B3K`). SPACE restarts game.

- [ ] **Step 3: Commit**

```bash
git add flappy/main.js
git commit -m "feat(flappy): end screen with verification code + restart"
```

---

## Task 13: Dino — HTML scaffold + canvas + cam preview

**Files:**
- Create: `dino/index.html`
- Create: `dino/style.css`
- Create: `dino/main.js`

- [ ] **Step 1: Write `dino/index.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Wizard Quest</title>
  <link rel="stylesheet" href="../shared/neon.css">
  <link rel="stylesheet" href="./style.css">
</head>
<body>
  <canvas id="game"></canvas>
  <video id="cam" autoplay muted playsinline></video>
  <div class="hud" id="hud">SCORE 0</div>
  <div class="banner" id="banner"></div>
  <div class="stage-track" id="stages">
    <div class="dot active"></div><div class="dot"></div><div class="dot"></div><div class="dot"></div>
  </div>
  <div class="scanlines"></div>
  <div class="title-overlay" id="title">
    <h1>WIZARD QUEST</h1>
    <p>Stale Data Storm sweeps the desert.<br>You are the ETL Knight.</p>
    <p style="color:var(--brand);text-shadow:0 0 12px var(--brand)">WAVE / JUMP TO SURVIVE</p>
    <p class="hint">PRESS SPACE TO START</p>
  </div>
  <script type="module" src="./main.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `dino/style.css`**

```css
#cam {
  position: fixed;
  top: 16px; right: 16px;
  width: 160px;
  height: 120px;
  border: 2px solid var(--hazard);
  box-shadow: 0 0 16px var(--hazard);
  z-index: 10;
  transform: scaleX(-1); /* mirror so user feels natural */
}
.hud { color: var(--score); text-shadow: 0 0 12px var(--score); }
```

- [ ] **Step 3: Write minimal `dino/main.js` with canvas + bg**

```js
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
```

- [ ] **Step 4: Smoke test**

Open `http://localhost:5173/dino/`. Title overlay + magenta grid floor visible.

- [ ] **Step 5: Commit**

```bash
git add dino/
git commit -m "feat(dino): scaffold HTML + magenta grid bg"
```

---

## Task 14: Dino — knight, jump/duck physics, hand input (S1–S2)

**Files:**
- Modify: `dino/main.js`

- [ ] **Step 1: Replace `dino/main.js`**

```js
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
```

- [ ] **Step 2: Smoke test**

Open dino. SPACE → allow cam. Webcam preview top-right. Raise index finger → knight jumps. (Duck not yet wired since S1 is finger-only.)

- [ ] **Step 3: Commit**

```bash
git add dino/main.js
git commit -m "feat(dino): knight physics + hand tracker S1 finger jump"
```

---

## Task 15: Dino — obstacles, collision, score

**Files:**
- Modify: `dino/main.js`

- [ ] **Step 1: Add obstacle spawn + collision + score wiring**

Add inside `state`:

```js
state.obs = [];
state.spawnTimer = 0;
state.spawnEvery = 90;
state.allowHigh = false; // S2+ enables high obstacles
```

Adjust `reset()` to clear obstacles:

```js
state.obs = [];
state.spawnTimer = 0;
```

Add helpers + integrate into step:

```js
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
```

Extend `step()` (append before `state.meters` increment):

```js
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
```

Add `die()` + end screen (reuse score-panel):

Add import at top:

```js
import { generateCode, renderEndScreen } from '../shared/score-panel.js';
```

```js
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
```

Extend `draw()` to draw obstacles:

```js
function drawObstacles() {
  withGlow(ctx, '#ff00ff', 14, () => {
    ctx.fillStyle = '#ff00ff';
    for (const o of state.obs) ctx.fillRect(o.x, o.y, o.w, o.h);
  });
}
```

Call `drawObstacles()` after `drawKnight()` in `draw()`.

- [ ] **Step 2: Smoke test**

Play. Low obstacles slide in. Jump to clear. Collision = end screen with meters + code.

- [ ] **Step 3: Commit**

```bash
git add dino/main.js
git commit -m "feat(dino): obstacles, collision, score, end screen"
```

---

## Task 16: Dino — wire stages + pose tracker for S4

**Files:**
- Modify: `dino/main.js`

- [ ] **Step 1: Add stage manager + pose tracker swap**

Add imports at top:

```js
import { createStageManager } from '../shared/stages.js';
import { createPoseTracker, isArmOverhead, isJumpingPose, isCrouchingPose } from '../shared/vision.js';
```

Add stage config:

```js
const STAGE_CFG = [
  { mode: 'finger',  speed: 5.0, spawnEvery: 110, allowHigh: false, label: 'FINGER' },
  { mode: 'hand',    speed: 6.0, spawnEvery: 95,  allowHigh: true,  label: 'HAND' },
  { mode: 'arm',     speed: 6.8, spawnEvery: 85,  allowHigh: true,  label: 'ARM' },
  { mode: 'body',    speed: 7.4, spawnEvery: 75,  allowHigh: true,  label: 'BODY' },
];

const bannerEl = document.getElementById('banner');
const stageDots = document.querySelectorAll('#stages .dot');

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
  setTimeout(() => { if (state.currentStage === n) bannerEl.textContent = ''; }, 2200);
  state.currentStage = n;

  if (n === 4 && !state.pose) {
    state.pose = await createPoseTracker(camEl);
    bannerEl.textContent = 'JUMPER TO CENTER · CROUCH + JUMP';
  }
}

state.currentStage = 1;
const stageMgr = createStageManager([8, 16, 23], setStage);
setStage(1);
```

Update `reset()` to reset stages:

```js
stageMgr.reset();
setStage(1);
```

Replace `readInput()`:

```js
function readInput() {
  const hands = state.hand.latest().hands;
  let jump = false, duck = false;

  if (state.mode === 'finger') {
    for (const h of hands) if (isFingerUp(h)) jump = true;
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
  return { jump, duck };
}
```

Update score-handler in `step()` to call `stageMgr.update(state.score)` after the score change check:

```js
if (newScore !== state.score) {
  state.score = newScore;
  hudEl.textContent = `SCORE ${state.score}`;
  stageMgr.update(state.score);
}
```

- [ ] **Step 2: Smoke test**

Play. At score 8 → S2 banner, palm/fist controls now (high obs appear). At 16 → S3 arm overhead. At 23 → S4 banner asks jumper to center; pose detection kicks in. Step back, jump → knight jumps; squat → duck.

- [ ] **Step 3: Commit**

```bash
git add dino/main.js
git commit -m "feat(dino): wire 4-stage gesture progression with pose for S4"
```

---

## Task 17: Calibration screen + attract loop

**Files:**
- Modify: `flappy/main.js`
- Modify: `dino/main.js`

- [ ] **Step 1: Flappy — auto-detect mic baseline**

Replace `start()` in `flappy/main.js`:

```js
async function start() {
  titleEl.style.display = 'none';
  try {
    state.audio = await createAudioInput();
  } catch {
    showDenialModal('microphone');
    return;
  }
  // calibrate: wait for first sound > 0.05
  bannerEl.textContent = 'SAY SOMETHING TO START...';
  const calibrate = () => {
    if (state.audio.amplitude() > 0.05) {
      bannerEl.textContent = '';
      reset();
      state.running = true;
    } else {
      requestAnimationFrame(calibrate);
    }
  };
  calibrate();
}
```

- [ ] **Step 2: Dino — calibration: wait for first hand**

Replace `start()` in `dino/main.js`:

```js
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
```

- [ ] **Step 3: Smoke test both**

Flappy: SPACE → "SAY SOMETHING" → make noise → game starts.
Dino: SPACE → cam preview + "WAVE A HAND" → wave → game starts.

- [ ] **Step 4: Commit**

```bash
git add flappy/main.js dino/main.js
git commit -m "feat: add calibration step before gameplay"
```

---

## Task 18: Error toasts (mic silent / pose lost)

**Files:**
- Modify: `flappy/main.js`
- Modify: `dino/main.js`

- [ ] **Step 1: Add toast helper inline (flappy)**

Add to `flappy/main.js`:

```js
function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

let lastSoundAt = performance.now();
```

In `step()`, after `state.audio.amplitude()`:

```js
if (state.audio.amplitude() > 0.05) lastSoundAt = performance.now();
if (performance.now() - lastSoundAt > 10000) {
  showToast('CHECK MIC?');
  lastSoundAt = performance.now();
}
```

- [ ] **Step 2: Add toast to dino for pose lost**

Add same `showToast()` function in `dino/main.js`. In `step()`, when in `body` mode:

```js
if (state.mode === 'body') {
  const pose = state.pose ? state.pose.latest().pose : null;
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
```

- [ ] **Step 3: Smoke test**

Flappy: stay silent 10s during gameplay → toast shows. Dino: at S4, walk out of frame → toast.

- [ ] **Step 4: Commit**

```bash
git add flappy/main.js dino/main.js
git commit -m "feat: add error toasts for missing input"
```

---

## Task 19: Persist run history to localStorage + debug view

**Files:**
- Modify: `shared/score-panel.js`
- Modify: `flappy/main.js`
- Modify: `dino/main.js`

- [ ] **Step 1: Add `saveRun` + `loadRuns` to `shared/score-panel.js`**

Add to `shared/score-panel.js`:

```js
export function saveRun(game, score, code) {
  const key = `runs.${game}`;
  const list = JSON.parse(localStorage.getItem(key) ?? '[]');
  list.push({ score, code, at: Date.now() });
  if (list.length > 20) list.shift();
  localStorage.setItem(key, JSON.stringify(list));
}

export function loadRuns(game) {
  return JSON.parse(localStorage.getItem(`runs.${game}`) ?? '[]');
}

export function showDebugIfRequested(game) {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const runs = loadRuns(game);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow:auto;background:#000c;color:#0ff;padding:8px;font-size:11px;z-index:100';
  pre.textContent = runs.map(r => `${new Date(r.at).toLocaleTimeString()}  ${r.score}/30  ${r.code}`).join('\n');
  document.body.appendChild(pre);
}
```

- [ ] **Step 2: Wire into flappy**

Top of `flappy/main.js`:

```js
import { generateCode, renderEndScreen, saveRun, showDebugIfRequested } from '../shared/score-panel.js';
```

In `showEndScreen()`, after `const code = ...`:

```js
saveRun('flappy', state.score, code);
```

At end of file:

```js
showDebugIfRequested('flappy');
```

- [ ] **Step 3: Wire into dino**

Same imports in `dino/main.js`. In `die()` after `const code = ...`:

```js
saveRun('dino', state.score, code);
```

End of file:

```js
showDebugIfRequested('dino');
```

- [ ] **Step 4: Smoke test**

Play 2 rounds. Open `?debug=1`. Confirm last 2 runs visible.

- [ ] **Step 5: Commit**

```bash
git add shared/score-panel.js flappy/main.js dino/main.js
git commit -m "feat: persist run history + debug view"
```

---

## Task 20: README — manual test checklist + delivery checklist

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Expand `README.md`**

Replace contents:

```md
# PS Offsite Voice & Gesture Games

Two browser-based party games for the offsite. Voice-controlled flappy ("Save the Customer") + gesture-controlled dino ("Wizard Quest"). Co-op for 5-6 players around one laptop. Scores 0-30 each, fed into the cross-station leaderboard.

See [design spec](docs/superpowers/specs/2026-05-04-voice-gesture-games-design.md).

## Run

    npm install
    npm run dev

Open `http://localhost:5173/flappy/` or `http://localhost:5173/dino/`.

For production: serve the repo root with any static server. No build step needed.

    python3 -m http.server 5173
    # or
    npx serve

Each game is reachable at `<host>/flappy/` and `<host>/dino/`.

## Run tests

    npm test

## Per-game manual smoke test

### Flappy ("Save the Customer")

- [ ] SPACE on title → mic prompt → calibration banner "SAY SOMETHING"
- [ ] First sound → game starts, orb falls under gravity
- [ ] Yelling lifts orb (S1: discrete impulse)
- [ ] Pass 5 pipes → "STAGE 2: LOUDER", gap shrinks, continuous control
- [ ] Pass to score 13 → "STAGE 3: SUSTAIN", sustained loudness boosts
- [ ] Pass to score 23 → "STAGE 4: CHANT", silence punishes
- [ ] Crash → end overlay shows score + 4-char code
- [ ] SPACE on end screen → restart back to S1
- [ ] 10s silence mid-game → "CHECK MIC?" toast

### Dino ("Wizard Quest")

- [ ] SPACE on title → cam prompt → cam preview top-right
- [ ] "WAVE A HAND" calibration banner → wave → game starts
- [ ] S1: index finger up → knight jumps over low obstacles
- [ ] Score 8 → "STAGE 2: HAND", palm = jump, fist = duck, high obstacles
- [ ] Score 16 → "STAGE 3: ARM", arm overhead = jump
- [ ] Score 23 → "STAGE 4: BODY", "JUMPER TO CENTER" banner; jumper steps back, real jump/squat works
- [ ] Crash → end overlay with meters + code
- [ ] SPACE → restart to S1
- [ ] At S4, no body in frame → "STAND BACK / CHECK LIGHT" toast

## Crowd rehearsal (do this before the offsite)

- 5-6 players around laptop. Run flappy through all 4 stages. Run dino through all 4 stages. Note which stages need tuning. Adjust thresholds in `flappy/main.js` (`STAGE_CFG`) and `dino/main.js` (`STAGE_CFG`).

## Delivery checklist (pre-event)

- [ ] Both games run from USB stick on target laptop (`python3 -m http.server` from repo root)
- [ ] MediaPipe models pre-cached: load each game once with internet, then test offline
- [ ] Camera FOV verified at station setup with 5–6 players
- [ ] Mic level tested with ambient venue noise
- [ ] Score-code copy-test with organizer's leaderboard sheet
- [ ] Backup laptop / restart procedure documented

## Architecture

See `docs/superpowers/specs/2026-05-04-voice-gesture-games-design.md`. Each game is a standalone static page; both share `shared/` utilities.

## Tech

Vanilla JS + Canvas 2D + Web Audio + MediaPipe Tasks Vision. No framework, no bundler in production. Vite + Vitest for dev only.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: expand README with manual test + delivery checklist"
```

---

## Self-review notes (already applied to plan above)

- Spec coverage: each spec section maps to a task — architecture (Task 1), shared modules (Tasks 2–7), Game 1 stages (Tasks 8–12), Game 2 stages (Tasks 13–16), calibration (Task 17), error toasts (Task 18), score export + debug (Task 19), README + delivery checklist (Task 20).
- No `TBD` / `TODO` placeholders remain.
- Type/method consistency: `createStageManager` / `createAudioInput` / `createHandTracker` / `createPoseTracker` / `generateCode` / `renderEndScreen` / `saveRun` / `loadRuns` used consistently across tasks.
- Stage thresholds noted as tunable in spec's open questions; thresholds appear in code comments where defined.
