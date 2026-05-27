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
- **Coordinate space (important):** MediaPipe normalizes every body's landmarks to
  the **shared video frame** (0..1 over the whole image), *not* per-body. So a
  cross-person distance like `dist(a.rWr, b.lWr)` is a meaningful whole-frame
  distance — this is what makes the duo checks possible. The video/canvas
  `scaleX(-1)` is **CSS display only** (`2-pantomime.html` ~L533-534); the landmark
  data fed to `detectForVideo` is raw, unmirrored video space. No check should flip
  coordinates.
- Each frame, `result.landmarks` is an array of 0..2 bodies.
  - **Primary body** (for solo poses) = the body with the largest torso size
    (`dist(shoulderMid, hipMid)`). NOTE: today's solo path reads `landmarks[0]`
    (detection order); with `numPoses: 2` a stray second body could be `[0]`, so the
    largest-torso pick is a deliberate behavior change that also hardens solo play.
    Falls back to `landmarks[0]` if only one body.
  - For duo poses, take the two bodies and sort by mid-hip x → `personLeft` =
    smaller x, `personRight` = larger x. This gives a **stable pair assignment**
    (all the cross-person checks need only that), assuming players don't fully cross
    sides mid-hold. Because the display is mirrored, data-space `personLeft`
    corresponds to the player on the **viewer's right**; this only matters for the
    ref-card layout (see Rendering note).

### `handlePose` branching (in `2-pantomime.html`)

- `const isDuo = (pose.people ?? 1) === 2;`
- **Solo path** (unchanged): use primary body, `c.fn(lm)`.
- **Duo path:**
  - Visibility gate: require **both** bodies present with the key joints
    (shoulders, hips, knees, ankles) visible > 0.4. If only one body, set hint
    "Need 2 people in frame", reset hold, return.
  - Run checks as `c.fn(personLeft, personRight)`.
  - Hint on success: "✓ Both bodies detected".
- **Similarity & lock are identical to solo:** `sim = mean(check values)`, and the
  lock condition stays `sim > 0.85 && stable` held for the hold time. Duos do NOT
  introduce per-body averaging or a different threshold — only the check signature
  and the stability computation differ.

### New poses (`POSE_POOL`)

**Human Arch** (`id: 'arch'`, emoji `🌉`, duo)
- desc: "Two people side by side — raise both arms overhead so your inner hands
  meet in the middle. Make an arch."
