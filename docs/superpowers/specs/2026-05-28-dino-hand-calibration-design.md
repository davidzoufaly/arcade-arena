# Dino — Per-attempt Hand-count Calibration

**Status:** design
**Date:** 2026-05-28
**Game:** Dino (3-dino)

## Problem

The dino game caps detected hands at a fixed number (currently 14 after the previous bump). Teams range from 2 to ~7 players (4–14 hands), and a fixed cap doesn't tune the experience to team size:

- Small teams (4 hands) — jump curve saturates immediately, granularity wasted.
- Large teams (14 hands) — fine, but the cap is a guess; an 8-person team is still clipped, and MediaPipe burns NMS work on hand slots the team will never fill.
- The HUD always shows 14 pips regardless of who's playing; new pips never light up for half the row in a 2-person team.

We want the game to discover team size at the start of each attempt and tune itself.

## Goals

1. Detect the number of hands a team is using during a dedicated 5-second calibrate sub-phase at the start of the **first** attempt.
2. Scale the jump-strength curve so that the team's **own** hand total equals peak jump (`vel = 20`).
3. Resize the MediaPipe tracker to a tight cap around the detected size (perf win for small teams).
4. Resize the HUD pip row to match the detected count.
5. **Reuse the calibrated value across all 3 attempts** — fair comparison between attempts; calibrate sub-phase only runs on attempt 1.

## Non-goals

- Adapting difficulty (spawn rate, scroll speed, high-obstacle probability) to team size. The existing endless ramp stays.
- Persisting team size across lobby sessions. Each visit to the game re-calibrates on attempt 1.
- Recalibrating later attempts. Once locked on attempt 1, the cap is fixed for attempts 2 and 3, even if the roster changes.
- Recalibrating mid-attempt. Once obstacles start, the cap is locked.
- Pose calibration (only hand count; jump/duck/ready gestures unchanged).

## User-visible flow

**First attempt (attempt 1):** the `play` phase runs three internal sub-phases:

```
setup → loading → intro → play
                          ├─ CALIBRATE (5s)        "SHOW ALL HANDS · 5s"
                          │   ├─ 0–2s:  team raises hands (no sampling)
                          │   ├─ 2–5s:  sample hands.length each frame
                          │   └─ tick 0: lock state.teamN = mode(samples), clamp [1, 20]
                          │              close + recreate tracker @ min(20, N+2)
                          │              rebuild HUD pips = N
                          ├─ WARMUP (10s)          "WARM UP · practice! · obstacles in 10s"
                          │   (current behavior — no sampling, no banner switch)
                          └─ LIVE                  obstacles spawn, score clock starts
                → attempt-end
```

**Subsequent attempts (attempts 2, 3):**

```
intro → play
        ├─ CALIBRATE — SKIPPED (state.teamN already locked)
        ├─ WARMUP (10s)   same as attempt 1
        └─ LIVE           obstacles, jump curve uses state.teamN
→ attempt-end
```

CALIBRATE and WARMUP both render the existing dino canvas (parallax particles + ground line + runner), so the team always sees motion. Only the banner copy and obstacle-spawning behavior differ.

## Architecture

### Constants (`ps-offsite-2026/shared/dino-logic.js`)

Replace existing `MAX_HANDS` with:

```js
export const TRACKER_CEILING  = 20;  // hard upper bound; MediaPipe-safe max
export const TRACKER_BUFFER   = 2;   // extra slots over detected N (stragglers)
export const CALIB_TOTAL_S    = 5;   // total calibration phase duration
export const CALIB_GRACE_S    = 2;   // skip the first N seconds (team raising hands)
export const FALLBACK_N       = 4;   // if calibration sees no hands at all
export const MIN_N            = 1;   // lower bound on team size
```

The sampled window is `CALIB_TOTAL_S - CALIB_GRACE_S = 3` seconds (default).

### Jump-strength curve

```js
// Slope auto-scales: teamN hands = peak jump (20). Base 6 keeps tiny-team
// jumps from feeling identical regardless of palm count.
//
// Uses ?? not || so that teamN === 0 stays 0 (then clamped up to MIN_N by
// Math.max), while teamN === null/undefined falls back to FALLBACK_N. This
// makes "teamN=0 → MIN_N" semantics correct, not collapsed into FALLBACK_N.
export function palmCountToJumpStrength(n, teamN) {
  if (n <= 0) return 0;
  const T = Math.max(MIN_N, teamN ?? FALLBACK_N);
  return Math.min(20, Math.round(6 + n * (14 / T)));
}
```

Sample curves:

| teamN | 1 palm | half team | full team |
|-------|--------|-----------|-----------|
| 2     | 13     | —         | 20        |
| 4     | 10     | 13 (2)    | 20        |
| 7     | 8      | 14 (4)    | 20        |
| 14    | 7      | 13 (7)    | 20        |
| 20    | 7      | 13 (10)   | 20        |

