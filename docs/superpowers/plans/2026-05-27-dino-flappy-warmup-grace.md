# Dino + Flappy 10s Warmup Grace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give dino + flappy a 10-second obstacle-free warmup at the start of each attempt so players learn the control before anything can kill them.

**Architecture:** One shared, unit-tested timing helper (`warmup-logic.js`) owns the countdown math. Each game adds a `warming` sub-state inside its existing `play` loop: input + physics run, obstacle spawn + scored clock + 60s cap are gated off until warmup ends. The scored clock (`startMs`) is left unset during warmup, which auto-excludes warmup from score/cap; the visibilitychange handlers are updated so an unset `startMs` and the new `warmStartMs` pause correctly when the tab is hidden.

**Tech Stack:** Vanilla ES modules, canvas 2D, Vitest. No new deps.

**Spec:** `docs/superpowers/specs/2026-05-27-dino-flappy-warmup-grace-design.md`

---

## File Structure

- **Create** `ps-offsite-2026/shared/warmup-logic.js` — exports `WARMUP_S` + `warmupSecondsLeft(elapsedSec)`. Pure, no DOM. Single responsibility: warmup countdown math.
- **Create** `tests/warmup-logic.test.js` — Vitest unit tests for the helper.
- **Modify** `ps-offsite-2026/games/3-dino.js` — warmup sub-state in `play`: init fields, `onVis` fix, `step()` spawn/meters gate, `endAttempt` timeSec guard, `loop()` warmup branch, `drawWarmupBanner()` helper, import.
- **Modify** `ps-offsite-2026/games/4-flappy.js` — same, with warmup entered at calibration end.

The game-loop edits are not unit-tested (the existing in-game spawn/loop logic has no unit tests; only the pure `*-logic.js` modules do). They are verified by running the app.

---

## Task 1: Shared warmup-logic module (TDD)

**Files:**
- Create: `ps-offsite-2026/shared/warmup-logic.js`
- Test: `tests/warmup-logic.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/warmup-logic.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { WARMUP_S, warmupSecondsLeft } from '../ps-offsite-2026/shared/warmup-logic.js';

describe('WARMUP_S', () => {
  it('is 10', () => expect(WARMUP_S).toBe(10));
});

describe('warmupSecondsLeft', () => {
  it('0s elapsed → 10', () => expect(warmupSecondsLeft(0)).toBe(10));
  it('9.1s → 1', () => expect(warmupSecondsLeft(9.1)).toBe(1));
  it('9.9s → 1', () => expect(warmupSecondsLeft(9.9)).toBe(1));
  it('9.999s → 1 (boundary, still warming)', () => expect(warmupSecondsLeft(9.999)).toBe(1));
  it('10s → 0 (transition)', () => expect(warmupSecondsLeft(10)).toBe(0));
  it('10.000001s → 0 (boundary, just past)', () => expect(warmupSecondsLeft(10.000001)).toBe(0));
  it('11s → 0 (floored, never negative)', () => expect(warmupSecondsLeft(11)).toBe(0));
  it('negative elapsed → 10 (clamped, never exceeds WARMUP_S)', () => expect(warmupSecondsLeft(-1)).toBe(10));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/warmup-logic.test.js`
Expected: FAIL — cannot resolve `../ps-offsite-2026/shared/warmup-logic.js` (module does not exist yet).

- [ ] **Step 3: Write minimal implementation**

Create `ps-offsite-2026/shared/warmup-logic.js`:

```js
export const WARMUP_S = 10;

// Whole seconds of warmup left, for the countdown banner. Clamped to
// [0, WARMUP_S]. 0s elapsed → 10, 9.9s → 1, ≥10s → 0 (triggers transition to
// live play). The min() guards a (non-physical) negative elapsed from ever
// showing more than WARMUP_S.
export const warmupSecondsLeft = (elapsedSec) =>
  Math.max(0, Math.min(WARMUP_S, Math.ceil(WARMUP_S - elapsedSec)));
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/warmup-logic.test.js`
Expected: PASS — 9 tests green.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/warmup-logic.js tests/warmup-logic.test.js
git commit -m "feat(warmup): shared 10s warmup countdown helper + tests"
```

---

## Task 2: Dino warmup integration

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.js`

No unit test (in-game loop logic is not unit-tested in this repo); verified by running the app in Step 8.

- [ ] **Step 1: Add the import**

Find the dino-logic import block near the top:

```js
import {
  MAX_OBSTACLES, ATTEMPT_CAP_S, PALM_COUNT_WINDOW,
  palmCountToJumpStrength, scoreAttempt, finalScore,
} from '../shared/dino-logic.js';
```

