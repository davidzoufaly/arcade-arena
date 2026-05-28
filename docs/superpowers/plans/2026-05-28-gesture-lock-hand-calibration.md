# Gesture-Lock Hand-Count Calibration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fixed 16-gesture sequence in `gesture-lock` with a one-shot calibration phase that detects team size on attempt 1 and scales the sequence length, success-score grace, and HUD/DOM accordingly.

**Architecture:** Add a `'calibrate'` phase before `'memorize'` (attempt 1 only); open the GestureRecognizer at `numHands: TRACKER_CEILING` (=20) during loading; mode-sample `result.landmarks.length` over 3 seconds (after 2 s grace); lock `state.teamN` and `state.sequenceLen = clamp(N*2, 8, 28)`; recreate the recognizer back at `numHands: 1` for play; reuse the locked values across attempts 2 and 3. Success-score grace becomes `len * 0.625` seconds — so `len=16` keeps the existing 10 s baseline exactly and no existing tests break.

**Tech Stack:** Vanilla JS ES modules, MediaPipe Tasks Vision (GestureRecognizer), Vitest for unit tests.

**Spec:** [docs/superpowers/specs/2026-05-28-gesture-lock-hand-calibration-design.md](../specs/2026-05-28-gesture-lock-hand-calibration-design.md)

---

## File map

- `ps-offsite-2026/shared/gesture-lock-logic.js` — add `SEQUENCE_LEN_MIN / SEQUENCE_LEN_MAX / TIME_GRACE_PER_GESTURE` constants; add `sequenceLengthForTeam / successScore / failScore` helpers; rewrite `scoreAttempt` to delegate, with a `sequenceLen = SEQUENCE_LEN` default for back-compat. Import `MIN_N / FALLBACK_N` from `dino-logic.js`.
- `ps-offsite-2026/games/1-gesture-lock.html` (inline `<script type="module">`) — extract MediaPipe URL constants; add `state.teamN / state.sequenceLen`; open recognizer at `TRACKER_CEILING`; add new `phase-calibrate` DOM section; insert `'calibrate'` into the `PHASES` array; implement `phaseEnter.calibrate` with sampling, banner, async lock-in, and recognizer recreate-at-1; route intro → calibrate; thread `state.sequenceLen` through memorize / recall / attempt-end; update wireRestart teardown; add `?debug&team=N` flag.
- `tests/gesture-lock.test.js` — add new test blocks for `sequenceLengthForTeam`, `successScore`, `failScore`, and explicit-`sequenceLen` `scoreAttempt` cases. Existing tests stay (back-compat).

No changes to `dino-logic.js`, `vision.js`, or other game files.

---

## Task 1: Logic helpers in `gesture-lock-logic.js` + new tests

**Files:**
- Modify: `ps-offsite-2026/shared/gesture-lock-logic.js`
- Test: `tests/gesture-lock.test.js`

- [ ] **Step 1: Add the new constants and helper imports to the test file**

Open `tests/gesture-lock.test.js`. Replace the existing import block (lines 2–8) with:

```js
import {
  GESTURE_POOL,
  SEQUENCE_LEN,
  SEQUENCE_LEN_MIN,
  SEQUENCE_LEN_MAX,
  TIME_GRACE_PER_GESTURE,
  pickSequenceWithRepeats,
  sequenceLengthForTeam,
  successScore,
  failScore,
  scoreAttempt,
  finalScore,
} from '../ps-offsite-2026/shared/gesture-lock-logic.js';
```

- [ ] **Step 2: Add the new test blocks below the existing `scoreAttempt` block**

In `tests/gesture-lock.test.js`, find the closing `});` of the `describe('scoreAttempt', …)` block (currently around line 107). Immediately after it (before the `describe('finalScore', …)` block), insert:

