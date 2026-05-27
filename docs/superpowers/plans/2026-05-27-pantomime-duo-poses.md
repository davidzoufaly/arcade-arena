# Pantomime Duo (2-Person) Poses Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two 2-person poses (Human Arch, Mirror Twins) to the webcam pantomime game, validated across two detected skeletons, so a run becomes 6 solo + 2 duo = 8 poses.

**Architecture:** Pure pose data + check functions live in `shared/pantomime-logic.js` (unit-tested with vitest). The webcam wiring in `games/2-pantomime.html` upgrades MediaPipe to `numPoses: 2`, branches `handlePose` on `pose.people`, and renders two reference figures for duo poses (browser-verified, not unit-testable).

**Tech Stack:** Vanilla ES modules, MediaPipe Tasks Vision (PoseLandmarker), Vite, Vitest.

**Spec:** `docs/superpowers/specs/2026-05-27-pantomime-duo-poses-design.md`

---

## Key facts the implementer must know

- **Check functions receive landmark ARRAYS**, indexed by `LM.*` numbers (e.g.
  `lm[LM.L_WRIST]` → `{x, y, visibility}`). They do NOT use ref-style keys
  (`.lWr`). The spec uses `.lWr` shorthand for readability; **real code uses
  `a[LM.X]`**. Solo checks are `fn(lm)`, duo checks are `fn(a, b)`.
- **Coordinates are normalized to the shared video frame** (0..1 over the whole
  image), so a cross-person distance like `dist(innerA, innerB)` is meaningful.
- **The video/canvas `scaleX(-1)` is display-only.** Landmark data is unmirrored.
  Never flip a coordinate in a check. To find a person's "inner" wrist (toward the
  other person) use the wrist with the larger/smaller **x**, not an anatomical
  L/R index — this is robust to the mirror.
- `smoothScore(value, target, tol)` = 1 when `|value-target| <= tol`, falls
  linearly to 0 at `2*tol` away.
- Existing tests in `tests/pantomime-logic.test.js` assert the OLD shape (12 poses,
  tiers `{easy:2,medium:4,hard:6}`, difficulty ∈ easy/medium/hard, `samplePoses`→7).
  These change in Tasks 1–2; update them, don't work around them.

## File structure

- **Modify** `ps-offsite-2026/shared/pantomime-logic.js`
  - Add ref builders `archRefLeft/Right`, `twinsRefLeft/Right`.
  - Add module-local helper `twinShape(p)`.
  - Add 2 duo pose objects (`difficulty:'duo'`, `people:2`, `refs:[…]`, `fn(a,b)`).
  - Extend `samplePoses` (`byTier.duo`, default mix, append duos last).
- **Modify** `tests/pantomime-logic.test.js`
  - Update POSE_POOL + samplePoses assertions; add duo-check behavior tests.
- **Modify** `ps-offsite-2026/games/2-pantomime.html`
  - `numPoses:2`; body-selection helpers; `handlePose` solo/duo branch;
    `isDuo` stability buffer + `STABILITY_MAX_DRIFT_DUO`; `HOLD_MS_BY_DIFFICULTY.duo`;
    `renderRefSvg(pose)` duo path; `drawSkeleton` ghost skip; `.difficulty.duo` CSS;
    `flashCam` text by `pose.people`; briefing + stepBadge copy.

---

## Task 1: Add duo poses to `pantomime-logic.js`

**Files:**
- Modify: `ps-offsite-2026/shared/pantomime-logic.js`
- Test: `tests/pantomime-logic.test.js`

- [ ] **Step 1: Write failing tests for the duo poses**

Add this block at the END of `tests/pantomime-logic.test.js`:

