# Pantomime Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring Station 2 (CV Pantomime) up to gesture-lock's structural and UX polish bar — phase state machine, shared-logic module, pose sampling (7 of 12), player rotation banner, match/miss feedback animations, visibility-aware timer.

**Architecture:** Extract pose definitions and pure helpers into `shared/pantomime-logic.js` (TDD-covered). Restructure `2-pantomime.html` into a gesture-lock-style phase state machine with per-phase cleanup. Sample 7 poses per run (2 easy / 3 medium / 2 hard). Replace per-pose `setTimeout` with RAF-driven elapsed check that survives tab backgrounding.

**Tech Stack:** Vanilla ES modules, MediaPipe Tasks Vision (`PoseLandmarker`), Vite, Vitest.

---

## File Structure

**Create:**
- `ps-offsite-2026/shared/pantomime-logic.js` — pure logic (helpers, pose pool, sample, score)
- `tests/pantomime-logic.test.js` — Vitest coverage

**Modify:**
- `ps-offsite-2026/stations/2-pantomime.html` — full restructure to phase state machine, import shared module, add player banner + animations + visibility pause

---

## Task 1: Pure math helpers + LM map in shared module

**Files:**
- Create: `ps-offsite-2026/shared/pantomime-logic.js`
- Create: `tests/pantomime-logic.test.js`

- [ ] **Step 1: Write failing tests for helpers**

Create `tests/pantomime-logic.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  LM,
  SKEL_LINES,
  dist,
  angle,
  smoothScore,
} from '../ps-offsite-2026/shared/pantomime-logic.js';

describe('LM', () => {
  it('exposes MediaPipe pose landmark indices', () => {
    expect(LM.NOSE).toBe(0);
    expect(LM.L_SHOULDER).toBe(11);
    expect(LM.R_SHOULDER).toBe(12);
    expect(LM.L_WRIST).toBe(15);
    expect(LM.R_WRIST).toBe(16);
    expect(LM.L_HIP).toBe(23);
    expect(LM.R_HIP).toBe(24);
    expect(LM.L_ANKLE).toBe(27);
    expect(LM.R_ANKLE).toBe(28);
  });
});

describe('SKEL_LINES', () => {
  it('is an array of [from, to] string pairs', () => {
    expect(Array.isArray(SKEL_LINES)).toBe(true);
    expect(SKEL_LINES.length).toBeGreaterThan(10);
    for (const pair of SKEL_LINES) {
      expect(pair).toHaveLength(2);
      expect(typeof pair[0]).toBe('string');
      expect(typeof pair[1]).toBe('string');
    }
  });
});

describe('dist', () => {
  it('computes euclidean distance', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('returns 0 for identical points', () => {
    expect(dist({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(0);
  });
});

describe('angle', () => {
  it('returns 180 for collinear points (straight line)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const c = { x: 2, y: 0 };
    expect(angle(a, b, c)).toBeCloseTo(180, 1);
  });

  it('returns 90 for right angle', () => {
    const a = { x: 0, y: 1 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 0 };
    expect(angle(a, b, c)).toBeCloseTo(90, 1);
  });

  it('returns 0 when a vector is zero-length', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 0 };
    expect(angle(a, b, c)).toBe(0);
  });
});

describe('smoothScore', () => {
  it('returns 1 when value within tolerance', () => {
    expect(smoothScore(10, 10, 1)).toBe(1);
    expect(smoothScore(10.5, 10, 1)).toBe(1);
  });

  it('returns 0 when value is 2*tol or more away', () => {
    expect(smoothScore(12, 10, 1)).toBe(0);
    expect(smoothScore(20, 10, 1)).toBe(0);
  });

  it('falls off linearly between tol and 2*tol', () => {
    expect(smoothScore(11.5, 10, 1)).toBeCloseTo(0.5, 2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pantomime-logic.test.js`
Expected: FAIL — `Cannot find module '../ps-offsite-2026/shared/pantomime-logic.js'`

- [ ] **Step 3: Create the module with helpers**

Create `ps-offsite-2026/shared/pantomime-logic.js`:

```javascript
export const LM = {
  NOSE: 0,
  L_SHOULDER: 11, R_SHOULDER: 12,
  L_ELBOW: 13, R_ELBOW: 14,
  L_WRIST: 15, R_WRIST: 16,
  L_HIP: 23, R_HIP: 24,
  L_KNEE: 25, R_KNEE: 26,
  L_ANKLE: 27, R_ANKLE: 28,
};

export const SKEL_LINES = [
  ['nose', 'lSh'], ['nose', 'rSh'],
  ['lSh', 'rSh'],
  ['lSh', 'lEl'], ['lEl', 'lWr'],
  ['rSh', 'rEl'], ['rEl', 'rWr'],
  ['lSh', 'lHip'], ['rSh', 'rHip'],
  ['lHip', 'rHip'],
  ['lHip', 'lKnee'], ['lKnee', 'lAnkle'],
  ['rHip', 'rKnee'], ['rKnee', 'rAnkle'],
];

export function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function angle(a, b, c) {
  const ab = { x: a.x - b.x, y: a.y - b.y };
  const cb = { x: c.x - b.x, y: c.y - b.y };
  const dot = ab.x * cb.x + ab.y * cb.y;
  const mag = Math.hypot(ab.x, ab.y) * Math.hypot(cb.x, cb.y);
  if (mag === 0) return 0;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
}

export function smoothScore(value, target, tol) {
  const d = Math.abs(value - target);
  if (d <= tol) return 1;
  if (d >= 2 * tol) return 0;
  return 1 - (d - tol) / tol;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pantomime-logic.test.js`
Expected: PASS — 4 describe blocks, 11 tests green.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/pantomime-logic.js tests/pantomime-logic.test.js
git commit -m "feat(pantomime): extract pure helpers to shared module"
```

---

## Task 2: Move POSE_POOL into shared module

**Files:**
- Modify: `ps-offsite-2026/shared/pantomime-logic.js` (append)
- Modify: `tests/pantomime-logic.test.js` (append)

- [ ] **Step 1: Append failing test for POSE_POOL**

Append to `tests/pantomime-logic.test.js`:

```javascript
import { POSE_POOL } from '../ps-offsite-2026/shared/pantomime-logic.js';

