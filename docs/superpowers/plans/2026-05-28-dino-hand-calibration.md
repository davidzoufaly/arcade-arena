# Dino Hand-Count Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed-cap hand detection in the dino game with a one-shot calibration phase that detects team size on attempt 1 and tunes the jump curve, MediaPipe tracker, and HUD pip row to match.

**Architecture:** Add a `'calibrate'` sub-phase before the existing warmup (attempt 1 only); sample `hands.length` over 3 seconds; mode-lock into `state.teamN`; recreate tracker at `min(20, N+2)`; rebuild HUD pips; reuse `state.teamN` for attempts 2 and 3. Drops the `g.warming` boolean in favor of a single `g.subPhase` state machine ('calibrate' | 'warmup' | 'live').

**Tech Stack:** Vanilla JS ES modules, MediaPipe Tasks Vision (HandLandmarker), Vitest for unit tests.

**Spec:** [docs/superpowers/specs/2026-05-28-dino-hand-calibration-design.md](../specs/2026-05-28-dino-hand-calibration-design.md)

---

## File map

- `ps-offsite-2026/shared/dino-logic.js` — replace `MAX_HANDS` constant with `TRACKER_CEILING / TRACKER_BUFFER / CALIB_TOTAL_S / CALIB_GRACE_S / FALLBACK_N / MIN_N`; change `palmCountToJumpStrength` signature to `(n, teamN)`; add `pickCalibratedHandCount(samples)`.
- `ps-offsite-2026/games/3-dino.js` — drop `g.warming`; introduce `g.subPhase` state machine; extract `tickCalibrate / tickWarmup / tickLive`; implement calibrate sampling + lock-in (open-new-before-close-old, re-entrancy + cancellation guards); adapt jump call sites; tear down tracker in `wireRestart`; add `?debug&team=N` skip path.
- `tests/dino-logic.test.js` — update `palmCountToJumpStrength` tests for new signature + curve; add `pickCalibratedHandCount` block; remove `MAX_HANDS` test.

No HTML changes. No CSS changes.

---

## Task 1: Replace constants in `dino-logic.js`

**Files:**
- Modify: `ps-offsite-2026/shared/dino-logic.js`
- Test: `tests/dino-logic.test.js`

- [ ] **Step 1: Update the constants test block**

Open `tests/dino-logic.test.js`. Find the `describe('constants', …)` block (around lines 17–20 — it currently asserts `MAX_HANDS === 14`). Replace the whole `describe('constants', …)` block with:

```js
describe('constants', () => {
  it('PALM_COUNT_WINDOW is 4', () => expect(PALM_COUNT_WINDOW).toBe(4));
  it('TRACKER_CEILING is 20', () => expect(TRACKER_CEILING).toBe(20));
  it('TRACKER_BUFFER is 2', () => expect(TRACKER_BUFFER).toBe(2));
  it('CALIB_TOTAL_S is 5', () => expect(CALIB_TOTAL_S).toBe(5));
  it('CALIB_GRACE_S is 2', () => expect(CALIB_GRACE_S).toBe(2));
  it('FALLBACK_N is 4', () => expect(FALLBACK_N).toBe(4));
  it('MIN_N is 1', () => expect(MIN_N).toBe(1));
  it('RAMP_S is 60', () => expect(RAMP_S).toBe(60));
});
```

In the imports at the top of `tests/dino-logic.test.js`, replace `MAX_HANDS` with the new constants. The import list becomes:

```js
import {
  PALM_COUNT_WINDOW,
  TRACKER_CEILING,
  TRACKER_BUFFER,
  CALIB_TOTAL_S,
  CALIB_GRACE_S,
  FALLBACK_N,
  MIN_N,
  RAMP_S,
  SPEED_MIN, SPEED_MAX,
  SPAWN_FRAMES_MAX, SPAWN_FRAMES_MIN,
  HIGH_PROB_MAX,
  palmCountToJumpStrength,
  pickCalibratedHandCount,
  difficultyProgress,
  runSpeed,
  spawnIntervalFrames,
  highObstacleProb,
  scoreAttempt,
  finalScore,
} from '../ps-offsite-2026/shared/dino-logic.js';
```

- [ ] **Step 2: Run the test to verify the constant block fails**

Run: `npx vitest run tests/dino-logic.test.js`
Expected: fails — `TRACKER_CEILING is undefined` and the import fails because `pickCalibratedHandCount` doesn't exist yet. (Subsequent tasks add it; for now we expect the failure.)

- [ ] **Step 3: Replace constants in `dino-logic.js`**

Open `ps-offsite-2026/shared/dino-logic.js`. Replace the existing `MAX_HANDS` definition (currently around lines 3–5) with the new constants. The top of the file should be:

