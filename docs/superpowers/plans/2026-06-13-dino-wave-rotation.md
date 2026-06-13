# Dino Wave/Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the endless Dino runner into looping waves — 20 s of obstacle play, then a 10 s auto-run rotate break to swap players — and make high obstacles appear from the start.

**Architecture:** Pure timing/probability logic and constants live in `shared/dino-logic.js` (vitest-covered). The sub-phase state machine, banners, and HUD live in `games/3-dino.js` (no unit harness — verified manually). Spec: `docs/superpowers/specs/2026-06-13-dino-wave-rotation-design.md`.

**Tech Stack:** Vanilla ES modules, Canvas 2D, vitest. Test command: `npm test` (vitest run).

---

## File Structure

- `ps-offsite-2026/shared/dino-logic.js` — add constants (`SEGMENT_PLAY_S`, `ROTATE_BREAK_S`, `HIGH_PROB_MIN`), change `highObstacleProb`, add `segmentSecondsLeft` / `rotateSecondsLeft`.
- `tests/dino-logic.test.js` — update `highObstacleProb` block, add constant + helper tests.
- `ps-offsite-2026/games/3-dino.js` — rename `'live'`→`'play'`, add `'rotate'` sub-phase, cumulative-time difficulty, `tickPlay`/`tickRotate`, `drawRotateBanner`, `endAttempt` timeSec fix, visibility handler.
- `ps-offsite-2026/games/3-dino.html` — briefing + intro copy.

---

## Task 1: Logic constants + high-obstacle floor (TDD)

**Files:**
- Modify: `ps-offsite-2026/shared/dino-logic.js`
- Test: `tests/dino-logic.test.js`

- [ ] **Step 1: Update the failing `highObstacleProb` tests**

In `tests/dino-logic.test.js`, replace the entire `describe('highObstacleProb', ...)` block (currently asserting start→0, half→MAX/2) with:

```js
describe('highObstacleProb', () => {
  it('start → HIGH_PROB_MIN floor (highs from t=0)', () => expect(highObstacleProb(0)).toBeCloseTo(HIGH_PROB_MIN));
  it('peak → HIGH_PROB_MAX', () => expect(highObstacleProb(RAMP_S)).toBeCloseTo(HIGH_PROB_MAX));
  it('half ramp → midpoint of floor and max', () =>
    expect(highObstacleProb(RAMP_S / 2)).toBeCloseTo((HIGH_PROB_MIN + HIGH_PROB_MAX) / 2));
  it('past ramp → HIGH_PROB_MAX (plateau)', () =>
    expect(highObstacleProb(RAMP_S * 2)).toBeCloseTo(HIGH_PROB_MAX));
  it('negative → HIGH_PROB_MIN (clamped)', () => expect(highObstacleProb(-5)).toBeCloseTo(HIGH_PROB_MIN));
});
```

Add `HIGH_PROB_MIN`, `SEGMENT_PLAY_S`, `ROTATE_BREAK_S` to the import list at the top of the file, and add constant assertions inside `describe('constants', ...)`:

```js
  it('HIGH_PROB_MIN is 0.20', () => expect(HIGH_PROB_MIN).toBe(0.20));
  it('SEGMENT_PLAY_S is 20', () => expect(SEGMENT_PLAY_S).toBe(20));
  it('ROTATE_BREAK_S is 10', () => expect(ROTATE_BREAK_S).toBe(10));
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dino-logic`
Expected: FAIL — `HIGH_PROB_MIN is not defined` / `highObstacleProb(0)` returns 0 not 0.20.

- [ ] **Step 3: Implement in `shared/dino-logic.js`**

Add the floor constant next to `HIGH_PROB_MAX` (after line 32):

```js
export const HIGH_PROB_MIN = 0.20;                     // base high-obstacle chance from t=0
```

Add the wave-segment constants near the difficulty knobs (after `RAMP_S`):

```js
export const SEGMENT_PLAY_S = 20;  // active obstacle play per wave
export const ROTATE_BREAK_S = 10;  // auto-run break to swap players
```

Replace `highObstacleProb`:

```js
export function highObstacleProb(elapsedSec) {
  return HIGH_PROB_MIN + (HIGH_PROB_MAX - HIGH_PROB_MIN) * difficultyProgress(elapsedSec);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dino-logic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/dino-logic.js tests/dino-logic.test.js
git commit -m "feat(dino): high-obstacle floor + wave segment constants"
```

---

## Task 2: Segment/rotate countdown helpers (TDD)

**Files:**
- Modify: `ps-offsite-2026/shared/dino-logic.js`
- Test: `tests/dino-logic.test.js`

- [ ] **Step 1: Write the failing tests**

Add to `tests/dino-logic.test.js` (imports `segmentSecondsLeft`, `rotateSecondsLeft` already need adding to the import list):

