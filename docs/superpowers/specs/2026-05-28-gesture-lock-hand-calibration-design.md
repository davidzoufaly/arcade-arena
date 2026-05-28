# Gesture-lock — Per-team Sequence Length via Hand Calibration

**Status:** design
**Date:** 2026-05-28
**Game:** Gesture-lock (1-gesture-lock)

## Problem

`gesture-lock` currently uses a fixed `SEQUENCE_LEN = 16`. Teams range from 2 to 7 players (4–14 hands), and the difficulty doesn't track that range:

- 2-player teams (4 hands) memorise the same 16-gesture sequence as a 7-player team (14 hands). Smaller teams get hammered; larger teams cruise.
- Score formula `100 - 2 * (time - 10)` assumes the 16-gesture pacing — if the length ever changed, the time-grace would no longer make sense.

Dino now calibrates hand count at the start of attempt 1 and reuses the value for all three attempts. We want the same pattern in gesture-lock, with the calibrated team size driving the sequence length.

## Goals

1. Detect team size during a dedicated 5-second calibrate phase at the start of the **first** attempt.
2. Set `state.sequenceLen` from `teamN`: `len = clamp(N * 2, 8, 28)`.
3. Reuse `state.sequenceLen` for all 3 attempts.
4. Admin "play again" tears down state and re-calibrates.
5. Success-score time-grace scales with `len` so per-gesture pace stays comparable across team sizes.
6. Share calibration primitives (`pickCalibratedHandCount`, the `TRACKER_*` / `CALIB_*` / `MIN_N` / `FALLBACK_N` constants) with the dino implementation by importing from `dino-logic.js` — no duplication.

## Non-goals

- Splitting the sequence into per-player sections. The sequence stays one ordered list; the team self-distributes who performs each gesture (existing behavior).
- Adapting the gesture pool, per-gesture timer, or `numHands` during play. Play remains single-hand (`numHands: 1`).
- Persisting `state.sequenceLen` across lobby sessions. Each visit re-calibrates on attempt 1.
- Moving the shared calibration constants out of `dino-logic.js`. Cross-import is acceptable until a third game needs them.

## User-visible flow

**First attempt (attempt 1):**

```
setup → loading (recognizer @ TRACKER_CEILING=20)
      → intro
      → calibrate (5s)        "SHOW ALL HANDS · 5s"
          ├─ 0–2s grace      live smoothed count visible, no sampling
          ├─ 2–5s sample     hands.length pushed each frame
          └─ tick 0          lock state.teamN = mode(samples), clamp [1, 20]
                             state.sequenceLen = clamp(teamN * 2, 8, 28)
                             open new recognizer @ numHands=1, swap
      → memorize → countdown → recall → result
```

**Subsequent attempts (attempts 2, 3):**

```
intro → calibrate (skipped — state.teamN already locked)
      → memorize → countdown → recall → result
```

The `calibrate` phase still routes through `phaseEnter.calibrate`, which immediately calls `goto('memorize')` when `state.teamN !== null`. No banner, no delay.

## Architecture

### Shared logic (`ps-offsite-2026/shared/gesture-lock-logic.js`)

Import the calibration primitives from `dino-logic.js`:

```js
import { TRACKER_CEILING, MIN_N, FALLBACK_N } from './dino-logic.js';
```

Add three constants and three pure helpers:

```js
// Backstop bounds: a solo player should still see a real sequence; a 7-player
// team should not be punished with 30+ gestures inside the 5-minute attempt.
export const SEQUENCE_LEN_MIN = 8;
export const SEQUENCE_LEN_MAX = 28;

// Free seconds per gesture before the success-score timer penalty kicks in.
// Tuned to 0.625 so that the old hard-coded default of 16 gestures lands on
// exactly 10 s of grace — matching the previous baseline and keeping the
// existing scoreAttempt tests passing without modification.
export const TIME_GRACE_PER_GESTURE = 0.625;

// Two gestures per detected hand, bounded.
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
```

Rewrite the existing `scoreAttempt` to delegate, with a back-compat default so any caller that hasn't been updated yet still works against the legacy 16-gesture assumption:

