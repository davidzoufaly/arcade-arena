# Gesture Lock Rewrite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite `1-gesture-lock.html` into a memorize-then-recall team game: random 8-gesture sequence (pool of 6), flashcards then hidden, team performs from memory taking turns, 3 attempts, success-or-partial scoring.

**Architecture:** Single-file station (matches existing convention) for orchestration + DOM, but pure logic (sequence generation, scoring) extracted to `ps-offsite-2026/shared/gesture-lock-logic.js` so it can be Vitest-tested. State machine with explicit `goto(phase)` transitions; each phase entry registers an `activeCleanup` to cancel timers/raf before next phase runs. MediaPipe Gesture Recognizer + getUserMedia init lazy on first LOADING transition, reused across attempts.

**Tech Stack:** Vanilla ES modules, MediaPipe `@mediapipe/tasks-vision@0.10.14` (CDN), Vite (existing build), Vitest (existing tests).

**Spec:** [docs/superpowers/specs/2026-05-25-gesture-lock-rewrite-design.md](../specs/2026-05-25-gesture-lock-rewrite-design.md)

---

## File Structure

**Create:**
- `ps-offsite-2026/shared/gesture-lock-logic.js` — pure functions: `pickSequenceWithRepeats`, `scoreAttempt`, `finalScore`, `GESTURE_POOL` constant
- `tests/gesture-lock.test.js` — Vitest suite for the pure logic

**Modify:**
- `ps-offsite-2026/stations/1-gesture-lock.html` — full rewrite of `<script type="module">` block + DOM regions for the new phases

**No other files touched.**

---

## Task 1: Pure logic module — sequence generator (TDD)

**Files:**
- Create: `tests/gesture-lock.test.js`
- Create: `ps-offsite-2026/shared/gesture-lock-logic.js`

- [ ] **Step 1.1: Write failing tests for `pickSequenceWithRepeats` and `GESTURE_POOL`**

Create `tests/gesture-lock.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  GESTURE_POOL,
  pickSequenceWithRepeats,
} from '../ps-offsite-2026/shared/gesture-lock-logic.js';

describe('GESTURE_POOL', () => {
  it('has exactly 6 gestures', () => {
    expect(GESTURE_POOL).toHaveLength(6);
  });

  it('contains expected MediaPipe gesture ids', () => {
    const ids = GESTURE_POOL.map(g => g.id).sort();
    expect(ids).toEqual([
      'Closed_Fist', 'Open_Palm', 'Pointing_Up',
      'Thumb_Down', 'Thumb_Up', 'Victory',
    ]);
  });

  it('each gesture has id, emoji, name', () => {
    for (const g of GESTURE_POOL) {
      expect(g).toHaveProperty('id');
      expect(g).toHaveProperty('emoji');
      expect(g).toHaveProperty('name');
    }
  });
});

describe('pickSequenceWithRepeats', () => {
  it('returns array of requested length', () => {
    const seq = pickSequenceWithRepeats(GESTURE_POOL, 8);
    expect(seq).toHaveLength(8);
  });

  it('every element comes from the pool', () => {
    const seq = pickSequenceWithRepeats(GESTURE_POOL, 8);
    const ids = new Set(GESTURE_POOL.map(g => g.id));
    for (const g of seq) {
      expect(ids.has(g.id)).toBe(true);
    }
  });

  it('permits repeats — across 200 runs of length 8 from pool of 6, at least one run has a repeat', () => {
    let sawRepeat = false;
    for (let i = 0; i < 200; i++) {
      const seq = pickSequenceWithRepeats(GESTURE_POOL, 8);
      const ids = seq.map(g => g.id);
      if (new Set(ids).size < ids.length) { sawRepeat = true; break; }
    }
    expect(sawRepeat).toBe(true);
  });

  it('handles length 0', () => {
    expect(pickSequenceWithRepeats(GESTURE_POOL, 0)).toEqual([]);
  });
});
```

- [ ] **Step 1.2: Run tests to confirm they fail**

Run: `npm test -- gesture-lock`
Expected: FAIL — module not found.

- [ ] **Step 1.3: Implement minimal logic module**

Create `ps-offsite-2026/shared/gesture-lock-logic.js`:

```js
export const GESTURE_POOL = [
  { id: 'Open_Palm',   emoji: '✋',  name: 'Open Palm' },
  { id: 'Closed_Fist', emoji: '✊',  name: 'Fist' },
  { id: 'Thumb_Up',    emoji: '👍', name: 'Thumbs Up' },
  { id: 'Thumb_Down',  emoji: '👎', name: 'Thumbs Down' },
  { id: 'Victory',     emoji: '✌️', name: 'Victory' },
  { id: 'Pointing_Up', emoji: '☝️', name: 'Point Up' },
];

export function pickSequenceWithRepeats(pool, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}
```

- [ ] **Step 1.4: Run tests to confirm they pass**

Run: `npm test -- gesture-lock`
Expected: PASS (4 of 4 in the two describes; 5 total counting the per-gesture loop).

- [ ] **Step 1.5: Commit**

```bash
git add tests/gesture-lock.test.js ps-offsite-2026/shared/gesture-lock-logic.js
git commit -m "feat(gesture-lock): pure logic module with sequence generator"
```