```js
describe('segmentSecondsLeft', () => {
  it('0s elapsed → 20', () => expect(segmentSecondsLeft(0)).toBe(20));
  it('19.1s → 1', () => expect(segmentSecondsLeft(19.1)).toBe(1));
  it('19.999s → 1 (boundary)', () => expect(segmentSecondsLeft(19.999)).toBe(1));
  it('20s → 0 (transition)', () => expect(segmentSecondsLeft(20)).toBe(0));
  it('25s → 0 (floored)', () => expect(segmentSecondsLeft(25)).toBe(0));
  it('negative → 20 (clamped)', () => expect(segmentSecondsLeft(-1)).toBe(20));
});

describe('rotateSecondsLeft', () => {
  it('0s elapsed → 10', () => expect(rotateSecondsLeft(0)).toBe(10));
  it('9.1s → 1', () => expect(rotateSecondsLeft(9.1)).toBe(1));
  it('9.999s → 1 (boundary)', () => expect(rotateSecondsLeft(9.999)).toBe(1));
  it('10s → 0 (transition)', () => expect(rotateSecondsLeft(10)).toBe(0));
  it('11s → 0 (floored)', () => expect(rotateSecondsLeft(11)).toBe(0));
  it('negative → 10 (clamped)', () => expect(rotateSecondsLeft(-1)).toBe(10));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- dino-logic`
Expected: FAIL — `segmentSecondsLeft is not defined`.

- [ ] **Step 3: Implement in `shared/dino-logic.js`**

Add after the difficulty functions:

```js
// Whole seconds left in the current play segment / rotate break, for the
// on-canvas countdown. Clamped to [0, duration] — mirrors warmupSecondsLeft.
export const segmentSecondsLeft = (elapsedSec) =>
  Math.max(0, Math.min(SEGMENT_PLAY_S, Math.ceil(SEGMENT_PLAY_S - elapsedSec)));
export const rotateSecondsLeft = (elapsedSec) =>
  Math.max(0, Math.min(ROTATE_BREAK_S, Math.ceil(ROTATE_BREAK_S - elapsedSec)));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- dino-logic`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/dino-logic.js tests/dino-logic.test.js
git commit -m "feat(dino): segment/rotate countdown helpers"
```

---

## Task 3: Wave state machine in `3-dino.js`

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.js`

No unit test (no DOM harness) — verified manually in Task 5. Make all edits, then verify the file parses via the build.

- [ ] **Step 1: Extend the logic import**

In `3-dino.js`, the import block from `'../shared/dino-logic.js'` (lines 11-17) currently ends with `runSpeed, spawnIntervalFrames, highObstacleProb,`. Add the new exports:

```js
import {
  PALM_COUNT_WINDOW, TRACKER_CEILING, TRACKER_BUFFER,
  CALIB_TOTAL_S, CALIB_GRACE_S, FALLBACK_N, MIN_N,
  palmCountToJumpStrength, pickCalibratedHandCount, effectivePalmCount,
  scoreAttempt, finalScore,
  runSpeed, spawnIntervalFrames, highObstacleProb,
  SEGMENT_PLAY_S, segmentSecondsLeft, rotateSecondsLeft,
} from '../shared/dino-logic.js';
```

- [ ] **Step 2: Rework the `g` state fields**

In `phaseEnter.play`, the `const g = {` initializer (lines 285-301) sets `subPhase: 'warmup'`, `subPhaseMs`, `warmStartMs`, `startMs: 0`. Replace those four lines:

```js
    subPhase: 'warmup',
    subPhaseMs: performance.now(),
    warmStartMs: performance.now(), startMs: 0,
```

with:

```js
    subPhase: 'warmup',
    warmStartMs: performance.now(),
    liveBankMs: 0,        // banked play-ms from completed segments (drives difficulty + survival time)
    segStartMs: 0,        // start of current play segment
    rotateStartMs: 0,     // start of current rotate break
```

(`subPhaseMs` and `startMs` are removed.)

- [ ] **Step 3: Add a cumulative-play-time helper inside `phaseEnter.play`**

Immediately after the `const g = {...}` block (before `let rafId = ...`), add:

```js
  // Cumulative live play seconds (banked segments + current segment), the input
  // to all difficulty ramps and the survival time. Rotate breaks never count.
  const livePlaySec = (now) =>
    (g.liveBankMs + (g.subPhase === 'play' ? now - g.segStartMs : 0)) / 1000;
```

- [ ] **Step 4: Fix the visibility-pause handler**

Replace the `onVis` body (lines 310-319):

```js
  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if (g.subPhase === 'warmup') g.warmStartMs += delta;
      else                         g.startMs    += delta;
      hiddenAt = 0;
      prevTs = performance.now();
    }
  };
```