```js
export const PALM_COUNT_WINDOW = 4;

// Hand-count calibration tuning. See
// docs/superpowers/specs/2026-05-28-dino-hand-calibration-design.md
export const TRACKER_CEILING  = 20;  // hard upper bound; MediaPipe-safe max
export const TRACKER_BUFFER   = 2;   // extra slots over detected N (stragglers)
export const CALIB_TOTAL_S    = 5;   // total calibration phase duration
export const CALIB_GRACE_S    = 2;   // skip the first N seconds (team raising hands)
export const FALLBACK_N       = 4;   // if calibration sees no hands at all
export const MIN_N            = 1;   // lower bound on team size

// Endless difficulty: knobs ramp linearly over the first RAMP_S seconds of live
// play, then plateau at peak — hard but steady, so the score keeps climbing as
// long as the team survives. All four numbers are safe to tune.
export const RAMP_S = 60;
export const SPEED_MIN = 4, SPEED_MAX = 12;            // scroll speed (px/frame)
export const SPAWN_FRAMES_MAX = 110, SPAWN_FRAMES_MIN = 48; // gap between spawns
export const HIGH_PROB_MAX = 0.45;                     // chance an obstacle is "high"
```

Then delete any existing `export const MAX_HANDS = …` line if it still appears.

- [ ] **Step 4: Run the constants test alone to verify it passes**

Run: `npx vitest run tests/dino-logic.test.js -t constants`
Expected: 8 tests pass for the constants block. The other tests (palmCountToJumpStrength, pickCalibratedHandCount) will still fail because they call functions that haven't been updated yet — that's expected, we fix them in the next task.

- [ ] **Step 5: Do not commit yet**

The other test cases in the file are still red (deliberately). Commit happens at the end of Task 2 when the file is internally consistent.

---

## Task 2: Update `palmCountToJumpStrength` signature and add `pickCalibratedHandCount`

**Files:**
- Modify: `ps-offsite-2026/shared/dino-logic.js`
- Test: `tests/dino-logic.test.js`

- [ ] **Step 1: Update the `palmCountToJumpStrength` test block**

In `tests/dino-logic.test.js`, find the existing `describe('palmCountToJumpStrength', …)` block. Replace its entire body with:

```js
describe('palmCountToJumpStrength', () => {
  it('0 palms → 0',            () => expect(palmCountToJumpStrength(0, 4)).toBe(0));
  it('negative palms → 0',     () => expect(palmCountToJumpStrength(-3, 4)).toBe(0));
  it('teamN=2, 1 palm → 13',   () => expect(palmCountToJumpStrength(1, 2)).toBe(13));
  it('teamN=2, 2 palms → 20',  () => expect(palmCountToJumpStrength(2, 2)).toBe(20));
  it('teamN=7, 4 palms → 14',  () => expect(palmCountToJumpStrength(4, 7)).toBe(14));
  it('teamN=7, 7 palms → 20',  () => expect(palmCountToJumpStrength(7, 7)).toBe(20));
  it('teamN=14, 14 palms → 20',           () => expect(palmCountToJumpStrength(14, 14)).toBe(20));
  it('teamN=14, 20 palms → 20 (clamped)', () => expect(palmCountToJumpStrength(20, 14)).toBe(20));
  it('teamN nullish → uses FALLBACK_N (4)', () => expect(palmCountToJumpStrength(4, null)).toBe(palmCountToJumpStrength(4, 4)));
  it('teamN undefined → uses FALLBACK_N',   () => expect(palmCountToJumpStrength(4, undefined)).toBe(palmCountToJumpStrength(4, 4)));
  // teamN=0 means "no team detected, but value was supplied" — clamped up to
  // MIN_N (1). One palm against teamN=0 = peak jump 20.
  it('teamN=0 → clamped to MIN_N',          () => expect(palmCountToJumpStrength(1, 0)).toBe(20));
  it('teamN=0, 2 palms → still clamped to 20', () => expect(palmCountToJumpStrength(2, 0)).toBe(20));
});
```

- [ ] **Step 2: Add the `pickCalibratedHandCount` test block**

Below the `palmCountToJumpStrength` block, add a new `describe` block:

```js
describe('pickCalibratedHandCount', () => {
  it('empty → FALLBACK_N',              () => expect(pickCalibratedHandCount([])).toBe(4));
  it('all zeros → FALLBACK_N',          () => expect(pickCalibratedHandCount([0,0,0])).toBe(4));
  it('clear mode',                       () => expect(pickCalibratedHandCount([4,4,4,5,4])).toBe(4));
  it('tie resolves to higher',           () => expect(pickCalibratedHandCount([6,6,7,7])).toBe(7));
  it('clamps above ceiling',             () => expect(pickCalibratedHandCount([25,25,25])).toBe(20));
  it('zero-dominant → FALLBACK_N',       () => expect(pickCalibratedHandCount([0,0,1])).toBe(4));
  it('ignores transient spike (noise)',  () => expect(pickCalibratedHandCount([10,10,10,10,15,10])).toBe(10));
  it('ignores drop-out (noise)',          () => expect(pickCalibratedHandCount([8,8,7,8,8,7,8,8,8,7])).toBe(8));
  it('uniform low signal',                () => expect(pickCalibratedHandCount([1,1,1])).toBe(1));
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/dino-logic.test.js -t palmCountToJumpStrength`
Run: `npx vitest run tests/dino-logic.test.js -t pickCalibratedHandCount`
Expected: both fail. `palmCountToJumpStrength` fails because the function ignores its second argument; `pickCalibratedHandCount` fails because it doesn't exist.

