# Dino + Flappy Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the Dino and Flappy games as card-bound, best-of-3 games that match the gesture-lock platform pattern, drop the cyberpunk theme, support whole-team multi-player input, and reduce input latency.

**Architecture:** Two new full pages (`games/3-dino.html`, `games/4-flappy.html`) each containing an inline ES module with a phase machine (`setup → loading → intro → play → attempt-end → final`) identical in shape to `games/1-gesture-lock.html`. All pure, testable logic (scoring, input mapping) lives in two new shared modules with Vitest unit tests. The shared `vision.js` is parameterised for resolution / hand-count / tick-rate. Old `dino/` + `flappy/` directories and now-dead shared modules are deleted last.

**Tech Stack:** Vanilla ES modules, Canvas 2D, MediaPipe Tasks Vision (`HandLandmarker`), Web Audio API, Firebase Realtime DB, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-26-dino-flappy-redesign-design.md`

---

## File Structure

| File | Responsibility |
|------|----------------|
| `ps-offsite-2026/shared/dino-logic.js` (new) | Pure: `palmCountToJumpStrength`, `scoreAttempt`, `finalScore`, constants |
| `ps-offsite-2026/shared/flappy-logic.js` (new) | Pure: `ampToThrust`, `scoreAttempt`, `finalScore`, constants |
| `tests/dino-logic.test.js` (new) | Unit tests for dino-logic |
| `tests/flappy-logic.test.js` (new) | Unit tests for flappy-logic |
| `ps-offsite-2026/shared/vision.js` (modify) | Add options to `createCamStream` + `createHandTracker` |
| `ps-offsite-2026/games/3-dino.html` (new) | Dino page: chrome + phase machine + canvas game |
| `ps-offsite-2026/games/4-flappy.html` (new) | Flappy page: chrome + phase machine + canvas game |
| `ps-offsite-2026/shared/games-catalog.js` (modify) | Repoint DN + FL hrefs |
| `tests/games-catalog.test.js` (modify if it asserts hrefs) | Keep green |
| `ps-offsite-2026/games/manual.html` (modify if it links old paths) | Repoint |
| `BUILD_PLAN.md` (modify) | Tick the Dino+Flappy bullet |
| Deleted: `ps-offsite-2026/dino/`, `ps-offsite-2026/flappy/`, `shared/neon-fx.js`, `shared/neon.css`, `shared/stages.js`, `shared/score-panel.js`, `tests/stages.test.js`, `tests/score-panel.test.js` | Dead after migration |

Note: `createPoseTracker` + pose helpers in `vision.js` become unused after old dino is deleted, but pruning them is out of scope — leave them.

---

## Task 1: Dino logic module

**Files:**
- Create: `ps-offsite-2026/shared/dino-logic.js`
- Test: `tests/dino-logic.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/dino-logic.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  MAX_OBSTACLES,
  PALM_COUNT_WINDOW,
  palmCountToJumpStrength,
  scoreAttempt,
  finalScore,
} from '../ps-offsite-2026/shared/dino-logic.js';

describe('constants', () => {
  it('MAX_OBSTACLES is 16', () => expect(MAX_OBSTACLES).toBe(16));
  it('PALM_COUNT_WINDOW is 4', () => expect(PALM_COUNT_WINDOW).toBe(4));
});

describe('palmCountToJumpStrength', () => {
  it('0 palms → 0 (no jump)', () => expect(palmCountToJumpStrength(0)).toBe(0));
  it('negative → 0', () => expect(palmCountToJumpStrength(-3)).toBe(0));
  it('1 palm → 8', () => expect(palmCountToJumpStrength(1)).toBe(8));
  it('4 palms → 14', () => expect(palmCountToJumpStrength(4)).toBe(14));
  it('8 palms → 20 (clamped)', () => expect(palmCountToJumpStrength(8)).toBe(20));
  it('20 palms → 20 (clamped)', () => expect(palmCountToJumpStrength(20)).toBe(20));
});

describe('scoreAttempt', () => {
  it('0 completed → 0', () =>
    expect(scoreAttempt({ completed: 0, timeSec: 60, died: true })).toBe(0));
  it('max in 30s → 100 (base 100 + 5 bonus, capped)', () =>
    expect(scoreAttempt({ completed: 16, timeSec: 30, died: false })).toBe(100));
  it('max in 60s → 100 (bonus floored at 0)', () =>
    expect(scoreAttempt({ completed: 16, timeSec: 60, died: false })).toBe(100));
  it('max in 0s → 100 (base 100 + 20 bonus, capped)', () =>
    expect(scoreAttempt({ completed: 16, timeSec: 0, died: false })).toBe(100));
  it('half in 20s → 50 (no bonus without max)', () =>
    expect(scoreAttempt({ completed: 8, timeSec: 20, died: true })).toBe(50));
});