```js
describe('sequence-length constants', () => {
  it('SEQUENCE_LEN_MIN is 8', () => expect(SEQUENCE_LEN_MIN).toBe(8));
  it('SEQUENCE_LEN_MAX is 28', () => expect(SEQUENCE_LEN_MAX).toBe(28));
  it('TIME_GRACE_PER_GESTURE is 0.625', () => expect(TIME_GRACE_PER_GESTURE).toBe(0.625));
  it('SEQUENCE_LEN (back-compat) is still 16', () => expect(SEQUENCE_LEN).toBe(16));
});

describe('sequenceLengthForTeam', () => {
  it('teamN nullish → FALLBACK_N (4) → clamped to MIN (8)', () => {
    expect(sequenceLengthForTeam(null)).toBe(8);
    expect(sequenceLengthForTeam(undefined)).toBe(8);
  });
  it('teamN=0 → clamped to MIN (8)',  () => expect(sequenceLengthForTeam(0)).toBe(8));
  it('teamN=1 → 2 → clamped to MIN (8)', () => expect(sequenceLengthForTeam(1)).toBe(8));
  it('teamN=3 → 6 → clamped to MIN (8)', () => expect(sequenceLengthForTeam(3)).toBe(8));
  it('teamN=4 → 8',  () => expect(sequenceLengthForTeam(4)).toBe(8));
  it('teamN=5 → 10', () => expect(sequenceLengthForTeam(5)).toBe(10));
  it('teamN=8 → 16 (matches today)', () => expect(sequenceLengthForTeam(8)).toBe(16));
  it('teamN=14 → 28', () => expect(sequenceLengthForTeam(14)).toBe(28));
  it('teamN=15 → 30 → clamped to MAX (28)', () => expect(sequenceLengthForTeam(15)).toBe(28));
  it('teamN=20 → 40 → clamped to MAX (28)', () => expect(sequenceLengthForTeam(20)).toBe(28));
});

describe('successScore', () => {
  it('inside grace at len=16 → 100',                 () => expect(successScore(0, 16)).toBe(100));
  it('at grace edge (10 s for len=16) → 100',         () => expect(successScore(10.0, 16)).toBe(100));
  it('5 s past grace at len=16 → 90',                 () => expect(successScore(15.0, 16)).toBe(90));
  it('30 s past grace at len=16 → floored to 40',     () => expect(successScore(40.0, 16)).toBe(40));
  it('len=8 floors earlier (grace 5 s) at 35 s',      () => expect(successScore(35.0, 8)).toBe(40));
  it('len=28 floors later (grace 17.5 s) at 47.5 s',  () => expect(successScore(47.5, 28)).toBe(40));
  it('len=8 inside grace at 4 s → 100',               () => expect(successScore(4.0, 8)).toBe(100));
  it('len=8 at 7 s (2 s past grace) → 96',            () => expect(successScore(7.0, 8)).toBe(96));
});

describe('failScore', () => {
  it('len=16, completed=8 → 17 (floor of 50% × 35)', () => expect(failScore(8, 16)).toBe(17));
  it('len=28, completed=8 → 10 (floor of 28.6% × 35)', () => expect(failScore(8, 28)).toBe(10));
  it('len=16, completed=0 → 0',                       () => expect(failScore(0, 16)).toBe(0));
  it('len=8, completed=8 → 35 (100% × 35)',           () => expect(failScore(8, 8)).toBe(35));
});

describe('scoreAttempt with explicit sequenceLen', () => {
  it('success at sequenceLen=8 grace edge (5 s) → 100', () =>
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 5, sequenceLen: 8 })).toBe(100));
  it('success at sequenceLen=8, 3 s past grace → 94', () =>
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 8, sequenceLen: 8 })).toBe(94));
  it('success at sequenceLen=28 grace edge (17.5 s) → 100', () =>
    expect(scoreAttempt({ result: 'success', completed: 28, timeSec: 17.5, sequenceLen: 28 })).toBe(100));
  it('fail at sequenceLen=28, completed=14 → 17', () =>
    expect(scoreAttempt({ result: 'fail', completed: 14, timeSec: 30, sequenceLen: 28 })).toBe(17));
});
```

- [ ] **Step 3: Run the test to verify the new blocks fail and the old ones still pass**

Run: `npx vitest run tests/gesture-lock.test.js`
Expected: existing tests pass; the new blocks fail with `undefined` import errors for `SEQUENCE_LEN_MIN`, `SEQUENCE_LEN_MAX`, `TIME_GRACE_PER_GESTURE`, `sequenceLengthForTeam`, `successScore`, `failScore`.

- [ ] **Step 4: Implement the helpers in `gesture-lock-logic.js`**

Open `ps-offsite-2026/shared/gesture-lock-logic.js`. Add an import at the top (above `GESTURE_POOL`):

```js
import { MIN_N, FALLBACK_N } from './dino-logic.js';
```

Replace the existing `export const SEQUENCE_LEN = 16;` line and the `export function scoreAttempt(…)` function with the following block. Keep `GESTURE_POOL`, `pickSequenceWithRepeats`, and `finalScore` exactly as they are.