Add immediately after it:

```js
import { warmupSecondsLeft } from '../shared/warmup-logic.js';
```

- [ ] **Step 2: Add warmup fields to the game object**

Replace:

```js
  const g = {
    y: GROUND_Y - RUNNER_H, vy: 0, ducking: false,
    meters: 0, score: 0, obs: [], spawnTimer: 0, runPhase: 0,
    palmWindow: [], lastEff: 0, startMs: performance.now(),
  };
```

with:

```js
  const g = {
    y: GROUND_Y - RUNNER_H, vy: 0, ducking: false,
    meters: 0, score: 0, obs: [], spawnTimer: 0, runPhase: 0,
    palmWindow: [], lastEff: 0,
    warming: true, warmStartMs: performance.now(), startMs: 0,
  };
```

`startMs: 0` is the sentinel for "warmup not finished" — `0` is falsy, so the
guards below treat it as "scored clock not started yet".

- [ ] **Step 3: Fix the visibilitychange handler**

Replace:

```js
  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) { g.startMs += performance.now() - hiddenAt; hiddenAt = 0; prevTs = performance.now(); }
  };
```

with:

```js
  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if (g.warming) g.warmStartMs += delta;   // pause the warmup countdown
      else g.startMs += delta;                 // pause the scored clock
      hiddenAt = 0;
      prevTs = performance.now();
    }
  };
```

This prevents `g.startMs += …` running while `startMs` is the `0` sentinel
(which would corrupt the clock), and makes the warmup countdown pause when the
tab is hidden, exactly like the scored clock already does.

- [ ] **Step 4: Guard the timeSec in endAttempt**

Replace:

```js
    const timeSec = (performance.now() - g.startMs) / 1000;
```

with:

```js
    const timeSec = g.startMs ? (performance.now() - g.startMs) / 1000 : 0;
```

So an attempt ended during warmup (abort, camera disconnect) scores with
`timeSec: 0` and `completed: 0` → score 0. All warmup exits route through this
single `endAttempt`, so no other guard is needed.

- [ ] **Step 5: Gate meters + spawn in step()**

Replace:

```js
    const speed = Math.min(9, 4 + g.meters * 0.02);
    g.meters += speed * 0.06 * dt;
    g.runPhase += 0.3 * dt;

    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) {
      spawnObstacle();
      g.spawnTimer = Math.max(60, 110 - g.meters * 0.3) + Math.random() * 30;
    }
```

with:

```js
    const speed = Math.min(9, 4 + g.meters * 0.02);
    if (!g.warming) g.meters += speed * 0.06 * dt;
    g.runPhase += 0.3 * dt;

    if (!g.warming) {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) {
        spawnObstacle();
        g.spawnTimer = Math.max(60, 110 - g.meters * 0.3) + Math.random() * 30;
      }
    }
```

Jump physics and the leg-swing animation (`runPhase`) still run every frame, so
the player practices jumping. With no spawn, `g.obs` stays empty, so the
obstacle-move and collision loops below are no-ops and `g.score` cannot change.
`meters` frozen at 0 means the post-warmup difficulty curve is identical to today.

- [ ] **Step 6: Add the drawWarmupBanner helper**

The `draw()` function ends with `drawRunner();` followed by its closing `}`.
Immediately after the `draw()` function's closing brace (and before
`function loop() {`), add:

```js
  function drawWarmupBanner(secondsLeft) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--accent');
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('WARM UP · practice!', CANVAS_W / 2, 70);
    ctx.fillStyle = css('--text');
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`obstacles in ${secondsLeft}`, CANVAS_W / 2, 104);
    ctx.restore();
  }
```

- [ ] **Step 7: Add the warmup branch to loop()**

Replace:

```js
    const elapsed = (now - g.startMs) / 1000;
    $('timerLabel').textContent = elapsed.toFixed(1);
    if (elapsed > ATTEMPT_CAP_S) { endAttempt(false); return; }

    step(dt);
    if (cancelled) return;
    draw();
    rafId = requestAnimationFrame(loop);
  }
```

with:

```js
    if (g.warming) {
      const left = warmupSecondsLeft((now - g.warmStartMs) / 1000);
      if (left <= 0) {
        // Transition to live play this same frame; falls through below.
        g.warming = false;
        g.startMs = now;
        g.spawnTimer = 0;
      } else {
        $('timerLabel').textContent = 'WARM UP';
        step(dt);
        if (cancelled) return;
        draw();
        drawWarmupBanner(left);
        rafId = requestAnimationFrame(loop);
        return;
      }
    }

    const elapsed = (now - g.startMs) / 1000;
    $('timerLabel').textContent = elapsed.toFixed(1);
    if (elapsed > ATTEMPT_CAP_S) { endAttempt(false); return; }

    step(dt);
    if (cancelled) return;
    draw();
    rafId = requestAnimationFrame(loop);
  }
```