```javascript
// ---- Duo poses ----
function mkBody(parts) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  for (const [k, v] of Object.entries(parts)) lm[LM[k]] = { x: v.x, y: v.y, visibility: 1 };
  return lm;
}
const getPose = (id) => POSE_POOL.find(p => p.id === id);

describe('duo poses presence', () => {
  it('POSE_POOL has the two duo poses, tagged people:2 and difficulty duo', () => {
    for (const id of ['arch', 'twins']) {
      const p = getPose(id);
      expect(p).toBeDefined();
      expect(p.people).toBe(2);
      expect(p.difficulty).toBe('duo');
      expect(Array.isArray(p.refs)).toBe(true);
      expect(p.refs).toHaveLength(2);
      expect(p.timeout).toBe(25);
      expect(p.checks.length).toBeGreaterThan(0);
    }
  });

  it('duo refs contain all skeleton joints', () => {
    const required = ['nose','lSh','rSh','lEl','rEl','lWr','rWr','lHip','rHip','lKnee','rKnee','lAnkle','rAnkle'];
    for (const id of ['arch', 'twins']) {
      for (const ref of getPose(id).refs) {
        for (const j of required) {
          expect(typeof ref[j].x).toBe('number');
          expect(typeof ref[j].y).toBe('number');
        }
      }
    }
  });
});

describe('Human Arch checks', () => {
  const arch = () => getPose('arch');
  // Left person (smaller hip x) and right person, both arms overhead,
  // inner wrists meeting in the middle (~x 0.5), arms straight.
  const good = () => {
    const left = mkBody({
      NOSE:{x:0.25,y:0.15}, L_SHOULDER:{x:0.20,y:0.30}, R_SHOULDER:{x:0.30,y:0.30},
      L_ELBOW:{x:0.16,y:0.15}, R_ELBOW:{x:0.40,y:0.13}, L_WRIST:{x:0.12,y:0.02}, R_WRIST:{x:0.48,y:0.02},
      L_HIP:{x:0.22,y:0.60}, R_HIP:{x:0.28,y:0.60},
    });
    const right = mkBody({
      NOSE:{x:0.75,y:0.15}, L_SHOULDER:{x:0.70,y:0.30}, R_SHOULDER:{x:0.80,y:0.30},
      L_ELBOW:{x:0.60,y:0.13}, R_ELBOW:{x:0.84,y:0.15}, L_WRIST:{x:0.52,y:0.02}, R_WRIST:{x:0.88,y:0.02},
      L_HIP:{x:0.72,y:0.60}, R_HIP:{x:0.78,y:0.60},
    });
    return [left, right];
  };

  it('scores high (mean > 0.85) for a correct arch', () => {
    const [a, b] = good();
    const vals = arch().checks.map(c => c.fn(a, b));
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    expect(mean).toBeGreaterThan(0.85);
  });

  it('apex check is low when inner hands are far apart', () => {
    const [a, b] = good();
    // pull both inner wrists outward so they no longer meet
    a[LM.R_WRIST] = { x: 0.05, y: 0.02, visibility: 1 };
    b[LM.L_WRIST] = { x: 0.95, y: 0.02, visibility: 1 };
    const apex = arch().checks.find(c => c.name.includes('apex')).fn(a, b);
    expect(apex).toBeLessThan(0.3);
  });

  it('arms-overhead check is low when arms are down', () => {
    const [a, b] = good();
    a[LM.L_WRIST] = { x: 0.20, y: 0.55, visibility: 1 };
    a[LM.R_WRIST] = { x: 0.30, y: 0.55, visibility: 1 };
    const leftArms = arch().checks[0].fn(a, b); // "Left person arms overhead"
    expect(leftArms).toBeLessThan(0.3);
  });
});

describe('Mirror Twins checks', () => {
  const twins = () => getPose('twins');
  // Both: one arm up (above nose), one arm out at shoulder height, RAISED on
  // opposite sides (mirror). Left person raises their +x arm, right person raises
  // their -x arm.
  const good = () => {
    const left = mkBody({
      NOSE:{x:0.25,y:0.16}, L_SHOULDER:{x:0.20,y:0.30}, R_SHOULDER:{x:0.30,y:0.30},
      L_WRIST:{x:0.08,y:0.30}, R_WRIST:{x:0.34,y:0.02},   // right (+x) arm up, left arm out
      L_HIP:{x:0.22,y:0.60}, R_HIP:{x:0.28,y:0.60},
    });
    const right = mkBody({
      NOSE:{x:0.75,y:0.16}, L_SHOULDER:{x:0.70,y:0.30}, R_SHOULDER:{x:0.80,y:0.30},
      L_WRIST:{x:0.66,y:0.02}, R_WRIST:{x:0.92,y:0.30},   // left (-x) arm up, right arm out
      L_HIP:{x:0.72,y:0.60}, R_HIP:{x:0.78,y:0.60},
    });
    return [left, right];
  };

  it('scores high (mean > 0.85) when both make the shape, mirrored', () => {
    const [a, b] = good();
    const vals = twins().checks.map(c => c.fn(a, b));
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    expect(mean).toBeGreaterThan(0.85);
  });

  it('mirror check is 0 when both raise the same side', () => {
    const [a, b] = good();
    // make right person raise the SAME (+x) arm as left -> not mirrored
    b[LM.L_WRIST] = { x: 0.66, y: 0.30, visibility: 1 }; // left arm now out
    b[LM.R_WRIST] = { x: 0.92, y: 0.02, visibility: 1 }; // right (+x) arm now up
    const mirror = twins().checks.find(c => c.name.toLowerCase().includes('mirror')).fn(a, b);
    expect(mirror).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- pantomime-logic`