describe('finalScore', () => {
  it('empty → 0', () => expect(finalScore([])).toBe(0));
  it('all zero → 0', () =>
    expect(finalScore([{ score: 0 }, { score: 0 }, { score: 0 }])).toBe(0));
  it('picks max', () =>
    expect(finalScore([{ score: 30 }, { score: 75 }, { score: 20 }])).toBe(75));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- dino-logic`
Expected: FAIL — `Failed to resolve import "../ps-offsite-2026/shared/dino-logic.js"`.

- [ ] **Step 3: Write minimal implementation**

Create `ps-offsite-2026/shared/dino-logic.js`:

```js
export const MAX_OBSTACLES = 16;
export const ATTEMPT_CAP_S = 60;
export const PALM_COUNT_WINDOW = 4;

// 0 palms → no jump. 1..8 palms → jump velocity 8..20 (clamped).
export function palmCountToJumpStrength(n) {
  if (n <= 0) return 0;
  return Math.min(20, 6 + n * 2);
}

// completed = obstacles cleared this attempt; timeSec = attempt duration.
// Base scales linearly to 100 at MAX_OBSTACLES. Time bonus only when maxed out.
export function scoreAttempt({ completed, timeSec }) {
  const base = Math.round(completed * (100 / MAX_OBSTACLES));
  let bonus = 0;
  if (completed >= MAX_OBSTACLES) bonus = Math.max(0, Math.round(20 - timeSec / 2));
  return Math.min(100, base + bonus);
}

export function finalScore(attempts) {
  if (!attempts.length) return 0;
  return Math.max(0, ...attempts.map(a => a.score));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- dino-logic`
Expected: PASS — all assertions green.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/dino-logic.js tests/dino-logic.test.js
git commit -m "feat(dino): pure scoring + jump-strength logic with tests"
```

---

## Task 2: Flappy logic module

**Files:**
- Create: `ps-offsite-2026/shared/flappy-logic.js`
- Test: `tests/flappy-logic.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/flappy-logic.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  MAX_PIPES,
  GAIN,
  GRAVITY,
  ampToThrust,
  scoreAttempt,
  finalScore,
} from '../ps-offsite-2026/shared/flappy-logic.js';

describe('constants', () => {
  it('MAX_PIPES is 20', () => expect(MAX_PIPES).toBe(20));
  it('GAIN is 25', () => expect(GAIN).toBe(25));
  it('GRAVITY is 0.28', () => expect(GRAVITY).toBeCloseTo(0.28));
});

describe('ampToThrust', () => {
  it('amp above floor → (amp-floor)*GAIN', () =>
    expect(ampToThrust(0.10, 0.05)).toBeCloseTo(1.25));
  it('amp below floor → 0', () =>
    expect(ampToThrust(0.05, 0.10)).toBe(0));
  it('zero amp & floor → 0', () =>
    expect(ampToThrust(0, 0)).toBe(0));
});

describe('scoreAttempt', () => {
  it('0 completed → 0', () =>
    expect(scoreAttempt({ completed: 0, timeSec: 5, died: true })).toBe(0));
  it('max in 30s → 100 (base 100 + 5 bonus, capped)', () =>
    expect(scoreAttempt({ completed: 20, timeSec: 30, died: false })).toBe(100));
  it('max in 60s → 100 (bonus floored)', () =>
    expect(scoreAttempt({ completed: 20, timeSec: 60, died: false })).toBe(100));
  it('half in 15s → 50', () =>
    expect(scoreAttempt({ completed: 10, timeSec: 15, died: true })).toBe(50));
});

describe('finalScore', () => {
  it('empty → 0', () => expect(finalScore([])).toBe(0));
  it('picks max', () =>
    expect(finalScore([{ score: 40 }, { score: 80 }, { score: 20 }])).toBe(80));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- flappy-logic`
Expected: FAIL — unresolved import.

- [ ] **Step 3: Write minimal implementation**

Create `ps-offsite-2026/shared/flappy-logic.js`:

```js
export const MAX_PIPES = 20;
export const ATTEMPT_CAP_S = 60;
export const GAIN = 25;
export const GRAVITY = 0.28;

// Voice amplitude above the calibrated noise floor → upward thrust.
export function ampToThrust(amp, floor) {
  return Math.max(0, amp - floor) * GAIN;
}

export function scoreAttempt({ completed, timeSec }) {
  const base = Math.round(completed * (100 / MAX_PIPES));
  let bonus = 0;
  if (completed >= MAX_PIPES) bonus = Math.max(0, Math.round(15 - timeSec / 3));
  return Math.min(100, base + bonus);
}

export function finalScore(attempts) {
  if (!attempts.length) return 0;
  return Math.max(0, ...attempts.map(a => a.score));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- flappy-logic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/flappy-logic.js tests/flappy-logic.test.js
git commit -m "feat(flappy): pure scoring + thrust logic with tests"
```

---

## Task 3: Parameterise vision.js

**Files:**
- Modify: `ps-offsite-2026/shared/vision.js:16-58`

No unit test — these wrap browser-only APIs (`getUserMedia`, MediaPipe). Behaviour is verified in the bench (Task 4) and in-browser (Tasks 6, 8). The only caller of these functions is the old `dino/main.js`, which is deleted in Task 11, so changing defaults is safe.

- [ ] **Step 1: Modify `createCamStream` to accept resolution**

Replace lines 16-27 (`export async function createCamStream() { ... }`) with:

```js
export async function createCamStream({ width = 640, height = 480 } = {}) {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { width, height, facingMode: 'user' }
  });
  const video = document.createElement('video');
  video.srcObject = stream;
  video.autoplay = true;
  video.playsInline = true;
  await new Promise(r => video.addEventListener('loadedmetadata', r, { once: true }));
  await video.play();
  return { video, stream };
}
```

- [ ] **Step 2: Modify `createHandTracker` to accept numHands + tick rate**

Replace lines 29-58 (`export async function createHandTracker(video) { ... }`) with:

```js
export async function createHandTracker(video, { numHands = 4, minRunMs = 0 } = {}) {
  const { mod, fileset } = await loadVision();
  const tracker = await mod.HandLandmarker.createFromOptions(fileset, {
    baseOptions: {
      modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
      delegate: 'GPU'
    },
    numHands,
    runningMode: 'VIDEO'
  });

  let latest = { hands: [] };
  let raf;
  let lastTs = 0;
  function loop() {
    const ts = performance.now();
    if (video.readyState >= 2 && ts - lastTs >= minRunMs) {
      lastTs = ts;
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
```

- [ ] **Step 3: Verify existing tests still pass**

Run: `npm test`
Expected: PASS (vision.js has no direct unit tests; nothing should break). The old dino/flappy still import the old signatures with no args — defaults preserve prior behaviour except `minRunMs` default changed 33→0. That's acceptable: those files are deleted in Task 11 and aren't exercised by tests.

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/shared/vision.js
git commit -m "refactor(vision): parameterise cam resolution, numHands, tick rate"
```

---

## Task 4: Latency bench gate (manual)

**Purpose:** Validate `numHands: 8` + 480×360 + every-RAF ticking is fast enough BEFORE building the full games. This is a gate, not shippable code.

**Files:**
- Create (temporary): `ps-offsite-2026/games/_bench-dino.html`

- [ ] **Step 1: Create the bench page**

Create `ps-offsite-2026/games/_bench-dino.html`:

```html
<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Dino bench</title>
<style>body{font-family:monospace;background:#0a0e1a;color:#0f0;padding:20px}#log{white-space:pre}</style>
</head><body>
<button id="go">Start camera + tracker</button>
<div id="log">idle</div>
<script type="module">
import { createCamStream, createHandTracker, isPalmOpen } from '../shared/vision.js';
const log = document.getElementById('log');
document.getElementById('go').onclick = async () => {
  log.textContent = 'loading…';
  const { video } = await createCamStream({ width: 480, height: 360 });
  const tracker = await createHandTracker(video, { numHands: 8, minRunMs: 0 });
  let frames = 0, last = performance.now(), inferSum = 0;
  function loop() {
    const t0 = performance.now();
    const hands = tracker.latest().hands;
    const t1 = performance.now();
    inferSum += (t1 - t0);
    frames++;
    if (t1 - last > 1000) {
      const fps = Math.round(frames * 1000 / (t1 - last));
      log.textContent =
        `fps: ${fps}\nhands seen: ${hands.length}\nopen palms: ${hands.filter(isPalmOpen).length}\nlatest()-read avg: ${(inferSum/frames).toFixed(2)}ms`;
      frames = 0; inferSum = 0; last = t1;
    }
    requestAnimationFrame(loop);
  }
  loop();
};
</script></body></html>
```

- [ ] **Step 2: Run the dev server and open the bench**

Run: `npm run dev`
Open: `http://localhost:5173/ps-offsite-2026/games/_bench-dino.html`
Click "Start camera + tracker". Allow camera.

- [ ] **Step 3: Record numbers**

With one hand visible, then 3-4 hands visible, note the `fps` and `hands seen` values.

Decision rule (per spec Latency Strategy):
- If sustained `fps` ≥ 40 with multiple hands → keep `numHands: 8`.
- If `fps` < 40 → change the dino page (Task 6) to `numHands: 4`, and note it in the commit.
- If `hands seen` never exceeds ~4 even with more hands present → that's a MediaPipe limit; the 4-frame max-buffer (built into Task 6) absorbs flicker; proceed.

- [ ] **Step 4: Delete the bench page**

```bash
rm ps-offsite-2026/games/_bench-dino.html
```

(No commit needed — temporary file, never committed. If accidentally committed, remove it.)

---

## Task 5: Dino page — chrome + markup

Build the page in two tasks: static shell here (Task 5), game logic next (Task 6). After Task 5 the page should load and show the setup card; the game won't run yet.

**Files:**
- Create: `ps-offsite-2026/games/3-dino.html`

- [ ] **Step 1: Create the page shell**

Create `ps-offsite-2026/games/3-dino.html`. Copy the entire `<style>...</style>` block from `ps-offsite-2026/games/1-gesture-lock.html` (lines 7-223) verbatim into the `<head>`, then append the dino-specific styles shown below inside the same `<style>` block (before `</style>`):

```css
  /* dino-specific */
  #dinoCanvas {
    width: 100%; max-width: 960px; aspect-ratio: 16 / 9;
    background: var(--bg); border-radius: 16px; display: block;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .cam-preview {
    width: 240px; height: 135px; object-fit: cover;
    transform: scaleX(-1); border-radius: 12px; background: #000;
  }
  .palm-dots { display: flex; gap: 6px; justify-content: center; margin-top: 10px; }
  .palm-dots .pip {
    width: 14px; height: 18px; border-radius: 4px;
    border: 1px solid rgba(0,212,255,0.3); background: rgba(0,212,255,0.06);
  }
  .palm-dots .pip.on { background: var(--accent); box-shadow: 0 0 8px var(--accent); }
  .jump-meter { height: 10px; background: rgba(255,255,255,0.08); border-radius: 6px; overflow: hidden; margin-top: 10px; }
  .jump-meter .fill { height: 100%; width: 0%; background: linear-gradient(90deg, var(--accent), var(--good)); transition: width 0.05s linear; }
  .toast {
    position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
    background: var(--card); color: var(--text); padding: 12px 20px;
    border-radius: 10px; border: 1px solid var(--bad); z-index: 50;
    font-size: 14px;
  }
```

Then the body (full markup):

```html
<body>
<header>
  <h1><span class="game-badge">DN</span>Dino Dash</h1>
</header>

<main>
  <div class="card briefing">
    <strong>Goal:</strong> The whole team jumps and ducks past obstacles. <strong>More open palms = higher jump.</strong> Make a fist to duck. Clear 16 obstacles. <strong>3 attempts</strong>, best score counts; finishing faster earns a bonus.
  </div>

  <!-- SETUP -->
  <div id="phase-setup" class="card">
    <h3 style="margin-bottom: 12px">Get ready</h3>
    <div class="setup"><button id="startBtn">Start camera</button></div>
    <div class="briefing" style="margin-top: 12px; font-size: 13px;">Allow camera access when prompted. Get the whole team in frame.</div>
  </div>

  <!-- LOADING -->
  <div id="phase-loading" class="card loading hidden">Loading AI model and camera…</div>

  <!-- INTRO -->
  <div id="phase-intro" class="card hidden">
    <h2 style="font-size: 28px; margin-bottom: 8px;">Attempt <span id="introNum">1</span> of 3</h2>
    <p class="briefing">Palms up to jump, fist to duck. Higher hands = higher jump.</p>
    <button id="introStartBtn" style="margin-top: 16px;">Start run</button>
  </div>

  <!-- PLAY -->
  <div id="phase-play" class="hidden">
    <div class="game">
      <canvas id="dinoCanvas"></canvas>
      <div class="panel">
        <div class="player-banner">
          <div class="label">Score</div>
          <div class="name"><span id="scoreLabel">0 / 16</span></div>
        </div>
        <div style="text-align:center"><video id="camPreview" class="cam-preview" playsinline autoplay muted></video></div>
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:4px;text-align:center">Open palms → jump strength</div>
          <div class="palm-dots" id="palmDots"></div>
          <div class="jump-meter"><div class="fill" id="jumpFill"></div></div>
        </div>
        <div class="stats">
          <div class="stat"><div class="value" id="timerLabel">0.0</div><div class="label">Time (s)</div></div>
          <div class="stat"><div class="value" id="attemptLabel">1 / 3</div><div class="label">Attempt</div></div>
        </div>
        <button class="secondary" id="playAbort">Abort attempt</button>
      </div>
    </div>
  </div>

  <!-- ATTEMPT-END -->
  <div id="phase-attempt-end" class="card hidden">
    <h2 id="attemptResultTitle" style="font-size: 28px; margin-bottom: 12px;">Attempt complete</h2>
    <p class="briefing">Cleared <strong id="attemptCompleted">0</strong> / 16 · time <strong id="attemptTime">0</strong> s · attempt score <strong id="attemptScoreVal">0</strong></p>
    <div class="result-row" style="margin-top: 20px;">
      <button id="attemptTryAgain">Try again</button>
      <button class="secondary" id="attemptFinish">Finish</button>
    </div>
  </div>

  <!-- FINAL -->
  <div id="phase-final" class="card result hidden">
    <h2 id="finalTitle">Run complete</h2>
    <p style="color:var(--muted)">Team <strong id="resTeam"></strong></p>
    <div class="score" id="resScore">0</div>
    <div id="saveStatus" class="save-status">SAVING…</div>
    <div class="result-row" style="margin-top: 14px;">
      <button id="finalPlayAgain">Play again</button>
      <a id="finalReturnLink" class="secondary-link" href="#">Return to catalog</a>
    </div>
  </div>
</main>

<script type="module" src="./3-dino.js"></script>
</body>
</html>
```

Note: the inline gesture-lock page keeps its script inline, but to keep this page readable we load `./3-dino.js` as a sibling module (added in Task 6). Add `<link rel="stylesheet" href="../shared/topbar.css">` in the `<head>` after the `<style>` block (matching gesture-lock line 224).

- [ ] **Step 2: Verify the shell loads**

Run: `npm run dev` (if not already running)
Open: `http://localhost:5173/ps-offsite-2026/games/3-dino.html`
Expected: Topbar + briefing + "Start camera" button render with gesture-lock styling. Console will show a 404 for `3-dino.js` (added next task) — that's fine for now.

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/games/3-dino.html
git commit -m "feat(dino): page shell with gesture-lock chrome"
```

---

## Task 6: Dino page — game module

**Files:**
- Create: `ps-offsite-2026/games/3-dino.js`

- [ ] **Step 1: Write the game module**

Create `ps-offsite-2026/games/3-dino.js`:

```js
import { createCamStream, createHandTracker, isPalmOpen, isFist } from '../shared/vision.js';
import { showDenialModal } from '../shared/perms.js';
import { mountTopbar } from '../shared/topbar.js';
import { resolveSession } from '../shared/lobby.js';
import { requireAdmin } from '../shared/admin-gate.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, update, push } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
import {
  MAX_OBSTACLES, ATTEMPT_CAP_S, PALM_COUNT_WINDOW,
  palmCountToJumpStrength, scoreAttempt, finalScore,
} from '../shared/dino-logic.js';

mountTopbar({ activePage: 'games' });
const session = resolveSession();
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const writer = firebaseWriter({ db, ref, update, push });
const catalogHref = session
  ? `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`
  : '../games.html';

const GAME_CODE = 'DN';
const MAX_ATTEMPTS = 3;
const CANVAS_W = 960, CANVAS_H = 540;
const GROUND_Y = Math.round(CANVAS_H * 0.78);
const RUNNER_X = 240, RUNNER_W = 30, RUNNER_H = 60;
const GRAVITY = 0.8;

const PHASES = ['setup', 'loading', 'intro', 'play', 'attempt-end', 'final'];
const phaseEnter = {};
let activeCleanup = null;

const state = {
  teamId: session?.teamId ?? 0,
  tracker: null, stream: null, video: null,
  attemptIdx: 0, attempts: [],
};

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();

function goto(phase) {
  if (activeCleanup) { try { activeCleanup(); } catch {} activeCleanup = null; }
  for (const p of PHASES) $(`phase-${p}`).classList.add('hidden');
  $(`phase-${phase}`).classList.remove('hidden');
  phaseEnter[phase]?.();
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// Pre-build 8 palm pips
const palmDotsEl = $('palmDots');
for (let i = 0; i < 8; i++) {
  const d = document.createElement('div');
  d.className = 'pip';
  palmDotsEl.appendChild(d);
}
function updatePalmHud(n) {
  const pips = palmDotsEl.children;
  for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < n);
  $('jumpFill').style.width = `${(palmCountToJumpStrength(n) / 20) * 100}%`;
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
      state.tracker = await createHandTracker(video, { numHands: 8, minRunMs: 0 });
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
  goto('intro');
};

// INTRO
phaseEnter.intro = () => {
  $('introNum').textContent = state.attemptIdx + 1;
  $('introStartBtn').onclick = () => goto('play');
};

// PLAY
phaseEnter.play = () => {
  const canvas = $('dinoCanvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');
  $('camPreview').srcObject = state.stream;

  $('scoreLabel').textContent = `0 / ${MAX_OBSTACLES}`;
  $('attemptLabel').textContent = `${state.attemptIdx + 1} / ${MAX_ATTEMPTS}`;
  $('timerLabel').textContent = '0.0';

  const g = {
    y: GROUND_Y - RUNNER_H, vy: 0, ducking: false,
    meters: 0, score: 0, obs: [], spawnTimer: 0, runPhase: 0,
    palmWindow: [], lastEff: 0, startMs: performance.now(),
  };

  let rafId = null, cancelled = false, prevTs = performance.now(), hiddenAt = 0;
  let fpsFrames = 0, fpsLast = performance.now(), slowTicks = 0;

  const track = state.stream.getVideoTracks()[0];
  const onEnded = () => endAttempt(true, '📷 Camera disconnected');
  track?.addEventListener('ended', onEnded);

  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) { g.startMs += performance.now() - hiddenAt; hiddenAt = 0; prevTs = performance.now(); }
  };
  document.addEventListener('visibilitychange', onVis);

  function readInput() {
    const hands = state.tracker.latest().hands;
    const palms = hands.filter(isPalmOpen).length;
    g.palmWindow.push(palms);
    if (g.palmWindow.length > PALM_COUNT_WINDOW) g.palmWindow.shift();
    const eff = Math.max(0, ...g.palmWindow);
    const fist = hands.some(isFist);
    updatePalmHud(eff);
    return { eff, fist };
  }

  function spawnObstacle() {
    const high = g.score >= 4 && Math.random() < 0.4;
    if (high) g.obs.push({ x: CANVAS_W, y: GROUND_Y - 75, w: 36, h: 45, type: 'high' });
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
    const timeSec = (performance.now() - g.startMs) / 1000;
    const score = scoreAttempt({ completed: g.score, timeSec });
    state.attempts.push({ score, completed: g.score, timeSec, died, msg });
    goto('attempt-end');
  }

  function step(dt) {
    const { eff, fist } = readInput();
    const onGround = g.y + RUNNER_H >= GROUND_Y - 0.5;
    if (onGround && eff > 0 && g.lastEff === 0) g.vy = -palmCountToJumpStrength(eff);
    g.lastEff = eff;
    g.ducking = fist && onGround;
    g.vy += GRAVITY * dt;
    g.y += g.vy * dt;
    if (g.y + RUNNER_H > GROUND_Y) { g.y = GROUND_Y - RUNNER_H; g.vy = 0; }

    const speed = Math.min(9, 4 + g.meters * 0.02);
    g.meters += speed * 0.06 * dt;
    g.runPhase += 0.3 * dt;

    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      spawnObstacle();
      g.spawnTimer = Math.max(60, 110 - g.meters * 0.3) + Math.random() * 30;
    }

    for (const o of g.obs) {
      o.x -= speed * dt;
      if (!o.passed && o.x + o.w < RUNNER_X) {
        o.passed = true;
        g.score = Math.min(MAX_OBSTACLES, g.score + 1);
        $('scoreLabel').textContent = `${g.score} / ${MAX_OBSTACLES}`;
        if (g.score >= MAX_OBSTACLES) { endAttempt(false); return; }
      }
    }
    g.obs = g.obs.filter(o => o.x + o.w > 0);

    const kh = g.ducking ? RUNNER_H * 0.55 : RUNNER_H;
    const box = { x: RUNNER_X, y: g.y + (RUNNER_H - kh), w: RUNNER_W, h: kh };
    for (const o of g.obs) { if (intersects(box, o)) { endAttempt(true); return; } }
  }

  function drawRunner() {
    const kh = g.ducking ? RUNNER_H * 0.55 : RUNNER_H;
    const top = g.y + (RUNNER_H - kh);
    ctx.fillStyle = css('--text');
    ctx.beginPath();
    ctx.roundRect(RUNNER_X, top, RUNNER_W, kh, 6);
    ctx.fill();
    // eye
    ctx.fillStyle = css('--accent');
    ctx.beginPath();
    ctx.arc(RUNNER_X + RUNNER_W - 8, top + 12, 3, 0, Math.PI * 2);
    ctx.fill();
    // legs (simple swing) when not ducking
    if (!g.ducking) {
      const swing = Math.sin(g.runPhase) * 6;
      ctx.strokeStyle = css('--text');
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(RUNNER_X + 8, top + kh);
      ctx.lineTo(RUNNER_X + 8 - swing, top + kh + 10);
      ctx.moveTo(RUNNER_X + RUNNER_W - 8, top + kh);
      ctx.lineTo(RUNNER_X + RUNNER_W - 8 + swing, top + kh + 10);
      ctx.stroke();
    }
  }

  function draw() {
    ctx.fillStyle = css('--bg');
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
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

    const elapsed = (now - g.startMs) / 1000;
    $('timerLabel').textContent = elapsed.toFixed(1);
    if (elapsed > ATTEMPT_CAP_S) { endAttempt(false); return; }

    step(dt);
    if (cancelled) return;
    draw();
    rafId = requestAnimationFrame(loop);
  }

  $('playAbort').onclick = () => endAttempt(true, 'Aborted');
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
  $('attemptResultTitle').textContent =
    last.msg ? last.msg
    : last.completed >= MAX_OBSTACLES ? '🏁 Course cleared!'
    : '💥 Crashed';
  $('attemptCompleted').textContent = last.completed;
  $('attemptTime').textContent = last.timeSec.toFixed(1);
  $('attemptScoreVal').textContent = last.score;

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
  $('finalTitle').textContent = score >= 100 ? '🏆 Perfect run!' : '🏁 Run complete';
  $('resTeam').textContent = state.teamId;
  $('resScore').textContent = score;

  const status = $('saveStatus');
  $('finalReturnLink').href = catalogHref;
  status.className = 'save-status';
  status.textContent = 'SAVING…';
  const trySubmit = () => submitScore({
    writer, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
  });
  trySubmit().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });

  $('finalPlayAgain').onclick = async () => {
    if (!await requireAdmin(session?.lobbyId, { promptText: 'Admin password required to replay:' })) return;
    state.attempts = [];
    state.attemptIdx = 0;
    goto('setup');
  };
};

