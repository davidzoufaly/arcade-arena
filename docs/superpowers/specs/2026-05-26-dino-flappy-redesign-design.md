# Dino + Flappy Redesign

**Date:** 2026-05-26
**Status:** Design approved, awaiting plan

## Goal

Bring Dino + Flappy in line with the gesture-lock / pantomime platform pattern:

1. Best-of-3 attempt model with admin-gated replay
2. Card-bound layout (no fullscreen canvas)
3. Drop cyberpunk arcade graphics; match gesture-lock chrome
4. Reduce input latency
5. One team plays at a time, but the whole team (4–8 players) drives input simultaneously through one camera / mic

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
- `ps-offsite-2026/shared/vision.js` — see "vision.js changes" below
- `ps-offsite-2026/shared/audio.js` — see "audio.js changes" below
- `BUILD_PLAN.md` — tick the "Dino a Flappy" bullet + sub-bullets (line number may drift; locate by text)

### Deleted (after verification)
- `ps-offsite-2026/dino/` (entire directory)
- `ps-offsite-2026/flappy/` (entire directory)
- `ps-offsite-2026/shared/neon-fx.js`, `shared/neon.css`, `shared/stages.js`, `shared/score-panel.js` — current importers (verified): only `dino/main.js` and `flappy/main.js`. Re-grep before deletion to catch any branch-local changes (e.g. `scoreboard.html` was touched on this branch).

### Retained (unchanged)
- `ps-offsite-2026/shared/admin-gate.js`, `lobby.js`, `topbar.js`, `score-submit.js`
- `ps-offsite-2026/shared/perms.js` (new dino imports `showDenialModal` from here — NOT vision.js / audio.js)

### vision.js changes
Current `createHandTracker` is hardcoded `numHands: 4` and an internal 33ms throttle (vision.js:36, 45). Both block the new game's latency target. Edits:
- Accept an options arg: `createHandTracker(video, { numHands = 4, minRunMs = 0 } = {})`.
- Plumb `numHands` into `HandLandmarker.createFromOptions`.
- Replace `ts - lastTs > 33` with `ts - lastTs >= minRunMs` (default `0` = every RAF). Existing call sites pass no options → unchanged behaviour. New dino passes `{ numHands: 8, minRunMs: 0 }`.
- `createCamStream` likewise accepts `{ width, height }` (defaults 640x480 — current). Dino passes `{ width: 480, height: 360 }`.

### audio.js changes
- `createAudioInput` accepts higher `smoothing` (default stays 0.4). Flappy passes `smoothing: 0.7` (less lag, slightly noisier). No other call-site changes.

## Phase Machine (both games)

```
setup → loading → intro → play → attempt-end → final
                    ↑                  ↓
                    └──── try-again ───┘
```

- **setup** — Briefing card + Start button. Click → `loading`.
- **loading** — Init MediaPipe / audio + cam/mic permissions. Success → `intro`. Failure → `showDenialModal('camera')` / `showDenialModal('microphone')` from `shared/perms.js`.
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

`activeCleanup` pattern from gesture-lock: each `phaseEnter[phase]` may register a tear-down; `goto(next)` invokes it before switching. `play` MUST register cleanup that cancels its RAF + clears its event listeners; without it, "Try again" leaks the RAF loop.

Cam/mic stream opened once in `loading`, persisted across attempts. Released only in `final` (after submit). Mic floor is re-measured at the start of every `play` phase (see Flappy mechanics below).

### Runtime failure modes

All games must handle (modelled on gesture-lock `1-gesture-lock.html:707`):