with a three-way branch on the active marker:

```js
  const onVis = () => {
    if (document.hidden) hiddenAt = performance.now();
    else if (hiddenAt) {
      const delta = performance.now() - hiddenAt;
      if      (g.subPhase === 'warmup') g.warmStartMs   += delta;
      else if (g.subPhase === 'rotate') g.rotateStartMs += delta;
      else                              g.segStartMs    += delta;
      hiddenAt = 0;
      prevTs = performance.now();
    }
  };
```

- [ ] **Step 5: Gate input/collision/spawn in `step()`**

`step(dt, elapsedSec)` (lines 357-396) currently always reads input, spawns when `subPhase === 'live'`, and always checks collision. Replace the whole function with a `controllable`-gated version:

```js
  function step(dt, elapsedSec, controllable) {
    let eff = 0, fist = false;
    if (controllable) { ({ eff, fist } = readInput()); }
    const onGround = g.y + RUNNER_H >= GROUND_Y - 0.5;
    if (controllable && onGround && eff > 0 && g.lastEff === 0) {
      g.vy = -palmCountToJumpStrength(eff, state.teamN ?? FALLBACK_N);
    }
    g.lastEff = eff;
    g.ducking = controllable && fist && onGround;
    g.vy += GRAVITY * dt;
    g.y += g.vy * dt;
    if (g.y + RUNNER_H > GROUND_Y) { g.y = GROUND_Y - RUNNER_H; g.vy = 0; }

    const speed = runSpeed(elapsedSec);
    g.runPhase += 0.3 * dt;

    for (const p of g.particles) {
      p.x -= speed * p.z * dt;
      if (p.x < -2) { p.x = CANVAS_W + Math.random() * 40; p.y = Math.random() * GROUND_Y; }
    }

    if (g.subPhase === 'play') {
      g.spawnTimer -= dt;
      if (g.spawnTimer <= 0) {
        spawnObstacle(elapsedSec);
        g.spawnTimer = spawnIntervalFrames(elapsedSec) + Math.random() * 30;
      }
    }

    for (const o of g.obs) {
      o.x -= speed * dt;
      if (!o.passed && o.x + o.w < RUNNER_X) {
        o.passed = true;
        g.score += 1;
        $('scoreLabel').textContent = `${g.score}`;
      }
    }
    g.obs = g.obs.filter(o => o.x + o.w > 0);

    if (controllable) {
      const kh = g.ducking ? RUNNER_H * 0.55 : RUNNER_H;
      const box = { x: RUNNER_X, y: g.y + (RUNNER_H - kh), w: RUNNER_W, h: kh };
      for (const o of g.obs) { if (intersects(box, o)) { endAttempt(true); return; } }
    }
  }
```

- [ ] **Step 6: Fix `endAttempt` survival time**

In `endAttempt` (lines 345-355), replace the `timeSec` line:

```js
    const timeSec = g.startMs ? (performance.now() - g.startMs) / 1000 : 0;
```

with cumulative play time:

```js
    const timeSec = livePlaySec(performance.now());
```

- [ ] **Step 7: Replace `tickWarmup` transition target**

In `tickWarmup` (lines 471-486), the transition block currently sets `subPhase = 'live'`, `subPhaseMs`, `startMs`, `spawnTimer`. Replace:

```js
    if (left <= 0) {
      g.subPhase = 'live';
      g.subPhaseMs = now;
      g.startMs = now;
      g.spawnTimer = 0;
      return false; // caller falls through to tickLive this same frame
    }
```

with:

```js
    if (left <= 0) {
      g.subPhase = 'play';
      g.segStartMs = now;
      g.spawnTimer = 0;
      return false; // caller falls through to tickPlay this same frame
    }
```

And update its `step` call (line 481) from `step(dt, 0);` to `step(dt, 0, true);`.

- [ ] **Step 8: Replace `tickLive` with `tickPlay` + add `tickRotate`**

Replace `tickLive` (lines 488-494) with:

```js
  function tickPlay(dt, now) {
    // Top-of-frame expiry check: segment end voids a same-frame collision (the
    // rotate break wins the tie). Returns false to fall through to tickRotate.
    if ((now - g.segStartMs) / 1000 >= SEGMENT_PLAY_S) {
      g.liveBankMs += now - g.segStartMs;
      g.subPhase = 'rotate';
      g.rotateStartMs = now;
      g.ducking = false;
      g.lastEff = 0; // so the first jump after the break isn't suppressed
      return false;
    }
    const elapsed = livePlaySec(now);
    $('timerLabel').textContent = elapsed.toFixed(1);
    step(dt, elapsed, true);
    if (cancelled) return true;
    draw();
    return true;
  }

  function tickRotate(dt, now) {
    const left = rotateSecondsLeft((now - g.rotateStartMs) / 1000);
    if (left <= 0) {
      g.subPhase = 'play';
      g.segStartMs = now;
      g.spawnTimer = 0;
      return false; // fall through to tickPlay this same frame
    }
    $('timerLabel').textContent = 'ROTATE';
    step(dt, livePlaySec(now), false);
    if (cancelled) return true;
    draw();
    drawRotateBanner(left);
    return true;
  }
```