// Bootstrap
goto('setup');
```

- [ ] **Step 2: Run the dev server and play the game**

Run: `npm run dev` (if not running)
Open: `http://localhost:5173/ps-offsite-2026/games/3-dino.html?lobby=PS-XXXX&team=1` (use a real lobby/team if testing submit; without them the page still runs but submit will no-op/throw — that's fine for mechanics testing).

Verify (golden path):
- "Start camera" → permission prompt → intro card "Attempt 1 of 3".
- "Start run" → canvas shows runner + ground, obstacles scroll in.
- Raising open palms makes the runner jump; more palms = higher jump (watch the jump meter fill).
- A fist makes the runner duck (squashes).
- Clearing 16 obstacles OR crashing → attempt-end card with correct numbers.
- "Try again" up to 3 attempts, then only "Finish".
- "Finish" → final card, score = best attempt, SAVED ✓ (if lobby valid).
- "Play again" prompts for admin password.

Verify (edge cases):
- Switch browser tabs mid-run → timer pauses, resumes on return (no giant dt jump).
- Stop the camera (OS-level) mid-run → attempt ends with "Camera disconnected".

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js
git commit -m "feat(dino): card-bound best-of-3 game with team palm-count input"
```

---

## Task 7: Flappy page — chrome + markup

**Files:**
- Create: `ps-offsite-2026/games/4-flappy.html`

- [ ] **Step 1: Create the page shell**

Create `ps-offsite-2026/games/4-flappy.html`. Copy the `<style>` block from `ps-offsite-2026/games/1-gesture-lock.html` (lines 7-223) verbatim, then append these flappy-specific styles before `</style>`:

```css
  /* flappy-specific */
  #flappyCanvas {
    width: 100%; max-width: 960px; aspect-ratio: 16 / 9;
    background: var(--bg); border-radius: 16px; display: block;
    border: 1px solid rgba(255,255,255,0.06);
  }
  .voice-meter {
    width: 28px; height: 220px; margin: 0 auto; position: relative;
    background: rgba(255,255,255,0.05); border: 1px solid rgba(0,212,255,0.4);
    border-radius: 14px; overflow: hidden;
  }
  .voice-meter .fill {
    position: absolute; bottom: 0; left: 0; right: 0; height: 0%;
    background: linear-gradient(0deg, var(--accent), var(--good)); transition: height 0.04s linear;
  }
  .voice-meter .floor-line {
    position: absolute; left: -4px; right: -4px; height: 1px; background: var(--muted);
  }
  .toast {
    position: fixed; left: 50%; bottom: 32px; transform: translateX(-50%);
    background: var(--card); color: var(--text); padding: 12px 20px;
    border-radius: 10px; border: 1px solid var(--bad); z-index: 50; font-size: 14px;
  }
  .calib-overlay {
    position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(10,14,26,0.85); border-radius: 16px; font-size: 22px; font-weight: 800;
    color: var(--accent); text-align: center;
  }
  .canvas-wrap { position: relative; }
