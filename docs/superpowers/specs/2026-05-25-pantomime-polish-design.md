# Pantomime polish — design

**Status:** approved
**Date:** 2026-05-25
**Scope:** `ps-offsite-2026/stations/2-pantomime.html`, new `ps-offsite-2026/shared/pantomime-logic.js`, new `tests/pantomime-logic.test.js`

## Goal

Bring Station 2 (CV Pantomime) up to the structural and UX polish bar set by Station 1 (Gesture Lock). Keep gameplay mechanic the same (timed per-pose match-and-hold) but adopt the same phase state machine, shared-logic split, feedback animations, and per-pose sampling that the gesture-lock station uses.

## Out of scope

- Retry/attempt model (Pantomime stays single-run; per-pose timeout = 0 pts on skip).
- New poses or new check functions.
- Scoreboard / Firebase changes.

## Architecture

### Phase state machine

Mirror the gesture-lock pattern. Single `goto(phase)` switches visible card and invokes `phaseEnter[phase]()`. Each phase owns its timers / RAF and registers `activeCleanup` so `goto()` can tear down safely.

Phases:

| Phase       | Purpose |
|-------------|---------|
| `setup`     | Team select + team-size select + start button. |
| `loading`   | Lazy-load MediaPipe `PoseLandmarker` and camera stream. |
| `countdown` | 3-2-1 before play (parity with gesture-lock). |
| `playing`   | Full 7-pose loop. Per-pose timeout governs intra-phase flow — no nested phases. |
| `final`     | Score, breakdown, submit code, play-again. |

Gesture-lock's `intro` / `memorize` / `attempt-end` phases are not needed (no memorization, no retries).

### Visibility pause

Same approach as gesture-lock recall: track `hiddenAt` on `visibilitychange`. On resume, shift `stepStartTs` forward by hidden duration so per-pose timeout doesn't expire while tab is backgrounded.

Switch per-pose timeout from `setTimeout(handle, pose.timeout*1000)` to RAF-driven elapsed check inside the loop (loop already polls elapsed for the timer bar). This removes the drift hazard and integrates with the visibility shift naturally.

## Shared logic module

New file `ps-offsite-2026/shared/pantomime-logic.js`. Pure ES module, no DOM.

Exports:

- `LM` — MediaPipe landmark index map (NOSE, L_SHOULDER, ...).
- `SKEL_LINES` — bone definitions for ghost overlay rendering.
- `dist(a, b)`, `angle(a, b, c)`, `smoothScore(value, target, tol)` — pure math helpers.
- `POSE_POOL` — array of all 12 pose definitions (id, name, emoji, difficulty, timeout, desc, ref, checks).
- `samplePoses(pool, mix)` — returns a randomized array. Default `mix = { easy: 2, medium: 3, hard: 2 }`. Random within each tier, no duplicates within a tier. Throws if a tier is under-resourced.

  Current pool composition: 2 easy (T-Pose, Star Jump), 4 medium (Conductor, Superhero, Skier, Wide Squat), 6 hard (Disco, Warrior, Tree, Liberty, Karate, Arabesque). Easy tier is exhaustively chosen at the default mix — both easy poses always appear. Medium picks 3 of 4. Hard picks 2 of 6.
- `scorePose({ sim, locked })` — `locked ? round(clamp(sim*100, 0, 100)) : 0`.
- `finalScore(perPoseScores)` — `round(sum / perPoseScores.length)`.

HTML imports from `../shared/pantomime-logic.js`.

## UX feedback

Add the visual feedback patterns gesture-lock uses:

- `.video-wrap.match-pulse` — green glow + inset ring, 0.6s `match-pulse` keyframes, triggered when a pose locks in.
- `.video-wrap.miss-flash` — red inset flash, 0.45s `miss-flash` keyframes, triggered on per-pose timeout (and manual skip).
- `.step-badge` — top-right of video, e.g. `3 / 7`.
- Player banner — card above `pose-card`. Shows `Player N` where `N = (stepIdx % teamSize) + 1`. Team-size dropdown (2–8, default 4) added next to team # at setup.
- Ghost-skeleton toggle stays as today.

Anti-replay: `pulseVideo(cls)` removes both classes, forces reflow, then adds — same idiom as gesture-lock.

## Scoring

- Per-pose locked score: `round(clamp(sim*100, 0, 100))`.
- Skipped or timed-out: `0`.
- Final: `round(sum(perPoseScores) / 7)`.
- Submit code unchanged: `PM-<teamId>-<finalScore>`.
- Breakdown panel on final card lists the 7 sampled poses (not the full 12), each with score, difficulty pill, and "— skipped" suffix when zero.

## Teardown

`goto('final')` stops the camera stream (`stream.getTracks().forEach(t => t.stop())`). The landmarker is retained (cheap to reuse, expensive to recreate). Play-again resets state to `setup` and lazy-init re-creates only the stream.

## Test plan

New file `tests/pantomime-logic.test.js` (Vitest, matching existing test setup):

- `samplePoses` returns exactly 7 poses with the requested mix (2 easy, 3 medium, 2 hard).
- `samplePoses` produces different medium/hard selections across calls (easy tier is exhaustive at default mix).
- `scorePose` returns 0 when not locked.
- `scorePose` rounds and clamps locked similarity.
- `finalScore` returns 0 for empty array.
- `finalScore` averages correctly and rounds.

Manual verification:

- Full play-through of 7 poses without backgrounding tab.
- Backgrounding tab mid-pose does not consume the per-pose timeout.
- Camera stream stops after final card appears (verify camera indicator).
- Skip button triggers miss-flash and advances.

## Migration / risk

- HTML file is significantly restructured — review carefully. Logic extraction is mechanical (cut/paste pure functions); the state-machine rewrite is the riskier change.
- No persistence changes; submit code format stable.
- No breaking API for the scoreboard.
