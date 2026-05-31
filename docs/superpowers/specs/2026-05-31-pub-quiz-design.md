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
game-config (timer/rules) resolvers, game-lock gate, and `submitScore` plumbing.

**Path note:** all app code lives under `ps-offsite-2026/`. Paths below are
relative to that dir (e.g. `shared/games-catalog.js` = `ps-offsite-2026/shared/games-catalog.js`).
Tests live at repo-root `tests/` and import via `../ps-offsite-2026/shared/...`.

### 1. Catalog — `shared/games-catalog.js`

PQ currently exists as `kind:'soon'` (line 13) with no `rules` field. Change to:

```js
PQ: { name: 'Pub Quiz', emoji: '🎤', kind: 'quiz', rules: '<rules text>' },
```

- Introduce kind `'quiz'`. Add a `rules` field (required so the rules fallback
  works — see §3).
- `allEnteredKeys()` already filters `kind !== 'soon'`, so retagging PQ to
  `quiz` includes it automatically — **no change to `allEnteredKeys()` needed**.
  Ranking, topbar points, and the scoreboard grid then pick PQ up free.
- Add a `quizKeys()` accessor mirroring `playableKeys()` / `manualKeys()`.
- `'soon'` is now unused by any catalog entry. Removing the kind value entirely
  also requires purging its references in `games.html` (see §3 tile routing) —
  decide in the plan whether to remove `'soon'` or just leave it unused.

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

- `catId` keys: seeded categories use deterministic keys (`c1`..`c4`) so they
  can be created inside `createLobby()` (which is Firebase-free — see §7).
  Runtime-added categories (admin tab, has Firebase access) use `push()` ids.
  Both are just string keys in the same map; `order` drives sort, not the key.
- Pre-seed on lobby creation: 4 categories (`order` 0..3, names
  "Category 1".."Category 4"), `questionCount` 8 each.
- Presence of a `submissions/{teamId}/{catId}` node = that category is locked
  for that team.
- **Frozen render uses the submitted answer count**, not the live
  `questionCount` — if the admin changes `questionCount` after a team submitted,
  the frozen category still shows exactly the answers that were submitted.
- Final score is written to the existing `scores/{teamId}/PQ` node via
  `submitScore()` — no new score storage.

### 3. Play view — `games/quiz.html`

Routed to by the `quiz` kind (same pattern as `manual.html`).

Reuse helpers from manual.html's imports: `isGameLockedFor` / `renderLockedScreen`
from `../shared/game-gate.js`; `resolveTimer` / `resolveRule` / `deadlineFor` /
`isExpired` / `formatMMSS` from `../shared/game-config.js`; `submitScore` /
`firebaseWriter` from `../shared/score-submit.js`.

- **Lock gate:** game-level lock via `game-gate.js` (`isGameLockedFor`), default
  locked — identical to manual games. Locked → full-page 🔒 modal.
- **Rules:** resolve via `resolveRule(rules, 'PQ', teamId, GAMES.PQ.rules)`
  against the **global `lobbies/{id}/rules` node** (same node + helper manual
  games use — there is no separate `quiz/rules` node); live re-render on rules
  change. `renderRules` is a local function in `manual.html`, **not** a shared
  export — quiz.html copies it (or the plan extracts it to a shared module).
- **Countdown:** if a timer is set for PQ (`resolveTimer`), show the countdown
  exactly like manual games. On expiry, auto-submit score 0 for PQ. **Copy
  manual.html's one-shot `settle()` latch / race handling**, not just the
  visible countdown.
- **Current category:** the first category (by `order`) without a submission
  for this team. Show its name + N answer inputs labelled `Question 1..N` + a
  **Submit Category** button.
- **Submit:** write `submissions/{teamId}/{catId}` (answers + `submittedAt`),
  then the next unsubmitted category appears. Submitted categories are frozen.
- **Completion:** when no unsubmitted category remains, show the self-report
  score input (same UI as `manual.html`) → `submitScore({ gameKey: 'PQ', ... })`
  called exactly once.
- **Tile routing (`games.html`) — more than one edit:** add a `quiz` branch in
  `tileHref()`; add `.tile.quiz` CSS; the timer-line on the tile is gated
  `kind === 'manual'` (so a PQ timer won't show) — widen it; the `baseTag` /
  `isDiv` / "Coming soon" logic references `'soon'` — update so `quiz` renders
  as a live, clickable tile.

### 4. Admin tab — `quiz-admin.html`

- **Nav:** admin topbar becomes `Scoreboard | Quiz Admin`. In `topbar.js`
  `buildHeader`, build a `quizAdminHref` and append a second
  `<a data-nav="quiz-admin">` to the admin nav branch (~3-line change; the
  `activePage` → `aria-current` lookup is already generic). New page uses
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

- PQ auto-appears in the lock grid (now an entered kind). Lock buttons are
  unconditional, so lock/unlock works with no change.
- **Not zero-change:** the timer + rules edit buttons are gated
  `GAMES[g].kind === 'manual'`. For full manual parity, widen that condition to
  also match `'quiz'` (e.g. `=== 'manual' || === 'quiz'`, or a helper). Without
  this, PQ would show lock buttons but no timer/rules buttons.
- All other games unchanged.

### 6. Tests

`tests/games-catalog.test.js`:
- Update allowed kinds to `['play', 'manual', 'quiz']`.
- Total-games count assertion stays 11 (PQ retagged, not added).
- Rewrite the "marks Pub Quiz as soon" test → asserts PQ kind `quiz`.
- `allEnteredKeys()` length assertion 10 → 11; PQ now present.
- Add a `quizKeys()` assertion (returns `['PQ']`).

`tests/lobby.test.js`:
- The created-lobby shape assertion must include the seeded `quiz.categories`
  (4 categories, `c1`..`c4`, `questionCount` 8).

### 7. Lobby pre-seed — `shared/lobby.js`

- Seed in `createLobby()` (the `set('lobbies/{id}', {...})` payload). This
  module is **Firebase-free** — it only uses injected `get`/`set`, so it cannot
  mint `push()` ids. Hence seeded categories use deterministic keys `c1`..`c4`
  (§2). Add a `quiz: { categories: { c1:{order:0,name:'Category 1',questionCount:8}, ... } }`
  block to the created payload.

## Preconditions

- Admin sets the category/question structure **before unlocking** PQ. Mid-play
  structure edits are best-effort: frozen submitted categories render against
  their submitted answer count (§2), and the admin Submissions view (§4B)
  iterates current categories — submissions under a removed category are not
  shown.

## Out of scope (YAGNI)

- No live reconciliation if the admin edits categories mid-play (see
  Preconditions).
- No admin grading — scoring is self-report only.