```

Body markup:

```html
<body>
<header>
  <h1><span class="game-badge">FL</span>Flappy Voice</h1>
</header>

<main>
  <div class="card briefing">
    <strong>Goal:</strong> The whole team yells to keep the orb flying through gaps. <strong>Louder = higher.</strong> Pass 20 gates. <strong>3 attempts</strong>, best score counts; faster clears earn a bonus.
  </div>

  <div id="phase-setup" class="card">
    <h3 style="margin-bottom: 12px">Get ready</h3>
    <div class="setup"><button id="startBtn">Start microphone</button></div>
    <div class="briefing" style="margin-top: 12px; font-size: 13px;">Allow microphone access when prompted.</div>
  </div>

  <div id="phase-loading" class="card loading hidden">Starting microphone…</div>

  <div id="phase-intro" class="card hidden">
    <h2 style="font-size: 28px; margin-bottom: 8px;">Attempt <span id="introNum">1</span> of 3</h2>
    <p class="briefing">When the run starts, the team yells to fly. We measure the room's quiet level first — stay quiet for a moment.</p>
    <button id="introStartBtn" style="margin-top: 16px;">Start run</button>
  </div>

  <div id="phase-play" class="hidden">
    <div class="game">
      <div class="canvas-wrap">
        <canvas id="flappyCanvas"></canvas>
        <div id="calibOverlay" class="calib-overlay hidden">Calibrating… stay quiet</div>
      </div>
      <div class="panel">
        <div class="player-banner">
          <div class="label">Score</div>
          <div class="name"><span id="scoreLabel">0 / 20</span></div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;text-align:center">Team volume</div>
          <div class="voice-meter"><div class="fill" id="voiceFill"></div><div class="floor-line" id="floorLine" style="bottom:0%"></div></div>
        </div>
        <div class="stats">
          <div class="stat"><div class="value" id="timerLabel">0.0</div><div class="label">Time (s)</div></div>
          <div class="stat"><div class="value" id="attemptLabel">1 / 3</div><div class="label">Attempt</div></div>
        </div>
        <button class="secondary" id="playAbort">Abort attempt</button>
      </div>
    </div>
  </div>

  <div id="phase-attempt-end" class="card hidden">
    <h2 id="attemptResultTitle" style="font-size: 28px; margin-bottom: 12px;">Attempt complete</h2>
    <p class="briefing">Cleared <strong id="attemptCompleted">0</strong> / 20 · time <strong id="attemptTime">0</strong> s · attempt score <strong id="attemptScoreVal">0</strong></p>
    <div class="result-row" style="margin-top: 20px;">
      <button id="attemptTryAgain">Try again</button>
      <button class="secondary" id="attemptFinish">Finish</button>
    </div>
  </div>

  <div id="phase-final" class="card result hidden">
    <h2 id="finalTitle">Run complete</h2>
    <p style="color:var(--muted)">Team <strong id="resTeam"></strong></p>
    <div class="score" id="resScore">0</div>
    <div id="saveStatus" class="save-status">SAVING…</div>
    <div class="result-row" style="margin-top: 14px;">
      <button id="finalPlayAgain">Play again</button>
      <a id="finalReturnLink" class="secondary-link" href="#">Return to catalog</a>
    </div>
  </div>