---

## Task 2: Pure logic — `scoreAttempt` (TDD)

**Files:**
- Modify: `tests/gesture-lock.test.js` (append)
- Modify: `ps-offsite-2026/shared/gesture-lock-logic.js` (append export)

- [ ] **Step 2.1: Append failing tests for `scoreAttempt`**

Append to `tests/gesture-lock.test.js` (before final newline, after existing describes):

```js
import { scoreAttempt } from '../ps-offsite-2026/shared/gesture-lock-logic.js';

describe('scoreAttempt', () => {
  it('success at 10s grace edge → 100', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 10 })).toBe(100);
  });

  it('success under grace (5s) → 100', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 5 })).toBe(100);
  });

  it('success at 20s → 80', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 20 })).toBe(80);
  });

  it('success at 30s → 60', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 30 })).toBe(60);
  });

  it('success at 45s → clamped to floor 40', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 45 })).toBe(40);
  });

  it('success never exceeds 100', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 0 })).toBe(100);
  });

  it('fail with 0 completed → 0', () => {
    expect(scoreAttempt({ result: 'fail', completed: 0, timeSec: 10 })).toBe(0);
  });

  it('fail with 4 completed → 17 (floor of 4/8*35)', () => {
    expect(scoreAttempt({ result: 'fail', completed: 4, timeSec: 12 })).toBe(17);
  });

  it('timeout with 7 completed → 30 (floor of 7/8*35)', () => {
    expect(scoreAttempt({ result: 'timeout', completed: 7, timeSec: 45 })).toBe(30);
  });

  it('partial never reaches success floor — 8/8 fail (impossible state) still caps at 35', () => {
    expect(scoreAttempt({ result: 'fail', completed: 8, timeSec: 30 })).toBe(35);
  });
});
```

- [ ] **Step 2.2: Run to confirm failure**

Run: `npm test -- gesture-lock`
Expected: FAIL — `scoreAttempt` not exported.

- [ ] **Step 2.3: Implement `scoreAttempt`**

Append to `ps-offsite-2026/shared/gesture-lock-logic.js`:

```js
export function scoreAttempt({ result, completed, timeSec }) {
  if (result === 'success') {
    const raw = 100 - Math.max(0, timeSec - 10) * 2;
    return Math.max(40, Math.min(100, Math.round(raw)));
  }
  return Math.floor((completed / 8) * 35);
}
```

- [ ] **Step 2.4: Run tests to confirm pass**

Run: `npm test -- gesture-lock`
Expected: PASS, all describes green.

- [ ] **Step 2.5: Commit**

```bash
git add tests/gesture-lock.test.js ps-offsite-2026/shared/gesture-lock-logic.js
git commit -m "feat(gesture-lock): scoreAttempt formula"
```

---

## Task 3: Pure logic — `finalScore` (TDD)

**Files:**
- Modify: `tests/gesture-lock.test.js`
- Modify: `ps-offsite-2026/shared/gesture-lock-logic.js`

- [ ] **Step 3.1: Append failing tests**

Append to `tests/gesture-lock.test.js`:

```js
import { finalScore } from '../ps-offsite-2026/shared/gesture-lock-logic.js';

describe('finalScore', () => {
  it('returns 0 for empty attempts', () => {
    expect(finalScore([])).toBe(0);
  });

  it('returns the only success score when one success + two fails', () => {
    const attempts = [
      { result: 'fail', completed: 3, score: 13 },
      { result: 'success', completed: 8, score: 60 },
      { result: 'fail', completed: 5, score: 21 },
    ];
    expect(finalScore(attempts)).toBe(60);
  });

  it('picks max across multiple successes', () => {
    const attempts = [
      { result: 'success', completed: 8, score: 50 },
      { result: 'success', completed: 8, score: 80 },
      { result: 'fail', completed: 6, score: 26 },
    ];
    expect(finalScore(attempts)).toBe(80);
  });

  it('picks max partial when no successes', () => {
    const attempts = [
      { result: 'fail', completed: 2, score: 8 },
      { result: 'timeout', completed: 5, score: 21 },
      { result: 'fail', completed: 4, score: 17 },
    ];
    expect(finalScore(attempts)).toBe(21);
  });

  it('any success beats any partial', () => {
    const attempts = [
      { result: 'fail', completed: 7, score: 30 },
      { result: 'success', completed: 8, score: 40 },
    ];
    expect(finalScore(attempts)).toBe(40);
  });
});
```

- [ ] **Step 3.2: Run to confirm failure**

Run: `npm test -- gesture-lock`
Expected: FAIL — `finalScore` not exported.

- [ ] **Step 3.3: Implement `finalScore`**

Append to `ps-offsite-2026/shared/gesture-lock-logic.js`:

```js
export function finalScore(attempts) {
  if (!attempts.length) return 0;
  const successes = attempts.filter(a => a.result === 'success');
  const pool = successes.length ? successes : attempts;
  return Math.max(0, ...pool.map(a => a.score));
}
```

- [ ] **Step 3.4: Run tests to confirm pass**

Run: `npm test -- gesture-lock`
Expected: PASS — all `gesture-lock.test.js` green.