```js
/**
 * @deprecated Use `state.sequenceLen` (computed via `sequenceLengthForTeam`) for new code.
 * Kept exported because the existing test suite imports it directly and the
 * scoreAttempt back-compat default refers to it.
 */
export const SEQUENCE_LEN = 16;

// Backstop bounds: a solo player should still see a real sequence; a 7-player
// team should not be punished with 30+ gestures inside the 5-minute attempt.
export const SEQUENCE_LEN_MIN = 8;
export const SEQUENCE_LEN_MAX = 28;

// Free seconds per gesture before the success-score timer penalty kicks in.
// Tuned to 0.625 so that the old hard-coded default of 16 gestures lands on
// exactly 10 s of grace — matching the previous baseline and keeping the
// existing scoreAttempt tests passing without modification.
export const TIME_GRACE_PER_GESTURE = 0.625;

// Two gestures per detected hand, bounded by [SEQUENCE_LEN_MIN, SEQUENCE_LEN_MAX].
export function sequenceLengthForTeam(teamN) {
  const T = Math.max(MIN_N, teamN ?? FALLBACK_N);
  return Math.max(SEQUENCE_LEN_MIN, Math.min(SEQUENCE_LEN_MAX, T * 2));
}

// Success score: full 100 inside the grace window, then 2 pt per second past.
// Floors at 40 — same floor as before.
export function successScore(timeSec, sequenceLen) {
  const grace = sequenceLen * TIME_GRACE_PER_GESTURE;
  const raw = 100 - 2 * Math.max(0, timeSec - grace);
  return Math.max(40, Math.min(100, Math.round(raw)));
}

// Fail score: completion percentage × 35, sequenceLen-aware.
export function failScore(completed, sequenceLen) {
  return Math.floor((completed / sequenceLen) * 35);
}

export function scoreAttempt({ result, completed, timeSec, sequenceLen = SEQUENCE_LEN }) {
  if (result === 'success') return successScore(timeSec, sequenceLen);
  return failScore(completed, sequenceLen);
}
```

- [ ] **Step 5: Run the full file's tests**

Run: `npx vitest run tests/gesture-lock.test.js`
Expected: all tests pass — original blocks (`scoreAttempt` back-compat at 10 s, fail percentages, etc.) and the new blocks.

- [ ] **Step 6: Run the entire suite**

Run: `npx vitest run`
Expected: every test file green (count grows by the new blocks added in Step 2; previous baseline was 248 across 12 files).

- [ ] **Step 7: Commit**

```bash
git add ps-offsite-2026/shared/gesture-lock-logic.js tests/gesture-lock.test.js
git commit -m "feat(gesture-lock): per-team sequence length helpers and scaled scoring

Adds SEQUENCE_LEN_MIN/MAX and TIME_GRACE_PER_GESTURE constants, plus
sequenceLengthForTeam, successScore, and failScore helpers. scoreAttempt
delegates to those and defaults sequenceLen to SEQUENCE_LEN=16 so
existing tests pass unchanged.

Grace constant 0.625 means len=16 → 10 s grace (exact match for the old
hard-coded baseline).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Extract MediaPipe URL constants in the HTML script

Pure refactor — no behavioral change. Promotes the two inline URL strings in `phaseEnter.loading` to module-level constants so Task 5's `phaseEnter.calibrate` can reuse them without copy-paste drift.

**Files:**
- Modify: `ps-offsite-2026/games/1-gesture-lock.html`

- [ ] **Step 1: Add the constants at the top of the script module**

Open `ps-offsite-2026/games/1-gesture-lock.html`. Find the `<script type="module">` opening (around line 344). Below the existing imports (after the `from '../shared/gesture-lock-logic.js'` import line and any other imports), add:

```js
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const GESTURE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
```

- [ ] **Step 2: Replace the inline URLs in `phaseEnter.loading`**

Find the existing `phaseEnter.loading` body (around lines 423–457). Two URL literals appear:

1. `await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm')` — replace the literal with `WASM_URL`.
2. `modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task'` — replace the literal with `GESTURE_MODEL_URL`.

After this step the `phaseEnter.loading` body should reference `WASM_URL` and `GESTURE_MODEL_URL` in place of the strings.

- [ ] **Step 3: Confirm no other inline copies exist**

Run:
```
grep -nE "mediapipe-models/gesture_recognizer|tasks-vision@0\\.10\\.14/wasm" ps-offsite-2026/games/1-gesture-lock.html
```
Expected: two matches, both on the new constant declarations. No matches inside `phaseEnter.loading` or anywhere else.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/games/1-gesture-lock.html
git commit -m "refactor(gesture-lock): extract WASM_URL and GESTURE_MODEL_URL constants

Pure refactor. The two MediaPipe URLs were inline literals in
phaseEnter.loading. Promote them to module-level constants so the
calibrate phase added in the next task can reuse them without
copy-paste drift.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Session state + loading recognizer at `TRACKER_CEILING`

Adds the new state fields and prepares the recognizer for multi-hand calibration. The calibrate phase itself is not added until Task 4–5; play will continue to use whatever recognizer is open (multi-hand) — gameplay still works since it polls only the first detected hand.

