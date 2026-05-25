# Gesture Lock Rewrite — Design

**Date:** 2026-05-25
**File touched:** `ps-offsite-2026/stations/1-gesture-lock.html`
**Approach:** in-place rewrite, single-file station matching existing convention

## Goal

Replace current "show-sequence-while-performing" gesture lock with a memorize-then-recall team game:

1. Random 8-gesture sequence (with repeats) drawn from a pool of 6 gestures
2. Sequence flashes one card at a time, ~0.8s each, then hidden
3. Team performs sequence from memory, taking turns (one player per gesture, by UI prompt only)
4. Wrong gesture or 45s timeout ends the attempt
5. Up to 3 attempts per team; final score = best successful attempt (or best partial if none succeed)

## Constraints / Decisions

| Decision | Value | Source |
|---|---|---|
| Pool size | 6 gestures: Palm, Fist, Thumb Up, Thumb Down, Victory, Point Up | User picked 6 over 4; drop ILoveYou (awkward, low confidence) |
| Sequence length | 8, repeats allowed | BUILD_PLAN |
| Memorize style | Flashcards 0.8s each (6.4s total) | User choice |
| Recall feedback | Progress dots only, no emojis shown post-correct | User choice |
| Failure trigger | Wrong gesture (sustained 500ms, conf>0.7) OR 45s timeout | User choice |
| Recall timer cap | 45s, starts after memorize+countdown ends | User choice |
| Max attempts | 3 | BUILD_PLAN |
| Turn-taking | UI banner only ("Player N"), no identity enforcement | User choice |
| Scoring | Successful attempt always > any partial | Derived; success floor 40, partial cap 35 |

## State machine

```
SETUP → LOADING → ATTEMPT_INTRO → MEMORIZE → COUNTDOWN → RECALL → ATTEMPT_END
                       ↑                                              │
                       └──────── (attempts remain & user continues) ──┘
                                                                       ↓
                                                                  FINAL_RESULT
```

- Single enum `state`, single `goto(phase)` function: hides all phase DOM regions, shows target, runs phase-entry function.
- Each phase that schedules timers/raf calls registers a cleanup via `activeCleanup = fn`; `goto` calls `activeCleanup` first.
- Camera + recognizer initialised lazily on first transition to LOADING; reused across attempts.

## Data shape

```js
const GESTURE_POOL = [
  { id: 'Open_Palm',   emoji: '✋', name: 'Open Palm' },
  { id: 'Closed_Fist', emoji: '✊', name: 'Fist' },
  { id: 'Thumb_Up',    emoji: '👍', name: 'Thumbs Up' },
  { id: 'Thumb_Down',  emoji: '👎', name: 'Thumbs Down' },
  { id: 'Victory',     emoji: '✌️', name: 'Victory' },
  { id: 'Pointing_Up', emoji: '☝️', name: 'Point Up' },
];

const SEQUENCE_LEN = 8;
const MAX_ATTEMPTS = 3;
const MEMORIZE_FLASH_MS = 800;
const COUNTDOWN_MS = 3000;
const HOLD_MS = 400;
const WRONG_CONFIRM_MS = 500;
const POST_MATCH_SETTLE_MS = 600;  // grace window after correct gesture: no detection counts (right or wrong) — lets players swap
const WRONG_CONFIDENCE = 0.7;
const MATCH_CONFIDENCE = 0.6;
const RECALL_CAP_S = 45;

state = {
  teamId, teamSize, recognizer, stream,
  attemptIdx,           // 0..2
  sequence,             // Gesture[8] regenerated each attempt
  stepIdx,              // 0..7 during RECALL
  recallStartMs,
  attempts: [           // one entry per finished attempt
    { result: 'success'|'fail'|'timeout', completed: int, timeSec: float, score: int }
  ],
}
```

## Phases

### SETUP
- Team number select (1..10), team size select (2..8, default 4), Start button.
- On Start → LOADING.

### LOADING
- First attempt only: load MediaPipe Gesture Recognizer + open camera (existing init code reused).
- Show spinner card.
- On both ready → ATTEMPT_INTRO.

### ATTEMPT_INTRO
- Card: `Attempt N of 3 — Memorize the sequence`, single Start button.
- Button → MEMORIZE.