The transition checks `left <= 0` **before** drawing the banner, so
`obstacles in 0` is never rendered: on the transition frame it falls through to
the live block (timer `0.0`, first obstacle spawns because `spawnTimer = 0`).

- [ ] **Step 8: Verify in the app**

Run: `npm run dev`
Open: `http://localhost:5173/ps-offsite-2026/games/3-dino.html?debug` (Vite serves the repo root; confirm the port/path printed by the dev server).

Click through Start → (allow camera) → intro Start. Verify:
- Timer label shows `WARM UP`; banner reads `WARM UP · practice!` / `obstacles in N` counting **10 → 1**; track is empty (no obstacles).
- Press keys `0`–`8` (debug palm count) and confirm the runner jumps — controls are live during warmup.
- After ~10s the banner disappears, timer flips to `0.0` and starts counting, the first obstacle appears from the right.
- Optional pause check: during warmup switch to another tab for ~5s, return — the countdown resumes near where it left off (does NOT skip ahead to 0).

- [ ] **Step 9: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js
git commit -m "feat(dino): 10s obstacle-free warmup with countdown banner"
```

---

## Task 3: Flappy warmup integration

**Files:**
- Modify: `ps-offsite-2026/games/4-flappy.js`

Mirrors dino, but warmup begins **after** the 1.5s calibration (thrust practice
needs the measured noise floor). No unit test; verified in Step 8.

- [ ] **Step 1: Add the import**

Find the flappy-logic import block:

```js
import {
  MAX_PIPES, ATTEMPT_CAP_S, GAIN, GRAVITY,
  ampToThrust, scoreAttempt, finalScore,
} from '../shared/flappy-logic.js';
```

Add immediately after it:

```js
import { warmupSecondsLeft } from '../shared/warmup-logic.js';
```

- [ ] **Step 2: Add warmup fields to the game object**

Replace:

```js
  const g = {
    y: CANVAS_H / 2, vy: 0, score: 0,
    pipes: [], spawnTimer: 0, worldX: 0,
    floor: 0, calibrating: true, calibStart: performance.now(), calibSamples: [],
    startMs: 0,
  };
```

with:

```js
  const g = {
    y: CANVAS_H / 2, vy: 0, score: 0,
    pipes: [], spawnTimer: 0, worldX: 0,
    floor: 0, calibrating: true, calibStart: performance.now(), calibSamples: [],
    warming: true, warmStartMs: 0, startMs: 0,
  };
```

`warmStartMs` is set for real when calibration ends (Step 5). It stays `0`
during calibration, but the calibration loop branch returns early before the
warmup branch runs, so it is never read while `0`.

- [ ] **Step 3: Fix the visibilitychange handler**

Replace:

```js
  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if (g.calibrating) g.calibStart += delta;
      else if (g.startMs) g.startMs += delta;
      prevTs = performance.now();
      hiddenAt = 0;
    }
  };
```

with:

```js
  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if (g.calibrating) g.calibStart += delta;
      else if (g.warming) g.warmStartMs += delta;   // pause the warmup countdown
      else if (g.startMs) g.startMs += delta;       // pause the scored clock
      prevTs = performance.now();
      hiddenAt = 0;
    }
  };
```

Order matters: calibrating → warming → live, since `warming` is `true`
throughout but the calibration branch wins while it is active.

- [ ] **Step 4: Gate the pipe spawn in step()**

Replace:

```js
    const speed = Math.min(6, 3 + g.score * 0.12);
    g.worldX += speed * dt;
    g.spawnTimer -= dt;
    if (g.spawnTimer <= 0) { spawnPipe(); g.spawnTimer = Math.max(100, 160 - g.score * 2); }
```

with:

```js
    const speed = Math.min(6, 3 + g.score * 0.12);
    g.worldX += speed * dt;
    if (!g.warming) {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) { spawnPipe(); g.spawnTimer = Math.max(100, 160 - g.score * 2); }
    }
```

Thrust + gravity + edge clamp run every frame (the player practices). With no
pipes, `g.score` stays 0, so post-warmup spawn cadence matches today.

- [ ] **Step 5: Enter warmup at calibration end**

Replace:

```js
      if (now - g.calibStart >= CALIB_MS) {
        g.calibSamples.sort((a, b) => a - b);
        g.floor = g.calibSamples[Math.floor(g.calibSamples.length / 2)] || 0;
        g.calibrating = false;
        g.startMs = now;
        prevTs = now;
        calibOverlay.classList.add('hidden');
      }