**Files:**
- Modify: `ps-offsite-2026/games/1-gesture-lock.html`

- [ ] **Step 1: Update imports**

Find the import block at the top of the `<script type="module">`. Replace the existing `from '../shared/gesture-lock-logic.js'` import with:

```js
import {
  GESTURE_POOL,
  SEQUENCE_LEN,
  sequenceLengthForTeam,
  pickSequenceWithRepeats,
  scoreAttempt,
  finalScore,
} from '../shared/gesture-lock-logic.js';
```

Add an additional import (place below the gesture-lock-logic import):

```js
import {
  TRACKER_CEILING,
  CALIB_TOTAL_S,
  CALIB_GRACE_S,
  FALLBACK_N,
  MIN_N,
  pickCalibratedHandCount,
} from '../shared/dino-logic.js';
```

- [ ] **Step 2: Add `teamN` and `sequenceLen` to the `state` object**

Find the `const state = { … }` declaration. Add two new fields. After your edit the object should look approximately like:

```js
const state = {
  teamId: session?.teamId ?? 0,
  lobbyId: session?.lobbyId,
  recognizer: null,
  stream: null,
  sequence: [],
  stepIdx: 0,
  teamN: null,         // locked by calibrate phase on attempt 1
  sequenceLen: null,   // derived from teamN; falls back at memorize-time
  attempts: [],
  attemptIdx: 0,
  result: null,
  recallStartMs: 0,
  stepStartMs: 0,
};
```

(Preserve any fields already present in the existing declaration — only add `teamN` and `sequenceLen`.)

- [ ] **Step 3: Change the `phaseEnter.loading` recognizer to multi-hand**

Find the `GestureRecognizer.createFromOptions(vision, { … })` call inside `phaseEnter.loading`. Change `numHands: 1` to `numHands: TRACKER_CEILING`. The full options object should be:

```js
state.recognizer = await GestureRecognizer.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: GESTURE_MODEL_URL,
    delegate: 'GPU',
  },
  runningMode: 'VIDEO',
  numHands: TRACKER_CEILING,
});
```

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: all tests pass (no logic tests reach into the HTML script).

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/games/1-gesture-lock.html
git commit -m "feat(gesture-lock): add state.teamN/sequenceLen and multi-hand recognizer

Adds the two session fields populated by the upcoming calibrate phase
and opens the GestureRecognizer at numHands=TRACKER_CEILING (20) during
loading. Until calibrate runs, the recognizer stays multi-hand; play
code only polls the first detected hand so gameplay is unaffected.

Imports calibration primitives from dino-logic.js (TRACKER_CEILING,
CALIB_TOTAL_S, CALIB_GRACE_S, FALLBACK_N, MIN_N, pickCalibratedHandCount).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: HTML `phase-calibrate` section + `PHASES` array entry

Skeleton DOM and phase-list entry only. The `phaseEnter.calibrate` handler is added in Task 5.

**Files:**
- Modify: `ps-offsite-2026/games/1-gesture-lock.html`

- [ ] **Step 1: Add the new phase section to the markup**

Find the existing `<section id="phase-intro" …>` element (it lives next to the other `phase-*` sections in the body). Immediately after the closing tag of `phase-intro`, insert:

```html
<section id="phase-calibrate" class="phase hidden">
  <div class="phase-card calib-card">
    <video id="calibVideo" autoplay playsinline muted class="cam"></video>
    <div class="calib-banner">
      <h1>SHOW ALL HANDS</h1>
      <p><span id="calibCount">0</span> detected · <span id="calibTimer">5</span>s</p>
    </div>
  </div>
</section>
```

- [ ] **Step 2: Add minimal styles**

In the existing `<style>` block, alongside the other `.phase-card` / `.cam` rules, append:

```css
.calib-card { display: flex; flex-direction: column; gap: 16px; align-items: center; }
.calib-banner { text-align: center; }
.calib-banner h1 { font-size: 34px; font-weight: 800; letter-spacing: 1px; color: var(--accent); margin: 0; }
.calib-banner p { font-size: 22px; color: var(--text); margin: 6px 0 0; }
```

(If `.cam` already styles the video reasonably, the `<video>` will inherit it. Otherwise add `.calib-card .cam { width: 320px; height: 240px; object-fit: cover; transform: scaleX(-1); border-radius: 12px; background: #000; }` matching the existing camera preview style.)

- [ ] **Step 3: Add `'calibrate'` to the `PHASES` array**

Find the `const PHASES = […]` declaration in the script. Insert `'calibrate'` between `'intro'` and `'memorize'`. After your edit:

```js
const PHASES = ['setup', 'loading', 'intro', 'calibrate', 'memorize', 'countdown', 'recall', 'attempt-end', 'final'];
```