- [ ] **Step 4: Update `palmCountToJumpStrength` in `dino-logic.js`**

In `ps-offsite-2026/shared/dino-logic.js`, find the existing `palmCountToJumpStrength` (currently around lines 11–15 — single-argument signature, formula `min(20, 6 + n)` or `min(20, 6 + n*2)` depending on prior state). Replace the function and its comment with:

```js
// 0 palms → no jump. 1..teamN palms → jump velocity scaled so that the team's
// own hand total equals peak jump (20). Base 6 keeps tiny-team jumps from
// feeling identical regardless of palm count.
//
// Uses `??` not `||` so that teamN === 0 stays 0 (then clamped up to MIN_N by
// Math.max), while teamN === null/undefined falls back to FALLBACK_N. This
// makes "teamN=0 → MIN_N" semantics correct, not collapsed into FALLBACK_N.
export function palmCountToJumpStrength(n, teamN) {
  if (n <= 0) return 0;
  const T = Math.max(MIN_N, teamN ?? FALLBACK_N);
  return Math.min(20, Math.round(6 + n * (14 / T)));
}
```

- [ ] **Step 5: Add `pickCalibratedHandCount` to `dino-logic.js`**

Below `palmCountToJumpStrength`, add a new exported function:

```js
// Mode of the sample array. Ties resolve to the higher count
// (favor "everyone is in" over a transient drop).
//
// "No signal" cases all collapse to FALLBACK_N:
// - Empty samples (calibration never sampled, e.g., grace window swallowed it all).
// - All zeros (MediaPipe never detected any hands).
// - Zero-dominant traces (mode is 0, even with a few stray 1s).
// In all three, `bestN || FALLBACK_N` short-circuits the falsy 0 to FALLBACK.
// The final clamp to [MIN_N, TRACKER_CEILING] only matters for valid signals.
export function pickCalibratedHandCount(samples) {
  if (!samples.length) return FALLBACK_N;
  const counts = new Map();
  for (const s of samples) counts.set(s, (counts.get(s) || 0) + 1);
  let bestN = 0, bestFreq = -1;
  for (const [n, f] of counts) {
    if (f > bestFreq || (f === bestFreq && n > bestN)) { bestN = n; bestFreq = f; }
  }
  return Math.max(MIN_N, Math.min(TRACKER_CEILING, bestN || FALLBACK_N));
}
```

- [ ] **Step 6: Run the entire dino-logic test file**

Run: `npx vitest run tests/dino-logic.test.js`
Expected: all tests pass (constants + palmCountToJumpStrength + pickCalibratedHandCount + the unchanged difficulty/score tests). If anything fails, fix it before moving on.

- [ ] **Step 7: Commit**

```bash
git add ps-offsite-2026/shared/dino-logic.js tests/dino-logic.test.js
git commit -m "feat(dino): per-team jump curve and calibration helper

Replaces MAX_HANDS with TRACKER_CEILING + TRACKER_BUFFER + CALIB_TOTAL_S
+ CALIB_GRACE_S + FALLBACK_N + MIN_N constants. palmCountToJumpStrength
now takes (n, teamN) and scales so teamN hands = peak jump 20.

Adds pickCalibratedHandCount: mode of samples, ties resolve to higher,
'no signal' cases collapse to FALLBACK_N.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Refactor `3-dino.js` — drop `g.warming`, introduce `g.subPhase` state machine

This task is a pure refactor — no behavioral change. After this task the game still plays exactly as before (no calibrate phase yet); the goal is to swap the warming boolean for the subPhase machine so the next task can plug calibrate in cleanly.

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.js`

- [ ] **Step 1: Update imports**

Find the import block at the top of `ps-offsite-2026/games/3-dino.js`. Replace the existing `dino-logic` import (around line 11) with:

```js
import {
  PALM_COUNT_WINDOW, TRACKER_CEILING, TRACKER_BUFFER,
  CALIB_TOTAL_S, CALIB_GRACE_S, FALLBACK_N, MIN_N,
  palmCountToJumpStrength, pickCalibratedHandCount, scoreAttempt, finalScore,
  runSpeed, spawnIntervalFrames, highObstacleProb,
} from '../shared/dino-logic.js';
```

The `MAX_HANDS` symbol no longer exists; this import is the contract.

- [ ] **Step 2: Replace the initial pip pre-build with a `TRACKER_CEILING`-sized placeholder row**

Find the pip pre-build block (around lines 73–79 — currently `for (let i = 0; i < MAX_HANDS; i++) { … }`). Replace with:

```js
// Pre-build TRACKER_CEILING pip placeholders. The row is rebuilt to the
// detected team size at calibration lock-in. Until then it shows the full
// ceiling so calibrate-phase players can see hands light up as they raise.
const palmDotsEl = $('palmDots');
for (let i = 0; i < TRACKER_CEILING; i++) {
  const d = document.createElement('div');
  d.className = 'pip';
  palmDotsEl.appendChild(d);
}
```

