# Pantomime — Duo (2-person) Poses

**Date:** 2026-05-27
**Status:** Approved (pending spec review)

## Goal

Add poses that require **two people** in frame, validated by real computer vision
across two detected skeletons. A run becomes **8 poses: 6 solo (escalating) then
2 duo** as the climax. The two duo poses are **Human Arch** and **Mirror Twins**.

## Background / current state

- `games/2-pantomime.html` runs MediaPipe `PoseLandmarker` with `numPoses: 1`.
- Poses live in `shared/pantomime-logic.js` as `POSE_POOL`. Each pose:
  `{ id, name, emoji, difficulty: 'easy'|'medium'|'hard', timeout, desc, ref, checks }`.
- A check is `{ name, fn }` where `fn(lm)` reads one body's landmark array and
  returns 0..1. Overall similarity = mean of check values. Lock requires
  similarity `> 0.85` **and** stability (no wobble) held for
  `HOLD_MS_BY_DIFFICULTY[difficulty]`.
- `samplePoses(pool, { easy, medium, hard })` shuffles each tier and concatenates.
- `ref` is `{ nose, lSh, rSh, lEl, rEl, lWr, rWr, lHip, rHip, lKnee, rKnee, lAnkle, rAnkle }`
  with normalized 0..1 coords; `renderRefSvg(ref)` and `drawGhostOverlay(ref)` draw it.
- All solo timeouts are currently 25 s. Hold: easy 1.2 / medium 1.5 / hard 2.0 s.
- `scorePose({ sim, locked })` → 0 if not locked, else `round(sim*100)`.
  `finalScore` = mean of per-pose scores.

## Design

### Pose schema additions

- New tier value `difficulty: 'duo'` and field `people: 2` on duo poses. Existing
  poses are implicitly `people: 1` (no change to their objects required; treat
  missing `people` as 1).
- Duo poses carry **two reference skeletons**: `refs: [refLeft, refRight]`
  (existing solo poses keep their single `ref`).
- Duo checks use a **two-body signature**: `fn(a, b)` where `a` = left person's
  landmarks, `b` = right person's landmarks. Each still returns 0..1.

### Detection & body selection