(Preserve any extra phase names that already exist; insert `'calibrate'` in the right slot.)

- [ ] **Step 4: Verify the page still loads without JS errors**

Run: `npx vitest run`
Expected: all tests pass. (The HTML changes do not affect the logic tests.)

Manual smoke (executor): open the page in the browser. `phase-calibrate` should be hidden by default (`.hidden` class). No errors in the console. The other phases route exactly as before because `phaseEnter.calibrate` is not defined yet — `goto('calibrate')` would error if called, but nothing calls it yet.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/games/1-gesture-lock.html
git commit -m "feat(gesture-lock): add phase-calibrate DOM section and PHASES entry

Skeleton-only: hidden section with calibVideo, calibCount, calibTimer
IDs and minimal banner styling. PHASES array now includes 'calibrate'
between 'intro' and 'memorize'. The phaseEnter.calibrate handler is
added in the next task.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Implement `phaseEnter.calibrate` with sampling, banner, and lock-in

The central task — adds calibrate-phase logic end-to-end.

**Files:**
- Modify: `ps-offsite-2026/games/1-gesture-lock.html`

- [ ] **Step 1: Add the calibrate handler**

Find the `phaseEnter.intro = …` declaration (around line 459). Immediately after that block (and before `phaseEnter.memorize`), insert:

```js
phaseEnter.calibrate = () => {
  // Attempts 2 and 3 reuse the locked teamN — skip immediately. Also covers
  // the ?debug&team=N path: state.teamN was set at boot, so calibrate is a
  // no-op.
  if (state.teamN !== null) {
    state.sequenceLen ??= sequenceLengthForTeam(state.teamN);
    goto('memorize');
    return;
  }

  const video = $('calibVideo');
  video.srcObject = state.stream;
  // GestureRecognizer.recognizeForVideo(video, ts) reads from video.currentTime.
  // Without an explicit play() the element stays at currentTime=0 and MediaPipe
  // gets the same frozen frame every tick — sampling sees zero hands forever.
  video.play().catch(() => {});

  // Closure-local per-phase state. g.startedMs is not paused on visibility
  // change — see spec: tab-switch mid-calibrate is a low-probability case in
  // a live offsite setting; worst case is early lock-in with samples already
  // collected.
  const g = {
    startedMs: performance.now(),
    samples: [],          // hands.length per frame, only after grace
    liveBuf: [],          // last ~20 frames for smoothed banner count
    liveMax: 0,
    locking: false,       // re-entrancy guard while async lock-in is in flight
  };

  let cancelled = false;
  let rafId = null;

  async function lockIn() {
    g.locking = true;
    const detected = pickCalibratedHandCount(g.samples);

    // Open a new single-hand recognizer BEFORE closing the multi-hand one.
    // If construction throws, the old recognizer stays live and the team
    // plays with the ceiling cap — slightly less efficient but functional.
    let newRecognizer = null;
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      newRecognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: 1,
      });
    } catch (e) {
      console.warn('Gesture-lock calibration: recognizer recreate failed, keeping multi-hand recognizer', e);
    }

    // If the phase was cancelled during the await, abort cleanly.
    if (cancelled) {
      try { newRecognizer?.close(); } catch {}
      g.locking = false;
      return;
    }

    if (newRecognizer) {
      try { state.recognizer.close(); } catch {}
      state.recognizer = newRecognizer;
    }

    state.teamN = detected;
    state.sequenceLen = sequenceLengthForTeam(detected);

    console.info('Gesture-lock calibration: locked', {
      teamN: state.teamN,
      sequenceLen: state.sequenceLen,
      samples: g.samples.length,
      recreateOk: !!newRecognizer,
    });

    goto('memorize');
  }

  function tick() {
    if (cancelled) return;
    const now = performance.now();
    const elapsed = (now - g.startedMs) / 1000;

    // MediaPipe's gesture recognizer returns one landmark array per detected
    // hand. We use the length as the hand count.
    const result = state.recognizer.recognizeForVideo(video, now);
    const handsNow = result.landmarks?.length ?? 0;

    g.liveBuf.push(handsNow);
    if (g.liveBuf.length > 20) g.liveBuf.shift();
    g.liveMax = g.liveBuf.reduce((m, v) => v > m ? v : m, 0);

    if (elapsed >= CALIB_GRACE_S && !g.locking) {
      g.samples.push(handsNow);
    }

    // Update banner DOM each frame.
    $('calibCount').textContent = String(g.liveMax);
    $('calibTimer').textContent = String(Math.max(0, Math.ceil(CALIB_TOTAL_S - elapsed)));

    if (elapsed >= CALIB_TOTAL_S && !g.locking) {
      // Fire-and-forget. The RAF chain stops here; lockIn() resolves and
      // calls goto('memorize'). During the ~100ms recreate, the calibrate
      // banner shows the last-rendered count + "0s" and stays static —
      // acceptable since nothing is in flight.
      lockIn();
      return;
    }

    rafId = requestAnimationFrame(tick);
  }

  rafId = requestAnimationFrame(tick);

  activeCleanup = () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
  };
};
```