```js
export function scoreAttempt({ result, completed, timeSec, sequenceLen = SEQUENCE_LEN }) {
  if (result === 'success') return successScore(timeSec, sequenceLen);
  return failScore(completed, sequenceLen);
}
```

`SEQUENCE_LEN = 16` stays exported. It is no longer the play-time source of truth — game code reads `state.sequenceLen` — but it serves as the default for the scoring back-compat path and remains the single number the legacy test suite asserts.

### Sample curves

| teamN | sequenceLen | grace (s) | 40-pt floor time (s) |
|-------|-------------|-----------|----------------------|
| 1     | 8 (clamped) | 5.0       | 35.0                 |
| 2     | 8 (clamped) | 5.0       | 35.0                 |
| 4     | 8           | 5.0       | 35.0                 |
| 5     | 10          | 6.25      | 36.25                |
| 7     | 14          | 8.75      | 38.75                |
| 8     | 16          | 10.0      | 40.0 (today's baseline) |
| 10    | 20          | 12.5      | 42.5                 |
| 14    | 28 (clamped) | 17.5     | 47.5                 |

### Game code changes (`ps-offsite-2026/games/1-gesture-lock.html`)

The game logic is inline in the HTML's `<script type="module">` block. All edits below land there.

**Extract MediaPipe URL constants.** Promote the two inline strings in `phaseEnter.loading` to module-level constants so `phaseEnter.calibrate` can reuse them without copy-paste drift:

```js
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
const GESTURE_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task';
```

Update the existing `phaseEnter.loading` body to use these instead of the inline literals.

**Imports.** Add the new helpers from `gesture-lock-logic.js`:

```js
import {
  GESTURE_POOL,
  SEQUENCE_LEN,
  sequenceLengthForTeam, successScore, failScore,
  pickSequenceWithRepeats, scoreAttempt, finalScore,
} from '../shared/gesture-lock-logic.js';
import { TRACKER_CEILING, CALIB_TOTAL_S, CALIB_GRACE_S, FALLBACK_N } from '../shared/dino-logic.js';
import { pickCalibratedHandCount } from '../shared/dino-logic.js';
```

(`pickCalibratedHandCount` could be merged into the same import line if you prefer; split here for readability.)

**Session state.** Add to the existing `state = {…}` object:

```js
teamN: null,         // locked by calibrate sub-phase on attempt 1
sequenceLen: null,   // derived from teamN; falls back at intro time
```

**Phase list.** Update the `PHASES` array to include `'calibrate'` between `'intro'` and `'memorize'`.

**HTML — new calibrate section.** Add a hidden phase section that mirrors the structure of `phase-intro`. Required element IDs (referenced from `phaseEnter.calibrate`):

```html
<section id="phase-calibrate" class="phase hidden">
  <video id="calibVideo" autoplay playsinline muted></video>
  <div class="calib-banner">
    <h1>SHOW ALL HANDS</h1>
    <p><span id="calibCount">0</span> detected · <span id="calibTimer">5</span>s</p>
  </div>
</section>
```

Style with existing tokens (`.phase`, `.hidden`); the `.calib-banner` class can be added with minimal CSS in the existing `<style>` block — match the typography of `phase-intro`.

**Loading.** Change recognizer creation to multi-hand:

```js
state.recognizer = await GestureRecognizer.createFromOptions(vision, {
  baseOptions: { modelAssetPath: '…/gesture_recognizer.task', delegate: 'GPU' },
  runningMode: 'VIDEO',
  numHands: TRACKER_CEILING,
});
```

**Intro.** Route `introStartBtn` to the new `calibrate` phase:

```js
$('introStartBtn').onclick = () => goto('calibrate');
```

**Calibrate phase.** New `phaseEnter.calibrate` runs as follows:

```js
phaseEnter.calibrate = () => {
  // Attempts 2/3 reuse the locked teamN — skip immediately.
  if (state.teamN !== null) { goto('memorize'); return; }

  const video = $('calibVideo');
  video.srcObject = state.stream;
  // Required: GestureRecognizer.recognizeForVideo(video, ts) reads from
  // video.currentTime. Without an explicit play() the element stays at
  // currentTime=0 and MediaPipe gets the same frozen frame every tick.
  video.play().catch(() => {});

  const g = {
    startedMs: performance.now(),
    samples: [],          // hands.length per frame, after grace
    liveBuf: [],          // last ~20 frames for smoothed banner count
    liveMax: 0,
    locking: false,
  };

  let cancelled = false;
  let rafId = null;

  async function lockIn() {
    g.locking = true;
    const detected = pickCalibratedHandCount(g.samples);
    const newCap = 1;     // gesture-lock plays single-hand

    // Reuses the same FilesetResolver + model URLs as phaseEnter.loading.
    // Extract them into module-level constants (e.g. WASM_URL,
    // GESTURE_MODEL_URL) during implementation so both call sites use the
    // same strings — currently they are inline literals in `loading`.
    let newRecognizer = null;
    try {
      const vision = await FilesetResolver.forVisionTasks(WASM_URL);
      newRecognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: { modelAssetPath: GESTURE_MODEL_URL, delegate: 'GPU' },
        runningMode: 'VIDEO',
        numHands: newCap,
      });
    } catch (e) {
      console.warn('Gesture-lock calibration: recognizer recreate failed, keeping multi-hand recognizer', e);
    }

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

    // Read landmark count from the recognizer (works the same way as
    // HandLandmarker's latest()). MediaPipe gesture recognizer returns one
    // landmark array per detected hand on each frame.
    const result = state.recognizer.recognizeForVideo(video, now);
    const handsNow = result.landmarks?.length ?? 0;

    g.liveBuf.push(handsNow);
    if (g.liveBuf.length > 20) g.liveBuf.shift();
    g.liveMax = g.liveBuf.reduce((m, v) => v > m ? v : m, 0);

    if (elapsed >= CALIB_GRACE_S && !g.locking) g.samples.push(handsNow);

    drawCalibBanner(
      Math.max(0, Math.ceil(CALIB_TOTAL_S - elapsed)),
      g.liveMax,
    );

    if (elapsed >= CALIB_TOTAL_S && !g.locking) {
      // Fire-and-forget. The RAF chain stops here; lockIn() resolves and
      // calls goto('memorize'). During the ~100ms recreate, the calibrate
      // banner shows the last-rendered count + 0s and stays static. That is
      // acceptable since no obstacles/gameplay are in flight.
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

`drawCalibBanner(secondsLeft, detectedCount)` is a new small helper that updates the calibrate-phase DOM (e.g., `$('calibCount').textContent = detectedCount; $('calibTimer').textContent = secondsLeft;`). No canvas — straight DOM updates.

**Memorize / countdown / recall.** Replace every `SEQUENCE_LEN` reference in `phaseEnter.memorize`, the countdown phase, and the recall loop with `state.sequenceLen`. Specifically:
- Top of `phaseEnter.memorize`, defensive: `state.sequenceLen ??= sequenceLengthForTeam(state.teamN)` so a bypassed-calibrate path still produces a non-null length.
- `state.sequence = pickSequenceWithRepeats(GESTURE_POOL, state.sequenceLen)`
- `$('stepBadge').textContent = ${Math.min(state.stepIdx + 1, state.sequenceLen)} / ${state.sequenceLen}`
- The `memorizeDots` row builds `state.sequenceLen` dots, not 16.
- The recall completion check fires when `state.stepIdx >= state.sequenceLen`.

**Attempt-end DOM.** Find the existing markup:

```html
Completed <strong id="attemptCompleted">0</strong> / 16
```

Replace the literal `16` with a dynamic span:

```html
Completed <strong id="attemptCompleted">0</strong> / <span id="attemptTotal">16</span>
```

In `phaseEnter['attempt-end']`, set `$('attemptTotal').textContent = state.sequenceLen` alongside the existing `attemptCompleted` update.

**Score submit.** Pass `sequenceLen: state.sequenceLen` to `scoreAttempt`:

```js
const score = scoreAttempt({ result, completed: state.stepIdx, timeSec, sequenceLen: state.sequenceLen });
```

**Visibility handler.** The existing pause logic targets `state.recallStartMs` / `state.stepStartMs`, which aren't live during calibrate. The calibrate timer (`g.startedMs`, a closure-local) is not paused — so a tab-switch mid-calibrate fast-forwards `elapsed`. In a live offsite setting this is low-probability (players are watching the camera, not tabbing away), and the worst case is that lock-in fires immediately on tab return with samples it already collected. Acceptable trade-off; not worth piping `g.startedMs` through the global handler. **Note this risk explicitly in code comments at the `g.startedMs` declaration.**

**Admin "play again" / `wireRestart`.** Mirror the dino teardown and preserve the existing resets so per-attempt state doesn't leak across the restart:

```js
function wireRestart() {
  $('finalPlayAgain').onclick = async () => {
    if (!await requireAdmin(...)) return;
    if (state.stream) { state.stream.getTracks().forEach(t => t.stop()); state.stream = null; }
    if (state.recognizer) { try { state.recognizer.close(); } catch {} state.recognizer = null; }
    state.teamN = null;
    state.sequenceLen = null;
    state.attempts = [];
    state.attemptIdx = 0;
    state.sequence = [];   // preserved from old wireRestart
    state.stepIdx = 0;     // preserved from old wireRestart
    goto('setup');
  };
}
```

**`?debug&team=N` URL flag.** Mirror dino's escape hatch for solo dev. At module top (after the `state` declaration), add:

```js
// ?debug&team=N skips the calibrate phase and forces state.teamN / sequenceLen
// at boot. Guarded by ?debug so a stray ?team= production URL cannot suppress
// calibration. Useful for solo dev when one person can't supply >2 hands.
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

Add `MIN_N` to the existing `dino-logic.js` import list. With `state.teamN` non-null at boot, `phaseEnter.calibrate` immediately calls `goto('memorize')` — calibrate is effectively skipped. The initial recognizer (opened in `phaseEnter.loading`) stays at `TRACKER_CEILING` until calibrate would have recreated it; with calibrate skipped, the recognizer is never downsized. That's fine — multi-hand recognition still works, the game just polls one hand per frame.

**Briefing copy.** The setup-screen briefing mentions "16-gesture sequence". Change to "a sequence" or "a sequence that scales to your team". Existing copy:

```
Goal: Watch a 16-gesture sequence flash by once, then unlock the vault by repeating it from memory.
```

becomes:

```
Goal: Watch a sequence flash by once, then unlock the vault by repeating it from memory. The length scales with your team — bigger team, longer sequence.
```

### Tests (`tests/gesture-lock-logic.test.js`)

Add a new test file (or extend the existing one if present — check `tests/` first). Cover the three new pure helpers:

```js
import {
  SEQUENCE_LEN, SEQUENCE_LEN_MIN, SEQUENCE_LEN_MAX, TIME_GRACE_PER_GESTURE,
  sequenceLengthForTeam, successScore, failScore, scoreAttempt,
} from '../ps-offsite-2026/shared/gesture-lock-logic.js';

describe('sequenceLengthForTeam', () => {
  it('teamN nullish → FALLBACK_N (4) → clamped to MIN (8)', () => {
    expect(sequenceLengthForTeam(null)).toBe(8);
    expect(sequenceLengthForTeam(undefined)).toBe(8);
  });
  it('teamN=0 → MIN_N (1) → clamped to MIN (8)', () => expect(sequenceLengthForTeam(0)).toBe(8));
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
  it('inside grace → 100', () => expect(successScore(0, 16)).toBe(100));
  it('at grace edge (10 s for len=16) → 100',           () => expect(successScore(10.0, 16)).toBe(100));
  it('5 s past grace → 100 - 10 = 90',                   () => expect(successScore(15.0, 16)).toBe(90));
  it('30 s past grace → 100 - 60 → floored to 40',       () => expect(successScore(40.0, 16)).toBe(40));
  it('len=8 floors earlier (grace 5 s) at 35 s',         () => expect(successScore(35.0, 8)).toBe(40));
  it('len=28 floors later (grace 17.5 s) at 47.5 s',     () => expect(successScore(47.5, 28)).toBe(40));
  it('len=8 inside grace at 4 s → 100',                  () => expect(successScore(4.0, 8)).toBe(100));
  it('len=8 at 7 s (2 s past grace) → 96',               () => expect(successScore(7.0, 8)).toBe(96));
});

describe('failScore', () => {
  it('len=16, completed=8 → floor(50% * 35) = 17',  () => expect(failScore(8, 16)).toBe(17));
  it('len=28, completed=8 → floor(28.6% * 35) = 10', () => expect(failScore(8, 28)).toBe(10));
  it('len=16, completed=0 → 0', () => expect(failScore(0, 16)).toBe(0));
});

describe('scoreAttempt (back-compat default sequenceLen = SEQUENCE_LEN = 16)', () => {
  it('success, no sequenceLen passed → uses 16 → grace 10 s exactly', () =>
    expect(scoreAttempt({ result: 'success', timeSec: 10, completed: 16 })).toBe(100));
  it('success past grace, no sequenceLen → matches old 2pt/s penalty', () =>
    expect(scoreAttempt({ result: 'success', timeSec: 20, completed: 16 })).toBe(80));
  it('fail, no sequenceLen passed → uses 16', () =>
    expect(scoreAttempt({ result: 'fail', completed: 8 })).toBe(17));
  it('success with explicit sequenceLen=8 → grace 5 s', () =>
    expect(scoreAttempt({ result: 'success', timeSec: 5, completed: 8, sequenceLen: 8 })).toBe(100));
  it('success with explicit sequenceLen=8, 3 s past grace → 94', () =>
    expect(scoreAttempt({ result: 'success', timeSec: 8, completed: 8, sequenceLen: 8 })).toBe(94));
  it('success with explicit sequenceLen=28 → grace 17.5 s', () =>
    expect(scoreAttempt({ result: 'success', timeSec: 17.5, completed: 28, sequenceLen: 28 })).toBe(100));
});
```

Any existing tests that assert the old `scoreAttempt({ result, completed, timeSec })` shape continue to pass via the back-compat default.

## Risks & mitigations

- **Recognizer recreate latency (~100ms)** at calibrate → memorize transition. No timer running, no animation in flight — acceptable.
- **Recognizer recreate failure.** The new recognizer is constructed before the old one is closed; on failure the multi-hand recognizer keeps running. Play still works (MediaPipe returns up to `numHands` results; the game polls the first one, so multi-hand recognition just costs more NMS).
- **Re-entrancy during the awaited recreate.** `g.locking` flag guards the calibrate tick from re-firing the lock-in. After each `await`, re-check `cancelled` and bail cleanly.
- **All-zero / no-signal calibration.** `pickCalibratedHandCount` returns `FALLBACK_N = 4`, so `sequenceLen = 8`. The team plays an 8-gesture sequence — short, doable, not a softlock.
- **Cross-team score comparison.** Per-gesture grace scales linearly with `len`, so the floor-to-40 time grows proportionally. A 14-hand team reaching 100 in 5 s feels the same as a 4-hand team reaching 100 in 5 s. Documented; acceptable.
- **`SEQUENCE_LEN` constant kept for back-compat.** Tests that import it still pass; game code no longer reads it at play time. Mark with a `@deprecated` JSDoc tag so future readers know not to use it for new code.
- **Cross-import from `dino-logic.js`.** Logical coupling between two game modules. Acceptable for two consumers; if a third game adds calibration, extract to `shared/calibration-logic.js` in a follow-up.

## Out of scope / follow-ups

- Extracting `pickCalibratedHandCount` and the calibration constants into a dedicated `shared/calibration-logic.js`. Defer until a third game needs them.
- Persisting `teamN` across the whole lobby session (so dino and gesture-lock both see the same calibration). Currently each game calibrates independently — fine, fast, no cross-game state needed.
- Sequence-length-aware difficulty ramps (faster reveal during memorize for shorter sequences, etc.). Out of scope for this change.
- UI showing the detected team size after lock-in (a brief "Team of N detected · 16 gestures coming up" overlay before memorize). Cosmetic, can be added later.