- checks `fn(a, b)`:
  1. **Left person arms up** — both wrists above shoulders
     (`a.lWr.y < a.lSh.y` and `a.rWr.y < a.rSh.y`), scored via `smoothScore` on the
     y-gap.
  2. **Right person arms up** — same for `b`.
  3. **Hands meet at apex** — the inner wrists are close. Because coords are
     **shared-frame** normalized, the tolerance must be sized for two-people-in-frame
     geometry and scaled by body width, not a fixed solo-scale number. Use a
     **shoulder-width-relative** measure: let `wL = dist(a.lSh, a.rSh)` (left
     person's shoulder width) and score
     `smoothScore(dist(a.rWr, b.lWr) / wL, 0, 1.2)` — i.e. inner wrists within ~1.2
     shoulder-widths of each other count as "meeting". (Avoids the brittle absolute
     `0.12`; final constant is a live-tuning knob.) `a.rWr`/`b.lWr` are the inner
     wrists given the hip-x sort.
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
- Note on "mirrored": landmark coords are **unmirrored** video space; the CSS
  `scaleX(-1)` is display-only and must NOT be applied to coords. When two people
  face the camera and mirror each other, person A raises their anatomical-left arm
  while person B raises their anatomical-right arm. So the check compares **A's
  `L_*` joints to B's `R_*` joints** (and A.R_* to B.L_*). This is due to the
  humans mirroring each other, not due to the canvas flip — do not introduce any
  x-axis coordinate flip.

### Hold / timeout / stability

- Duo timeout: **25 s** (consistent with all poses).
- Duo hold: **1.5 s** (`HOLD_MS_BY_DIFFICULTY.duo = 1500`).
- **Wobble/stability check kept for duos**, with a **looser** drift threshold
  (`STABILITY_MAX_DRIFT_DUO = 0.045` vs solo `0.025`) and computed over **both**
  bodies' key joints (wrists, ankles, knees).
- **Buffer-shape gap (must not reuse the solo reader).** Today `recentLandmarks`
  holds, per frame, a *flat landmark array* and the stability reader does
  `frame[j]` expecting a landmark object (`2-pantomime.html` ~L685 push, ~L695
  read). A duo frame has two bodies, so the solo `frame[j]` access would break.
  Resolution:
  - `startStep` already resets `recentLandmarks = []` each pose, so there is **no
    cross-pose carryover** when switching between solo and duo — but the entry shape
    differs per pose type, so the **reader must branch on `isDuo`**.
  - Duo buffer entry shape: `{ a: [...landmarks], b: [...landmarks] }` (the two
    hip-x-sorted bodies, each mapped to `{x,y}` like the solo case).
  - Duo drift: for each key joint `j` in {L_WRIST, R_WRIST, L_ANKLE, R_ANKLE,
    L_KNEE, R_KNEE}, compute the (max−min) over the window for **both** `entry.a[j]`
    and `entry.b[j]`; `stabilityDrift = max` across all of those. `stable =
    stabilityDrift <= STABILITY_MAX_DRIFT_DUO`.
  - If fewer than 2 bodies on a frame, push nothing / reset the buffer (can't be
    stable). Same `STABILITY_WINDOW` as solo.
- Scoring unchanged (`scorePose`, `finalScore` mean over 8).

### `samplePoses`

- New signature/default: `samplePoses(pool, mix = { easy: 2, medium: 2, hard: 2, duo: 2 })`.
  `phaseEnter.playing` calls `samplePoses(POSE_POOL)` with no args, so this default
  governs a normal run.
- **Pose-count change to flag:** today's default is `{ easy:2, medium:3, hard:2 }` =
  **7 solo**. The new run is **6 solo + 2 duo = 8**, which means **medium drops
  3→2**. This is intentional (keeps the run at 8, not 9). Call it out so it's not a
  silent regression.
- **Must fix the hardcoded `byTier`.** Current code:
  `const byTier = { easy: [], medium: [], hard: [] };` then iterates
  `for (const tier of ['easy','medium','hard'])`. A `duo` pose would do
  `byTier['duo'].push(p)` on `undefined` → **TypeError at module load**. Required
  changes:
  - `const byTier = { easy: [], medium: [], hard: [], duo: [] };`
  - Build solo output by iterating the solo tiers `['easy','medium','hard']` in
    order (escalating), THEN append the duo picks **after** the loop so duos are
    always last: `out.push(...shuffle(byTier.duo).slice(0, mix.duo || 0))`.
  - Keep the existing "not enough poses in tier" throw for every requested tier
    including `duo`.
- Duo order at the end is cosmetic (both always included); shuffle is fine.

### Rendering

- **Ghost overlay off for duo poses**: `drawSkeleton` skips `drawGhostOverlay`
  when `(pose.people ?? 1) === 2`. The live detected skeletons of both players plus
  the reference card carry the guidance. (Placing two ghosts at the right screen
  positions for two freely-standing people is unreliable.)
- **`renderRefSvg`** is called from `startStep` with the **pose** (not a bare
  `ref`) so it can branch: solo → draw `pose.ref` as today; duo → draw each of
  `pose.refs` into its half of the 200×200 viewBox (left ref x mapped to [10,95],
  right ref x mapped to [105,190]) so the card shows two stick figures. The ref
  card is **screen-space** (left figure = viewer's left); it does not need to match
  data-space `personLeft` (which is the viewer's right under the mirror). The
  cross-person checks are symmetric / sort-stable, so this mismatch is purely
  cosmetic and never affects scoring.

### UI / copy

- `.difficulty.duo` badge: color via `var(--accent-2)` (cyan) directly, matching the
  existing `.difficulty.easy/medium/hard` pattern. A dedicated `--duo` var is
  optional, not required. The badge already renders the literal tier text, so "duo"
  prints with no other change.
- `cam-flash` on entering a duo step shows **"👥👥 Grab a partner!"** instead of
  "👥 Next player — take turns". `startStep` chooses text by `pose.people`.
- Briefing copy: replace the existing literal **"7 poses per run, escalating
  difficulty."** string (`2-pantomime.html` ~L297) with "8 poses per run — the last
  2 need a **partner** (two people in frame)." The `stepBadge` default text "1 / 7"
  is overwritten at runtime by `startStep`, so it's cosmetic, but update it to
  "1 / 8" for tidiness.

## Files touched

- `shared/pantomime-logic.js` — two new duo poses (`refs`, `people: 2`, `fn(a,b)`
  checks), `byTier`/`samplePoses` duo handling (fixes the crash), helper(s) for the
  duo checks. (`HOLD_MS_BY_DIFFICULTY` and the stability constants live in the HTML,
  see below.)
- `games/2-pantomime.html` — `numPoses: 2`, largest-torso primary-body + hip-x
  two-body selection, `handlePose` duo branch (incl. identical sim/lock),
  `isDuo`-branched stability buffer + `STABILITY_MAX_DRIFT_DUO`,
  `HOLD_MS_BY_DIFFICULTY.duo = 1500`, `renderRefSvg(pose)` duo path,
  `drawSkeleton` ghost skip for duos, `.difficulty.duo` CSS, `flashCam` text by
  `pose.people`, briefing + stepBadge copy.

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