- [ ] **Step 2: Verify the imports include every symbol used**

Run:
```
grep -nE "sequenceLengthForTeam|pickCalibratedHandCount|CALIB_TOTAL_S|CALIB_GRACE_S|WASM_URL|GESTURE_MODEL_URL|TRACKER_CEILING" ps-offsite-2026/games/1-gesture-lock.html | head -20
```
Expected: each symbol appears at least once at an import/declaration site and at least once at a use site inside `phaseEnter.calibrate`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Manual smoke check**

Executor opens the gesture-lock game in the browser. Confirm on attempt 1:
- After clicking Start on the intro screen, the calibrate banner appears showing `"SHOW ALL HANDS"` and a live `"<n> detected · <s>s"` line.
- The detected count climbs as hands are raised in front of the camera; the timer counts down from 5 to 0.
- After 5 s, the page briefly pauses (~100 ms) then transitions to the `memorize` phase.
- Browser console contains exactly one `console.info("Gesture-lock calibration: locked", { teamN, sequenceLen, samples, recreateOk: true })` log.

If the executor cannot drive the browser, defer this verification to Task 9.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/games/1-gesture-lock.html
git commit -m "feat(gesture-lock): implement calibrate phase with mode-based lock-in

Attempt 1 runs a 5-second calibrate phase before memorize. First 2 s
let the team raise hands (no sampling); next 3 s sample
result.landmarks.length each frame. At lock-in: open a new recognizer
at numHands=1 BEFORE closing the multi-hand one, set state.teamN +
state.sequenceLen, then goto('memorize').

Re-entrancy guard (g.locking) makes RAF ticks no-op while the async
lock-in is in flight. Cancellation guard post-await closes the new
recognizer if the phase was cancelled. Old recognizer is only closed
after the new one is successfully constructed — a recreate failure
leaves the multi-hand recognizer live.

Smoothed banner (rolling max over last 20 frames) shows the count
climbing as hands are raised. console.info logs the lock-in result.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Thread `state.sequenceLen` through memorize / recall / attempt-end

Wires the locked sequence length through the rest of the game flow.

**Files:**
- Modify: `ps-offsite-2026/games/1-gesture-lock.html`

- [ ] **Step 1: Route the intro Start button to calibrate**

Find `phaseEnter.intro = …`. The body sets `$('introStartBtn').onclick = () => goto('memorize')`. Change `'memorize'` to `'calibrate'`. After your edit:

```js
phaseEnter.intro = () => {
  $('introNum').textContent = state.attemptIdx + 1;
  $('introStartBtn').onclick = () => goto('calibrate');
};
```

- [ ] **Step 2: Make `phaseEnter.memorize` use `state.sequenceLen`**

Find `phaseEnter.memorize`. Two changes:

1. At the very top of the body, add a defensive default:

```js
  state.sequenceLen ??= sequenceLengthForTeam(state.teamN);
```

2. Find the existing `state.sequence = pickSequenceWithRepeats(GESTURE_POOL, SEQUENCE_LEN)` line. Change `SEQUENCE_LEN` to `state.sequenceLen`. After your edit:

```js
  state.sequence = pickSequenceWithRepeats(GESTURE_POOL, state.sequenceLen);
```

3. Find the line that builds the memorize dots row (something like `const dotsEl = $('memorizeDots'); dotsEl.innerHTML = state.sequence.map(() => …).join('');`). It already iterates `state.sequence`, so no change is needed there — but verify it doesn't reference `SEQUENCE_LEN` independently. If it does, switch to `state.sequenceLen`.

- [ ] **Step 3: Make the recall loop use `state.sequenceLen`**

Find the recall phase (search for `stepBadge` and the per-step badge update). Inside `phaseEnter.recall` or the recall loop, find:

```js
$('stepBadge').textContent = `${Math.min(state.stepIdx + 1, SEQUENCE_LEN)} / ${SEQUENCE_LEN}`;
```

Change both `SEQUENCE_LEN` references to `state.sequenceLen`.

Also find the completion check — something like `if (state.stepIdx >= SEQUENCE_LEN) { … success … }` — and change `SEQUENCE_LEN` to `state.sequenceLen`.