```

with:

```js
      if (now - g.calibStart >= CALIB_MS) {
        g.calibSamples.sort((a, b) => a - b);
        g.floor = g.calibSamples[Math.floor(g.calibSamples.length / 2)] || 0;
        g.calibrating = false;
        g.warming = true;
        g.warmStartMs = now;
        prevTs = now;
        calibOverlay.classList.add('hidden');
      }
```

`startMs` stays `0` (set later, when warmup ends). `calibOverlay` still hides;
the warmup banner is a separate on-canvas draw (Step 6), not a reuse of it.

- [ ] **Step 6: Add the drawWarmupBanner helper**

The `draw()` function ends with the orb `ctx.fill();` then its closing `}`.
Immediately after `draw()`'s closing brace (and before `function loop() {`), add:

```js
  function drawWarmupBanner(secondsLeft) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--accent');
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('WARM UP · practice!', CANVAS_W / 2, 70);
    ctx.fillStyle = css('--text');
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`obstacles in ${secondsLeft}`, CANVAS_W / 2, 104);
    ctx.restore();
  }
```

(Intentionally identical copy to dino — two call sites, kept in sync by hand.)

- [ ] **Step 7: Add the warmup branch to loop()**

This goes after the FPS-check block and before the `elapsed`/cap block. Replace:

```js
    const elapsed = (now - g.startMs) / 1000;
    $('timerLabel').textContent = elapsed.toFixed(1);
    if (elapsed > ATTEMPT_CAP_S) { endAttempt(false); return; }

    step(dt);
    if (cancelled) return;
    draw();
    rafId = requestAnimationFrame(loop);
  }
```

with:

```js
    if (g.warming) {
      const left = warmupSecondsLeft((now - g.warmStartMs) / 1000);
      if (left <= 0) {
        // Transition to live play this same frame; falls through below.
        g.warming = false;
        g.startMs = now;
        g.spawnTimer = 0;
      } else {
        $('timerLabel').textContent = 'WARM UP';
        step(dt);
        if (cancelled) return;
        draw();
        drawWarmupBanner(left);
        rafId = requestAnimationFrame(loop);
        return;
      }
    }

    const elapsed = (now - g.startMs) / 1000;
    $('timerLabel').textContent = elapsed.toFixed(1);
    if (elapsed > ATTEMPT_CAP_S) { endAttempt(false); return; }

    step(dt);
    if (cancelled) return;
    draw();
    rafId = requestAnimationFrame(loop);
  }
```

- [ ] **Step 8: Verify in the app**

Run: `npm run dev` (if not already running)
Open: `http://localhost:5173/ps-offsite-2026/games/4-flappy.html`

Click Start → (allow microphone) → intro Start. Verify:
- Calibration overlay shows ~1.5s (stay quiet), then hides.
- Timer label shows `WARM UP`; banner reads `WARM UP · practice!` / `obstacles in N` counting **10 → 1**; no pipes on screen.
- Make noise — the orb thrusts upward; controls are live during warmup.
- After ~10s the banner disappears, timer flips to `0.0`, the first pipe enters from the right.

- [ ] **Step 9: Commit**

```bash
git add ps-offsite-2026/games/4-flappy.js
git commit -m "feat(flappy): 10s obstacle-free warmup with countdown banner"
```

---

## Task 4: Full regression

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — all existing suites plus the new `warmup-logic` suite green.

- [ ] **Step 2: Verify the production build**

Run: `npm run build`
Expected: build succeeds with no errors (confirms the new import resolves in the
Vite multi-entry build; the entry paths were fixed for the `games/` layout in a
prior commit).

- [ ] **Step 3: Final commit (only if Steps 1–2 produced changes)**

Most likely nothing to commit here. If the build surfaced a fixable issue:

```bash
git add -A
git commit -m "fix(warmup): address build/test feedback"
```

---

## Notes for the implementer

- Dev server: `npm run dev` runs Vite from the repo root; the games live under
  `ps-offsite-2026/games/`. Use the exact URL Vite prints (port may differ from 5173).
- Dino accepts `?debug` to force palm count with number keys `0`–`8` — use it so
  you do not need to wave at a webcam to test jumping.
- Flappy genuinely needs a microphone for the orb to move; if you cannot grant one,
  you can still confirm calibration → warmup banner countdown → first pipe timing visually.
- Do NOT touch the `*-logic.js` scoring functions or the `PHASES` arrays — warmup is
  a sub-state inside `play`, not a new phase/screen.