- [ ] **Step 3: Update the tracker creation in `phaseEnter.loading`**

Find the line in `phaseEnter.loading` that calls `createHandTracker` (currently around line 110). Change `numHands: MAX_HANDS` (or whatever it currently is) to `numHands: TRACKER_CEILING`. The line becomes:

```js
      state.tracker = await createHandTracker(video, { numHands: TRACKER_CEILING, minRunMs: 0 });
```

- [ ] **Step 4: Add `state.teamN` to the session state**

Find the `state = {…}` declaration (around lines 38–42). Add `teamN: null` to it:

```js
const state = {
  teamId: session?.teamId ?? 0,
  tracker: null, stream: null, video: null,
  teamN: null,
  attemptIdx: 0, attempts: [],
};
```

- [ ] **Step 5: Update the per-attempt `g` initialization in `phaseEnter.play`**

Find the `const g = { … }` declaration inside `phaseEnter.play` (currently around lines 150–162). Replace it with:

```js
  const g = {
    y: GROUND_Y - RUNNER_H, vy: 0, ducking: false,
    score: 0, obs: [], spawnTimer: 0, runPhase: 0,
    palmWindow: [], lastEff: 0,
    // Sub-phase machine replaces the old `warming` boolean. On attempt 1
    // (state.teamN === null) we'd start in 'calibrate' — for now we always
    // start in 'warmup'; calibrate is added in the next task.
    subPhase: 'warmup',
    subPhaseMs: performance.now(),
    warmStartMs: performance.now(), startMs: 0,
    // Parallax speck field — scrolls with run speed so forward motion reads
    // even in warmup (no obstacles yet). z = depth → speed, size, brightness.
    particles: Array.from({ length: 28 }, () => ({
      x: Math.random() * CANVAS_W,
      y: Math.random() * GROUND_Y,
      z: 0.35 + Math.random() * 0.65,
    })),
  };
```

Note the removed `warming: true` field and added `subPhase / subPhaseMs`.

- [ ] **Step 6: Rewrite the visibility-change handler to branch on `subPhase`**

Find `const onVis = () => { … }` inside `phaseEnter.play` (currently around lines 171–180). Replace it with:

```js
  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if (g.subPhase === 'calibrate')   g.subPhaseMs += delta;  // pause calibration clock
      else if (g.subPhase === 'warmup') g.warmStartMs += delta; // pause warmup countdown
      else                              g.startMs    += delta;  // pause scored clock
      hiddenAt = 0;
      prevTs = performance.now();
    }
  };
```

- [ ] **Step 7: Rewrite the obstacle-spawn gate in `step()`**

Find the obstacle-spawn block in `step()` (currently around lines 236–242):

```js
    if (!g.warming) {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) {
        spawnObstacle(elapsedSec);
        g.spawnTimer = spawnIntervalFrames(elapsedSec) + Math.random() * 30;
      }
    }
```

Replace with:

```js
    if (g.subPhase === 'live') {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) {
        spawnObstacle(elapsedSec);
        g.spawnTimer = spawnIntervalFrames(elapsedSec) + Math.random() * 30;
      }
    }
```

- [ ] **Step 8: Rewrite the warmup branch inside `loop()`**

Find the `if (g.warming) { … }` block inside `loop()` (currently around lines 346–362). Replace it with:

```js
    if (g.subPhase === 'warmup') {
      const left = warmupSecondsLeft((now - g.warmStartMs) / 1000);
      if (left <= 0) {
        // Transition to live play this same frame; falls through below.
        g.subPhase = 'live';
        g.subPhaseMs = now;
        g.startMs = now;
        g.spawnTimer = 0;
      } else {
        $('timerLabel').textContent = 'WARM UP';
        step(dt, 0);
        if (cancelled) return;
        draw();
        drawWarmupBanner(left);
        rafId = requestAnimationFrame(loop);
        return;
      }
    }
```

- [ ] **Step 9: Run the existing logic tests**

Run: `npx vitest run`
Expected: all 229+ tests pass (the dino-logic tests from Task 2 plus the unchanged suites). No dino-logic tests reach into `3-dino.js`, so this step verifies nothing else broke from the import/symbol changes.

- [ ] **Step 10: Manual smoke check (no agent action — just open the game)**

This step is a sanity check by the executor, not a tool call. Open the dino game in the browser via your usual local dev workflow (`?debug` URL helps). Confirm:
- Warmup banner appears for 10 seconds.
- Obstacles spawn after warmup.
- HUD pip row shows 20 pips (placeholder until calibrate is added).
- Hand-based jumps still work.

If the executor cannot run the browser, skip this step and rely on the next task's tests to catch regressions.

- [ ] **Step 11: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js
git commit -m "refactor(dino): replace g.warming with g.subPhase state machine

Pure refactor. Drops the warming boolean in favor of a 'warmup' | 'live'
sub-phase machine in preparation for the 'calibrate' sub-phase to come.
Visibility handler, obstacle-spawn gate, and warmup branch all read
g.subPhase. HUD pip row pre-built at TRACKER_CEILING placeholder; will
shrink to detected team size after calibration.

