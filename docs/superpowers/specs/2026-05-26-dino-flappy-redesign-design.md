# Dino + Flappy Redesign

**Date:** 2026-05-26
**Status:** Design approved, awaiting plan

## Goal

Bring Dino + Flappy in line with the gesture-lock / pantomime platform pattern:

1. Best-of-3 attempt model with admin-gated replay
2. Card-bound layout (no fullscreen canvas)
3. Drop cyberpunk arcade graphics; match gesture-lock chrome
4. Reduce input latency
5. Designed for whole-team simultaneous play

## File Structure

### New
- `ps-offsite-2026/games/3-dino.html` — full page, mirrors `1-gesture-lock.html`
- `ps-offsite-2026/games/4-flappy.html` — full page, mirrors `1-gesture-lock.html`
- `ps-offsite-2026/shared/dino-logic.js` — pure scoring + input-mapping helpers
- `ps-offsite-2026/shared/flappy-logic.js` — pure scoring + input-mapping helpers
- `tests/dino-logic.test.js`
- `tests/flappy-logic.test.js`

### Updated
- `ps-offsite-2026/shared/games-catalog.js` — repoint dino + flappy entries to new paths
- `ps-offsite-2026/games/manual.html` — update any references to old paths
- `BUILD_PLAN.md` — tick line 17 + sub-bullets

### Deleted (after verification)
- `ps-offsite-2026/dino/` (entire directory)
- `ps-offsite-2026/flappy/` (entire directory)
- `ps-offsite-2026/shared/neon-fx.js`, `shared/neon.css`, `shared/stages.js`, `shared/score-panel.js` — only if no other game imports them after migration

### Retained
- `ps-offsite-2026/shared/vision.js` (new dino imports `createCamStream`, `createHandTracker`, `isPalmOpen`, `isFist`)
- `ps-offsite-2026/shared/audio.js` (new flappy imports `createAudioInput`)
- `ps-offsite-2026/shared/admin-gate.js`, `lobby.js`, `topbar.js`, `score-submit.js` (unchanged)

## Phase Machine (both games)

```
setup → loading → intro → play → attempt-end → final
                    ↑                  ↓
                    └──── try-again ───┘
```