### Calibration helper

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

### Game loop changes (`ps-offsite-2026/games/3-dino.js`)

- **Session state:** add `state.teamN = null` alongside `state.tracker / stream / video`. Cleared only on full restart (admin "play again"), not on retry.
- **Loading phase:** open tracker with `numHands: TRACKER_CEILING` only on first session (when `state.tracker` is null). Subsequent attempts reuse whatever tracker was last set (post-calibration cap of `state.teamN + TRACKER_BUFFER`).
- **Drop `g.warming`:** the existing flag is removed in favor of `g.subPhase`. Every existing read site of `g.warming` (visibility handler, `step()`'s spawn gate, the warmup branch in `loop()`) is rewritten to read `g.subPhase`. Single source of truth.
- **`play` phase init:** add to per-attempt game state:
  ```js
  // Internal sub-phase machine inside the play canvas.
  // 'calibrate' runs only on attempt 1 (when state.teamN is null at play entry).
  // Replaces the previous `g.warming` boolean.
  g.subPhase     = (state.teamN === null) ? 'calibrate' : 'warmup';
  g.subPhaseMs   = performance.now();   // when current sub-phase started
  g.calibSamples = [];                  // populated only during 'calibrate'
  g.calibLiveMax = 0;                   // smoothed max for the banner display
  g.calibLocking = false;                // re-entrancy guard during async lock-in
  // existing fields kept: y, vy, ducking, score, obs, spawnTimer, runPhase,
  // palmWindow, lastEff, warmStartMs, startMs, particles, …
  // `g.warming` is removed.
  ```
- **Loop dispatch:** the existing `loop()` becomes a 3-way switch on `g.subPhase`. Extract `tickCalibrate(dt)`, `tickWarmup(dt)`, `tickLive(dt, elapsed)` to keep each branch readable. Particles + runner draw every frame regardless.

  - **`'calibrate'` (attempt 1 only):**
    - `step(dt, 0)` (no obstacles; runner still responds to jumps so practice feels real).
    - Maintain `g.calibLiveMax`: each frame, set `g.calibLiveMax = max over hands.length samples in the last ~20 frames` (use a small ring buffer; cheap). This is what the banner displays — smoother than the raw current frame, immediate enough that the team sees the count climb as people raise hands.
    - Push raw `hands.length` to `g.calibSamples` **only when** `(now - g.subPhaseMs) / 1000 >= CALIB_GRACE_S`. The smoothed banner value (`g.calibLiveMax`) is independent and used regardless of grace.
    - Banner: `"SHOW ALL HANDS"` + `"{g.calibLiveMax} detected · {ceil(CALIB_TOTAL_S - elapsed)}s"`.
    - When `(now - g.subPhaseMs) / 1000 >= CALIB_TOTAL_S` and `!g.calibLocking`:
      1. Set `g.calibLocking = true` (any further RAF ticks see this and become no-ops until cleared).
      2. Compute candidate: `const detected = pickCalibratedHandCount(g.calibSamples)`.
      3. **Open new tracker first** (no close-before-open):
         ```js
         const newCap = Math.min(TRACKER_CEILING, detected + TRACKER_BUFFER);
         let newTracker;
         try {
           newTracker = await createHandTracker(video, { numHands: newCap, minRunMs: 0 });
         } catch (e) {
           console.warn('Dino calibration: tracker recreate failed, keeping ceiling cap', e);
           // newTracker stays undefined; we keep the existing one untouched.
         }
         ```
      4. Re-check the cancellation guard (see "Re-entrancy & cancellation" below). If `cancelled`, immediately `newTracker?.stop()` and return.
      5. If `newTracker` was created: stop the old tracker (`state.tracker.stop()`), then `state.tracker = newTracker`. If `newTracker` is undefined: leave `state.tracker` as-is (still at ceiling cap).
      6. Commit `state.teamN = detected` (regardless of recreate outcome — the curve adapts even when the cap stays at ceiling).
      7. `palmDotsEl.innerHTML = ''`; build `state.teamN` pip elements.
      8. `g.calibSamples = []; g.calibLocking = false;`.
      9. Advance: `g.subPhase = 'warmup'; g.subPhaseMs = performance.now(); g.warmStartMs = g.subPhaseMs;`.
      10. `console.info('Dino calibration: locked teamN', state.teamN, 'cap', newCap, 'samples', g.calibSamples.length)`.
    - During the awaited recreate, the RAF loop continues to fire but the calibrate tick is a no-op while `g.calibLocking === true`. Particles + runner still render via the always-on draw path — no frozen frame.

  - **`'warmup'` (every attempt):** identical to today's warmup branch logic, except it reads `g.subPhase !== 'live'` where it used to read `g.warming`. Drives `warmupSecondsLeft` off `g.warmStartMs`. On expiry, advance `g.subPhase = 'live'; g.startMs = now; g.spawnTimer = 0;`.

  - **`'live'` (every attempt):** identical to today's live branch.

- **`step()` updates:** the obstacle-spawn gate `if (!g.warming)` becomes `if (g.subPhase === 'live')`. No other behavioral changes.
- **Jump call:** `palmCountToJumpStrength(eff, state.teamN ?? FALLBACK_N)` in both `step()` and `updatePalmHud()`. The fallback covers the calibrate phase before lock-in so the HUD's `jumpFill` still animates and practice jumps feel real.
- **Debug:** `?debug` keyboard override stays. The keydown handler reads `state.teamN ?? TRACKER_CEILING` **inside the closure** (not at bind time) so the bound shifts after calibration. For solo testing, `?debug&team=N` URL param forces `state.teamN = N` at boot and starts `play` in `subPhase: 'warmup'` (calibrate is skipped, no tracker recreate, tracker opens at `min(TRACKER_CEILING, N + TRACKER_BUFFER)` from loading).
- **Admin "play again" path** (`wireRestart`): clear `state.teamN = null` **and** tear down `state.tracker` + `state.stream` (same teardown `phaseEnter.final` does). This guarantees the next `phaseEnter.loading` reopens a fresh tracker at `TRACKER_CEILING` for the new team. Defensive even though `phaseEnter.final` does the same teardown — `wireRestart` may be invoked from `enterAlreadyPlayed` where final didn't run.
- **Visibility-change handler:** rewritten as a 3-branch switch on `g.subPhase`:
  - `'calibrate'` → pause `g.subPhaseMs` (and don't sample while hidden).
  - `'warmup'` → pause `g.warmStartMs` (today's behavior).
  - `'live'` → pause `g.startMs` (today's behavior).
  If `g.calibLocking` is true when visibility changes, ignore the event (the awaited recreate doesn't care about page visibility; it just races to completion).

### Re-entrancy & cancellation during async lock-in

The await calls in lock-in introduce two hazards the loop must guard:

1. **Re-entrant RAF firing**: the RAF chain continues during the await. The calibrate tick checks `g.calibLocking` at entry — if set, it skips the time-based threshold check and just draws. Prevents firing the lock-in twice or calling `latest()` on a tracker mid-swap.
2. **Cancellation during await**: `activeCleanup` may set `cancelled = true` while we're awaiting `createHandTracker`. After each `await`, re-check `cancelled`. If true, stop the (possibly new) tracker and bail without mutating `state.tracker` / `state.teamN`. Prevents leaking a live tracker when the user navigates away mid-calibration.

### Tracker recreation — failure mode

The new tracker is constructed **before** the old one is closed. If `createHandTracker` throws, the old tracker is never touched and stays live — the team plays with the ceiling-sized tracker. `state.teamN` still commits (the curve adapts even when the cap stays at ceiling), and a `console.warn` records the failure. Do not crash the attempt.

## Sampling design rationale

Mode over the 3-second sampled window (≈90 frames at 30 fps) is robust to:

- One or two frames where MediaPipe misses a hand (mode ignores rare values).
- The first 2 seconds being chaotic as people raise hands (`CALIB_GRACE_S` excludes them).
- A single false positive (occasionally MediaPipe returns 15+ hands when there are 12; one frame can't outvote a sustained reading).

Ties resolve toward the higher count, so "11 hands seen 30 frames, 10 hands seen 30 frames" → 11. Favors "everyone in" over a transient drop.

A dedicated 5-second calibrate phase (vs. embedding sampling in warmup) makes the social moment explicit — the team sees "SHOW ALL HANDS" and the live count, then settles into practice once the cap is locked. Practice (warmup) feels normal because tracker/HUD/jump-curve are already correct.

## Tests (`tests/dino-logic.test.js`)

Replace the existing `MAX_HANDS` test and update `palmCountToJumpStrength` tests:

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

describe('pickCalibratedHandCount', () => {
  it('empty → FALLBACK_N',         () => expect(pickCalibratedHandCount([])).toBe(4));
  it('all zeros → FALLBACK_N',     () => expect(pickCalibratedHandCount([0,0,0])).toBe(4));
  it('clear mode',                  () => expect(pickCalibratedHandCount([4,4,4,5,4])).toBe(4));
  it('tie resolves to higher',      () => expect(pickCalibratedHandCount([6,6,7,7])).toBe(7));
  it('clamps above ceiling',        () => expect(pickCalibratedHandCount([25,25,25])).toBe(20));
  // When 0 is the dominant value, treat as "no signal" → FALLBACK_N (not MIN_N).
  // This preserves the discontinuity by design: mostly-zeros means MediaPipe
  // wasn't seeing hands, so trusting FALLBACK is safer than locking at 1.
  it('zero-dominant → FALLBACK_N',  () => expect(pickCalibratedHandCount([0,0,1])).toBe(4));
  it('ignores transient spike (noise)', () => expect(pickCalibratedHandCount([10,10,10,10,15,10])).toBe(10));
  it('ignores drop-out (noise)',         () => expect(pickCalibratedHandCount([8,8,7,8,8,7,8,8,8,7])).toBe(8));
  it('uniform low signal',                () => expect(pickCalibratedHandCount([1,1,1])).toBe(1));
});
```

Test changes affecting other suites: none. Vision helpers, score-submit, lobby, etc. don't import `MAX_HANDS`.

Integration coverage (out of vitest scope; Playwright smoke covers it):

- Attempt 1 calibrates → attempt 2 reuses (HUD pip count and tracker cap stable across `intro → play` re-entry).
- Admin "play again" → calibration re-runs on next attempt 1 (HUD pips reset to ceiling at boot, locked to a new value at calibrate end).
- `?debug&team=6` → calibrate skipped, warmup runs immediately, HUD shows 6 pips from the start.

## File scope

- `ps-offsite-2026/shared/dino-logic.js` — replace `MAX_HANDS` with new constants, update `palmCountToJumpStrength`, add `pickCalibratedHandCount`.
- `ps-offsite-2026/games/3-dino.js`:
  - Drop `g.warming`; introduce `g.subPhase` machine + `g.subPhaseMs / g.calibSamples / g.calibLiveMax / g.calibLocking`.
  - Extract `tickCalibrate / tickWarmup / tickLive` from the existing `loop()`.
  - Add lock-in path (open-new-before-close-old) + re-entrancy and cancellation guards.
  - Update `step()`, visibility handler, jump-call sites to consume `g.subPhase` / `state.teamN`.
  - Pre-build pip row at `TRACKER_CEILING` placeholder (rebuilt at lock-in to `state.teamN`).
  - Debug key handler reads bound inside closure (not at bind time).
  - `wireRestart` also tears down `state.tracker` + `state.stream` + clears `state.teamN`.
  - Optional URL flag `?debug&team=N` skips calibrate, opens tracker at `min(20, N+2)` at boot.
- `tests/dino-logic.test.js` — updated `palmCountToJumpStrength` tables, new `pickCalibratedHandCount` block, removed `MAX_HANDS` test.
- `ps-offsite-2026/games/3-dino.html` — no change.

## Risks & mitigations

- **Tracker recreate latency (~100ms detection gap):** happens at calibrate → warmup transition. No obstacles, no score, runner stays put. Acceptable.
- **Tracker recreate failure:** new tracker is constructed first; on failure the old tracker is untouched. `state.teamN` still locks, curve adapts, tracker stays at ceiling. Attempt continues.
- **Cancellation during await (user navigates away mid-calibration):** post-`await` re-check of `cancelled` stops the new tracker and bails without mutating shared state. No leak.
- **Re-entrant RAF tick during lock-in:** `g.calibLocking` guard makes calibrate-branch ticks no-op while the async swap is in flight. Particles + runner still render via the always-on draw path.
- **Camera stream interruption during recreate:** `state.video` / `state.stream` are preserved; only the tracker wrapper is recreated. Camera permission / stream untouched.
- **Wrong calibration (e.g., 5 hands when team is 6):** worst case one palm is invisible to the curve. Calibration is one-shot for the session — team is stuck with it for all 3 attempts. Admin "play again" is the escape hatch; it tears down the tracker and re-runs calibration.
- **Tracker leak across "play again":** `wireRestart` explicitly clears `state.tracker` / `state.stream` / `state.teamN`. Defensive even though `phaseEnter.final` already does the same teardown, since `wireRestart` is also wired from `enterAlreadyPlayed`.
- **Single user / debug:** `?debug` URL keeps working; key 0–9 + shift 0–4 still clamp to `state.teamN ?? TRACKER_CEILING` (read inside the handler closure, not at bind time, so the bound shifts after calibration). `?debug&team=N` skips the calibrate sub-phase, opens tracker at the right cap from boot, and forces `state.teamN = N`.

## Out of scope / follow-ups

- Persisting `teamN` across attempts (could save one calibration per attempt 2/3 if team size stable).
- Showing post-calibration confirmation toast ("✓ 8 hands detected, jump curve calibrated").
- Auto-recalibration if MediaPipe consistently sees fewer hands than `teamN` for >5s (drop-out detection).