Adds state.teamN session field (still always null after this commit).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Extract `tickCalibrate / tickWarmup / tickLive` from `loop()`

Pure refactor again. After this task the loop is just a switch on `g.subPhase`, and each branch lives in its own helper. Sets up Task 5 to plug calibrate logic into `tickCalibrate` without touching the loop scaffolding.

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.js`

- [ ] **Step 1: Add empty `tickCalibrate` stub above `loop()`**

Find the `function loop() { … }` declaration inside `phaseEnter.play` (currently around line 332). Immediately above it, add:

```js
  function tickCalibrate(_dt, _now) {
    // Filled in by Task 5. For now: immediately advance to warmup so the
    // refactor stays behaviorally identical when subPhase happens to start
    // at 'calibrate' (e.g., if Task 5 lands partially).
    g.subPhase = 'warmup';
    g.subPhaseMs = performance.now();
    g.warmStartMs = g.subPhaseMs;
  }
```

- [ ] **Step 2: Move the warmup branch into `tickWarmup`**

Above `loop()` (below `tickCalibrate`), add:

```js
  function tickWarmup(dt, now) {
    const left = warmupSecondsLeft((now - g.warmStartMs) / 1000);
    if (left <= 0) {
      g.subPhase = 'live';
      g.subPhaseMs = now;
      g.startMs = now;
      g.spawnTimer = 0;
      return false; // caller falls through to tickLive this same frame
    }
    $('timerLabel').textContent = 'WARM UP';
    step(dt, 0);
    if (cancelled) return true;
    draw();
    drawWarmupBanner(left);
    return true; // handled this frame
  }
```

- [ ] **Step 3: Move the live branch into `tickLive`**

Below `tickWarmup`, add:

```js
  function tickLive(dt, now) {
    const elapsed = (now - g.startMs) / 1000;
    $('timerLabel').textContent = elapsed.toFixed(1);
    step(dt, elapsed);
    if (cancelled) return;
    draw();
  }
```

- [ ] **Step 4: Rewrite `loop()` to dispatch on subPhase**

Replace the entire body of `function loop() { … }` with:

```js
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

    if (g.subPhase === 'calibrate') {
      tickCalibrate(dt, now);
      if (cancelled) return;
      rafId = requestAnimationFrame(loop);
      return;
    }

    if (g.subPhase === 'warmup') {
      const handled = tickWarmup(dt, now);
      if (cancelled) return;
      if (handled) {
        rafId = requestAnimationFrame(loop);
        return;
      }
      // Fall through into tickLive this same frame (warmup just expired).
    }

    tickLive(dt, now);
    if (cancelled) return;
    rafId = requestAnimationFrame(loop);
  }
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run`
Expected: all tests still pass. No `3-dino.js` logic is unit-tested directly; this verifies the dino-logic suite is still green.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js
git commit -m "refactor(dino): extract tickCalibrate/tickWarmup/tickLive from loop

Pure refactor. loop() becomes a dispatcher on g.subPhase; each sub-phase
is its own helper. tickCalibrate is a stub that immediately advances to
warmup; Task 5 fills in its body.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Implement the `'calibrate'` sub-phase — sampling, banner, lock-in

This is the meaty task. Implements the calibration logic from the spec end-to-end: sampling, smoothed banner, open-new-before-close-old recreate, re-entrancy guard, cancellation guard, HUD rebuild, `console.info` lock log.

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.js`

- [ ] **Step 1: Start the play phase in `'calibrate'` when `state.teamN === null`**

Find the `subPhase: 'warmup'` line inside `g = {…}` (added in Task 3 Step 5). Change it so attempt 1 starts in calibrate. The replaced block is:

```js
    // Sub-phase machine. On attempt 1 (state.teamN === null) start in
    // 'calibrate' to detect team size; subsequent attempts skip straight to
    // warmup and reuse the locked state.teamN.
    subPhase: (state.teamN === null) ? 'calibrate' : 'warmup',
    subPhaseMs: performance.now(),
    calibSamples: [],
    calibLiveBuf: [],     // ring buffer of recent hands.length for smoothed banner
    calibLiveMax: 0,      // smoothed max for banner display
    calibLocking: false,  // re-entrancy guard while async lock-in is in flight
    warmStartMs: performance.now(), startMs: 0,
```

(The block already had the parallax `particles: Array.from(…)` field below — keep that. Replace only the `subPhase / subPhaseMs / warmStartMs / startMs` lines with the above, preserving particles.)

- [ ] **Step 2: Add a banner draw helper for the calibrate phase**

Find `function drawWarmupBanner(secondsLeft) { … }` (currently around lines 320–330). Immediately above it, add:

```js
  function drawCalibrateBanner(secondsLeft, detectedCount) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--accent');
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('SHOW ALL HANDS', CANVAS_W / 2, 70);
    ctx.fillStyle = css('--text');
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`${detectedCount} detected · ${secondsLeft}s`, CANVAS_W / 2, 104);
    ctx.restore();
  }
```

- [ ] **Step 3: Replace the `tickCalibrate` stub with the real implementation**