### MEMORIZE
- Generate new sequence: `pickSequenceWithRepeats(POOL, 8)`.
- Render 8 dim slots.
- For each `i` in 0..7: highlight slot `i`, show big emoji centre-stage for `MEMORIZE_FLASH_MS`.
- After last → COUNTDOWN.

### COUNTDOWN
- 3-2-1 overlay, 1s each (total 3s).
- → RECALL.

### RECALL
- DOM: live camera + canvas overlay (existing), 8 progress dots, big "Player N" banner, timer, abort button.
- `Player N = (stepIdx % teamSize) + 1`.
- `recallStartMs = performance.now()`.
- raf detection loop scoped to RECALL only (`activeCleanup` cancels on phase exit).
- raf loop calls `recognizer.recognizeForVideo`; draws landmarks; calls `handleGesture`.
- `handleGesture`:
  - If within `POST_MATCH_SETTLE_MS` of last successful match → ignore all detections (lets players swap without false-fail).
  - If detected gesture matches `sequence[stepIdx].id` and conf > 0.6 and held ≥ `HOLD_MS` → advance step, stamp `lastMatchMs`.
  - If detected gesture differs from target, conf > 0.7, sustained ≥ `WRONG_CONFIRM_MS` → fail attempt.
  - Else → progress bar updates.
- Timer raf: `elapsed > 45s` → timeout attempt.
- `stepIdx === 8` → success attempt.

### ATTEMPT_END
- Compute attempt score (formula below), push to `attempts`.
- Card shows: result label, completed `X/8`, time, attempt score.
- Buttons:
  - If attempts remaining: `Try again` (→ ATTEMPT_INTRO) + `Finish` (→ FINAL_RESULT). `Finish` enabled only if ≥1 success.
  - If last attempt: `Finish` only.

### FINAL_RESULT
- Tear down stream + recognizer (free GPU).
- Compute final score (formula below).
- Card: team, final score, code `GZ-{teamId}-{score}`, Play again button (→ SETUP, reset state).

## Scoring

**Per attempt:**

```js
function scoreAttempt({ result, completed, timeSec }) {
  if (result === 'success') {
    const raw = 100 - Math.max(0, timeSec - 10) * 2;
    return Math.max(40, Math.min(100, Math.round(raw)));
  }
  // fail or timeout — partial credit
  return Math.floor((completed / 8) * 35);
}
```

- Success curve: 10s grace, then -2/sec. 10s→100, 20s→80, 30s→60, 45s→30→clamped 40.
- Partial cap 35 < success floor 40 → success always beats partial.

**Final:**

```js
function finalScore(attempts) {
  const successes = attempts.filter(a => a.result === 'success');
  if (successes.length) return Math.max(...successes.map(a => a.score));
  return Math.max(0, ...attempts.map(a => a.score));
}
```

## Error handling

| Failure | Behaviour |
|---|---|
| MediaPipe load error | `alert()` with retry hint, → SETUP |
| Camera permission denied | `alert()` with hint, → SETUP |
| Tab backgrounded mid-MEMORIZE/COUNTDOWN | Pause via `visibilitychange`; resume from current flash/count when visible again |
| Tab backgrounded mid-RECALL | Pause timer; resume on visibility (no penalty for backgrounding) |
| Restart button (any phase) | Stop stream, drop recognizer, → SETUP |

## Testing

Mirror existing `tests/` Vitest layout. New file `tests/gesture-lock.test.js`:

- `pickSequenceWithRepeats(pool, len)`
  - returns length `len`
  - every element drawn from `pool`
  - permits repeats (statistically: across many runs, at least one repeat occurs for `len > pool.length / 2`)
- `scoreAttempt(...)` table-driven:
  - success at 10s → 100; success at 30s → 60; success at 45s → 40
  - fail at 4 completed → 17; fail at 0 → 0; timeout at 7 → 30
- `finalScore([...])`:
  - 1 success (60) + 2 fails → 60
  - 2 successes (50, 80) + 1 fail → 80
  - 3 fails (10, 20, 5) → 20
  - 0 attempts → 0

No headless e2e — gesture detection needs real camera.

## Out of scope

- Identity verification per turn (BUILD_PLAN explicitly defers this to honor system).
- Sound cues (current games are silent; keep parity).
- Pre-fetched fixed sequences (random each attempt is the spec).
- Backup "dance freeze" game (separate BUILD_PLAN item).