- **`visibilitychange`**: when `document.hidden` becomes true during `play`, pause the RAF + freeze the attempt timer; resume on return. Mirror gesture-lock's `hiddenAt` pattern.
- **Mic / cam stream ends mid-game** (`stream.getTracks()[0].onended`): treat as instant attempt-end with `died: true`, completed = current score, advance to `attempt-end` with a "Camera/microphone disconnected" message in `attemptResultTitle`.
- **Permission revoked mid-game**: same as stream-ended.
- **Low FPS fallback**: a 1Hz EMA of frame-time runs continuously during `play`. If the EMA exceeds 25ms (i.e. < 40 FPS) for 3 consecutive ticks, log a warning to console and surface a "Low frame rate — moves may feel slow" toast. Mid-game `numHands` swap is OUT OF SCOPE for this pass (requires re-creating the tracker which is expensive). Document as a follow-up.

These handlers live in the page module, not in `dino-logic.js` / `flappy-logic.js` (which stay pure).

## Dino — Mechanics

**Goal:** team-jumps and ducks past obstacles. Score = obstacles passed before death or time-out.

### Input → action

Multiple team members in front of one camera. MediaPipe `numHands: 8` (480×360 input). Tracker output flickers: MediaPipe does not guarantee returning every hand in frame; under occlusion, IDs and counts swap frame-to-frame.

To reconcile "low latency" with "stable jump strength":

- **Sample buffer**: maintain `palmCountWindow[N]` (ring buffer, `N = 4` frames). Each RAF, push current `hands.filter(isPalmOpen).length`.
- `effectivePalmCount = max(palmCountWindow)` — uses the strongest recent detection (4 frames @ 60 Hz = 66ms). Resists flicker drop-outs without delaying the *first* detection.
- **Jump strength**:
  - `v0 = palmCountToJumpStrength(effectivePalmCount)` — see logic module below.
  - On ground + edge transition (`effectivePalmCount` rose from 0 to >0 since last frame) → apply `vy = -v0`. This means the jump fires on first-detection frame; subsequent frames just sustain the same `v0` value.
- **Duck**: `ducking = hands.some(isFist) && onGround`. No smoothing — duck is a sustained state, not an impulse.
- Input read once per RAF at top of `step()`; physics applied same frame. No hold-time gates (no "must hold palm for 250ms").

### Physics
- All quantities are **per-60Hz-frame** (px/frame, px/frame²), multiplied by `dt` (= actual ms / 16.67) each step. Matches existing `dino/main.js` convention.
- Gravity: 0.8 px/frame²
- Max fall vy: 9 px/frame
- Runner box: `w=30, h=60`; ducking → height × 0.55
- Speed (px/frame): linear ramp `speed = clamp(4 + meters * 0.02, 4, 9)`. `meters` accumulates `speed * 0.06 * dt` per frame (existing convention).

### Obstacles
- Low (h=30) only spawn while score < 4
- After score ≥ 4: 60% low / 40% high (h=45)
- `spawnEvery = clamp(110 - meters*0.3, 60, 110)`
- Visuals: flat dark rect `var(--bg-2)` fill, `var(--accent)` 2px border. No bar-charts, no glow.

### Runner sprite
- Simple silhouette: filled `var(--text)` rounded rectangle with eye dot in `var(--accent)`. Running animation via leg position swap based on `meters % 12`.
- Ducking: rect compressed to 55% height.
- (Note: prior version called this "knight" — name dropped along with cyberpunk theme.)

### Scoring
- `MAX_OBSTACLES = 16`
- `scoreAttempt({ completed, timeSec, died })` →
  - Base: `round(completed * (100 / MAX_OBSTACLES))`
  - Time bonus when `completed === MAX_OBSTACLES`: `+ max(0, round(20 - timeSec/2))`
  - Cap 100
- `finalScore(attempts)` = `max(a.score)` across attempts (best of 3)
- Attempt ends: collision, completed ≥ 16, 60s cap

### Per-attempt HUD layout
Mirrors gesture-lock recall layout (`1-gesture-lock.html:114`): `.game { display: grid; grid-template-columns: 1fr 360px; gap: 24px; }`. Left = 960×540 canvas. Right = side panel (360px) containing, top-to-bottom:
- Score badge: `SCORE N / 16`
- Cam preview 240×135 (mirrored), with palm-count overlay (0–8 dots filling)
- Jump-strength meter bar (`effectivePalmCount` → fill %)
- Timer + attempt counter stats (gesture-lock `.stats` block, reused 1:1)
- "Abort attempt" secondary button