Find `function tickCalibrate(_dt, _now) { … }` (the stub from Task 4 Step 1). Replace its entire body with:

```js
  function tickCalibrate(dt, now) {
    if (g.calibLocking) {
      // Async lock-in in flight; draw the current frame but do not advance.
      step(dt, 0);
      if (cancelled) return;
      draw();
      drawCalibrateBanner(0, g.calibLiveMax);
      return;
    }

    step(dt, 0);
    if (cancelled) return;

    // Maintain the smoothed live max over the last ~20 frames so the banner
    // count climbs as hands are raised but doesn't flicker on a missed frame.
    const handsNow = state.tracker.latest().hands.length;
    g.calibLiveBuf.push(handsNow);
    if (g.calibLiveBuf.length > 20) g.calibLiveBuf.shift();
    g.calibLiveMax = g.calibLiveBuf.reduce((m, v) => v > m ? v : m, 0);

    const elapsed = (now - g.subPhaseMs) / 1000;
    if (elapsed >= CALIB_GRACE_S) {
      g.calibSamples.push(handsNow);
    }

    if (elapsed >= CALIB_TOTAL_S) {
      lockInCalibration(now);
      // Draw this frame normally; lockInCalibration schedules its own RAF.
    }

    draw();
    drawCalibrateBanner(Math.max(0, Math.ceil(CALIB_TOTAL_S - elapsed)), g.calibLiveMax);
  }
```

- [ ] **Step 4: Add the async `lockInCalibration` helper above `tickCalibrate`**

Immediately above `function tickCalibrate(…)`, add:

```js
  async function lockInCalibration(now) {
    g.calibLocking = true;
    const detected = pickCalibratedHandCount(g.calibSamples);
    const newCap = Math.min(TRACKER_CEILING, detected + TRACKER_BUFFER);

    // Open the new tracker BEFORE closing the old one. If construction throws,
    // the old tracker is still live and the team plays with the ceiling cap.
    let newTracker = null;
    try {
      newTracker = await createHandTracker(state.video, { numHands: newCap, minRunMs: 0 });
    } catch (e) {
      console.warn('Dino calibration: tracker recreate failed, keeping ceiling cap', e);
    }

    // If the play phase was cancelled while we were awaiting, abort cleanly
    // and don't mutate shared state.
    if (cancelled) {
      try { newTracker?.stop(); } catch {}
      g.calibLocking = false;
      return;
    }

    if (newTracker) {
      try { state.tracker.stop(); } catch {}
      state.tracker = newTracker;
    }

    state.teamN = detected;

    // Rebuild HUD pip row to match the detected count.
    palmDotsEl.innerHTML = '';
    for (let i = 0; i < state.teamN; i++) {
      const d = document.createElement('div');
      d.className = 'pip';
      palmDotsEl.appendChild(d);
    }

    console.info('Dino calibration: locked', {
      teamN: state.teamN,
      cap: newTracker ? newCap : TRACKER_CEILING,
      samples: g.calibSamples.length,
      recreateOk: !!newTracker,
    });

    g.calibSamples = [];
    g.calibLocking = false;
    g.subPhase = 'warmup';
    g.subPhaseMs = performance.now();
    g.warmStartMs = g.subPhaseMs;
  }
```

- [ ] **Step 5: Add the `calibLocking` guard to the visibility handler**

Find `const onVis = () => { … }` inside `phaseEnter.play` (rewritten in Task 3 Step 6). Replace it with:

```js
  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      // Ignore the visibility delta while the async lock-in is in flight —
      // the awaited recreate doesn't care about page visibility, and
      // subPhaseMs is about to be overwritten anyway when subPhase advances.
      if (!g.calibLocking) {
        if (g.subPhase === 'calibrate')   g.subPhaseMs += delta;
        else if (g.subPhase === 'warmup') g.warmStartMs += delta;
        else                              g.startMs    += delta;
      }
      hiddenAt = 0;
      prevTs = performance.now();
    }
  };
```

- [ ] **Step 6: Run logic tests**

Run: `npx vitest run`
Expected: all green. The new code in `3-dino.js` isn't unit-tested, but this confirms nothing else regressed.

- [ ] **Step 7: Manual smoke check**

Executor opens the dino game in the browser. Confirm on attempt 1:
- Banner shows `"SHOW ALL HANDS"` for 5 seconds.
- Subcaption shows live count climbing as hands are raised.
- After 5s, brief recreate pause (~100ms is normal), then warmup banner appears.
- HUD pip row shrinks from 20 → detected count.
- `console.info` log fires once with `{ teamN, cap, samples, recreateOk }`.
- Attempt 2 (after first attempt ends): warmup runs immediately, no calibrate banner, HUD pip count stays at the detected size.

If the executor cannot open the browser, leave verification to Task 9.

- [ ] **Step 8: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js
git commit -m "feat(dino): implement 'calibrate' sub-phase with mode-based lock-in

Attempt 1 runs a dedicated 5-second calibrate sub-phase before warmup.
First 2 seconds let the team raise hands (no sampling); next 3 seconds
sample hands.length each frame. At lock-in: open a new tracker at
min(20, N+2) BEFORE closing the old one, set state.teamN, rebuild HUD
pip row.