Run:
```
grep -n "SEQUENCE_LEN" ps-offsite-2026/games/1-gesture-lock.html
```
Expected after this step: only the import statement still references `SEQUENCE_LEN`. Every play-time read should now use `state.sequenceLen`.

- [ ] **Step 4: Make the attempt-end DOM dynamic**

Find the markup `Completed <strong id="attemptCompleted">0</strong> / 16` (around line 321). Change the literal `16` to a span:

```html
Completed <strong id="attemptCompleted">0</strong> / <span id="attemptTotal">16</span>
```

In `phaseEnter['attempt-end']` (around line 704 where `$('attemptCompleted').textContent` is set), add a line:

```js
$('attemptTotal').textContent = String(state.sequenceLen);
```

Place it directly below the `attemptCompleted` update so both DOM updates live together.

- [ ] **Step 5: Pass `sequenceLen` to `scoreAttempt`**

Find the score-submission call (search for `scoreAttempt({`). Add the `sequenceLen` field. The call should look like:

```js
const score = scoreAttempt({
  result,
  completed: state.stepIdx,
  timeSec,
  sequenceLen: state.sequenceLen,
});
```

(Keep whatever other fields the existing call already passes — only add `sequenceLen`.)

- [ ] **Step 6: Update the static `1 / 16` placeholder in the step badge**

Find `<div class="step-badge" id="stepBadge">1 / 16</div>` (around line 293). Change the static text to `1 / ?` — it is overwritten by JS on the first recall tick anyway, but `1 / ?` reads more honestly while the calibrate phase decides the length. Edit:

```html
<div class="step-badge" id="stepBadge">1 / ?</div>
```

- [ ] **Step 7: Update the briefing copy**

Find the briefing text containing `Watch a 16-gesture sequence` (around line 244). Replace the sentence:

```
Goal: Watch a 16-gesture sequence flash by once, then unlock the vault by repeating it from memory.
```

with:

```
Goal: Watch a sequence flash by once, then unlock the vault by repeating it from memory. The length scales with your team — bigger team, longer sequence.
```

Keep the rest of the briefing paragraph (`<strong>Who performs each gesture…</strong>` etc.) exactly as it is.

- [ ] **Step 8: Run tests**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 9: Verify no stale `SEQUENCE_LEN` reads remain**

Run:
```
grep -n "SEQUENCE_LEN" ps-offsite-2026/games/1-gesture-lock.html
```
Expected: exactly one match — the import statement at the top of the script.

- [ ] **Step 10: Commit**