## Flappy — Mechanics

**Goal:** keep orb alive through pipe gaps via team-yelling. Score = pipes passed before death or time-out.

### Input → action

- Floor calibration runs at the **start of every `play` phase** (1.5s quiet sample, median amp; UI shows "Calibrating… stay quiet" overlay on canvas). Rooms get louder between attempts as the team cheers — one-shot calibration drifts. Each attempt gets its own fresh floor on `state.floor`.
- Each frame: `thrust = ampToThrust(amp, state.floor)` = `max(0, (amp - floor)) * GAIN`, `GAIN = 25`.
- `createAudioInput({ smoothing: 0.7 })` — higher than current default 0.4 → less EMA lag.
- No threshold gate, no mode switch, no sustain logic.
- Physics applied same frame: `vy += GRAVITY * dt; vy -= thrust * dt`.

### Physics
- All quantities per-60Hz-frame, dt-scaled — same convention as dino.
- Gravity: 0.28 px/frame²
- vy clamped ±10 px/frame
- Orb radius 18 px
- Pipe width 80 px
- Gap height 240 px (constant)

### Pipes
- `speed = clamp(3 + score * 0.12, 3, 6)`
- `spawnEvery = clamp(160 - score*2, 100, 160)`
- Flat bands: `var(--accent)` border, semi-transparent `var(--card)` fill. No anomaly art, no internal charts.

### Orb
- Solid `var(--accent)` circle
- Pulse: radius +10% on frames where `thrust > 0`
- No trail (drop current rainbow trail)

### Scoring
- `MAX_PIPES = 20`. (Current implementation caps at 31; lowered because pipe gaps shrink past playable point. Historical scoreboard rows in any pre-redesign lobby may show values up to 30 — they remain valid raw counts, but the 0–100 normalised score that flows into `submitScore` is new. For the offsite event this is fine: lobbies are reset before play.)
- `scoreAttempt({ completed, timeSec, died })` →
  - Base: `round(completed * (100 / 20))`
  - Time bonus when `completed === 20`: `+ max(0, round(15 - timeSec/3))`
  - Cap 100
- `finalScore(attempts)` = `max(a.score)` across attempts
- Attempt ends: pipe collision, floor/ceiling, completed ≥ 20, 60s cap

### Per-attempt HUD layout
Same `1fr 360px` grid as dino. Left = 960×540 canvas. Right side panel:
- Score badge: `SCORE N / 20`
- Vertical voice-meter (style retained from current flappy `index.html:26`; sustain marker + trigger marker REMOVED, only the floor line stays)
- Timer + attempt counter stats
- "Abort attempt" secondary button

## Latency Strategy

**Stretch goal:** sub-100ms gesture→action, sub-50ms voice→action on a mid-tier laptop. Hard target unverified — published MediaPipe `HandLandmarker` GPU figures on web suggest 15–30ms inference for a single hand; multi-hand scales roughly linearly in post-processing. End-to-end (capture → infer → next RAF → paint) is realistically 60–120ms before any of the wins below. Treat the number as a direction, not a contract.

**Implement tactics 1–6, then measure with the debug overlay (7) on the actual offsite laptop. If measured input→action exceeds ~150ms or sustained tracker FPS < 40, fall back to `numHands: 4`.**