Re-entrancy guard (g.calibLocking) makes RAF ticks no-op while the async
lock-in is in flight. Cancellation guard post-await stops the new
tracker if the play phase was cancelled. Old tracker is only closed
after the new one is successfully constructed — a recreate failure
leaves the old tracker live and falls back to the ceiling cap.

Smoothed banner (rolling max over last 20 frames) shows the count
climbing as hands are raised. console.info logs the lock-in result.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Adapt jump-call sites to use `state.teamN`

Wires the new jump curve through to the two places `palmCountToJumpStrength` is called.

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.js`

- [ ] **Step 1: Update `updatePalmHud`**

Find `function updatePalmHud(n) { … }` (currently around lines 80–84). Replace its body with:

```js
function updatePalmHud(n) {
  const pips = palmDotsEl.children;
  for (let i = 0; i < pips.length; i++) pips[i].classList.toggle('on', i < n);
  $('jumpFill').style.width = `${(palmCountToJumpStrength(n, state.teamN ?? FALLBACK_N) / 20) * 100}%`;
}
```

- [ ] **Step 2: Update the jump-trigger line in `step()`**

Find the jump-trigger line in `step()` (currently around line 221):

```js
    if (onGround && eff > 0 && g.lastEff === 0) g.vy = -palmCountToJumpStrength(eff);
```

Replace with:

```js
    if (onGround && eff > 0 && g.lastEff === 0) g.vy = -palmCountToJumpStrength(eff, state.teamN ?? FALLBACK_N);
```

- [ ] **Step 3: Run logic tests**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 4: Manual smoke check**

Executor opens the dino game. Confirm:
- During calibrate: jumps still work (HUD `jumpFill` animates with `T=FALLBACK_N=4` curve).
- After lock-in: jumps scale to detected team size — e.g. with `state.teamN=4`, 2 palms → mid-jump, 4 palms → peak.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js
git commit -m "feat(dino): jump curve uses state.teamN with FALLBACK_N during calibrate

Both jump-trigger and updatePalmHud now pass state.teamN ?? FALLBACK_N
as the second argument to palmCountToJumpStrength. Pre-calibration
(state.teamN === null) the team plays on the FALLBACK_N=4 curve so
practice still feels real; post-lock-in the curve adapts.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `wireRestart` tears down tracker + clears `state.teamN`

So that admin "play again" leads to a clean calibration on the next attempt 1.

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.js`

- [ ] **Step 1: Update `wireRestart`**

Find `function wireRestart() { … }` (currently around lines 438–445). Replace its body with:

```js
function wireRestart() {
  $('finalPlayAgain').onclick = async () => {
    if (!await requireAdmin(session?.lobbyId, { promptText: 'Something went wrong? Enter admin password to restart:' })) return;
    // Tear down the camera/tracker so the next loading phase reopens a fresh
    // tracker at TRACKER_CEILING. Defensive — phaseEnter.final already does
    // the same teardown, but wireRestart is also wired from enterAlreadyPlayed
    // where final didn't run.
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
    if (state.tracker) { try { state.tracker.stop(); } catch {} state.tracker = null; }
    state.teamN = null;
    state.attempts = [];
    state.attemptIdx = 0;
    goto('setup');
  };
}
```

- [ ] **Step 2: Run logic tests**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 3: Manual smoke check**

Executor: complete an attempt 1 calibration with one team size (e.g., 2 hands), reach the final phase, hit "Play again" with admin password, click Start. Confirm:
- Camera reopens (browser permission may re-prompt depending on browser).
- Calibrate phase runs again.
- HUD pip row starts at 20 placeholder, then shrinks to the new detected count.

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js
git commit -m "fix(dino): wireRestart tears down tracker and clears state.teamN

Admin 'play again' now explicitly stops the camera stream and tracker
and resets state.teamN. The next phaseEnter.loading reopens a fresh
tracker at TRACKER_CEILING so calibration re-runs cleanly. Defensive
even though phaseEnter.final does the same teardown — wireRestart is
also wired from enterAlreadyPlayed where final didn't run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `?debug&team=N` URL flag — skip calibrate for solo testing

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.js`

- [ ] **Step 1: Parse the `team` URL param at boot**

Find the existing debug-flag block (currently around lines 64–80 — `DEBUG = new URLSearchParams(...).has('debug')`). Below the existing `DEBUG` declaration and key listeners, add:

```js
// ?debug&team=N forces state.teamN at boot and skips the calibrate sub-phase.
// Useful for solo testing where a single user can't supply >2 hands.
const DEBUG_TEAM_N = (() => {
  const raw = new URLSearchParams(location.search).get('team');
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_N || n > TRACKER_CEILING) return null;
  return Math.floor(n);
})();
if (DEBUG_TEAM_N !== null) state.teamN = DEBUG_TEAM_N;
```

This must run after `state` is declared (around line 38) but before any `phaseEnter.*` runs. Place it directly below the existing `debugPalms` keydown/keyup block.

- [ ] **Step 2: Tighten the initial tracker numHands when `DEBUG_TEAM_N` is set**

Find the line in `phaseEnter.loading` that calls `createHandTracker` (currently `numHands: TRACKER_CEILING`). Replace the line with:

```js
      state.tracker = await createHandTracker(video, {
        numHands: DEBUG_TEAM_N !== null
          ? Math.min(TRACKER_CEILING, DEBUG_TEAM_N + TRACKER_BUFFER)
          : TRACKER_CEILING,
        minRunMs: 0,
      });