- [ ] **Step 9: Add `drawRotateBanner`**

After `drawWarmupBanner` (ends line 469), add:

```js
  function drawRotateBanner(secondsLeft) {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.fillStyle = css('--good');
    ctx.font = 'bold 34px system-ui, sans-serif';
    ctx.fillText('🔄 ROTATE — swap players', CANVAS_W / 2, 70);
    ctx.fillStyle = css('--text');
    ctx.font = '22px system-ui, sans-serif';
    ctx.fillText(`resume in ${secondsLeft}`, CANVAS_W / 2, 104);
    ctx.restore();
  }
```

- [ ] **Step 10: Rewire the main `loop()` to drive the wave machine**

Replace the body of `loop()` from the `if (g.subPhase === 'warmup')` block to the end (lines 510-522) with:

```js
    if (g.subPhase === 'warmup') {
      const handled = tickWarmup(dt, now);
      if (cancelled) return;
      if (handled) { rafId = requestAnimationFrame(loop); return; }
      // warmup expired → fall through to play this frame
    }

    if (g.subPhase === 'rotate') {
      const handled = tickRotate(dt, now);
      if (cancelled) return;
      if (handled) { rafId = requestAnimationFrame(loop); return; }
      // rotate expired → fall through to play this frame
    }

    tickPlay(dt, now);
    if (cancelled) return;
    rafId = requestAnimationFrame(loop);
```

Note: `tickPlay` returning false (segment→rotate) does not need same-frame fall-through — the next `requestAnimationFrame` picks up the rotate branch. Drop-through only matters warmup→play and rotate→play, both handled above.

- [ ] **Step 11: Verify the file builds**

Run: `npm run build`
Expected: build succeeds, no syntax/import errors mentioning `3-dino`.

- [ ] **Step 12: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js
git commit -m "feat(dino): wave/rotation sub-phase machine"
```

---

## Task 4: Rules copy (briefing + intro)

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.html`

- [ ] **Step 1: Update the briefing**

In `3-dino.html` `#briefing` (line 277), replace the sentence fragment "it's <strong>endless and keeps speeding up 💨</strong>." with:

```html
it plays in <strong>~20-second waves 💨</strong>, then a 10-second breather to swap players.
```

And replace the tail "Survive as long as you can; your score is the number of obstacles passed." with:

```html
Only <strong>2–3 players are active per wave</strong> — just those raise hands at calibration. Survive across waves; your score is the number of obstacles passed.
```

Leave the "First, a 20-second calibration…" sentence and the ✋/✊/✌️ gesture legend untouched.

- [ ] **Step 2: Update the intro**

In `#phase-intro` (line 308), replace `<strong>Endless run</strong>` with `<strong>Wave run</strong> — 20s obstacles, then 10s to rotate players;`.

- [ ] **Step 3: Verify it builds**

Run: `npm run build`
Expected: success.

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/games/3-dino.html
git commit -m "docs(dino): wave/rotation + 2-3 players rules copy"
```

---

## Task 5: Manual verification

**Files:** none.

- [ ] **Step 1: Full suite green**

Run: `npm test`
Expected: all pass.

- [ ] **Step 2: Run the game with debug**

Run: `npm run dev`, open `…/games/3-dino.html?debug&team=3`.

- [ ] **Step 3: Verify behavior**

- Warmup practice works (no obstacles, jump/duck respond).
- After warmup, obstacles spawn; high (top, red-bordered) obstacles appear early (≈1 in 5).
- Press number keys 1–3 to simulate palms → runner jumps; key `0`/release → no jump; hold a fist gesture path isn't keyboard-mapped, so test duck via real camera if needed.
- At ~20 s of play, the `🔄 ROTATE — swap players` banner shows, runner auto-runs flat, no obstacles, key presses do **not** jump, timer reads `ROTATE`, no death possible.
- After ~10 s, obstacles resume; a jump works on the first raise (no stuck `lastEff`).
- Difficulty (speed/spawn density) is higher in the 2nd wave than the 1st (cumulative ramp).
- Crash ends the attempt; survival time excludes the rotate break.

- [ ] **Step 4: Mark 2do.md Dino done (optional)**

If the maintainer wants it tracked, tick the Dino lines in `2do.md`. Not required by this plan.