- `PoseLandmarker` option changes to `numPoses: 2`.
- Each frame, `result.landmarks` is an array of 0..2 bodies.
  - **Primary body** (for solo poses) = the body with the largest torso size
    (`dist(shoulderMid, hipMid)`); falls back to `landmarks[0]`.
  - For duo poses, take the two bodies and sort by mid-hip x → `personLeft`,
    `personRight`, so checks have a stable left/right assignment. (Assumes players
    don't fully cross sides mid-hold; acceptable.)

### `handlePose` branching (in `2-pantomime.html`)

- `const isDuo = (pose.people ?? 1) === 2;`
- **Solo path** (unchanged): use primary body, `c.fn(lm)`.
- **Duo path:**
  - Visibility gate: require **both** bodies present with the key joints
    (shoulders, hips, knees, ankles) visible > 0.4. If only one body, set hint
    "Need 2 people in frame", reset hold, return.
  - Run checks as `c.fn(personLeft, personRight)`.
  - Hint on success: "✓ Both bodies detected".

### New poses (`POSE_POOL`)

**Human Arch** (`id: 'arch'`, emoji `🌉`, duo)
- desc: "Two people side by side — raise both arms overhead so your inner hands
  meet in the middle. Make an arch."
- checks `fn(a, b)`:
  1. **Left person arms up** — both wrists above shoulders
     (`a.lWr.y < a.lSh.y` and `a.rWr.y < a.rSh.y`), scored via `smoothScore` on the
     y-gap.
  2. **Right person arms up** — same for `b`.
  3. **Hands meet at apex** — the inner wrists are close:
     `smoothScore(dist(a.rWr, b.lWr), 0, 0.12)` (left person's right wrist vs right
     person's left wrist). Left/right resolved by hip-x sort so this is stable.
  4. **Arms straight** — mean of shoulder-elbow-wrist angles near 170° across all
     four arms.

**Mirror Twins** (`id: 'twins'`, emoji `🪞`, duo)
- desc: "Both strike the SAME shape — one arm up, one arm out to the side. Mirror
  each other."
- checks `fn(a, b)`:
  1. **Both arms raised into a shape** — each person has one wrist clearly above
     the head and one wrist roughly shoulder height out to the side (gives a
     definite, matchable silhouette; avoids "both standing still" trivially
     matching).
  2. **Arm angles match (mirrored)** — compare A's joint angles to B's mirrored
     angles: left-elbow and right-elbow flexion of A vs B within tolerance,
     scored with `smoothScore` on the angle difference.
  3. **Torso lean matches** — shoulder-tilt of A ≈ shoulder-tilt of B.
- Note: "mirrored" means we compare A's left side to B's right side, since the two
  people face the camera.

### Hold / timeout / stability

- Duo timeout: **25 s** (consistent with all poses).
- Duo hold: **1.5 s** (`HOLD_MS_BY_DIFFICULTY.duo = 1500`).
- **Wobble/stability check kept for duos**, with a **looser** drift threshold
  (`STABILITY_MAX_DRIFT_DUO = 0.045` vs solo `0.025`) and computed over **both**
  bodies' key joints (wrists, ankles, knees). The recent-frames buffer stores both
  sorted bodies per frame; per-joint drift is the max across both bodies. If only
  one body is present the buffer resets (can't be stable).
- Scoring unchanged (`scorePose`, `finalScore` mean over 8).

### `samplePoses`

- New signature: `samplePoses(pool, mix = { easy: 2, medium: 2, hard: 2, duo: 2 })`.
- Solo tiers (`easy`, `medium`, `hard`) picked and concatenated in escalating order
  as today (6 poses).
- `duo` tier picked (2 poses) and appended **last**, in fixed order Human Arch then
  Mirror Twins (or shuffled — both required, order cosmetic; spec picks Arch→Twins).
- Throws if a tier lacks enough poses (existing behavior).

### Rendering

- **Ghost overlay off for duo poses**: `drawSkeleton` skips `drawGhostOverlay`
  when `(pose.people ?? 1) === 2`. The live detected skeletons of both players plus
  the reference card carry the guidance. (Placing two ghosts at the right screen
  positions for two freely-standing people is unreliable.)
- **`renderRefSvg`** is called from `startStep` with the **pose** (not a bare
  `ref`) so it can branch: solo → draw `pose.ref` as today; duo → draw each of
  `pose.refs` into its half of the 200×200 viewBox (left ref x mapped to [10,95],
  right ref x mapped to [105,190]) so the card shows two stick figures.

### UI / copy

- New badge color: `--duo` (cyan, reuse `--accent-2`). Add `.difficulty.duo`
  style. The difficulty badge renders the literal tier text ("duo").
- `cam-flash` on entering a duo step shows **"👥👥 Grab a partner!"** instead of
  "👥 Next player — take turns". `startStep` chooses text by `pose.people`.
- Briefing copy: "8 poses per run — the last 2 need a **partner** (two people in
  frame)."

## Files touched

- `shared/pantomime-logic.js` — duo refs/checks, two new poses, `HOLD` duo entry
  is in the HTML (see below), `samplePoses` duo handling.
- `games/2-pantomime.html` — `numPoses: 2`, primary-body + two-body selection,
  `handlePose` duo branch, duo stability buffer/threshold,
  `HOLD_MS_BY_DIFFICULTY.duo`, `STABILITY_MAX_DRIFT_DUO`, `renderRefSvg` duo path,
  `drawSkeleton` ghost skip, `.difficulty.duo` CSS + `--duo`, `cam-flash` text by
  `pose.people`, briefing copy.

## Out of scope / non-goals

- More than 2 people per pose.
- Per-person scoring (the duo gets one combined score, like every pose).
- Changing solo poses, other games, or scoreboard.

## Risks

- **Body order swap**: if the two players cross sides mid-hold, left/right sort
  flips and "hands meet" / mirror checks may dip. Acceptable for a party game;
  players naturally hold position during the 1.5 s lock.
- **Two-body detection cost**: `numPoses: 2` is slightly heavier; lite model should
  still hit frame budget on a laptop. Verify on target hardware.
- **Mirror Twins tuning**: matching two noisy skeletons is the hardest check;
  tolerances may need a live tuning pass.
