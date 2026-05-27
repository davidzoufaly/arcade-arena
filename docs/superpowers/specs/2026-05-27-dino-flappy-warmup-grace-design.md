# Dino + Flappy: 10s warmup grace period

**Date:** 2026-05-27
**Status:** Approved design
**Scope:** `3-dino` and `4-flappy` games only.

## Problem

Both games throw an obstacle at the player on the very first frame (`spawnTimer`
starts at 0). The control schemes are unusual — dino jumps on open-palm count
from the webcam, flappy thrusts on voice amplitude — so players crash before
they have learned the control. They need a brief, safe window to practice the
input before obstacles threaten them.

## Goal

Give each attempt a 10-second warmup at the start where controls are fully live
but no obstacles appear, so players learn the input. The warmup is free: it does
not count toward the on-screen timer, the 60-second attempt cap, or the
time-bonus scoring.

## Decisions

- **Warmup UX:** on-canvas countdown banner. World/controls are live; the player
  can jump (dino) / thrust (flappy) freely. Banner reads `WARM UP · practice!`
  with `obstacles in N` counting down. The timer label shows `WARM UP`.
- **Clock:** separate. The scored clock, the 60s cap, and the time-bonus all
  start when obstacles begin. Nobody is penalized for practicing.
- **Structure:** approach A — one shared, tested helper module. The warmup
  behavior is identical across both games, so it lives in one place rather than
  being duplicated per game.

## New module: `ps-offsite-2026/shared/warmup-logic.js`

```js
export const WARMUP_S = 10;

// Whole seconds of warmup left, for the countdown banner. Clamped to
// [0, WARMUP_S]. 0s elapsed → 10, 9.9s → 1, ≥10s → 0 (triggers transition).
export const warmupSecondsLeft = (elapsedSec) =>
  Math.max(0, Math.min(WARMUP_S, Math.ceil(WARMUP_S - elapsedSec)));
```

Both game pages import `WARMUP_S` and `warmupSecondsLeft`.

## In-game state machine

Warmup is a sub-state **inside the existing `play` phase**, drawn on the game
canvas. It is NOT a new entry in the `PHASES` array (those drive full-screen
show/hide; warmup stays on the play canvas).

Game object gains:

- `warming: true`
- `warmStartMs: performance.now()`

`startMs` is left **unset** (sentinel) until warmup ends — this is what makes the
scored clock exclude the warmup.

### Loop branch (both games)

Reuse the loop's existing per-frame `now` (`const now = performance.now()`, already
computed once per frame); do NOT call `performance.now()` again for warmup.
`warmElapsed = (now - g.warmStartMs) / 1000`.

**While warming, per frame, in this order:**
1. Read input + update HUD + run vertical physics (dino jump / flappy thrust +
   gravity + edge clamp) + idle animation (dino leg swing / flappy orb).
2. Keep the FPS-drop check — we draw every frame, so surfacing lag during practice
   is useful and keeps both games' loops symmetric.
3. **Check the transition first** (below). If transitioning, return without drawing
   the banner this frame — so `obstacles in 0` is never rendered.
4. Otherwise draw the scene + the countdown banner, centered on canvas, using
   `warmupSecondsLeft(warmElapsed)`. Timer label = `WARM UP`.

Gate OFF while warming: obstacle/pipe spawn; dino `meters` advance; scored-clock
display; the 60s cap check.

The banner copy (`WARM UP · practice!`, `obstacles in N`) is drawn per-game (each on
its own canvas with its own styling); the shared module owns only the timing. The
two strings are kept in sync by hand — acceptable at two call sites.

**Transition** when `warmupSecondsLeft(warmElapsed) <= 0`:
- `g.warming = false`
- `g.startMs = now`
- `g.spawnTimer = 0` → first obstacle spawns on the next live frame
- timer ticks from `0.0`

**Live:** existing logic, unchanged.

### Pause / tab-hidden during warmup (visibilitychange) — load-bearing

Both games already pause their clock across a hidden tab by adding the hidden delta
to `startMs` on resume. Leaving `startMs` unset during warmup **and** introducing a
new `warmStartMs` origin interacts with these handlers and MUST be handled:

- **Dino `onVis` would corrupt `startMs` to `NaN`.** Its resume branch runs
  `g.startMs += performance.now() - hiddenAt` **unconditionally**. During warmup
  `startMs` is unset → `undefined += n` → `g.startMs = NaN`, which poisons the timer
  label and makes the cap check `NaN > 60` false forever. (Flappy's handler is
  already guarded with `else if (g.startMs)`, so it does not NaN.) Fix: branch on
  warmup — when `g.warming`, add the delta to `g.warmStartMs`; touch `g.startMs`
  only when `!g.warming`.
- **Warmup itself must pause too (both games).** Neither handler currently adjusts
  `warmStartMs`, so hiding the tab mid-warmup makes `warmElapsed` jump on resume and
  the warmup ends early — defeating the safe practice window. Fix: on resume,
  `if (g.warming) g.warmStartMs += delta;` in both handlers. For flappy, sequence the
  branches: `calibrating` → adjust `calibStart`; else `warming` → adjust
  `warmStartMs`; else → adjust `startMs`.

## Implementation notes (minimal guards, not a rewrite)

### Dino — `ps-offsite-2026/games/3-dino.js`
- In `step()`: wrap the spawn block (`g.spawnTimer -= dt; if (g.spawnTimer <= 0) {…}`)
  and the `g.meters += …` advance in `if (!g.warming) { … }`. The obstacle-move
  and collision loops are no-ops while `g.obs` is empty, so they need no guard.
  Jump physics run unconditionally.
- In `loop()`: branch on `g.warming` — warmup path draws banner + sets timer
  label to `WARM UP` and skips the cap check; live path is today's code.
- `g` initializer: add `warming: true, warmStartMs: performance.now()`; remove the
  eager `startMs: performance.now()` (set it at transition instead).

### Flappy — `ps-offsite-2026/games/4-flappy.js`
- Warmup runs **after** the 1.5s calibration (thrust practice needs the measured
  noise floor). At calibration end (where it currently sets `g.startMs = now` and
  hides `calibOverlay`), instead set `g.warming = true; g.warmStartMs = now;`, keep
  hiding `calibOverlay`, and leave `startMs` unset.
- In `step()`: wrap the pipe-spawn block in `if (!g.warming) { … }`. Thrust +
  gravity + edge clamp run unconditionally.
- In `loop()`: add a warmup branch after the existing calibration branch (which
  early-returns each frame). It mirrors dino — runs the FPS check, draws the scene +
  the warmup banner as a normal on-canvas draw (NOT a reuse of the `calibOverlay`
  HTML element, which stays hidden), and gates spawn/clock/cap.

### Clock guard
The separate clock falls out for free: `timeSec` and the cap already derive from
`startMs`, so setting it at live-start auto-excludes warmup. One fix needed:

- **Dino:** if the player aborts, the camera disconnects, or the attempt otherwise
  ends **during warmup**, `startMs` is unset. Guard `endAttempt`'s timeSec:
  `const timeSec = g.startMs ? (performance.now() - g.startMs) / 1000 : 0;` (flappy
  already guards its `endAttempt` timeSec the same way). Every warmup exit —
  `playAbort`, camera `ended` — routes through the single `endAttempt`, so this one
  guard covers them all; do not add redundant guards at the call sites. Such an
  attempt scores 0 (`completed: 0`), which is correct.

## Difficulty curve unchanged

Freezing `meters` (dino) and leaving `score` at 0 (flappy) during warmup means
the post-warmup spawn cadence and speed are identical to today — the existing
difficulty ramp is simply delayed by 10 seconds, not altered.

## Testing

- **New `tests/warmup-logic.test.js`** (vitest, mirrors existing logic tests):
  - `WARMUP_S === 10`
  - `warmupSecondsLeft(0) === 10`
  - `warmupSecondsLeft(9.1) === 1`
  - `warmupSecondsLeft(9.9) === 1`
  - `warmupSecondsLeft(10) === 0`
  - `warmupSecondsLeft(11) === 0`
  - `warmupSecondsLeft(-1) === 10` (clamp / never exceeds WARMUP_S)
  - `warmupSecondsLeft(9.999) === 1` and `warmupSecondsLeft(10.000001) === 0`
    (locks the transition boundary the loop depends on)
- **Loop + banner behavior:** manual + playwright verification, consistent with
  the existing approach (in-game spawn logic is not unit-tested today).
  Use `?debug` on dino to force palm counts.

## Out of scope

- Other games (the warmup concept is dino/flappy-specific: both have a learned,
  unusual control and instant-death obstacles).
- Configurable warmup length, skip-warmup button, or per-attempt warmup tuning.
