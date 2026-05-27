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

**While warming:**
- Run input read + HUD update + vertical physics (dino jump / flappy thrust +
  gravity + edge clamp) + idle animation (dino leg swing / flappy orb).
- Gate OFF: obstacle/pipe spawn; dino `meters` advance; scored-clock display;
  60s cap check.
- Timer label = `WARM UP`.
- Draw the countdown banner centered on canvas using `warmupSecondsLeft(warmElapsed)`,
  where `warmElapsed = (now - g.warmStartMs) / 1000`.

**Transition** when `warmupSecondsLeft(warmElapsed) <= 0`:
- `g.warming = false`
- `g.startMs = now`
- `g.spawnTimer = 0` → first obstacle spawns on the next live frame
- timer ticks from `0.0`

**Live:** existing logic, unchanged.

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
  noise floor). At calibration end, instead of `g.startMs = now`, set
  `g.warming = true; g.warmStartMs = now;` and leave `startMs` unset.
- In `step()`: wrap the pipe-spawn block in `if (!g.warming) { … }`. Thrust +
  gravity + edge clamp run unconditionally.
- In `loop()`: add a warmup branch after the existing calibration branch, mirroring
  dino.

### Clock guard
The separate clock falls out for free: `timeSec` and the cap already derive from
`startMs`, so setting it at live-start auto-excludes warmup. One fix needed:

- **Dino:** if the player aborts / camera disconnects **during warmup**, `startMs`
  is unset. Guard `endAttempt`: `const timeSec = g.startMs ? (performance.now() - g.startMs) / 1000 : 0;`
  (flappy already guards this at line 132). Such an attempt scores 0
  (`completed: 0`), which is correct.

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
- **Loop + banner behavior:** manual + playwright verification, consistent with
  the existing approach (in-game spawn logic is not unit-tested today).
  Use `?debug` on dino to force palm counts.

## Out of scope

- Other games (the warmup concept is dino/flappy-specific: both have a learned,
  unusual control and instant-death obstacles).
- Configurable warmup length, skip-warmup button, or per-attempt warmup tuning.