- **setup** — Briefing card + Start button. Click → `loading`.
- **loading** — Init MediaPipe / audio + cam/mic permissions. Success → `intro`. Failure → `showDenialModal` (vision.js / audio.js helpers).
- **intro** — "Attempt N of 3" card + Start button. Click → `play`.
- **play** — 960×540 canvas + side panel (attempt #, score, timer, cam preview thumbnail for dino). Game runs until death OR per-game max-score reached (`MAX_OBSTACLES` for dino, `MAX_PIPES` for flappy) OR 60s cap.
- **attempt-end** — Card showing attempt result. If attempts < 3 → "Try again" button → `intro` with `attemptIdx + 1`. "Finish" → `final`.
- **final** — Total card with best-attempt score, `save-status` (SAVING…/SAVED/FAILED→retry), "Play again" (admin-gated via `requireAdmin`) + "Return to catalog" link.

State shape (both):
```
state = {
  teamId,
  attemptIdx,          // 0-based
  attempts: [{score, completed, timeSec, died}, ...],
  // game-specific live state populated only during `play`
}
```

`activeCleanup` pattern from gesture-lock: each `phaseEnter[phase]` may register a tear-down; `goto(next)` invokes it before switching.

Cam/mic stream opened once in `loading`, persisted across attempts. Released only in `final` (after submit).

## Dino — Mechanics

**Goal:** team-jumps and ducks past obstacles. Score = obstacles passed before death or time-out.

### Input → action

Multiple team members in front of one camera. MediaPipe `numHands: 8` (fallback 4 if FPS < 40).

- **Jump strength** from open-palm count:
  - `palmCount = hands.filter(isPalmOpen).length`
  - `v0 = palmCount === 0 ? 0 : clamp(6 + palmCount * 2, 6, 20)`
  - On ground + edge transition (was 0 last frame, now > 0) → apply `vy = -v0`.
- **Duck** from any fist: `ducking = hands.some(isFist) && onGround`.
- Input read once per RAF at top of `step()`; physics applied same frame. No hold gates, no debounce.

### Physics
- Gravity 0.8/frame
- Max fall vy 9
- Knight box: `w=30, h=60`; ducking → height × 0.55
- Speed: linear ramp `speed = 4 + meters * 0.02` clamped to 9

### Obstacles
- Low (h=30) only spawn while score < 4
- After score ≥ 4: 60% low / 40% high (h=45)
- `spawnEvery = clamp(110 - meters*0.3, 60, 110)`
- Visuals: flat dark rect `var(--bg-2)` fill, `var(--accent)` 2px border. No bar-charts, no glow.

### Knight
- Simple silhouette: filled `var(--text)` rounded rectangle with eye dot in `var(--accent)`. Running animation via leg position swap based on `meters % 12`.
- Ducking: rect compressed to 55% height.

### Scoring
- `MAX_OBSTACLES = 16`
- `scoreAttempt({ completed, timeSec, died })` →
  - Base: `round(completed * (100 / MAX_OBSTACLES))`
  - Time bonus when `completed === MAX_OBSTACLES`: `+ max(0, round(20 - timeSec/2))`
  - Cap 100
- `finalScore(attempts)` = `max(a.score)` across attempts (best of 3)
- Attempt ends: collision, completed ≥ 16, 60s cap

### Per-attempt HUD
- Top-left: `SCORE N / 16`
- Side panel: cam preview 240×135 (mirrored), palm-count indicator overlay (0–8 dots filling)
- Bottom: jump-strength meter bar (palmCount → fill %)
- Timer: `MM.S` style, identical to gesture-lock

## Flappy — Mechanics

**Goal:** keep orb alive through pipe gaps via team-yelling. Score = pipes passed before death or time-out.

### Input → action

- Floor calibration runs once per page load (1.5s quiet sample, median amp), in the first `loading` phase entry. Cached on `state.floor` and reused across all 3 attempts. Page reload re-calibrates.
- Each frame: `thrust = max(0, (amp - floor)) * GAIN`, `GAIN = 25`.
- No threshold gate, no mode switch, no sustain logic.
- Physics applied same frame: `vy += GRAVITY * dt; vy -= thrust * dt`.

### Physics
- Gravity 0.28
- vy clamped ±10
- Orb radius 18
- Pipe width 80
- Gap height 240 (constant)

### Pipes
- `speed = clamp(3 + score * 0.12, 3, 6)`
- `spawnEvery = clamp(160 - score*2, 100, 160)`
- Flat bands: `var(--accent)` border, semi-transparent `var(--card)` fill. No anomaly art, no internal charts.

### Orb
- Solid `var(--accent)` circle
- Pulse: radius +10% on frames where `thrust > 0`
- No trail (drop current rainbow trail)

### Scoring
- `MAX_PIPES = 20`
- `scoreAttempt({ completed, timeSec, died })` →
  - Base: `round(completed * (100 / 20))`
  - Time bonus when `completed === 20`: `+ max(0, round(15 - timeSec/3))`
  - Cap 100
- `finalScore(attempts)` = `max(a.score)` across attempts
- Attempt ends: pipe collision, floor/ceiling, completed ≥ 20, 60s cap

### Per-attempt HUD
- Top-left: `SCORE N / 20`
- Right side: vertical voice-meter (style retained from current flappy, sustain marker removed)
- Timer: same as dino
- No cam

## Latency Strategy

**Target:** <80ms gesture→action, <50ms voice→action.

1. **Tracker tick every RAF.** Drop the `video.currentTime !== lastVideoTime` skip; re-run `recognizeForVideo` every frame. Removes 16–33ms stalls.
2. **Cam resolution 480×360.** Faster MediaPipe inference vs current 640×480.
3. **`numHands: 8`**, GPU delegate, float16 model. Bench during impl; fall back to 4 if sustained FPS < 40.
4. **Single-frame pipeline.** Inside RAF: `readInput → step → render`. Input read same frame physics uses.
5. **No input hold gates.** Palm-detected frame → jump frame.
6. **Audio smoothing.** Audit `shared/audio.js`; if RMS window > 5 samples, halve. Direct `amp - floor` mapping with no threshold-cross.
7. **Debug overlay** behind `?debug=1`: per-frame `input-ms`, `infer-ms`, `paint-ms`.

## Code Organization

### `shared/dino-logic.js`
```
export const MAX_OBSTACLES = 16;
export const ATTEMPT_CAP_S = 60;
export function palmCountToJumpStrength(n) { ... }
export function scoreAttempt({ completed, timeSec, died }) { ... }
export function finalScore(attempts) { ... }
```

### `shared/flappy-logic.js`
```
export const MAX_PIPES = 20;
export const ATTEMPT_CAP_S = 60;
export const GAIN = 25;
export const GRAVITY = 0.28;
export function ampToThrust(amp, floor) { ... } // returns max(0, (amp - floor)) * GAIN
export function scoreAttempt({ completed, timeSec, died }) { ... }
export function finalScore(attempts) { ... }
```

### Page modules
Inline `<script type="module">` in each HTML, mirroring `1-gesture-lock.html`. Pulls Firebase, `submitScore`, `requireAdmin`, `resolveSession`, `mountTopbar`, and the logic module. Phase machine + RAF loop live here.

## Visual Style

- Chrome (header, cards, briefing, progress dots, stats, save-status, end card): copy CSS variables and class names from `1-gesture-lock.html` verbatim.
- Inside canvas: flat shapes with `var(--bg)`, `var(--bg-2)`, `var(--card)`, `var(--text)`, `var(--accent)`, `var(--good)`, `var(--bad)`. No `withGlow`, no scanlines, no neon grid, no shake.

## Testing

`tests/dino-logic.test.js` covers:
- `scoreAttempt({completed: 0})` → 0
- `scoreAttempt({completed: 16, timeSec: 30})` → 100 + 5 bonus, capped at 100
- `scoreAttempt({completed: 16, timeSec: 60})` → 100 (no negative bonus)
- `scoreAttempt({completed: 8, timeSec: 20})` → 50 (no bonus without max)
- `finalScore([{score:30},{score:75},{score:20}])` → 75
- `palmCountToJumpStrength(0)` → 0
- `palmCountToJumpStrength(1)` → 8
- `palmCountToJumpStrength(8)` → 20 (clamped)

`tests/flappy-logic.test.js` covers analogous cases for pipes.

## Out of Scope

- Audio worklet rewrites beyond smoothing-window tweak
- New vision helpers
- Catalog UI changes beyond path repoint
- Multi-team simultaneous play (current platform is single-team-at-a-time)
- Mobile touch controls (camera/mic only)