</main>

<script type="module" src="./4-flappy.js"></script>
</body>
</html>
```

Add `<link rel="stylesheet" href="../shared/topbar.css">` in the `<head>` after the `<style>` block.

- [ ] **Step 2: Verify the shell loads**

Open: `http://localhost:5173/ps-offsite-2026/games/4-flappy.html`
Expected: Topbar + briefing + "Start microphone" render with gesture-lock styling. 404 for `4-flappy.js` is expected until Task 8.

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/games/4-flappy.html
git commit -m "feat(flappy): page shell with gesture-lock chrome"
```

---

## Task 8: Flappy page — game module

**Files:**
- Create: `ps-offsite-2026/games/4-flappy.js`

- [ ] **Step 1: Write the game module**

Create `ps-offsite-2026/games/4-flappy.js`:

```js
import { createAudioInput } from '../shared/audio.js';
import { showDenialModal } from '../shared/perms.js';
import { mountTopbar } from '../shared/topbar.js';
import { resolveSession } from '../shared/lobby.js';
import { requireAdmin } from '../shared/admin-gate.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, update, push } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
import {
  MAX_PIPES, ATTEMPT_CAP_S, GAIN, GRAVITY,
  ampToThrust, scoreAttempt, finalScore,
} from '../shared/flappy-logic.js';