Expected: FAIL — `getPose('arch')` is `undefined` (poses don't exist yet), so the
`duo poses presence` test throws on `p.people`.

- [ ] **Step 3: Add ref builders to `pantomime-logic.js`**

Insert AFTER the existing ref builders (after the last `function …Ref() { … }`,
before `export const POSE_POOL = [`):

```javascript
// --- Duo (2-person) reference figures ---
function mirrorRefX(ref) {
  const out = {};
  for (const k in ref) out[k] = { x: 1 - ref[k].x, y: ref[k].y };
  return out;
}
function archRefLeft() {
  return {
    nose:  { x: 0.50, y: 0.16 },
    lSh:   { x: 0.40, y: 0.30 }, rSh:   { x: 0.60, y: 0.30 },
    lEl:   { x: 0.30, y: 0.18 }, rEl:   { x: 0.72, y: 0.16 },
    lWr:   { x: 0.22, y: 0.06 }, rWr:   { x: 0.86, y: 0.04 },
    lHip:  { x: 0.45, y: 0.62 }, rHip:  { x: 0.55, y: 0.62 },
    lKnee: { x: 0.45, y: 0.80 }, rKnee: { x: 0.55, y: 0.80 },
    lAnkle:{ x: 0.45, y: 0.97 }, rAnkle:{ x: 0.55, y: 0.97 },
  };
}
function archRefRight() { return mirrorRefX(archRefLeft()); }
function twinsRefLeft() {
  return {
    nose:  { x: 0.48, y: 0.18 },
    lSh:   { x: 0.40, y: 0.32 }, rSh:   { x: 0.58, y: 0.32 },
    lEl:   { x: 0.26, y: 0.34 }, rEl:   { x: 0.66, y: 0.18 },
    lWr:   { x: 0.12, y: 0.34 }, rWr:   { x: 0.70, y: 0.04 },
    lHip:  { x: 0.44, y: 0.62 }, rHip:  { x: 0.54, y: 0.62 },
    lKnee: { x: 0.44, y: 0.80 }, rKnee: { x: 0.54, y: 0.80 },
    lAnkle:{ x: 0.44, y: 0.97 }, rAnkle:{ x: 0.54, y: 0.97 },
  };
}
function twinsRefRight() { return mirrorRefX(twinsRefLeft()); }

// Shared duo helper: classifies a body into "one arm up, one arm out" and
// reports which side the raised wrist is on (for the mirror check).
function twinShape(p) {
  const lw = p[LM.L_WRIST], rw = p[LM.R_WRIST], nose = p[LM.NOSE];
  const shMidY = (p[LM.L_SHOULDER].y + p[LM.R_SHOULDER].y) / 2;
  const shMidX = (p[LM.L_SHOULDER].x + p[LM.R_SHOULDER].x) / 2;
  const raised = lw.y < rw.y ? lw : rw;   // higher wrist = smaller y
  const out    = lw.y < rw.y ? rw : lw;
  const raisedOK    = smoothScore(nose.y - raised.y, 0.10, 0.12);          // raised wrist above nose
  const outLevel    = smoothScore(Math.abs(out.y - shMidY), 0, 0.15);      // other wrist near shoulder height
  const outExtended = smoothScore(Math.abs(out.x - shMidX), 0.28, 0.18);   // ...and far out sideways
  return { score: (raisedOK + outLevel + outExtended) / 3, raised, shMidX };
}
```

- [ ] **Step 4: Add the two duo pose objects to `POSE_POOL`**

Insert these two objects as the LAST entries of the `POSE_POOL` array (after the
final existing pose object, before the closing `];`):

```javascript
  {
    id: 'arch',
    name: 'Human Arch',
    emoji: '🌉',
    difficulty: 'duo',
    people: 2,
    timeout: 25,
    desc: 'Two people side by side — raise both arms overhead so your inner hands meet in the middle. Make an arch.',
    refs: [archRefLeft(), archRefRight()],
    checks: [
      { name: 'Left person arms overhead', fn: (a, b) => {
        const lUp = smoothScore(a[LM.L_SHOULDER].y - a[LM.L_WRIST].y, 0.25, 0.15);
        const rUp = smoothScore(a[LM.R_SHOULDER].y - a[LM.R_WRIST].y, 0.25, 0.15);
        return (lUp + rUp) / 2;
      }},
      { name: 'Right person arms overhead', fn: (a, b) => {
        const lUp = smoothScore(b[LM.L_SHOULDER].y - b[LM.L_WRIST].y, 0.25, 0.15);
        const rUp = smoothScore(b[LM.R_SHOULDER].y - b[LM.R_WRIST].y, 0.25, 0.15);
        return (lUp + rUp) / 2;
      }},
      { name: 'Hands meet at apex', fn: (a, b) => {
        // inner wrist = the wrist nearer the other person (a is left, so a's inner
        // wrist has the larger x; b's inner wrist has the smaller x). Mirror-robust.
        const innerA = a[LM.L_WRIST].x > a[LM.R_WRIST].x ? a[LM.L_WRIST] : a[LM.R_WRIST];
        const innerB = b[LM.L_WRIST].x < b[LM.R_WRIST].x ? b[LM.L_WRIST] : b[LM.R_WRIST];
        const shoulderW = dist(a[LM.L_SHOULDER], a[LM.R_SHOULDER]);
        return smoothScore(dist(innerA, innerB) / Math.max(0.05, shoulderW), 0, 1.2);
      }},
      { name: 'Arms straight', fn: (a, b) => {
        const angs = [
          angle(a[LM.L_SHOULDER], a[LM.L_ELBOW], a[LM.L_WRIST]),
          angle(a[LM.R_SHOULDER], a[LM.R_ELBOW], a[LM.R_WRIST]),
          angle(b[LM.L_SHOULDER], b[LM.L_ELBOW], b[LM.L_WRIST]),
          angle(b[LM.R_SHOULDER], b[LM.R_ELBOW], b[LM.R_WRIST]),
        ];
        return angs.reduce((s, ang) => s + smoothScore(ang, 175, 35), 0) / angs.length;
      }},
    ],
  },
  {
    id: 'twins',
    name: 'Mirror Twins',
    emoji: '🪞',
    difficulty: 'duo',
    people: 2,
    timeout: 25,
    desc: 'Both strike the SAME shape — one arm up, one arm out to the side. Mirror each other.',
    refs: [twinsRefLeft(), twinsRefRight()],
    checks: [
      { name: 'Left person: one arm up, one out', fn: (a, b) => twinShape(a).score },
      { name: 'Right person: one arm up, one out', fn: (a, b) => twinShape(b).score },
      { name: 'Mirrored (opposite arms up)', fn: (a, b) => {
        const sa = twinShape(a), sb = twinShape(b);
        const sideA = Math.sign(sa.raised.x - sa.shMidX);
        const sideB = Math.sign(sb.raised.x - sb.shMidX);
        return (sideA !== 0 && sideA === -sideB) ? 1 : 0;
      }},
    ],
  },
```

- [ ] **Step 5: Patch `samplePoses` so the duo poses in the pool don't crash it**

The current `samplePoses` builds `const byTier = { easy: [], medium: [], hard: [] };`
then does `byTier[p.difficulty].push(p)` for every pose. With duo poses now in
`POSE_POOL`, `byTier['duo']` is `undefined` → TypeError on every call. Add the duo
bucket now (the full sampler rewrite happens in Task 2). Change that one line to:
```javascript
  const byTier = { easy: [], medium: [], hard: [], duo: [] };
```
The default mix is still `{ easy: 2, medium: 3, hard: 2 }` here (no `duo` key), so a
default call still returns 7 — the duo bucket is populated but unused until Task 2.

- [ ] **Step 6: Update the existing POSE_POOL assertions that now changed**

In `tests/pantomime-logic.test.js`, make these edits:

Replace `expect(POSE_POOL).toHaveLength(12);` with:
```javascript
    expect(POSE_POOL).toHaveLength(14);
```

Replace the `each pose has required fields` test body with (poses now have `ref`
OR `refs`):
```javascript
  it('each pose has required fields', () => {
    for (const p of POSE_POOL) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('emoji');
      expect(p).toHaveProperty('difficulty');
      expect(p).toHaveProperty('timeout');
      expect(p).toHaveProperty('desc');
      expect(p.ref || p.refs).toBeTruthy();
      expect(Array.isArray(p.checks)).toBe(true);
      expect(p.checks.length).toBeGreaterThan(0);
    }
  });
```

Replace the `every difficulty is easy/medium/hard` test with:
```javascript
  it('every difficulty is easy/medium/hard/duo', () => {
    for (const p of POSE_POOL) {
      expect(['easy', 'medium', 'hard', 'duo']).toContain(p.difficulty);
    }
  });
```

Replace the `ref has all skeleton joints` test with (skip duo poses, which use
`refs` and are covered by the new `duo refs` test):
```javascript
  it('ref has all skeleton joints', () => {
    const required = ['nose', 'lSh', 'rSh', 'lEl', 'rEl', 'lWr', 'rWr', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle'];
    for (const p of POSE_POOL) {
      if (!p.ref) continue; // duo poses use `refs`, checked separately
      for (const j of required) {
        expect(p.ref).toHaveProperty(j);
        expect(typeof p.ref[j].x).toBe('number');
        expect(typeof p.ref[j].y).toBe('number');
      }
    }
  });
```

Replace the `pool tier counts` test with:
```javascript
  it('pool tier counts: 2 easy, 4 medium, 6 hard, 2 duo', () => {
    const tiers = POSE_POOL.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ easy: 2, medium: 4, hard: 6, duo: 2 });
  });
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- pantomime-logic`
Expected: PASS — the new duo presence/check tests and the updated POSE_POOL tests
are green, AND the existing `samplePoses` tests still pass (the byTier patch keeps
the default at 7 for now). The whole `pantomime-logic.test.js` file should be green.

- [ ] **Step 8: Commit**

```bash
git add ps-offsite-2026/shared/pantomime-logic.js tests/pantomime-logic.test.js
git commit -m "feat(pantomime): add Human Arch and Mirror Twins duo poses to pool"
```

---

## Task 2: Extend `samplePoses` for the duo tier

**Files:**
- Modify: `ps-offsite-2026/shared/pantomime-logic.js` (the `samplePoses` function)
- Test: `tests/pantomime-logic.test.js`

- [ ] **Step 1: Update the samplePoses tests (and add duo coverage)**

In `tests/pantomime-logic.test.js`, replace the `default mix returns 7 poses` test
with:
```javascript
  it('default mix returns 8 poses (2 easy + 2 medium + 2 hard + 2 duo)', () => {
    const sample = samplePoses(POSE_POOL);
    expect(sample).toHaveLength(8);
    const tiers = sample.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ easy: 2, medium: 2, hard: 2, duo: 2 });
  });

  it('the two duo poses are always last', () => {
    for (let i = 0; i < 10; i++) {
      const sample = samplePoses(POSE_POOL);
      expect(sample[6].people).toBe(2);
      expect(sample[7].people).toBe(2);
      // all earlier poses are solo
      for (let k = 0; k < 6; k++) expect(sample[k].people ?? 1).toBe(1);
    }
  });

  it('throws if duo tier under-resourced', () => {
    expect(() => samplePoses(POSE_POOL, { easy: 1, medium: 1, hard: 1, duo: 5 }))
      .toThrow(/not enough duo poses/);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- pantomime-logic`
Expected: FAIL — `default mix returns 8` gets 7 (old default), and `duo poses are
always last` reads `sample[6].people` which is `undefined`.

- [ ] **Step 3: Update `samplePoses` in `pantomime-logic.js`**

Replace the entire `export function samplePoses(...) { … }` with:

```javascript
export function samplePoses(pool, mix = { easy: 2, medium: 2, hard: 2, duo: 2 }) {
  const byTier = { easy: [], medium: [], hard: [], duo: [] };
  for (const p of pool) byTier[p.difficulty].push(p);
  const out = [];
  // Solo tiers first, in escalating order.
  for (const tier of ['easy', 'medium', 'hard']) {
    const n = mix[tier] || 0;
    if (byTier[tier].length < n) {
      throw new Error(`not enough ${tier} poses: have ${byTier[tier].length}, need ${n}`);
    }
    out.push(...shuffle(byTier[tier]).slice(0, n));
  }
  // Duo poses appended last (the climax).
  const nDuo = mix.duo || 0;
  if (byTier.duo.length < nDuo) {
    throw new Error(`not enough duo poses: have ${byTier.duo.length}, need ${nDuo}`);
  }
  out.push(...shuffle(byTier.duo).slice(0, nDuo));
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -- pantomime-logic`
Expected: PASS — all pantomime-logic tests green.

- [ ] **Step 5: Run the full test suite (no regressions elsewhere)**

Run: `npm test`
Expected: PASS — all test files green.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/shared/pantomime-logic.js tests/pantomime-logic.test.js
git commit -m "feat(pantomime): sample 6 solo + 2 duo poses per run"
```

---

## Task 3: Two-body detection + scoring in `2-pantomime.html`

No unit tests (DOM + MediaPipe). Verified in the browser. Make the edits, confirm
no console errors and the duo branch is reachable.

**Files:**
- Modify: `ps-offsite-2026/games/2-pantomime.html`

- [ ] **Step 1: Enable 2-person detection**

Change `numPoses: 1,` (currently ~line 513, inside `createFromOptions`) to:
```javascript
      numPoses: 2,
```

- [ ] **Step 2: Add the duo stability threshold constant**

Just after `const STABILITY_MAX_DRIFT = 0.025; …` (~line 483) add:
```javascript
const STABILITY_MAX_DRIFT_DUO = 0.045; // looser: two people can't freeze as still
```

And change the hold-time map (~line 481) to include `duo`:
```javascript
const HOLD_MS_BY_DIFFICULTY = { easy: 1200, medium: 1500, hard: 2000, duo: 1500 };
```

- [ ] **Step 3: Add body-selection helpers**

Insert these helpers immediately BEFORE `function handlePose(result) {` (~line 661):
```javascript
function torsoSize(lm) {
  const shMid = { x: (lm[LM.L_SHOULDER].x + lm[LM.R_SHOULDER].x) / 2, y: (lm[LM.L_SHOULDER].y + lm[LM.R_SHOULDER].y) / 2 };
  const hipMid = { x: (lm[LM.L_HIP].x + lm[LM.R_HIP].x) / 2, y: (lm[LM.L_HIP].y + lm[LM.R_HIP].y) / 2 };
  return dist(shMid, hipMid);
}
function primaryBody(bodies) {
  return bodies.slice().sort((a, b) => torsoSize(b) - torsoSize(a))[0];
}
function sortedPair(bodies) {
  const hipX = lm => (lm[LM.L_HIP].x + lm[LM.R_HIP].x) / 2;
  return bodies.slice().sort((a, b) => hipX(a) - hipX(b)); // left (smaller x) first
}
function bodyVisible(lm) {
  const required = [LM.L_SHOULDER, LM.R_SHOULDER, LM.L_HIP, LM.R_HIP, LM.L_KNEE, LM.R_KNEE, LM.L_ANKLE, LM.R_ANKLE];
  return lm && lm.length >= 33 && required.every(i => (lm[i].visibility ?? 1) > 0.4);
}
```

Note: `dist` is already imported from `pantomime-logic.js` at the top of the module.

- [ ] **Step 4: Replace `handlePose` with the solo/duo branching version**

Replace the entire `function handlePose(result) { … }` (currently ~lines 661–735)
with:
```javascript
function handlePose(result) {
  const pose = POSES[stepIndex];
  const isDuo = (pose?.people ?? 1) === 2;
  const bodies = (result.landmarks || []).filter(b => b && b.length >= 33);

  let checkResults, frameForStability, seriesKeys;

  if (isDuo) {
    const visBodies = bodies.filter(bodyVisible);
    if (visBodies.length < 2) {
      document.getElementById('hint').textContent = 'Need 2 people in frame, full body visible';
      document.getElementById('simFill').style.width = '0%';
      document.getElementById('simText').textContent = '—';
      document.getElementById('holdFill').style.width = '0%';
      document.getElementById('poseCard').classList.remove('match');
      holdStart = 0;
      recentLandmarks = []; // duo buffer requires both bodies; reset on dropout
      return;
    }
    const [a, b] = sortedPair(visBodies);
    document.getElementById('hint').textContent = '✓ Both bodies detected';
    checkResults = pose.checks.map(c => ({ name: c.name, val: c.fn(a, b) }));
    frameForStability = { a: a.map(p => ({ x: p.x, y: p.y })), b: b.map(p => ({ x: p.x, y: p.y })) };
    seriesKeys = ['a', 'b'];
  } else {
    if (bodies.length === 0) {
      document.getElementById('hint').textContent = 'Stand in front of the camera, full body visible';
      document.getElementById('simFill').style.width = '0%';
      document.getElementById('simText').textContent = '—';
      holdStart = 0;
      return;
    }
    const lm = primaryBody(bodies);
    if (!bodyVisible(lm)) {
      document.getElementById('hint').textContent = 'Move so your full body is visible';
      return;
    }
    document.getElementById('hint').textContent = '✓ Full body detected';
    checkResults = pose.checks.map(c => ({ name: c.name, val: c.fn(lm) }));
    frameForStability = lm.map(p => ({ x: p.x, y: p.y }));
    seriesKeys = [null];
  }

  const sim = checkResults.reduce((s, c) => s + c.val, 0) / checkResults.length;
  const pct = Math.round(sim * 100);

  // Stability: max per-joint drift across the recent window (over both bodies if duo)
  recentLandmarks.push(frameForStability);
  if (recentLandmarks.length > STABILITY_WINDOW) recentLandmarks.shift();
  const driftThreshold = isDuo ? STABILITY_MAX_DRIFT_DUO : STABILITY_MAX_DRIFT;
  const joints = [LM.L_WRIST, LM.R_WRIST, LM.L_ANKLE, LM.R_ANKLE, LM.L_KNEE, LM.R_KNEE];
  let stabilityDrift = 0;
  if (recentLandmarks.length >= STABILITY_WINDOW) {
    for (const key of seriesKeys) {
      for (const j of joints) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (const frame of recentLandmarks) {
          const p = key ? frame[key][j] : frame[j];
          if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
          if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
        }
        stabilityDrift = Math.max(stabilityDrift, maxX - minX, maxY - minY);
      }
    }
  }
  const stable = stabilityDrift <= driftThreshold;

  document.getElementById('simFill').style.width = pct + '%';
  document.getElementById('simText').textContent = pct + '%';
  document.getElementById('checks').innerHTML = checkResults.map(c => {
    const cls = c.val > 0.85 ? 'pass' : c.val > 0.5 ? 'partial' : '';
    const icon = c.val > 0.85 ? '✓' : c.val > 0.5 ? '◐' : '·';
    return `<div class="check ${cls}"><span>${c.name}</span><span>${icon} ${(c.val * 100).toFixed(0)}%</span></div>`;
  }).join('');
  document.getElementById('checks').innerHTML += `<div class="check ${stable ? 'pass' : ''}"><span>Hold steady (no wobble)</span><span>${stable ? '✓' : '◌'} ${(stabilityDrift * 100).toFixed(1)}%</span></div>`;

  const holdMs = HOLD_MS_BY_DIFFICULTY[pose.difficulty] || 2500;

  if (sim > SIM_THRESHOLD && stable) {
    if (holdStart === 0) holdStart = performance.now();
    const held = performance.now() - holdStart;
    document.getElementById('holdFill').style.width = Math.min(100, (held / holdMs) * 100) + '%';
    document.getElementById('poseCard').classList.add('match');
    if (held >= holdMs) {
      scores.push(scorePose({ sim, locked: true }));
      pulseVideo('match-pulse');
      advance();
    }
  } else {
    holdStart = 0;
    document.getElementById('holdFill').style.width = '0%';
    document.getElementById('poseCard').classList.remove('match');
  }
}
```

- [ ] **Step 5: Verify in the browser (smoke test, no second person needed yet)**

Run: `npm run dev`
Then open the printed local URL + `/ps-offsite-2026/games/2-pantomime.html` and:
1. Open devtools console — confirm **no errors** on load.
2. Click Start game → allow camera → let the countdown finish into the playing
   phase. Stand in frame; confirm a solo pose still scores (sim % moves, checks
   update) exactly as before. This proves the `numPoses: 2` + `primaryBody` change
   didn't break solo play.
3. In the console run `POSES.map(p => [p.name, p.people ?? 1])`. Expected: 8 entries,
   the last two showing `2` (the duo poses) and named "Human Arch"/"Mirror Twins".

Expected: no console errors; solo scoring works; duo poses are positions 7–8.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/games/2-pantomime.html
git commit -m "feat(pantomime): detect two bodies, branch handlePose for duo poses"
```

---

## Task 4: Duo rendering + copy in `2-pantomime.html`

**Files:**
- Modify: `ps-offsite-2026/games/2-pantomime.html`

- [ ] **Step 1: Make `drawSkeleton` skip the ghost for duo poses**

Replace (currently ~lines 649–651):
```javascript
  if (stepIndex < POSES.length) {
    drawGhostOverlay(POSES[stepIndex].ref);
  }
```
with:
```javascript
  if (stepIndex < POSES.length && (POSES[stepIndex].people ?? 1) === 1) {
    drawGhostOverlay(POSES[stepIndex].ref);
  }
```

- [ ] **Step 2: Rewrite `renderRefSvg` to accept the pose and draw two figures for duos**

Replace the entire `function renderRefSvg(ref) { … }` (currently ~lines 434–458)
with:
```javascript
function refToSvg(ref, mapX, mapY) {
  const lines = SKEL_LINES.map(([a, b]) => {
    const pa = ref[a], pb = ref[b];
    return `<line x1="${mapX(pa.x)}" y1="${mapY(pa.y)}" x2="${mapX(pb.x)}" y2="${mapY(pb.y)}" stroke="#ff00aa" stroke-width="3" stroke-linecap="round" />`;
  }).join('');
  const points = Object.values(ref).map(p =>
    `<circle cx="${mapX(p.x)}" cy="${mapY(p.y)}" r="3.5" fill="#00d4ff" />`
  ).join('');
  const head = ref.nose;
  const headCircle = `<circle cx="${mapX(head.x)}" cy="${mapY(head.y) - 6}" r="10" fill="none" stroke="#ff00aa" stroke-width="3" />`;
  return headCircle + lines + points;
}

function renderRefSvg(pose) {
  const W = 200, H = 200;
  const svg = document.getElementById('poseRefSvg');

  // Duo: two figures, each in its half of a fixed padded viewBox.
  if ((pose.people ?? 1) === 2 && Array.isArray(pose.refs)) {
    const yMap = y => 14 + y * (H - 28);
    const leftMap = x => 8 + x * 86;     // [8, 94]
    const rightMap = x => 106 + x * 86;  // [106, 192]
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.innerHTML = refToSvg(pose.refs[0], leftMap, yMap) + refToSvg(pose.refs[1], rightMap, yMap);
    return;
  }

  // Solo: single figure with auto-expanding viewBox (raised arms can spill above).
  const ref = pose.ref;
  const idMap = v => v * W; // x and y share scale at W===H
  const head = ref.nose;
  let minX = 0, minY = 0, maxX = W, maxY = H;
  for (const p of Object.values(ref)) {
    minX = Math.min(minX, p.x * W - 4); maxX = Math.max(maxX, p.x * W + 4);
    minY = Math.min(minY, p.y * H - 4); maxY = Math.max(maxY, p.y * H + 4);
  }
  minY = Math.min(minY, head.y * H - 16);
  minX = Math.min(minX, head.x * W - 10); maxX = Math.max(maxX, head.x * W + 10);
  svg.setAttribute('viewBox', `${minX} ${minY} ${maxX - minX} ${maxY - minY}`);
  svg.innerHTML = refToSvg(ref, idMap, idMap);
}
```

- [ ] **Step 3: Pass the pose (not `pose.ref`) into `renderRefSvg`**

In `startStep` (~line 573) change:
```javascript
  renderRefSvg(pose.ref);
```
to:
```javascript
  renderRefSvg(pose);
```

- [ ] **Step 4: Choose the cam-flash text by pose type**

In `startStep` (~line 577) change:
```javascript
  flashCam('👥 Next player — take turns');
```
to:
```javascript
  flashCam((pose.people ?? 1) === 2 ? '👥👥 Grab a partner!' : '👥 Next player — take turns');
```

- [ ] **Step 5: Add the duo difficulty badge color**

After `.difficulty.hard { … }` (~line 148) add:
```css
  .difficulty.duo { background: rgba(0,212,255,0.15); color: var(--accent-2); }
```

- [ ] **Step 6: Update the briefing and step-badge copy**

In the briefing paragraph (~line 297) replace:
```
<strong>7 poses per run, escalating difficulty.</strong> 25 s per pose.
```
with:
```
<strong>8 poses per run — the last 2 need a partner</strong> (two people in frame). 25 s per pose.
```

Change the step-badge default text (~line 333) from `1 / 7` to:
```html
          <div class="step-badge" id="stepBadge">1 / 8</div>
```

- [ ] **Step 7: Verify in the browser**

Run: `npm run dev` (if not already running) and open the pantomime page.
1. Console: no errors.
2. Reach a duo pose (fastest: in console set `stepIndex = 6` is NOT safe mid-loop;
   instead just play/skip through, or temporarily call `startStep()` won't reset
   index — simplest: use the "Skip pose" button 6 times to reach pose 7). On the
   duo pose confirm: the reference card shows **two** stick figures side by side;
   the badge reads **duo** in cyan; the cam-flash showed **"👥👥 Grab a partner!"**;
   the live camera shows **no pink ghost overlay**.
3. With two people in frame, confirm the sim % responds and a held arch/twins locks
   (match pulse, advances). With one person, the hint reads "Need 2 people in frame".

Expected: two-figure ref card, cyan duo badge, partner flash, ghost off, duo
scoring works with two people and gates with one.

- [ ] **Step 8: Run the full test suite (guard against logic regressions)**

Run: `npm test`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add ps-offsite-2026/games/2-pantomime.html
git commit -m "feat(pantomime): duo ref card, badge, partner flash, ghost-off, copy"
```

---

## Task 5: Final end-to-end verification

**Files:** none (verification only).

- [ ] **Step 1: Run the whole suite**

Run: `npm test`
Expected: all files PASS.

- [ ] **Step 2: Full play-through smoke test (two people)**

Run: `npm run dev`, open the pantomime page, and complete a full run:
1. 6 solo poses score and advance as before.
2. Poses 7–8 are Human Arch and Mirror Twins; each requires two people in frame,
   shows two ref figures, no ghost, cyan duo badge, partner flash, and locks when
   held ~1.5 s.
3. The final screen shows 8 breakdown rows (the two duo rows carry the "duo" badge)
   and the average score saves.

Expected: clean 8-pose run, duo poses behave per spec, score saved.

- [ ] **Step 3: Confirm clean git state**

Run: `git status`
Expected: working tree clean, all commits from Tasks 1–4 present.

---

## Self-review notes (for the implementer)

- **Spec coverage:** detection (T3), body selection (T3), handlePose duo branch +
  identical sim/lock (T3), stability buffer `{a,b}` + duo threshold (T3), HOLD duo
  (T3), `numPoses:2` (T3), two duo poses + refs + checks (T1), samplePoses
  6+2 / byTier fix / medium 3→2 (T2), ghost-off (T4), two-figure ref card (T4),
  duo badge (T4), partner flash (T4), briefing + stepBadge copy (T4).
- **Deviation from spec (intentional, better):** duo checks index landmark arrays
  (`a[LM.X]`), not ref keys; "inner wrist" is chosen by x-extremum (mirror-robust)
  rather than an anatomical L/R index. Mirror Twins uses an explicit
  one-up-one-out + opposite-side check instead of raw angle matching, for
  testability and robustness. These satisfy the spec's intent.
- **Type/name consistency:** `bodyVisible`, `primaryBody`, `sortedPair`,
  `torsoSize`, `twinShape`, `refToSvg`, `renderRefSvg(pose)`, `STABILITY_MAX_DRIFT_DUO`,
  `HOLD_MS_BY_DIFFICULTY.duo`, pose `people`/`refs` fields — all referenced
  consistently across tasks.
