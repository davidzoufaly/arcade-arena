# Pub Quiz — Design

**Date:** 2026-05-31
**Status:** Approved (design), pending implementation plan

## Summary

Add Pub Quiz as a third game kind alongside the existing `play` (submit
answers + score) and `manual` (submit score only) kinds. Pub Quiz is
**host-read**: an announcer reads questions aloud; teams type answers into
numbered blank inputs grouped by category, submit one category at a time, and
finally self-report a score (manual-style). A new admin-only **Quiz Admin** tab
(next to Scoreboard) manages the category/question structure and shows all team
submissions.

## Decisions (locked)

- **Question content:** Host reads aloud. Admin defines only category names and
  per-category question counts. Teams see numbered blank answer inputs
  (`Question 1..N`). No stored question text or correct answers.
- **Scoring:** Self-report, manual-style. After the last category, the team
  types its own score into the same input non-playable games use. Submitted
  answers are collected only for the admin's review.
- **Defaults:** Lobby is pre-seeded with 4 categories ("Category 1".."Category 4"),
  each with `questionCount` 8.
- **Question count:** Editable per category (independent N each).
- **Submit behaviour:** Submitting a category locks its answers (frozen, no
  edit) and reveals the next category. Sequential, one at a time.

## Architecture (Approach A)

Vanilla JS + Firebase Realtime Database, no framework (matches existing repo).
New `quiz` kind, a dedicated play page, and a dedicated admin page. Reuses the
existing rules renderer, game-lock gate, and `submitScore` plumbing.

### 1. Catalog — `shared/games-catalog.js`

```js
PQ: { name: 'Pub Quiz', emoji: '🎤', kind: 'quiz', rules: '<rules text>' },
```

- Introduce kind `'quiz'`. Remove `'soon'` (no remaining `soon` games).
- `allEnteredKeys()` returns keys where `kind !== 'soon'` → now includes PQ, so
  ranking and the scoreboard lock grid pick it up automatically.
- Add a `quizKeys()` accessor mirroring `playableKeys()` / `manualKeys()`.

### 2. Firebase data model

```
lobbies/{id}/quiz/categories/{catId}/
    order:         int      // stable sort order
    name:          string
    questionCount: int      // default 8

lobbies/{id}/quiz/submissions/{teamId}/{catId}/
    submittedAt:   ts
    answers:       { 0: str, 1: str, ... }   // question index -> answer text
```

- `catId` = Firebase push id; categories ordered by `order`.
- Pre-seed on lobby creation: 4 categories, `questionCount` 8 each.
- Presence of a `submissions/{teamId}/{catId}` node = that category is locked
  for that team.
- Final score is written to the existing `scores/{teamId}/PQ` node via
  `submitScore()` — no new score storage.

### 3. Play view — `games/quiz.html`

Routed to by the `quiz` kind (same pattern as `manual.html`).

- **Lock gate:** game-level lock via `game-gate.js`, default locked — identical
  to manual games. Locked → full-page 🔒 modal.
- **Rules:** render the resolved rules (admin override via `quiz/.. rules` node,
  falling back to `GAMES.PQ.rules`) at top using the shared `renderRules`
  helper; live re-render on rules change (same as `manual.html`).
- **Countdown:** if a timer is set for PQ (`resolveTimer`), show the countdown
  exactly like manual games. On expiry, auto-submit score 0 for PQ (manual
  parity).
- **Current category:** the first category (by `order`) without a submission
  for this team. Show its name + N answer inputs labelled `Question 1..N` + a
  **Submit Category** button.
- **Submit:** write `submissions/{teamId}/{catId}` (answers + `submittedAt`),
  then the next unsubmitted category appears. Submitted categories are frozen.
- **Completion:** when no unsubmitted category remains, show the self-report
  score input (same UI as `manual.html`) → `submitScore({ gameKey: 'PQ', ... })`.
- **Tile routing:** `games.html` `tileHref()` gains a `quiz` branch →
  `games/quiz.html?lobby=...&team=...`; add CSS class `.tile.quiz`.

### 4. Admin tab — `quiz-admin.html`

- **Nav:** admin topbar becomes `Scoreboard | Quiz Admin`; new
  `activePage: 'quiz-admin'`. Admin-gated via `admin-gate.js`.
- **A) Categories editor:**
  - List categories ordered by `order`.
  - Rename inline.
  - Per-category `+/-` to change `questionCount` (default 8, independent N).
  - **Add category:** append with `order = max+1`, `questionCount` 8.
  - **Remove category:** delete the node.
- **B) Submissions view:** category → question index → per-team answers, read
  live from `quiz/submissions`.

### 5. Scoreboard — `scoreboard.html`

- PQ auto-appears in the lock grid (now an entered kind).
- Full manual parity for PQ: lock/unlock **+** countdown timer **+** rules
  override edit buttons — same actions as non-playable games, for consistency.
  All other games unchanged.

### 6. Tests — `tests/games-catalog.test.js`

- Update allowed kinds to `['play', 'manual', 'quiz']`.
- Assert PQ has kind `quiz` and is present in `allEnteredKeys()`.

## Out of scope (YAGNI)

- No live reconciliation if the admin edits categories mid-play — assume the
  admin configures structure before unlocking the game (best-effort otherwise).
- No admin grading — scoring is self-report only.