mountTopbar({ activePage: 'games' });
const session = resolveSession();
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const writer = firebaseWriter({ db, ref, update, push });
const catalogHref = session
  ? `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`
  : '../games.html';

const GAME_CODE = 'FL';
const MAX_ATTEMPTS = 3;
const CANVAS_W = 960, CANVAS_H = 540;
const PIPE_W = 80, GAP_H = 240, ORB_R = 18, ORB_X = 220;
const METER_MAX = 0.30;
const CALIB_MS = 1500;

const PHASES = ['setup', 'loading', 'intro', 'play', 'attempt-end', 'final'];
const phaseEnter = {};
let activeCleanup = null;

const state = {
  teamId: session?.teamId ?? 0,
  audio: null,
  attemptIdx: 0, attempts: [],
};

const $ = (id) => document.getElementById(id);
const css = (v) => getComputedStyle(document.body).getPropertyValue(v).trim();

function goto(phase) {
  if (activeCleanup) { try { activeCleanup(); } catch {} activeCleanup = null; }
  for (const p of PHASES) $(`phase-${p}`).classList.add('hidden');
  $(`phase-${phase}`).classList.remove('hidden');
  phaseEnter[phase]?.();
}

function showToast(msg) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
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
    if (!state.audio) state.audio = await createAudioInput({ smoothing: 0.7 });
  } catch (e) {
    if (e && (e.name === 'NotAllowedError' || e.name === 'NotFoundError' || e.name === 'NotReadableError')) {
      showDenialModal('microphone');
    } else {
      alert('Failed to start microphone: ' + (e.message || e));
    }
    goto('setup');
    return;
  }
  goto('intro');
};

// INTRO
phaseEnter.intro = () => {
  $('introNum').textContent = state.attemptIdx + 1;
  $('introStartBtn').onclick = () => goto('play');
};

