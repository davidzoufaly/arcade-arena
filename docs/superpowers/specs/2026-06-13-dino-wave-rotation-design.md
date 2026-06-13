# Dino — Wave/Rotation Redesign

**Date:** 2026-06-13
**Game:** Mission 3 — Gravity Corridor (`games/3-dino.html`, `games/3-dino.js`, `shared/dino-logic.js`)

## Problem

The Dino game currently runs as a single endless segment: the team plays continuously until the runner crashes. For the offsite we want it to play in **waves** so a team of more than 2–3 can rotate who controls the runner, and we want top ("high") obstacles to appear more often from the start.

This supersedes the `2do.md` "must clear 10 obstacles" line — the gate is **time-based (20 s)**, not obstacle-count based, per the decision below.

## Decisions

- **Wave cycle:** 20 s of active play → 10 s rotate break → repeat, endlessly.
- **Rotate break:** runner auto-runs flat. No obstacle spawning, hand input ignored, no collision/death. A big on-canvas banner prompts players to swap (mirrors pantomime's "Next player — take turns").
- **Difficulty:** speed / spawn rate / high-obstacle probability ramp on **cumulative play time** (sum of completed play segments + current segment elapsed). Rotate breaks do not advance difficulty. `RAMP_S = 70` unchanged → plateaus after ~3.5 waves.
- **High obstacles:** constant base probability **0.20** from t=0, ramping to the existing peak 0.38.
- **Scoring:** unchanged — score = total obstacles passed in an attempt, best of 5 attempts.
- **2–3 active players:** rules text only. Only the active players raise hands during calibration, so `teamN` (jump-strength scaling) reflects the wave size. No scaling-code change.

## Sub-phase machine

Current: `warmup → live` (single endless segment).

New: `warmup → play(20s) ⇄ rotate(10s)`, looping. Crash during **play** ends the attempt (best-of-5 flow unchanged).

| Sub-phase | Spawning | Input drives runner | Collision/death | Banner |
|-----------|----------|---------------------|-----------------|--------|
| warmup    | no       | yes (practice)      | no              | WARM UP · obstacles in N |
| play      | yes      | yes                 | yes             | (none) — optional "rotate in Ns" hint |
| rotate    | no       | no (auto-run flat)  | no              | 🔄 ROTATE — swap players · resume in Ns |

Transitions:
- warmup expiry → first play segment: `segStartMs = now`, `liveBankMs = 0`.
- play reaches 20 s → `liveBankMs += now - segStartMs`; `subPhase = 'rotate'`; `rotateStartMs = now`; stop spawning.
- rotate reaches 10 s → `subPhase = 'play'`; `segStartMs = now`; `spawnTimer = 0` (resume spawning); fall through to play this frame.

**Boundary ordering (segment expiry vs collision):** `tickPlay` checks the 20 s expiry at the **top of the frame, before `step()`**. If expired, it transitions to rotate and runs that frame as a rotate frame (fall-through, mirroring `tickWarmup → live`). Consequence: a collision on the exact frame the segment ends is voided by the rotate break — the breather wins the tie. Intentional, player-friendly.

## Changes

### `shared/dino-logic.js`
- Add constants: `SEGMENT_PLAY_S = 20`, `ROTATE_BREAK_S = 10`, `HIGH_PROB_MIN = 0.20`.
- Change `highObstacleProb(elapsedSec)`:
  `HIGH_PROB_MIN + (HIGH_PROB_MAX - HIGH_PROB_MIN) * difficultyProgress(elapsedSec)`.
  t=0 → 0.20, peak → 0.38, mid → 0.29.
- Add pure timer helpers (mirror `warmupSecondsLeft`):
  - `segmentSecondsLeft(elapsedInSegmentSec)` → `max(0, min(SEGMENT_PLAY_S, ceil(SEGMENT_PLAY_S - e)))`
  - `rotateSecondsLeft(elapsedInRotateSec)` → `max(0, min(ROTATE_BREAK_S, ceil(ROTATE_BREAK_S - e)))`

### `games/3-dino.js`
- `g.subPhase`: `'warmup' | 'play' | 'rotate'`. The current `'live'` literal is **renamed to `'play'` everywhere** — including the spawn gate `if (g.subPhase === 'live')` (currently 3-dino.js:375 → `'play'`). The now-unused `g.subPhaseMs` field is removed.
- New game-state fields: `liveBankMs` (banked ms from completed play segments), `segStartMs`, `rotateStartMs`. Cumulative live seconds = `(liveBankMs + (now - segStartMs)) / 1000` during play. `g.startMs` is dropped — see `endAttempt` below.
- `step(dt, elapsedSec, { controllable })`: when `controllable === false` (rotate), **skip `readInput`** (treat as `eff=0, fist=false`), **skip the collision loop** (3-dino.js:393-395 only — the pass-counting loop at 383-391 still runs so obstacles scrolling off keep scoring), and **skip spawning**. Still run gravity (settles a mid-air runner to ground), obstacle/particle scroll. On the play→rotate transition, force `g.ducking = false` and `g.lastEff = 0` so a stale `lastEff` doesn't suppress the first jump after the break.
- Replace `tickLive` with `tickPlay` (20 s segment; checks expiry at top-of-frame per Boundary ordering; drives difficulty off cumulative time; calls `step(..., {controllable:true})`) and add `tickRotate` (10 s; `step(..., {controllable:false})`; banner; transitions to play at 10 s).
- `tickWarmup` now transitions into the first play segment instead of `live`.
- `drawRotateBanner(secondsLeft)`: centered "🔄 ROTATE — swap players" + "resume in Ns" sub-line, same canvas-text style as `drawWarmupBanner` (no new CSS — canvas text).
- `endAttempt` (3-dino.js:351): `timeSec` must report **cumulative play time**, not wall-clock. Compute from `liveBankMs + (now - segStartMs)` when in play, or `liveBankMs` when in rotate — never count rotate breaks. (Replaces the old `g.startMs`-based calc, which would have included breaks.)
- `timerLabel` shows cumulative live survival time during play; shows "ROTATE" during rotate (consistent with warmup's "WARM UP").
- Extend the `visibilitychange` pause handler to add the hidden delta to the active marker (`warmStartMs` / `segStartMs` / `rotateStartMs`) by sub-phase.

### `games/3-dino.html`
- **Briefing** (`#briefing`, 3-dino.html:277): edit only the "endless and keeps speeding up" clause and the "Survive as long as you can" tail — **preserve the existing 20-second-calibration sentence and the gesture legend** (✋ jump / ✊ duck / ✌️ ready). New framing: "~20-second obstacle waves, then a 10-second breather to swap players. **2–3 players active per wave** — only those raise hands during calibration. Score = obstacles passed; survive across waves. 5 attempts, best counts."
- **Intro** (`#phase-intro`, 3-dino.html:308): "Endless run" → "Wave run — 20s obstacles, then 10s to rotate players", keep the gesture legend.

### `tests/dino-logic.test.js`
- Update `highObstacleProb` block: start → 0.20, peak → 0.38, half ramp → 0.29 (`(0.20+0.38)/2`), past ramp → 0.38.
- Add constant assertions: `HIGH_PROB_MIN === 0.20`, `SEGMENT_PLAY_S === 20`, `ROTATE_BREAK_S === 10`.
- Add `segmentSecondsLeft` / `rotateSecondsLeft` blocks (boundaries: 0→full, just-under→1, exact→0, past→0, negative→clamped to full).

## Out of scope / manual
- **"Test individual hands and jumps"** (`2do.md` line 17): manual verification via `?debug` after implementation — confirm per-hand palm counting, jump triggering on raise, and duck on fist. Note: input is intentionally dead during the 10 s rotate break, so test gestures only respond in warmup/play. Not a code deliverable.

## Risk / notes
- During the first ~1–2 s of a rotate break, an obstacle near the right edge may visually pass through the auto-running runner (collision off). Acceptable — it scrolls off well within 10 s and still counts toward score.
- `teamN` is locked once at calibration; rotating different players mid-attempt assumes a roughly constant active count (2–3). Rules text directs only active players to calibrate.