describe('POSE_POOL', () => {
  it('has 12 poses', () => {
    expect(POSE_POOL).toHaveLength(12);
  });

  it('each pose has required fields', () => {
    for (const p of POSE_POOL) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('emoji');
      expect(p).toHaveProperty('difficulty');
      expect(p).toHaveProperty('timeout');
      expect(p).toHaveProperty('desc');
      expect(p).toHaveProperty('ref');
      expect(Array.isArray(p.checks)).toBe(true);
      expect(p.checks.length).toBeGreaterThan(0);
    }
  });

  it('every difficulty is easy/medium/hard', () => {
    for (const p of POSE_POOL) {
      expect(['easy', 'medium', 'hard']).toContain(p.difficulty);
    }
  });

  it('each check has name + fn', () => {
    for (const p of POSE_POOL) {
      for (const c of p.checks) {
        expect(typeof c.name).toBe('string');
        expect(typeof c.fn).toBe('function');
      }
    }
  });

  it('ref has all skeleton joints', () => {
    const required = ['nose', 'lSh', 'rSh', 'lEl', 'rEl', 'lWr', 'rWr', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle'];
    for (const p of POSE_POOL) {
      for (const j of required) {
        expect(p.ref).toHaveProperty(j);
        expect(typeof p.ref[j].x).toBe('number');
        expect(typeof p.ref[j].y).toBe('number');
      }
    }
  });

  it('pool tier counts: 2 easy, 4 medium, 6 hard', () => {
    const tiers = POSE_POOL.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ easy: 2, medium: 4, hard: 6 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pantomime-logic.test.js`
Expected: FAIL — `POSE_POOL is not exported`.

- [ ] **Step 3: Append POSE_POOL + ref builders + checks**

Append to `ps-offsite-2026/shared/pantomime-logic.js` the 12 ref-builder functions (`tposeRef`, `starRef`, `conductorRef`, `superheroRef`, `skierRef`, `discoRef`, `warriorRef`, `treeRef`, `wideSquatRef`, `libertyRef`, `karateRef`, `arabesqueRef`) and the `POSE_POOL` array. **Copy them verbatim from `ps-offsite-2026/stations/2-pantomime.html` lines 337–886** (the `tposeRef()` through `arabesqueRef()` functions and the `POSES` array — rename `POSES` to `POSE_POOL`). The check functions already reference `LM`, `dist`, `angle`, `smoothScore` which are now in-module.

Final structure of appended content:

```javascript
// Ref builders (one per pose)
function tposeRef() { /* ... verbatim from HTML ... */ }
function starRef() { /* ... */ }
// ... 10 more ref functions ...

export const POSE_POOL = [
  { id: 'tpose', name: 'T-Pose', emoji: '✝️', difficulty: 'easy', timeout: 25, desc: '...', ref: tposeRef(), checks: [ /* verbatim */ ] },
  // ... 11 more pose objects ...
];
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pantomime-logic.test.js`
Expected: PASS — all describe blocks green, including pool tier counts `{ easy: 2, medium: 4, hard: 6 }`.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/pantomime-logic.js tests/pantomime-logic.test.js
git commit -m "feat(pantomime): move POSE_POOL to shared module"
```

---

## Task 3: samplePoses function

**Files:**
- Modify: `ps-offsite-2026/shared/pantomime-logic.js` (append)
- Modify: `tests/pantomime-logic.test.js` (append)

- [ ] **Step 1: Append failing tests for samplePoses**

Append to `tests/pantomime-logic.test.js`:

```javascript
import { samplePoses } from '../ps-offsite-2026/shared/pantomime-logic.js';

describe('samplePoses', () => {
  it('default mix returns 7 poses (2 easy + 3 medium + 2 hard)', () => {
    const sample = samplePoses(POSE_POOL);
    expect(sample).toHaveLength(7);
    const tiers = sample.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ easy: 2, medium: 3, hard: 2 });
  });

  it('custom mix returns matching counts', () => {
    const sample = samplePoses(POSE_POOL, { easy: 1, medium: 2, hard: 1 });
    expect(sample).toHaveLength(4);
  });

  it('no duplicates within a tier', () => {
    const sample = samplePoses(POSE_POOL);
    const ids = sample.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every sampled pose comes from the pool', () => {
    const sample = samplePoses(POSE_POOL);
    const poolIds = new Set(POSE_POOL.map(p => p.id));
    for (const p of sample) {
      expect(poolIds.has(p.id)).toBe(true);
    }
  });

  it('different medium selections across calls (probabilistic — 20 runs)', () => {
    const firstMedium = samplePoses(POSE_POOL).filter(p => p.difficulty === 'medium').map(p => p.id).sort().join(',');
    let sawDifferent = false;
    for (let i = 0; i < 20; i++) {
      const m = samplePoses(POSE_POOL).filter(p => p.difficulty === 'medium').map(p => p.id).sort().join(',');
      if (m !== firstMedium) { sawDifferent = true; break; }
    }
    expect(sawDifferent).toBe(true);
  });

  it('throws if tier under-resourced', () => {
    expect(() => samplePoses(POSE_POOL, { easy: 5, medium: 1, hard: 1 })).toThrow(/not enough easy poses/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pantomime-logic.test.js`
Expected: FAIL — `samplePoses is not exported`.

- [ ] **Step 3: Append samplePoses implementation**

Append to `ps-offsite-2026/shared/pantomime-logic.js`:

```javascript
function shuffle(arr) {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function samplePoses(pool, mix = { easy: 2, medium: 3, hard: 2 }) {
  const byTier = { easy: [], medium: [], hard: [] };
  for (const p of pool) byTier[p.difficulty].push(p);
  const out = [];
  for (const tier of ['easy', 'medium', 'hard']) {
    const n = mix[tier] || 0;
    if (byTier[tier].length < n) {
      throw new Error(`not enough ${tier} poses: have ${byTier[tier].length}, need ${n}`);
    }
    out.push(...shuffle(byTier[tier]).slice(0, n));
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pantomime-logic.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/pantomime-logic.js tests/pantomime-logic.test.js
git commit -m "feat(pantomime): samplePoses with tier mix"
```

---

## Task 4: scorePose + finalScore

**Files:**
- Modify: `ps-offsite-2026/shared/pantomime-logic.js` (append)
- Modify: `tests/pantomime-logic.test.js` (append)

- [ ] **Step 1: Append failing tests**

Append to `tests/pantomime-logic.test.js`:

```javascript
import { scorePose, finalScore } from '../ps-offsite-2026/shared/pantomime-logic.js';

describe('scorePose', () => {
  it('returns 0 when not locked', () => {
    expect(scorePose({ sim: 0.95, locked: false })).toBe(0);
  });

  it('returns rounded sim*100 when locked', () => {
    expect(scorePose({ sim: 0.876, locked: true })).toBe(88);
    expect(scorePose({ sim: 0.85, locked: true })).toBe(85);
  });

  it('clamps to 0..100 when locked', () => {
    expect(scorePose({ sim: 1.5, locked: true })).toBe(100);
    expect(scorePose({ sim: -0.2, locked: true })).toBe(0);
  });
});

describe('finalScore', () => {
  it('returns 0 for empty array', () => {
    expect(finalScore([])).toBe(0);
  });

  it('rounds the average', () => {
    expect(finalScore([80, 90, 100, 70, 60, 50, 40])).toBe(70);
  });

  it('handles all zeros', () => {
    expect(finalScore([0, 0, 0, 0, 0, 0, 0])).toBe(0);
  });

  it('handles partial run (skipped poses included as 0)', () => {
    expect(finalScore([100, 100, 0, 0, 0, 0, 0])).toBe(29);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/pantomime-logic.test.js`
Expected: FAIL — `scorePose`/`finalScore` not exported.

- [ ] **Step 3: Append implementations**

Append to `ps-offsite-2026/shared/pantomime-logic.js`:

```javascript
export function scorePose({ sim, locked }) {
  if (!locked) return 0;
  return Math.round(Math.max(0, Math.min(100, sim * 100)));
}

export function finalScore(perPoseScores) {
  if (!perPoseScores.length) return 0;
  const sum = perPoseScores.reduce((a, b) => a + b, 0);
  return Math.round(sum / perPoseScores.length);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/pantomime-logic.test.js`
Expected: PASS — all groups green.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/pantomime-logic.js tests/pantomime-logic.test.js
git commit -m "feat(pantomime): scorePose + finalScore"
```

---

## Task 5: HTML imports shared module + drops local duplicates

**Files:**
- Modify: `ps-offsite-2026/stations/2-pantomime.html`

- [ ] **Step 1: Replace local LM/SKEL_LINES/helpers/ref-builders/POSES with import**

In `ps-offsite-2026/stations/2-pantomime.html`, at the top of the `<script type="module">` block (after the MediaPipe import on line 294), add:

```javascript
import {
  LM,
  SKEL_LINES,
  dist,
  angle,
  smoothScore,
  POSE_POOL,
  samplePoses,
  scorePose,
  finalScore,
} from '../shared/pantomime-logic.js';
```

Then delete from the HTML:
- The local `const LM = { ... }` block (lines ~299–307)
- The `dist`, `angle`, `smoothScore` function declarations (lines ~309–324)
- The local `const SKEL_LINES = [ ... ]` (lines ~326–335)
- All 12 ref-builder functions (`tposeRef` through `arabesqueRef`, lines ~337–468)
- The local `const POSES = [ ... ]` (lines ~470–886) — **but keep a `let POSES = [];`** declaration; it will be assigned in Task 8 from the sample call

Replace all in-file references to `POSES` with the new `POSES` `let` binding (no name change yet — sampling wires in Task 8).

- [ ] **Step 2: Verify dev server still loads page**

Run: `npm run dev`
Open `http://localhost:5173/ps-offsite-2026/stations/2-pantomime.html`
Expected: Page loads, no console errors. (Game won't work yet — `POSES` is empty array; that's fine, fixed in Task 8.)

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "refactor(pantomime): import shared logic, drop local duplicates"
```

---

## Task 6: Add phase state machine scaffold

**Files:**
- Modify: `ps-offsite-2026/stations/2-pantomime.html`

- [ ] **Step 1: Wrap existing markup in phase containers**

In `ps-offsite-2026/stations/2-pantomime.html`:

1. Rename `id="setupCard"` to `id="phase-setup"`. Keep `class="card"` and contents.
2. Rename `id="gameCard"` to `id="phase-playing"`. Keep contents.
3. Rename `id="resultCard"` to `id="phase-final"`. Keep contents.
4. Add new phase containers before `phase-playing`:

```html
<div id="phase-loading" class="card hidden">
  <div class="briefing" style="text-align:center; padding:40px;">Loading AI model and camera…</div>
</div>

<div id="phase-countdown" class="card hidden">
  <div style="text-align:center; padding:60px 24px;">
    <div style="font-size:180px; font-weight:900; line-height:1;
                background:linear-gradient(135deg, var(--accent), var(--gold));
                -webkit-background-clip:text; background-clip:text; color:transparent;"
         id="countdownNum">3</div>
  </div>
</div>
```

- [ ] **Step 2: Add `goto()` + `phaseEnter` registry in script**

At the top of the `<script type="module">` block (after imports), add:

```javascript
const PHASES = ['setup', 'loading', 'countdown', 'playing', 'final'];
let activeCleanup = null;
const phaseEnter = {};

function $(id) { return document.getElementById(id); }

function goto(phase) {
  if (activeCleanup) { try { activeCleanup(); } catch {} activeCleanup = null; }
  for (const p of PHASES) $(`phase-${p}`).classList.add('hidden');
  $(`phase-${phase}`).classList.remove('hidden');
  const entry = phaseEnter[phase];
  if (entry) entry();
}
```

At the very bottom of the `<script>` block (just before `</script>`), add:

```javascript
goto('setup');
```

- [ ] **Step 3: Verify page still loads, setup card visible**

Run: `npm run dev`
Open page. Expected: only the setup card is visible. Other phase containers exist in DOM but `.hidden`.

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "refactor(pantomime): phase containers + goto() scaffold"
```

---

## Task 7: Wire setup → loading → countdown → playing into phaseEnter

**Files:**
- Modify: `ps-offsite-2026/stations/2-pantomime.html`

- [ ] **Step 1: Refactor `startGame()` into phase entries**

Replace the existing `startGame()` function and the start-button listener with:

```javascript
document.getElementById('startBtn').addEventListener('click', () => {
  teamId = parseInt(teamSelect.value, 10);
  goto('loading');
});

phaseEnter.loading = async () => {
  if (!landmarker) {
    document.getElementById('startBtn').textContent = 'Loading AI…';
    try { await loadModel(); }
    catch (e) { alert('Failed to load AI model. Check internet and refresh.'); goto('setup'); return; }
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 1280, height: 720 } });
  } catch (e) { alert('Camera access required.'); goto('setup'); return; }

  const video = document.getElementById('video');
  video.srcObject = stream;
  await video.play();
  const canvas = document.getElementById('overlay');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  video.style.transform = 'scaleX(-1)';
  canvas.style.transform = 'scaleX(-1)';

  goto('countdown');
};

phaseEnter.countdown = () => {
  let n = 3;
  const el = document.getElementById('countdownNum');
  el.textContent = n;
  const timer = setInterval(() => {
    n--;
    if (n <= 0) { clearInterval(timer); goto('playing'); }
    else el.textContent = n;
  }, 1000);
  activeCleanup = () => clearInterval(timer);
};

phaseEnter.playing = () => {
  scores = [];
  stepIndex = 0;
  running = true;
  startStep();
  loop();
  activeCleanup = () => { running = false; if (stepTimeoutHandle) clearTimeout(stepTimeoutHandle); };
};
```

Delete the old `startGame()` function entirely.

- [ ] **Step 2: Update `finish()` to call `goto('final')`**

Replace inside `finish()` the lines:

```javascript
document.getElementById('gameCard').classList.add('hidden');
document.getElementById('resultCard').classList.remove('hidden');
```

with:

```javascript
goto('final');
```

(Move the remaining DOM writes from `finish()` into a new `phaseEnter.final` block.)

Replace `function finish() { ... }` with:

```javascript
function finish() {
  running = false;
  if (stepTimeoutHandle) clearTimeout(stepTimeoutHandle);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  goto('final');
}

phaseEnter.final = () => {
  const final = finalScore(scores);
  const code = `${STATION_CODE}-${teamId}-${final}`;
  document.getElementById('resTeam').textContent = teamId;
  document.getElementById('resScore').textContent = final;
  document.getElementById('resCode').textContent = code;
  document.getElementById('resBreakdown').innerHTML = POSES.map((p, i) => {
    const s = scores[i] ?? 0;
    return `<div class="breakdown-row ${s === 0 ? 'failed' : ''}">
      <span>${p.emoji} ${p.name} <span class="difficulty ${p.difficulty}">${p.difficulty}</span></span>
      <span class="pose-score">${s === 0 ? '— skipped' : s + ' / 100'}</span>
    </div>`;
  }).join('');
};
```

- [ ] **Step 3: Update `resetGame()` to use `goto('setup')`**

Replace the body of `resetGame()` with:

```javascript
window.resetGame = function() {
  running = false;
  if (stepTimeoutHandle) clearTimeout(stepTimeoutHandle);
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  scores = []; stepIndex = 0;
  POSES = [];
  goto('setup');
};
```

- [ ] **Step 4: Smoke-test phase transitions**

Run: `npm run dev`
Open page. Pick team. Hit start → loading visible → countdown 3-2-1 → playing visible. (Playing will still show empty pose list — sampling wired in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "feat(pantomime): wire phaseEnter for setup/loading/countdown/playing/final"
```

---

## Task 8: Wire samplePoses into playing phase

**Files:**
- Modify: `ps-offsite-2026/stations/2-pantomime.html`

- [ ] **Step 1: Update `phaseEnter.playing` to sample 7 poses**

Find the `phaseEnter.playing` block and update:

```javascript
phaseEnter.playing = () => {
  POSES = samplePoses(POSE_POOL);
  scores = [];
  stepIndex = 0;
  running = true;
  renderPoseList();
  startStep();
  loop();
  activeCleanup = () => { running = false; if (stepTimeoutHandle) clearTimeout(stepTimeoutHandle); };
};
```

- [ ] **Step 2: Update pose counter display**

In `startStep()`, the line:

```javascript
document.getElementById('poseIdx').textContent = `${stepIndex + 1}/${POSES.length}`;
```

is already dynamic — verify it shows `1/7` not `1/12`.

- [ ] **Step 3: Manual play-through**

Run: `npm run dev`
Open page. Play through 7 poses (or skip them). Expected:
- Each game shows exactly 7 poses
- Distribution roughly 2 easy / 3 medium / 2 hard
- Pose counter reads `N/7`
- Final breakdown shows 7 rows

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "feat(pantomime): sample 7 poses per run"
```

---

## Task 9: Team-size selector + player banner

**Files:**
- Modify: `ps-offsite-2026/stations/2-pantomime.html`

- [ ] **Step 1: Add team-size select to setup**

In the setup card, inside `.setup`, after the team-number label add:

```html
<label>Team size:
  <select id="teamSize"></select>
</label>
```

In the script, after the team-select population loop, add:

```javascript
const teamSizeSel = document.getElementById('teamSize');
for (let i = 2; i <= 8; i++) {
  const o = document.createElement('option');
  o.value = i; o.textContent = `${i} players`;
  if (i === 4) o.selected = true;
  teamSizeSel.appendChild(o);
}
```

- [ ] **Step 2: Add `teamSize` state var + capture on start**

In the script's state vars block (near `let teamId = null;`), add:

```javascript
let teamSize = 4;
```

In the start-button listener, capture it:

```javascript
document.getElementById('startBtn').addEventListener('click', () => {
  teamId = parseInt(teamSelect.value, 10);
  teamSize = parseInt(teamSizeSel.value, 10);
  goto('loading');
});
```

- [ ] **Step 3: Add player banner to playing card**

In `phase-playing`, inside `.panel`, **before** the existing `pose-card`, add:

```html
<div class="player-banner" id="playerBanner">
  <div class="label">Now posing</div>
  <div class="name" id="playerName">Player 1</div>
</div>
```

Add CSS rules in the `<style>` block (near the existing `.pose-card` block):

```css
.player-banner {
  background: var(--card);
  border-radius: 20px;
  padding: 18px;
  text-align: center;
  border: 2px solid var(--accent);
}
.player-banner .label {
  font-size: 11px; color: var(--muted);
  text-transform: uppercase; letter-spacing: 1px;
}
.player-banner .name {
  font-size: 28px; font-weight: 900; margin-top: 4px;
}
```

- [ ] **Step 4: Update banner on every pose**

In `startStep()`, after the existing DOM writes, add:

```javascript
document.getElementById('playerName').textContent = `Player ${(stepIndex % teamSize) + 1}`;
```

- [ ] **Step 5: Verify visually**

Run: `npm run dev`
Open page. Pick team + team size (e.g. 3). Play. Expected: Banner shows "Player 1" → "Player 2" → "Player 3" → "Player 1" → ... rotating per pose.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "feat(pantomime): team-size selector + player rotation banner"
```

---

## Task 10: Match-pulse + miss-flash animations

**Files:**
- Modify: `ps-offsite-2026/stations/2-pantomime.html`

- [ ] **Step 1: Add CSS keyframes and classes**

In the `<style>` block, locate `.video-wrap` and update it + add keyframes:

```css
.video-wrap {
  position: relative; background: #000; border-radius: 20px;
  overflow: hidden; aspect-ratio: 4/3;
  box-shadow: 0 0 0 0 rgba(0,230,118,0);
  transition: box-shadow 0.15s ease-out;
}
.video-wrap.match-pulse { animation: match-pulse 0.6s ease-out; }
.video-wrap.miss-flash { animation: miss-flash 0.45s ease-out; }
@keyframes match-pulse {
  0%   { box-shadow: 0 0 0 0 rgba(0,230,118,0.9), inset 0 0 0 6px rgba(0,230,118,0.0); }
  30%  { box-shadow: 0 0 32px 8px rgba(0,230,118,0.65), inset 0 0 0 6px rgba(0,230,118,0.85); }
  100% { box-shadow: 0 0 0 0 rgba(0,230,118,0),   inset 0 0 0 6px rgba(0,230,118,0.0); }
}
@keyframes miss-flash {
  0%, 100% { box-shadow: inset 0 0 0 6px rgba(255,77,109,0.0); }
  50%      { box-shadow: inset 0 0 0 6px rgba(255,77,109,0.9); }
}
```

- [ ] **Step 2: Add an `id` to the video wrap**

In the playing card markup, change:

```html
<div class="video-wrap">
```

to:

```html
<div class="video-wrap" id="videoWrap">
```

- [ ] **Step 3: Add `pulseVideo()` helper + trigger from handlers**

In the script (near `startStep`), add:

```javascript
function pulseVideo(cls) {
  const el = document.getElementById('videoWrap');
  el.classList.remove('match-pulse', 'miss-flash');
  void el.offsetWidth; // reflow -> restart animation
  el.classList.add(cls);
}
```

In `handlePose`, where the pose locks (inside `if (held >= holdMs)` after `scores.push(stepScore)`), add:

```javascript
pulseVideo('match-pulse');
```

In `timeoutStep()`, add at top:

```javascript
pulseVideo('miss-flash');
```

In `window.skipCurrent`, add before `advance()`:

```javascript
pulseVideo('miss-flash');
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`
Play. Expected:
- Locking a pose triggers green pulse.
- Timeout or skip triggers red flash.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "feat(pantomime): match-pulse + miss-flash feedback"
```

---

## Task 11: Step badge top-right of video

**Files:**
- Modify: `ps-offsite-2026/stations/2-pantomime.html`

- [ ] **Step 1: Add step-badge markup**

Inside `.video-wrap` (in the playing card), after the `<canvas>`, add:

```html
<div class="step-badge" id="stepBadge">1 / 7</div>
```

- [ ] **Step 2: Add CSS**

In the `<style>` block, add (near `.video-overlay`):

```css
.step-badge {
  position: absolute; top: 16px; left: 16px;
  background: rgba(0,0,0,0.7); backdrop-filter: blur(8px);
  padding: 8px 14px; border-radius: 999px;
  font-size: 14px; font-weight: 800; letter-spacing: 0.5px;
  color: var(--accent);
}
```

(Note: `left:16px` because the existing `.ghost-toggle` is on the right.)

- [ ] **Step 3: Update badge on every step**

In `startStep()`, add:

```javascript
document.getElementById('stepBadge').textContent = `${stepIndex + 1} / ${POSES.length}`;
```

- [ ] **Step 4: Verify visually**

Run: `npm run dev`
Play. Expected: top-left of video shows `1 / 7`, `2 / 7`, ... `7 / 7`.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "feat(pantomime): step badge on video"
```

---

## Task 12: RAF-driven timeout + visibility pause

**Files:**
- Modify: `ps-offsite-2026/stations/2-pantomime.html`

- [ ] **Step 1: Replace setTimeout in `startStep` with RAF check**

In `startStep()`, delete the lines:

```javascript
if (stepTimeoutHandle) clearTimeout(stepTimeoutHandle);
const idxAtStart = stepIndex;
stepTimeoutHandle = setTimeout(() => {
  if (running && stepIndex === idxAtStart) timeoutStep();
}, pose.timeout * 1000);
```

(`stepStartTs` is already set at the top of `startStep`.)

In `loop()`, find the block:

```javascript
const pose = POSES[stepIndex];
if (pose) {
  const elapsed = (performance.now() - stepStartTs) / 1000;
  const remaining = Math.max(0, pose.timeout - elapsed);
  document.getElementById('poseTimer').textContent = Math.ceil(remaining);
  document.getElementById('timerFill').style.width = (remaining / pose.timeout * 100) + '%';
}
```

Replace with:

```javascript
const pose = POSES[stepIndex];
if (pose) {
  const elapsed = (performance.now() - stepStartTs) / 1000;
  const remaining = Math.max(0, pose.timeout - elapsed);
  document.getElementById('poseTimer').textContent = Math.ceil(remaining);
  document.getElementById('timerFill').style.width = (remaining / pose.timeout * 100) + '%';
  if (elapsed >= pose.timeout) { timeoutStep(); return; }
}
```

Also delete the `let stepTimeoutHandle = null;` state var and all `clearTimeout(stepTimeoutHandle)` calls everywhere (in `finish`, `resetGame`, `skipCurrent`, `handlePose`, `phaseEnter.playing` cleanup).

- [ ] **Step 2: Add visibility-change handler**

Near the bottom of the script (above `goto('setup');`), add:

```javascript
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = performance.now();
  } else if (hiddenAt && stepStartTs) {
    stepStartTs += performance.now() - hiddenAt;
    hiddenAt = 0;
  }
});
```

- [ ] **Step 3: Manual verify**

Run: `npm run dev`
Open page. Start a game. On a 25s easy pose, after ~5s switch to another tab for 10s, switch back. Expected: timer resumes from where it was (~20s left, not ~10s left).

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "feat(pantomime): RAF-driven per-pose timeout + visibility pause"
```

---

## Task 13: Final verification + cleanup

**Files:**
- Run: full test suite, manual play-through

- [ ] **Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass (pantomime-logic + existing gesture-lock, audio, score-panel, stages).

- [ ] **Step 2: Manual play-through checklist**

Run: `npm run dev`. Open Station 2. Verify:

- [ ] Pick team + size, click start → loading → countdown 3-2-1 → playing
- [ ] Exactly 7 poses sampled, mix is 2 easy / 3 medium / 2 hard
- [ ] Player banner rotates per pose
- [ ] Step badge shows `N / 7`
- [ ] Locking a pose triggers green pulse
- [ ] Skipping or timing out triggers red flash
- [ ] Switching tab mid-pose pauses the timer
- [ ] Final breakdown lists 7 rows (not 12) with correct scores
- [ ] Submit code matches `PM-<team>-<finalScore>`
- [ ] Camera stops after final card appears (camera indicator off)
- [ ] Play-again returns to setup; second game samples a different selection

- [ ] **Step 3: Lint / format check (if available)**

Run: `npm run build` (if build script catches errors)
Expected: Build succeeds (or no build script — skip).

- [ ] **Step 4: Final commit (only if anything was changed during verification)**

If verification surfaced fixes:

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "fix(pantomime): verification fixes"
```

Otherwise no commit needed.