// PLAY
phaseEnter.play = () => {
  const canvas = $('flappyCanvas');
  canvas.width = CANVAS_W;
  canvas.height = CANVAS_H;
  const ctx = canvas.getContext('2d');

  $('scoreLabel').textContent = `0 / ${MAX_PIPES}`;
  $('attemptLabel').textContent = `${state.attemptIdx + 1} / ${MAX_ATTEMPTS}`;
  $('timerLabel').textContent = '0.0';

  const g = {
    y: CANVAS_H / 2, vy: 0, score: 0,
    pipes: [], spawnTimer: 0, worldX: 0,
    floor: 0, calibrating: true, calibStart: performance.now(), calibSamples: [],
    startMs: 0,
  };

  let rafId = null, cancelled = false, prevTs = performance.now(), hiddenAt = 0;
  let fpsFrames = 0, fpsLast = performance.now(), slowTicks = 0;

  const calibOverlay = $('calibOverlay');
  calibOverlay.classList.remove('hidden');

  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if (g.startMs) g.startMs += delta;
      prevTs = performance.now();
      hiddenAt = 0;
    }
  };
  document.addEventListener('visibilitychange', onVis);

  function endAttempt(died, msg) {
    if (cancelled) return;
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', onVis);
    const timeSec = g.startMs ? (performance.now() - g.startMs) / 1000 : 0;
    const score = scoreAttempt({ completed: g.score, timeSec });
    state.attempts.push({ score, completed: g.score, timeSec, died, msg });
    goto('attempt-end');
  }

  function spawnPipe() {
    const minY = 80;
    const maxY = CANVAS_H - 80 - GAP_H;
    const topH = minY + Math.random() * (maxY - minY);
    g.pipes.push({ x: CANVAS_W + PIPE_W, topH, passed: false });
  }

  function updateMeter(amp) {
    const pct = Math.max(0, Math.min(100, (amp / METER_MAX) * 100));
    $('voiceFill').style.height = `${pct}%`;
    $('floorLine').style.bottom = `${Math.min(100, (g.floor / METER_MAX) * 100)}%`;
  }

  function step(dt) {
    const amp = state.audio.amplitude();
    updateMeter(amp);
    const thrust = ampToThrust(amp, g.floor);
    g.vy += GRAVITY * dt;
    g.vy -= thrust * dt;
    g.vy = Math.max(-10, Math.min(10, g.vy));
    g.y += g.vy * dt;
    if (g.y < ORB_R || g.y > CANVAS_H - ORB_R) { endAttempt(true); return; }

    const speed = Math.min(6, 3 + g.score * 0.12);
    g.worldX += speed * dt;
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) { spawnPipe(); g.spawnTimer = Math.max(100, 160 - g.score * 2); }

    for (const p of g.pipes) {
      p.x -= speed * dt;
      if (!p.passed && p.x + PIPE_W < ORB_X) {
        p.passed = true;
        g.score = Math.min(MAX_PIPES, g.score + 1);
        $('scoreLabel').textContent = `${g.score} / ${MAX_PIPES}`;
        if (g.score >= MAX_PIPES) { endAttempt(false); return; }
      }
      const inX = ORB_X + ORB_R > p.x && ORB_X - ORB_R < p.x + PIPE_W;
      if (inX) {
        const inGap = g.y - ORB_R > p.topH && g.y + ORB_R < p.topH + GAP_H;
        if (!inGap) { endAttempt(true); return; }
      }
    }
    g.pipes = g.pipes.filter(p => p.x + PIPE_W > 0);
    g._thrusting = thrust > 0;
  }

  function draw() {
    ctx.fillStyle = css('--bg');
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    for (const p of g.pipes) {
      ctx.fillStyle = css('--card');
      ctx.strokeStyle = css('--accent');
      ctx.lineWidth = 2;
      ctx.fillRect(p.x, 0, PIPE_W, p.topH);
      ctx.strokeRect(p.x, 0, PIPE_W, p.topH);
      const by = p.topH + GAP_H;
      ctx.fillRect(p.x, by, PIPE_W, CANVAS_H - by);
      ctx.strokeRect(p.x, by, PIPE_W, CANVAS_H - by);
    }
    const r = g._thrusting ? ORB_R * 1.1 : ORB_R;
    ctx.fillStyle = css('--accent');
    ctx.beginPath();
    ctx.arc(ORB_X, g.y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function loop() {
    if (cancelled) return;
    const now = performance.now();
    const dt = Math.min(2.5, (now - prevTs) / 16.6667);
    prevTs = now;

    // calibration window
    if (g.calibrating) {
      g.calibSamples.push(state.audio.amplitude());
      if (now - g.calibStart >= CALIB_MS) {
        g.calibSamples.sort((a, b) => a - b);
        g.floor = g.calibSamples[Math.floor(g.calibSamples.length / 2)] || 0;
        g.calibrating = false;
        g.startMs = now;
        prevTs = now;
        calibOverlay.classList.add('hidden');
      }
      draw();
      rafId = requestAnimationFrame(loop);
      return;
    }

    fpsFrames++;
    if (now - fpsLast > 1000) {
      const fps = (fpsFrames * 1000) / (now - fpsLast);
      fpsFrames = 0; fpsLast = now;
      if (fps < 40) { slowTicks++; if (slowTicks >= 3) { showToast('Low frame rate — moves may feel slow'); slowTicks = 0; } }
      else slowTicks = 0;
    }

    const elapsed = (now - g.startMs) / 1000;
    $('timerLabel').textContent = elapsed.toFixed(1);
    if (elapsed > ATTEMPT_CAP_S) { endAttempt(false); return; }

    step(dt);
    if (cancelled) return;
    draw();
    rafId = requestAnimationFrame(loop);
  }

  $('playAbort').onclick = () => endAttempt(true, 'Aborted');
  rafId = requestAnimationFrame(loop);

  activeCleanup = () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    document.removeEventListener('visibilitychange', onVis);
    calibOverlay.classList.add('hidden');
  };
};

// ATTEMPT-END
phaseEnter['attempt-end'] = () => {
  const last = state.attempts[state.attempts.length - 1];
  $('attemptResultTitle').textContent =
    last.msg ? last.msg
    : last.completed >= MAX_PIPES ? '🏁 All gates cleared!'
    : '💥 Crashed';
  $('attemptCompleted').textContent = last.completed;
  $('attemptTime').textContent = last.timeSec.toFixed(1);
  $('attemptScoreVal').textContent = last.score;

  const attemptsLeft = MAX_ATTEMPTS - state.attempts.length;
  const tryAgain = $('attemptTryAgain');
  tryAgain.classList.toggle('hidden', attemptsLeft <= 0);
  tryAgain.onclick = () => { state.attemptIdx++; goto('intro'); };
  $('attemptFinish').onclick = () => goto('final');
};

// FINAL
phaseEnter.final = () => {
  if (state.audio) { try { state.audio.stop(); } catch {} state.audio = null; }

  const score = finalScore(state.attempts);
  $('finalTitle').textContent = score >= 100 ? '🏆 Perfect run!' : '🏁 Run complete';
  $('resTeam').textContent = state.teamId;
  $('resScore').textContent = score;

  const status = $('saveStatus');
  $('finalReturnLink').href = catalogHref;
  status.className = 'save-status';
  status.textContent = 'SAVING…';
  const trySubmit = () => submitScore({
    writer, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
  });
  trySubmit().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });

  $('finalPlayAgain').onclick = async () => {
    if (!await requireAdmin(session?.lobbyId, { promptText: 'Admin password required to replay:' })) return;
    state.attempts = [];
    state.attemptIdx = 0;
    goto('setup');
  };
};

// Bootstrap
goto('setup');
```

Note: mic floor is re-measured at the start of every `play` phase (the calibration window inside `loop`), satisfying the per-attempt-recalibration requirement. The audio input itself (`state.audio`) is opened once in `loading` and reused.

Note on mic disconnect: unlike dino's camera, `createAudioInput` does not expose the mic track, so there is no explicit `ended` handler. This is intentional (we don't modify audio.js). If the mic is lost mid-run, `amplitude()` returns 0 → the orb sinks → it hits the floor → the normal crash path ends the attempt. No hang. This matches the spec's documented behaviour.

- [ ] **Step 2: Run the dev server and play**

Open: `http://localhost:5173/ps-offsite-2026/games/4-flappy.html?lobby=PS-XXXX&team=1`