- [ ] **Step 3.5: Commit**

```bash
git add tests/gesture-lock.test.js ps-offsite-2026/shared/gesture-lock-logic.js
git commit -m "feat(gesture-lock): finalScore aggregator"
```

---

## Task 4: HTML skeleton — phase regions + setup UI

**Files:**
- Modify: `ps-offsite-2026/stations/1-gesture-lock.html` (replace whole file)

This task swaps the file wholesale to the new structure. Pure-DOM scaffolding only; JS is a no-op stub that wires the team selector to a `console.log` Start. Subsequent tasks fill in each phase.

- [ ] **Step 4.1: Replace `ps-offsite-2026/stations/1-gesture-lock.html` with new skeleton**

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Station 1 — Gesture Lock</title>
<style>
  :root {
    --bg: #0a0e1a;
    --bg-2: #131a2e;
    --card: #1b2540;
    --text: #f5f7fb;
    --muted: #8b95b5;
    --accent: #00d4ff;
    --good: #00e676;
    --bad: #ff4d6d;
    --gold: #ffd84d;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(circle at 20% 0%, #1f2a4a 0%, var(--bg) 60%);
    color: var(--text);
    min-height: 100vh;
    overflow-x: hidden;
  }
  header {
    padding: 20px 32px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 1px solid rgba(255,255,255,0.08);
  }
  header h1 { font-size: 22px; font-weight: 800; }
  header .station-badge {
    background: var(--accent); color: #001;
    padding: 4px 10px; border-radius: 6px;
    font-size: 12px; font-weight: 800; letter-spacing: 0.5px; margin-right: 12px;
  }
  main { max-width: 1200px; margin: 0 auto; padding: 32px; }
  .card {
    background: var(--card);
    border-radius: 20px;
    padding: 28px;
    border: 1px solid rgba(255,255,255,0.06);
    margin-bottom: 20px;
  }
  .briefing { font-size: 15px; line-height: 1.6; color: var(--muted); }
  .briefing strong { color: var(--text); }
  .setup { display: flex; gap: 16px; align-items: center; flex-wrap: wrap; }
  input, select {
    background: var(--bg-2);
    border: 1px solid rgba(255,255,255,0.1);
    color: var(--text);
    padding: 12px 16px;
    border-radius: 10px;
    font-size: 16px;
    font-family: inherit;
  }
  button {
    background: linear-gradient(135deg, var(--accent), #0099cc);
    border: none; color: #001;
    padding: 12px 24px; border-radius: 10px;
    font-size: 16px; font-weight: 700; cursor: pointer;
    font-family: inherit; transition: all 0.15s;
  }
  button:hover:not(:disabled) { transform: translateY(-1px); }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  button.secondary {
    background: var(--card);
    border: 1px solid rgba(255,255,255,0.1);
    color: var(--text);
  }

  .video-wrap {
    position: relative; background: #000;
    border-radius: 20px; overflow: hidden; aspect-ratio: 4/3;
  }
  video, canvas {
    width: 100%; height: 100%;
    object-fit: cover; display: block;
  }
  canvas { position: absolute; inset: 0; pointer-events: none; }
  .video-overlay {
    position: absolute; bottom: 16px; left: 16px;
    background: rgba(0,0,0,0.6); backdrop-filter: blur(8px);
    padding: 8px 14px; border-radius: 10px;
    font-size: 14px; font-family: ui-monospace, monospace;
  }
  .game { display: grid; grid-template-columns: 1fr 360px; gap: 24px; }
  @media (max-width: 900px) { .game { grid-template-columns: 1fr; } }

  .panel { display: flex; flex-direction: column; gap: 16px; }

  .player-banner {
    background: var(--card);
    border-radius: 20px;
    padding: 24px;
    text-align: center;
    border: 2px solid var(--accent);
  }
  .player-banner .label {
    font-size: 12px; color: var(--muted);
    text-transform: uppercase; letter-spacing: 1px;
  }
  .player-banner .name {
    font-size: 36px; font-weight: 900; margin-top: 4px;
  }

  .progress-dots {
    display: flex; gap: 8px; justify-content: center; margin-top: 8px;
  }
  .dot {
    flex: 1; aspect-ratio: 1;
    background: var(--bg-2);
    border: 2px solid rgba(255,255,255,0.06);
    border-radius: 12px;
    display: flex; align-items: center; justify-content: center;
    font-size: 28px;
    transition: all 0.2s;
  }
  .dot.done {
    background: rgba(0,230,118,0.18);
    border-color: var(--good);
  }
  .dot.flashing {
    border-color: var(--accent);
    box-shadow: 0 0 24px rgba(0,212,255,0.5);
  }

  .progress-bar {
    height: 6px; background: rgba(255,255,255,0.08);
    border-radius: 999px; overflow: hidden; margin-top: 16px;
  }
  .progress-fill {
    height: 100%;
    background: linear-gradient(90deg, var(--accent), var(--good));
    width: 0%; transition: width 0.1s linear;
  }

  .stats { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
  .stat {
    background: var(--bg-2); padding: 16px;
    border-radius: 12px; text-align: center;
  }
  .stat .value { font-size: 28px; font-weight: 800; font-variant-numeric: tabular-nums; }
  .stat .label { font-size: 11px; color: var(--muted); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

  .big-flash {
    text-align: center;
    padding: 40px 24px;
  }
  .big-flash .emoji { font-size: 160px; line-height: 1; }
  .big-flash .name { font-size: 22px; color: var(--muted); margin-top: 12px; }

  .countdown {
    text-align: center;
    padding: 60px 24px;
  }
  .countdown .num {
    font-size: 180px; font-weight: 900;
    background: linear-gradient(135deg, var(--accent), var(--gold));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    line-height: 1;
  }

  .result { text-align: center; padding: 32px; }
  .result h2 { font-size: 32px; margin-bottom: 8px; }
  .result .score {
    font-size: 72px; font-weight: 900;
    background: linear-gradient(135deg, var(--accent), var(--gold));
    -webkit-background-clip: text; background-clip: text; color: transparent;
    margin: 16px 0;
  }
  .submit-code {
    background: var(--bg-2); padding: 16px 24px;
    border-radius: 12px; font-family: ui-monospace, monospace;
    font-size: 28px; font-weight: 800; letter-spacing: 4px;
    display: inline-block; margin: 20px 0;
    border: 2px dashed var(--accent); color: var(--accent);
  }
  .result-row {
    display: flex; gap: 12px; justify-content: center; flex-wrap: wrap;
  }
  .hidden { display: none !important; }
  .loading { text-align: center; color: var(--muted); padding: 40px; }
</style>
</head>
<body>
<header>
  <h1><span class="station-badge">GZ</span>Gesture Lock</h1>
  <a href="../scoreboard.html" style="color:var(--muted); text-decoration:none; font-size:13px">← Scoreboard</a>
</header>

<main>
  <div class="card briefing">
    <strong>Goal:</strong> Watch the 8-gesture sequence flash, then unlock the vault from memory — one player per gesture, take turns. <strong>3 attempts</strong>. Best successful attempt counts; if none succeed, best partial counts. Faster = more points.
  </div>

  <!-- SETUP -->
  <div id="phase-setup" class="card">
    <h3 style="margin-bottom: 12px">Get ready</h3>
    <div class="setup">
      <label>Team #:
        <select id="teamSelect"><option value="">—</option></select>
      </label>
      <label>Team size:
        <select id="teamSize"></select>
      </label>
      <button id="startBtn" disabled>Start camera</button>
    </div>
    <div class="briefing" style="margin-top: 12px; font-size: 13px;">
      Allow camera access when prompted.
    </div>
  </div>

  <!-- LOADING -->
  <div id="phase-loading" class="card loading hidden">
    Loading AI model and camera…
  </div>

  <!-- ATTEMPT_INTRO -->
  <div id="phase-intro" class="card hidden">
    <h2 style="font-size: 28px; margin-bottom: 8px;">Attempt <span id="introNum">1</span> of 3</h2>
    <p class="briefing">Memorize the sequence — it flashes one at a time, no replay.</p>
    <button id="introStartBtn" style="margin-top: 16px;">Show sequence</button>
  </div>

  <!-- MEMORIZE -->
  <div id="phase-memorize" class="card hidden">
    <div class="big-flash">
      <div class="emoji" id="flashEmoji">✋</div>
      <div class="name" id="flashName">Open Palm</div>
    </div>
    <div class="progress-dots" id="memorizeDots"></div>
  </div>

  <!-- COUNTDOWN -->
  <div id="phase-countdown" class="card hidden">
    <div class="countdown"><div class="num" id="countdownNum">3</div></div>
  </div>

  <!-- RECALL -->
  <div id="phase-recall" class="hidden">
    <div class="game">
      <div class="video-wrap">
        <video id="video" playsinline autoplay muted></video>
        <canvas id="overlay"></canvas>
        <div class="video-overlay">
          Detected: <span id="currentGesture">—</span>
        </div>
      </div>
      <div class="panel">
        <div class="player-banner">
          <div class="label">Now showing</div>
          <div class="name" id="playerName">Player 1</div>
          <div class="progress-bar"><div class="progress-fill" id="progressFill"></div></div>
        </div>
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:8px;text-align:center">Progress</div>
          <div class="progress-dots" id="recallDots"></div>
        </div>
        <div class="stats">
          <div class="stat"><div class="value" id="timer">00.0</div><div class="label">Time (s)</div></div>
          <div class="stat"><div class="value" id="attemptLabel">1 / 3</div><div class="label">Attempt</div></div>
        </div>
        <button class="secondary" id="recallAbort">Abort attempt</button>
      </div>
    </div>
  </div>

  <!-- ATTEMPT_END -->
  <div id="phase-attempt-end" class="card hidden">
    <h2 id="attemptResultTitle" style="font-size: 28px; margin-bottom: 12px;">Attempt complete</h2>
    <p class="briefing">
      Completed <strong id="attemptCompleted">0</strong> / 8 ·
      time <strong id="attemptTime">0</strong> s ·
      attempt score <strong id="attemptScoreVal">0</strong>
    </p>
    <div class="result-row" style="margin-top: 20px;">
      <button id="attemptTryAgain">Try again</button>
      <button class="secondary" id="attemptFinish">Finish</button>
    </div>
  </div>

  <!-- FINAL_RESULT -->
  <div id="phase-final" class="card result hidden">
    <h2 id="finalTitle">🔓 Vault unlocked!</h2>
    <p style="color:var(--muted)">Team <strong id="resTeam"></strong></p>
    <div class="score" id="resScore">0</div>
    <p style="color:var(--muted); font-size: 14px;">Enter this code at the central scoreboard:</p>
    <div class="submit-code" id="resCode">GZ-?-?</div>
    <div><button id="finalPlayAgain">Play again</button></div>
  </div>
</main>

<script type="module">
import {
  GESTURE_POOL,
  pickSequenceWithRepeats,
  scoreAttempt,
  finalScore,
} from '../shared/gesture-lock-logic.js';

// Stub: populate selectors, enable Start when team chosen. Logic lands in later tasks.
const teamSelect = document.getElementById('teamSelect');
for (let i = 1; i <= 10; i++) {
  const o = document.createElement('option');
  o.value = i; o.textContent = `Team ${i}`;
  teamSelect.appendChild(o);
}
const teamSize = document.getElementById('teamSize');
for (let i = 2; i <= 8; i++) {
  const o = document.createElement('option');
  o.value = i; o.textContent = `${i} players`;
  if (i === 4) o.selected = true;
  teamSize.appendChild(o);
}
const startBtn = document.getElementById('startBtn');
teamSelect.addEventListener('change', () => { startBtn.disabled = !teamSelect.value; });
startBtn.addEventListener('click', () => { console.log('start clicked — implementation pending'); });
</script>
</body>
</html>
```

- [ ] **Step 4.2: Run dev server and verify skeleton loads with no JS errors**

Run: `npm run dev`
Open: `http://localhost:5173/stations/1-gesture-lock.html`
Expected:
- Setup card visible with team + team size selectors and disabled Start button
- Selecting a team enables Start
- Browser console shows no errors
- All other phase cards hidden

Stop the dev server (Ctrl-C) before continuing.

- [ ] **Step 4.3: Commit**

```bash
git add ps-offsite-2026/stations/1-gesture-lock.html
git commit -m "feat(gesture-lock): HTML skeleton with phase regions"
```

---

## Task 5: State machine + MediaPipe init (LOADING → ATTEMPT_INTRO)

**Files:**
- Modify: `ps-offsite-2026/stations/1-gesture-lock.html` — replace `<script type="module">` body

- [ ] **Step 5.1: Replace the `<script type="module">` body**

Locate the existing `<script type="module">…</script>` block (the stub from Task 4) and replace its **contents** (keep the tags) with:

```js
import { GestureRecognizer, FilesetResolver, DrawingUtils } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs';
import {
  GESTURE_POOL,
  pickSequenceWithRepeats,
  scoreAttempt,
  finalScore,
} from '../shared/gesture-lock-logic.js';

const STATION_CODE = 'GZ';
const SEQUENCE_LEN = 8;
const MAX_ATTEMPTS = 3;
const MEMORIZE_FLASH_MS = 800;
const COUNTDOWN_MS = 3000;
const HOLD_MS = 400;
const WRONG_CONFIRM_MS = 500;
const POST_MATCH_SETTLE_MS = 600;
const WRONG_CONFIDENCE = 0.7;
const MATCH_CONFIDENCE = 0.6;
const RECALL_CAP_S = 45;

const PHASES = ['setup', 'loading', 'intro', 'memorize', 'countdown', 'recall', 'attempt-end', 'final'];
let activeCleanup = null;

const state = {
  teamId: null,
  teamSize: 4,
  recognizer: null,
  stream: null,
  attemptIdx: 0,
  sequence: [],
  stepIdx: 0,
  recallStartMs: 0,
  attempts: [],
};

function $(id) { return document.getElementById(id); }

function goto(phase) {
  if (activeCleanup) { try { activeCleanup(); } catch {} activeCleanup = null; }
  for (const p of PHASES) $(`phase-${p}`).classList.add('hidden');
  $(`phase-${phase}`).classList.remove('hidden');
  const entry = phaseEnter[phase];
  if (entry) entry();
}

const phaseEnter = {};

// ----- SETUP -----
const teamSelect = $('teamSelect');
for (let i = 1; i <= 10; i++) {
  const o = document.createElement('option');
  o.value = i; o.textContent = `Team ${i}`;
  teamSelect.appendChild(o);
}
const teamSizeSel = $('teamSize');
for (let i = 2; i <= 8; i++) {
  const o = document.createElement('option');
  o.value = i; o.textContent = `${i} players`;
  if (i === 4) o.selected = true;
  teamSizeSel.appendChild(o);
}
const startBtn = $('startBtn');
teamSelect.addEventListener('change', () => { startBtn.disabled = !teamSelect.value; });
startBtn.addEventListener('click', () => {
  state.teamId = parseInt(teamSelect.value, 10);
  state.teamSize = parseInt(teamSizeSel.value, 10);
  state.attempts = [];
  state.attemptIdx = 0;
  goto('loading');
});

// ----- LOADING -----
phaseEnter.loading = async () => {
  try {
    if (!state.recognizer) {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
      );
      state.recognizer = await GestureRecognizer.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 1,
      });
    }
    if (!state.stream) {
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 640, height: 480 },
      });
      const video = $('video');
      video.srcObject = state.stream;
      await video.play();
      video.style.transform = 'scaleX(-1)';
      $('overlay').style.transform = 'scaleX(-1)';
      $('overlay').width = video.videoWidth;
      $('overlay').height = video.videoHeight;
    }
  } catch (e) {
    alert('Failed to start AI/camera: ' + (e.message || e));
    goto('setup');
    return;
  }
  goto('intro');
};

// ----- ATTEMPT_INTRO -----
phaseEnter.intro = () => {
  $('introNum').textContent = state.attemptIdx + 1;
  $('introStartBtn').onclick = () => goto('memorize');
};

// ----- placeholders (filled in later tasks) -----
phaseEnter.memorize = () => { /* Task 6 */ };
phaseEnter.countdown = () => { /* Task 7 */ };
phaseEnter.recall = () => { /* Task 8 */ };
phaseEnter['attempt-end'] = () => { /* Task 9 */ };
phaseEnter.final = () => { /* Task 9 */ };

// Bootstrap
goto('setup');
```

- [ ] **Step 5.2: Manual verify in browser**

Run: `npm run dev`
Open: `http://localhost:5173/stations/1-gesture-lock.html`
Steps:
1. Pick Team 1, size 4, click Start camera.
2. Approve camera permission.
3. Expect: spinner "Loading AI model and camera…", then `Attempt 1 of 3` intro card with `Show sequence` button.
4. Click `Show sequence` → memorize phase shows (empty placeholder for now; no JS error).

Stop dev server.

- [ ] **Step 5.3: Commit**

```bash
git add ps-offsite-2026/stations/1-gesture-lock.html
git commit -m "feat(gesture-lock): state machine + camera/AI init"
```

---

## Task 6: MEMORIZE phase — flashcard loop

**Files:**
- Modify: `ps-offsite-2026/stations/1-gesture-lock.html` — replace `phaseEnter.memorize = …` body

- [ ] **Step 6.1: Replace `phaseEnter.memorize`**

Find the line `phaseEnter.memorize = () => { /* Task 6 */ };` and replace with:

```js
phaseEnter.memorize = () => {
  state.sequence = pickSequenceWithRepeats(GESTURE_POOL, SEQUENCE_LEN);
  state.stepIdx = 0;

  const dotsEl = $('memorizeDots');
  dotsEl.innerHTML = state.sequence.map(() => `<div class="dot"></div>`).join('');
  const dots = [...dotsEl.children];

  let i = 0;
  let timer = null;
  let cancelled = false;

  function tick() {
    if (cancelled) return;
    if (i >= state.sequence.length) {
      // Brief pause then advance
      timer = setTimeout(() => { if (!cancelled) goto('countdown'); }, 400);
      return;
    }
    const g = state.sequence[i];
    $('flashEmoji').textContent = g.emoji;
    $('flashName').textContent = g.name;
    dots.forEach(d => d.classList.remove('flashing'));
    dots[i].classList.add('flashing');
    i++;
    timer = setTimeout(tick, MEMORIZE_FLASH_MS);
  }

  tick();

  activeCleanup = () => {
    cancelled = true;
    if (timer) clearTimeout(timer);
  };
};
```

- [ ] **Step 6.2: Manual verify**

Run: `npm run dev` → open station 1 → set team → Start → Show sequence.
Expected:
- 8 dots appear in a row, dimmed.
- One at a time, the current dot glows blue and the centre flashes the emoji+name. ~0.8s per card.
- After the 8th, screen transitions to the countdown card.

Stop dev server.

- [ ] **Step 6.3: Commit**

```bash
git add ps-offsite-2026/stations/1-gesture-lock.html
git commit -m "feat(gesture-lock): memorize flashcard loop"
```

---

## Task 7: COUNTDOWN phase

**Files:**
- Modify: `ps-offsite-2026/stations/1-gesture-lock.html` — replace `phaseEnter.countdown` body

- [ ] **Step 7.1: Replace `phaseEnter.countdown`**

Replace `phaseEnter.countdown = () => { /* Task 7 */ };` with:

```js
phaseEnter.countdown = () => {
  let n = 3;
  const el = $('countdownNum');
  el.textContent = n;
  let timer = setInterval(() => {
    n--;
    if (n <= 0) {
      clearInterval(timer);
      timer = null;
      goto('recall');
    } else {
      el.textContent = n;
    }
  }, 1000);
  activeCleanup = () => { if (timer) clearInterval(timer); };
};
```

- [ ] **Step 7.2: Manual verify**

Run: `npm run dev` → trigger memorize → expect countdown counts `3 → 2 → 1` (1s each), then transitions to recall phase.

Stop dev server.

- [ ] **Step 7.3: Commit**

```bash
git add ps-offsite-2026/stations/1-gesture-lock.html
git commit -m "feat(gesture-lock): countdown phase"
```

---

## Task 8: RECALL phase — gesture detection + scoring

**Files:**
- Modify: `ps-offsite-2026/stations/1-gesture-lock.html` — replace `phaseEnter.recall` body

- [ ] **Step 8.1: Replace `phaseEnter.recall`**

Replace `phaseEnter.recall = () => { /* Task 8 */ };` with:

```js
phaseEnter.recall = () => {
  state.stepIdx = 0;
  state.recallStartMs = performance.now();

  // Render empty dots
  const dotsEl = $('recallDots');
  dotsEl.innerHTML = state.sequence.map(() => `<div class="dot"></div>`).join('');
  const dots = [...dotsEl.children];

  $('attemptLabel').textContent = `${state.attemptIdx + 1} / ${MAX_ATTEMPTS}`;
  $('progressFill').style.width = '0%';
  $('currentGesture').textContent = '—';
  updatePlayerBanner();

  let rafId = null;
  let cancelled = false;
  let lastVideoTime = -1;
  let holdStart = 0;
  let lastGesture = null;
  let lastMatchMs = 0;
  let wrongStart = 0;
  let wrongName = null;

  function updatePlayerBanner() {
    $('playerName').textContent = `Player ${(state.stepIdx % state.teamSize) + 1}`;
  }

  function endAttempt(result) {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
    const timeSec = (performance.now() - state.recallStartMs) / 1000;
    const completed = state.stepIdx;
    const score = scoreAttempt({ result, completed, timeSec });
    state.attempts.push({ result, completed, timeSec, score });
    goto('attempt-end');
  }

  function drawLandmarks(result) {
    const canvas = $('overlay');
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!result.landmarks) return;
    const du = new DrawingUtils(ctx);
    for (const lm of result.landmarks) {
      du.drawConnectors(lm, GestureRecognizer.HAND_CONNECTIONS, { color: '#00d4ff', lineWidth: 3 });
      du.drawLandmarks(lm, { color: '#ff00aa', lineWidth: 1, radius: 3 });
    }
  }

  function handleGesture(result) {
    const g = (result.gestures && result.gestures[0] && result.gestures[0][0]) || null;
    const name = g ? g.categoryName : 'None';
    const conf = g ? g.score : 0;
    $('currentGesture').textContent = name === 'None' ? '—' : `${name} (${(conf*100).toFixed(0)}%)`;

    if (state.stepIdx >= state.sequence.length) return;
    const now = performance.now();

    // Settle window after a correct match
    if (now - lastMatchMs < POST_MATCH_SETTLE_MS) {
      $('progressFill').style.width = '0%';
      return;
    }

    const target = state.sequence[state.stepIdx].id;

    if (name === target && conf > MATCH_CONFIDENCE) {
      if (lastGesture !== target) holdStart = now;
      lastGesture = target;
      const held = now - holdStart;
      $('progressFill').style.width = Math.min(100, (held / HOLD_MS) * 100) + '%';
      if (held >= HOLD_MS) {
        // Advance
        dots[state.stepIdx].classList.add('done');
        state.stepIdx++;
        lastMatchMs = now;
        holdStart = 0;
        lastGesture = null;
        wrongStart = 0;
        wrongName = null;
        $('progressFill').style.width = '0%';
        if (state.stepIdx >= state.sequence.length) {
          endAttempt('success');
          return;
        }
        updatePlayerBanner();
      }
    } else {
      $('progressFill').style.width = '0%';
      // Wrong-gesture detection
      if (name !== 'None' && name !== target && conf > WRONG_CONFIDENCE) {
        if (wrongName !== name) {
          wrongName = name;
          wrongStart = now;
        } else if (now - wrongStart >= WRONG_CONFIRM_MS) {
          endAttempt('fail');
          return;
        }
      } else {
        wrongStart = 0;
        wrongName = null;
      }
      lastGesture = name;
    }
  }

  function loop() {
    if (cancelled) return;
    const elapsed = (performance.now() - state.recallStartMs) / 1000;
    const t = $('timer');
    t.textContent = elapsed.toFixed(1);
    t.style.color = elapsed > RECALL_CAP_S * 0.8 ? '#ffd84d' : '';

    if (elapsed > RECALL_CAP_S) {
      endAttempt('timeout');
      return;
    }

    const video = $('video');
    if (video.currentTime !== lastVideoTime) {
      lastVideoTime = video.currentTime;
      const result = state.recognizer.recognizeForVideo(video, performance.now());
      drawLandmarks(result);
      handleGesture(result);
    }
    rafId = requestAnimationFrame(loop);
  }

  $('recallAbort').onclick = () => endAttempt('fail');

  rafId = requestAnimationFrame(loop);

  activeCleanup = () => {
    cancelled = true;
    if (rafId) cancelAnimationFrame(rafId);
  };
};
```

- [ ] **Step 8.2: Manual verify**

Run: `npm run dev` → station 1 → set team → through memorize + countdown → recall.
Verify:
- Camera feed visible (mirrored), landmark dots/lines drawn on hand.
- Banner shows `Player 1`.
- Performing the correct first gesture for ~0.4s lights the first dot, advances banner to `Player 2`.
- Performing a clearly wrong gesture sustained ~0.5s ends attempt with `fail`.
- Letting the 45s timer expire ends attempt with `timeout`.
- Completing all 8 ends with `success`.

Stop dev server.

- [ ] **Step 8.3: Commit**

```bash
git add ps-offsite-2026/stations/1-gesture-lock.html
git commit -m "feat(gesture-lock): recall phase with gesture detection"
```

---

## Task 9: ATTEMPT_END + FINAL_RESULT phases

**Files:**
- Modify: `ps-offsite-2026/stations/1-gesture-lock.html`

- [ ] **Step 9.1: Replace `phaseEnter['attempt-end']` and `phaseEnter.final`**

Replace the two placeholders with:

```js
phaseEnter['attempt-end'] = () => {
  const last = state.attempts[state.attempts.length - 1];
  const titles = {
    success: '🔓 Sequence cleared!',
    fail: '❌ Wrong gesture',
    timeout: '⏱ Out of time',
  };
  $('attemptResultTitle').textContent = titles[last.result] || 'Attempt complete';
  $('attemptCompleted').textContent = last.completed;
  $('attemptTime').textContent = last.timeSec.toFixed(1);
  $('attemptScoreVal').textContent = last.score;

  const attemptsLeft = MAX_ATTEMPTS - state.attempts.length;
  const tryAgain = $('attemptTryAgain');
  const finish = $('attemptFinish');

  tryAgain.classList.toggle('hidden', attemptsLeft <= 0);
  tryAgain.onclick = () => {
    state.attemptIdx++;
    goto('intro');
  };
  finish.onclick = () => goto('final');
};

phaseEnter.final = () => {
  // Tear down camera + recognizer
  if (state.stream) {
    state.stream.getTracks().forEach(t => t.stop());
    state.stream = null;
  }
  // Note: keep recognizer (cheap to keep, expensive to re-create) — only stream needs stopping
  const score = finalScore(state.attempts);
  const anySuccess = state.attempts.some(a => a.result === 'success');
  $('finalTitle').textContent = anySuccess ? '🔓 Vault unlocked!' : '🔒 Vault still locked';
  $('resTeam').textContent = state.teamId;
  $('resScore').textContent = score;
  $('resCode').textContent = `${STATION_CODE}-${state.teamId}-${score}`;
  $('finalPlayAgain').onclick = () => {
    // Hard reset for replay
    state.attempts = [];
    state.attemptIdx = 0;
    state.sequence = [];
    state.stepIdx = 0;
    goto('setup');
  };
};
```

- [ ] **Step 9.2: Manual verify**

Run: `npm run dev` → play one full attempt:
- Force a `fail` (show wrong gesture early) → expect attempt-end card with title `❌ Wrong gesture`, completed/time/score correct, both `Try again` and `Finish` visible.
- Click `Try again` → memorize starts over with a new sequence.
- Repeat until 3 attempts. After attempt 3 ends, expect `Try again` hidden; only `Finish`.
- Click `Finish` → final result card with team #, score, and code `GZ-{team}-{score}`. Verify `Play again` returns to setup.

Stop dev server.

- [ ] **Step 9.3: Commit**

```bash
git add ps-offsite-2026/stations/1-gesture-lock.html
git commit -m "feat(gesture-lock): attempt-end and final-result phases"
```

---

## Task 10: Visibility-pause + run full test suite + final verification

**Files:**
- Modify: `ps-offsite-2026/stations/1-gesture-lock.html`

- [ ] **Step 10.1: Add `visibilitychange` pause**

Insert at the end of the module script (just before `goto('setup');`):

```js
// Pause-on-background: stop the recall raf loop while hidden so the timer doesn't
// burn through 45s while the user has the tab buried. Other phases use setTimeout/setInterval
// which keep running; if that becomes an issue, expand here.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    hiddenAt = performance.now();
  } else if (hiddenAt && state.recallStartMs) {
    // Shift recall start forward by the time spent hidden so elapsed math stays honest.
    state.recallStartMs += performance.now() - hiddenAt;
    hiddenAt = 0;
  }
});
```

- [ ] **Step 10.2: Run full test suite**

Run: `npm test`
Expected: all suites pass, including the 4 `gesture-lock` describes (`GESTURE_POOL`, `pickSequenceWithRepeats`, `scoreAttempt`, `finalScore`).

- [ ] **Step 10.3: Run dev server and walk the golden path one final time**

Run: `npm run dev`
Open: `http://localhost:5173/stations/1-gesture-lock.html`
Walk through: Setup → Loading → Intro 1/3 → Memorize → Countdown → Recall → Attempt End → Intro 2/3 → … → Finish → Final result card with valid code.

Also verify:
- Switching tabs during recall does **not** burn the timer (timer pauses).
- Restarting via `Play again` returns to a clean Setup state.
- Browser console has zero errors throughout.

Stop dev server.

- [ ] **Step 10.4: Commit**

```bash
git add ps-offsite-2026/stations/1-gesture-lock.html
git commit -m "feat(gesture-lock): pause recall timer on tab background"
```

---

## Done

When all task checkboxes are ticked and `npm test` is green, the rewrite is complete. The station behaves per the spec; pure logic is covered by Vitest; manual verification confirms the camera/detection flow end-to-end.