```bash
git add ps-offsite-2026/games/1-gesture-lock.html
git commit -m "feat(gesture-lock): thread state.sequenceLen through memorize/recall/attempt-end

Intro Start now routes to the calibrate phase. memorize pulls the
sequence at state.sequenceLen, with a defensive ??= fallback against
sequenceLengthForTeam(state.teamN) in case calibrate was bypassed.
Recall loop's step-badge and completion check use state.sequenceLen.
Attempt-end DOM gets a dynamic <span id='attemptTotal'> for the
denominator. scoreAttempt receives sequenceLen so the success-grace
math scales with the locked length.

Briefing copy + the static '1 / 16' step-badge placeholder updated to
acknowledge the dynamic length.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: `wireRestart` teardown + clear `state.teamN` / `state.sequenceLen`

Admin "play again" must re-run calibration on the next attempt 1.

**Files:**
- Modify: `ps-offsite-2026/games/1-gesture-lock.html`

- [ ] **Step 1: Update `wireRestart`**

Find `function wireRestart() { … }`. Replace its body with:

```js
function wireRestart() {
  $('finalPlayAgain').onclick = async () => {
    if (!await requireAdmin(session?.lobbyId, { promptText: 'Something went wrong? Enter admin password to restart:' })) return;
    // Tear down the camera/recognizer so the next loading phase reopens fresh
    // at TRACKER_CEILING and calibration re-runs. Defensive — phaseEnter.final
    // already does the same teardown, but wireRestart is also wired from
    // enterAlreadyPlayed where final didn't run.
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
    if (state.recognizer) { try { state.recognizer.close(); } catch {} state.recognizer = null; }
    state.teamN = null;
    state.sequenceLen = null;
    state.attempts = [];
    state.attemptIdx = 0;
    state.sequence = [];
    state.stepIdx = 0;
    goto('setup');
  };
}
```

(If the existing function used a different prompt text, keep that text — only adjust the body to perform the new teardown.)

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/games/1-gesture-lock.html
git commit -m "fix(gesture-lock): wireRestart tears down recognizer and clears calibration

Admin 'play again' now explicitly stops the camera stream and closes
the recognizer, then resets state.teamN, state.sequenceLen, attempts,
and per-attempt counters. The next phaseEnter.loading reopens a fresh
TRACKER_CEILING recognizer so calibration re-runs cleanly. Defensive
even though phaseEnter.final does the same teardown — wireRestart is
also wired from enterAlreadyPlayed where final didn't run.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: `?debug&team=N` URL flag

Solo-dev escape hatch matching dino. Skips the calibrate phase and forces `state.teamN` + `state.sequenceLen` at boot.

**Files:**
- Modify: `ps-offsite-2026/games/1-gesture-lock.html`

- [ ] **Step 1: Add the debug parsing block**

Find the `const state = { … }` declaration. Immediately below it (and above any `phaseEnter.*` declarations), add:

```js
// ?debug&team=N skips the calibrate phase and forces state.teamN /
// sequenceLen at boot. Guarded by ?debug so a stray ?team= production URL
// cannot suppress calibration. Useful for solo dev when one person cannot
// supply >2 hands during the 5 s calibrate window.
const DEBUG = new URLSearchParams(location.search).has('debug');
const DEBUG_TEAM_N = DEBUG ? (() => {
  const raw = new URLSearchParams(location.search).get('team');
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < MIN_N || n > TRACKER_CEILING) return null;
  return Math.floor(n);
})() : null;
if (DEBUG_TEAM_N !== null) {
  state.teamN = DEBUG_TEAM_N;
  state.sequenceLen = sequenceLengthForTeam(DEBUG_TEAM_N);
}
```

(If a `DEBUG` flag was already declared elsewhere in the file, do not declare it twice — adjust to reuse the existing one and add only the `DEBUG_TEAM_N` block.)

- [ ] **Step 2: Run tests**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 3: Manual smoke check**

Executor opens the page with `?debug&team=4`. Confirm:
- Clicking Start on intro goes directly to the `memorize` phase — no `SHOW ALL HANDS` banner appears.
- The memorize dots row contains 8 dots (since `sequenceLengthForTeam(4) === 8`).
- The step badge during recall reads `1 / 8`, then `2 / 8`, etc.
- Without the `team=` param, calibration runs as in Task 5.

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/games/1-gesture-lock.html
git commit -m "feat(gesture-lock): ?debug&team=N URL flag skips calibrate for solo testing

Sets state.teamN and state.sequenceLen at boot from the URL param;
phaseEnter.calibrate sees non-null teamN and immediately advances to
memorize. Recognizer stays at TRACKER_CEILING (never downsized) but
gameplay only polls the first detected hand so that is harmless.

Guarded by ?debug so a stray ?team= production URL cannot suppress
calibration.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: Full verification

**Files:**
- (none modified)

- [ ] **Step 1: Run the full test suite**

Run: `npx vitest run`
Expected: every test green. Total count grew by Task 1 additions; previous baseline was 248.

- [ ] **Step 2: Run the build**

Run: `npm run build`
Expected: build succeeds. Confirm `dist/games/1-gesture-lock.html` appears in the output and is reasonably sized (similar to the dino HTML, ~14 kB).

- [ ] **Step 3: Manual end-to-end smoke check**

Executor: open the gesture-lock game in the browser. Walk through the three attempts and the admin restart path:

1. **Attempt 1:** raise hands during the calibrate banner. Confirm the count climbs live, the HUD dots row in memorize matches the detected count × 2 (clamped to [8, 28]), the step badge during recall reads `X / <sequenceLen>`, and `console.info` fired once on lock-in.
2. **Attempt 2 ("Try Again"):** intro → calibrate → memorize. Confirm the calibrate phase is skipped (no banner, instant transition), the sequence length is the same as attempt 1, and the step badge denominator matches.
3. **Attempt 3:** same as attempt 2.
4. **Finish:** reach the final phase; confirm score submission works.
5. **Admin "Play again":** enter admin password, click Start. Confirm camera reopens, calibration runs again on attempt 1 with a potentially different detected count.
6. **Solo dev:** open `?debug&team=4` — calibrate is skipped, memorize has 8 dots, recall reaches `8 / 8`.

- [ ] **Step 4: Spec coverage reference check**

Open `docs/superpowers/specs/2026-05-28-gesture-lock-hand-calibration-design.md`. Walk through each numbered Goal and each major bullet in the "Architecture" section. Confirm every one has a corresponding behavior. If anything is missing, file a follow-up or add a small task.

- [ ] **Step 5: Final commit (none needed if everything is green)**

If Steps 1–4 all passed and no edits were made, nothing to commit. If anything was tweaked during smoke (e.g., a small comment fix or styling polish), commit:

```bash
git add -A
git commit -m "chore(gesture-lock): verification tweaks after calibration smoke check

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```