Verify (golden path):
- "Start microphone" → permission → intro → "Start run" → "Calibrating… stay quiet" overlay (~1.5s) → orb falls, pipes scroll.
- Yelling lifts the orb; louder = higher; silence = sink. Passing gaps increments score.
- 20 gates OR crash → attempt-end with correct numbers.
- 3 attempts, then Finish → final card, best-attempt score, SAVED ✓.
- Play again → admin password.

Verify (edge cases):
- Tab switch mid-run → timer pauses/resumes.
- Each new attempt re-shows the calibration overlay (fresh floor).

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/games/4-flappy.js
git commit -m "feat(flappy): card-bound best-of-3 game with team-voice input"
```

---

## Task 9: Repoint the games catalog

**Files:**
- Modify: `ps-offsite-2026/shared/games-catalog.js:5-6`
- Check: `tests/games-catalog.test.js`

- [ ] **Step 1: Check whether the catalog test asserts hrefs**

Run: `grep -n "dino/index\|flappy/index\|href" tests/games-catalog.test.js`
If it asserts the old hrefs, note the line numbers — update them in Step 3.

- [ ] **Step 2: Update the hrefs**

In `ps-offsite-2026/shared/games-catalog.js`, change lines 5-6:

```js
  DN: { name: 'Dino Dash',     emoji: '🦖', kind: 'play',   href: 'games/3-dino.html' },
  FL: { name: 'Flappy Voice',  emoji: '📢', kind: 'play',   href: 'games/4-flappy.html' },
```

(Names + emojis updated to drop the cyberpunk theme. If you prefer keeping the old names, only change the `href` fields — the names are not load-bearing.)

- [ ] **Step 3: Update the test if needed**

If Step 1 found href assertions, update them to the new paths. If the test only checks `kind`/`name`/keys, update any renamed `name` expectations.

- [ ] **Step 4: Run tests**

Run: `npm test -- games-catalog`
Expected: PASS.

- [ ] **Step 5: Verify the catalog links in-browser**

Open: `http://localhost:5173/ps-offsite-2026/games.html?lobby=PS-XXXX&team=1`
Click the Dino and Flappy tiles → they should open `games/3-dino.html` / `games/4-flappy.html`.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/shared/games-catalog.js tests/games-catalog.test.js
git commit -m "feat(catalog): point dino + flappy to new game pages"
```

---

## Task 10: Update manual.html references

**Files:**
- Check/modify: `ps-offsite-2026/games/manual.html`

- [ ] **Step 1: Search for old path references**

Run: `grep -n "dino/index\|flappy/index\|dino/\|flappy/\|Pipeline Dash\|Insight Monitor" ps-offsite-2026/games/manual.html`

- [ ] **Step 2: Repoint any matches**

If `manual.html` links to `../dino/index.html` or `../flappy/index.html`, change them to `./3-dino.html` / `./4-flappy.html`. If it references the old game names in copy, update to "Dino Dash" / "Flappy Voice" (match the catalog). If there are no matches, skip — note "no references" and move on.

- [ ] **Step 3: Verify**

Open `http://localhost:5173/ps-offsite-2026/games/manual.html` and confirm any dino/flappy links resolve.

- [ ] **Step 4: Commit (only if changed)**

```bash
git add ps-offsite-2026/games/manual.html
git commit -m "fix(manual): repoint dino + flappy references"
```

---

## Task 11: Delete dead code

Do this LAST, only after Tasks 5-10 verified working. Deleting earlier would break the running app.

**Files:**
- Delete: `ps-offsite-2026/dino/`, `ps-offsite-2026/flappy/`
- Delete: `ps-offsite-2026/shared/neon-fx.js`, `shared/neon.css`, `shared/stages.js`, `shared/score-panel.js`
- Delete: `tests/stages.test.js`, `tests/score-panel.test.js`

- [ ] **Step 1: Re-grep to confirm nothing else imports the dead modules**

Run:
```bash
grep -rln "neon-fx\|stages\.js\|score-panel\|neon\.css\|dino/\|flappy/" \
  ps-offsite-2026 tests | grep -v "ps-offsite-2026/dino/\|ps-offsite-2026/flappy/"
```
Expected: only `tests/stages.test.js` and `tests/score-panel.test.js` (which we delete). If anything else appears (e.g. `index.html`, `scoreboard.html`), STOP and repoint/handle that reference before deleting.

- [ ] **Step 2: Delete the directories and dead modules**

```bash
git rm -r ps-offsite-2026/dino ps-offsite-2026/flappy
git rm ps-offsite-2026/shared/neon-fx.js ps-offsite-2026/shared/neon.css \
       ps-offsite-2026/shared/stages.js ps-offsite-2026/shared/score-panel.js \
       tests/stages.test.js tests/score-panel.test.js
```

- [ ] **Step 3: Run the full test suite**

Run: `npm test`
Expected: PASS, no unresolved imports. (`stages` / `score-panel` test files are gone; the rest stay green.)

- [ ] **Step 4: Smoke-test the app**

Open `http://localhost:5173/ps-offsite-2026/index.html`, navigate to the catalog, open both new games, confirm they still load. Open `scoreboard.html` and confirm it renders (it was touched on this branch and must not depend on `score-panel.js`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: remove old dino/flappy + dead cyberpunk shared modules"
```

---

## Task 12: Tick BUILD_PLAN

**Files:**
- Modify: `BUILD_PLAN.md` (around line 17)

- [ ] **Step 1: Tick the Dino+Flappy items**

In `BUILD_PLAN.md`, change the "Dino a Flappy" block from `[]` to `[x]` for the parent and all three sub-bullets:

```
    - [x] Dino a Flappy
        - [x] překopat grafiku pryč s tou cyberpunk arcade verzí
        - [x] introduce retries apod.
        - [x] make it more stable and playable
```

- [ ] **Step 2: Commit**

```bash
git add BUILD_PLAN.md
git commit -m "chore(build-plan): tick dino + flappy redesign"
```

---

## Self-Review Notes (for the executor)

- **Logic is the only unit-tested layer.** The HTML/canvas game loop is verified in-browser (Tasks 6, 8) — there is no DOM test harness in this repo. Treat the "play the game" steps as required verification, not optional.
- **The bench (Task 4) is a real gate.** If FPS is bad with `numHands: 8`, drop to 4 in Task 6's `createHandTracker(video, { numHands: 4, minRunMs: 0 })` call and note it.
- **Do Task 11 last.** The app keeps importing the old modules until the new pages are live and the catalog is repointed.
- **Firebase submit requires a real lobby.** For mechanics-only testing, the game runs fine without a valid `?lobby=`; only the final SAVE step needs it.