```

- [ ] **Step 3: Update the debug keydown clamp to read `state.teamN` from the closure**

Find the `parseKey` function in the debug block (currently around lines 67–77 — uses `MAX_HANDS` or a previous bound). Replace the whole debug listener block (just the `parseKey + addEventListener` section) with:

```js
let debugPalms = null;
if (DEBUG) {
  const parseKey = (e) => {
    if (e.key >= '0' && e.key <= '9') return e.shiftKey ? 10 + Number(e.key) : Number(e.key);
    return null;
  };
  window.addEventListener('keydown', (e) => {
    const n = parseKey(e);
    // Read state.teamN inside the handler so the bound updates after lock-in.
    const upper = state.teamN ?? TRACKER_CEILING;
    if (n !== null && n <= upper) debugPalms = n;
  });
  window.addEventListener('keyup', (e) => { if (parseKey(e) !== null) debugPalms = null; });
}
```

- [ ] **Step 4: Pre-build the pip row at the correct size when DEBUG_TEAM_N is set**

Find the pip pre-build (added in Task 3 Step 2 — `for (let i = 0; i < TRACKER_CEILING; i++)`). Replace it with:

```js
// Pre-build pip placeholders. The row is rebuilt to the detected team size at
// calibration lock-in. Until then it shows the full ceiling (or DEBUG_TEAM_N
// if the debug param forced it).
const palmDotsEl = $('palmDots');
const initialPipCount = DEBUG_TEAM_N !== null ? DEBUG_TEAM_N : TRACKER_CEILING;
for (let i = 0; i < initialPipCount; i++) {
  const d = document.createElement('div');
  d.className = 'pip';
  palmDotsEl.appendChild(d);
}
```

- [ ] **Step 5: Run logic tests**

Run: `npx vitest run`
Expected: all green.

- [ ] **Step 6: Manual smoke check**

Executor opens the game with `?debug&team=4`. Confirm:
- Calibrate phase is skipped — warmup banner appears immediately on entering play.
- HUD pip row shows 4 pips from the start, not 20.
- Jump curve scales to `T=4`.
- Without the `team` param, calibration runs as in Task 5.

- [ ] **Step 7: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js
git commit -m "feat(dino): ?debug&team=N URL flag skips calibrate for solo testing

Sets state.teamN at boot from the URL param, opens the tracker at the
right cap from loading, and pre-builds the HUD pip row at that count.
Calibrate sub-phase is skipped (play starts in 'warmup' because
state.teamN is non-null). Useful for solo dev when only one human can
supply 2 hands.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full verification

**Files:**
- (none modified)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: all 229+ tests pass (count grew by Task 1+2 additions; baseline was 229).

- [ ] **Step 2: Lint (if available)**

Check whether the repo has a lint script:
Run: `node -e "console.log(require('./package.json').scripts)"`
If a `lint` script exists, run `npm run lint`. Expected: pass.

- [ ] **Step 3: Build (if available)**

Check whether the repo has a build step (Vite, based on the `dist/` directory in the repo root):
If `vite.config.*` or a `build` npm script exists, run `npm run build`. Expected: build succeeds without errors.

- [ ] **Step 4: Manual end-to-end smoke check**

Executor: open the dino game in the browser. Walk through the three attempts and the admin restart path:

1. **Attempt 1:** raise hands. Confirm calibrate banner counts up live; HUD pips shrink from 20 to the detected count after 5s; warmup runs for 10s with the dino canvas; jumps work; obstacles spawn; collision ends attempt.
2. **Attempt 2 ("Try Again"):** intro → play. Confirm there is no calibrate banner; warmup runs immediately; HUD pip count is unchanged from attempt 1; jump curve still scales to the same `state.teamN`.
3. **Attempt 3:** same as attempt 2.
4. **Finish:** reach the final phase; confirm score submission works (or LOCKED if the lobby is in that state).
5. **Admin "Play again":** enter admin password, click Start. Confirm camera reopens, calibrate runs again, and HUD pips reset to 20 then shrink to the new detected count.

- [ ] **Step 5: Reference check the spec for coverage**

Open `docs/superpowers/specs/2026-05-28-dino-hand-calibration-design.md`. Walk through each numbered Goal and each bullet in "Architecture / Game loop changes". Confirm every one has a corresponding implemented behavior. If anything is missing, file a follow-up issue or add a small task.

- [ ] **Step 6: Final commit (none needed if everything is green)**

If Steps 1–5 all passed and no edits were made in this task, nothing to commit. If anything was tweaked during smoke (e.g., a small comment fix), commit:

```bash
git add -A
git commit -m "chore(dino): verification tweaks after calibration smoke check

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