1. **Tracker tick every RAF.** `minRunMs: 0` (via vision.js change above). Removes 16–33ms stalls from the existing 33ms throttle.
2. **Cam resolution 480×360.** Faster MediaPipe inference vs current 640×480.
3. **`numHands: 8`**, GPU delegate, float16 model. Fall back to 4 per the measurement step.
4. **Single-frame pipeline.** Inside RAF: `readInput → step → render`. Input read same frame physics uses. No 1-frame lag.
5. **No input hold gates.** Palm-detected frame → jump frame (modulo the 4-frame `palmCountWindow` max-buffer described in dino input — that's 66ms of resilience, not a delay on first detect).
6. **Audio:** `createAudioInput({ smoothing: 0.7 })` (default is 0.4 — flappy currently inherits default). Lower EMA history → less voice→action lag.
7. **Debug overlay** behind `?debug=1`: per-frame `input-ms` (RAF-start → physics step), `infer-ms` (`detectForVideo` duration), `paint-ms` (after render). Logged to a fixed-position div and `console.table` every 60 frames.

**Pre-implementation bench step**: before writing the full game pages, build a one-page dino skeleton wired to the new `vision.js` options, open it on the offsite laptop, eyeball the debug overlay numbers. Adjust the design (likely `numHands`, `palmCountWindow` size) before locking the rest. This bench is listed in the implementation plan as a gate.

## Code Organization

### `shared/dino-logic.js`
```
export const MAX_OBSTACLES = 16;
export const ATTEMPT_CAP_S = 60;
export const PALM_COUNT_WINDOW = 4;

// Returns 0 when n===0, else linearly maps n=1..8 to v0=8..20 (clamped).
export function palmCountToJumpStrength(n) {
  if (n <= 0) return 0;
  return Math.min(20, 6 + n * 2);
}

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

`tests/dino-logic.test.js` covers (assert exact returned values):
- `scoreAttempt({completed: 0, timeSec: 60, died: true})` → 0
- `scoreAttempt({completed: 16, timeSec: 30, died: false})` → 100 (base 100 + 5 bonus, capped at 100)
- `scoreAttempt({completed: 16, timeSec: 60, died: false})` → 100 (base 100, bonus floored at 0)
- `scoreAttempt({completed: 16, timeSec: 0, died: false})` → 100 (base 100 + 20 bonus, capped at 100)
- `scoreAttempt({completed: 8, timeSec: 20, died: true})` → 50 (no bonus without max)
- `finalScore([{score:30},{score:75},{score:20}])` → 75
- `finalScore([{score:0},{score:0},{score:0}])` → 0
- `finalScore([])` → 0
- `palmCountToJumpStrength(0)` → 0
- `palmCountToJumpStrength(1)` → 8
- `palmCountToJumpStrength(4)` → 14
- `palmCountToJumpStrength(8)` → 20 (clamped)
- `palmCountToJumpStrength(20)` → 20 (clamped)

`tests/flappy-logic.test.js` covers:
- `scoreAttempt({completed: 0, timeSec: 5, died: true})` → 0
- `scoreAttempt({completed: 20, timeSec: 30, died: false})` → 100 (base 100 + 5 bonus, capped)
- `scoreAttempt({completed: 20, timeSec: 60, died: false})` → 100 (base 100, bonus floored)
- `scoreAttempt({completed: 10, timeSec: 15, died: true})` → 50
- `finalScore([{score:40},{score:80},{score:20}])` → 80
- `ampToThrust(0.10, 0.05)` → `0.05 * 25` = 1.25
- `ampToThrust(0.05, 0.10)` → 0 (amp below floor)
- `ampToThrust(0, 0)` → 0

Harness: project uses Vitest (verify in `package.json` during impl; if different, adapt).

## Out of Scope

- Audio worklet rewrites beyond the smoothing default change
- New vision helpers beyond the parameterisation of existing `createCamStream` / `createHandTracker`
- Catalog UI changes beyond path repoint
- Multi-team-simultaneously-online play (current platform plays one team at a time; spec adds multi-player-per-team input, not multi-team)
- Mobile touch controls (camera/mic only)
- Mid-game `numHands` hot-swap (recreate tracker = expensive; documented as follow-up)
- Historical score migration (event lobbies are reset before play)
