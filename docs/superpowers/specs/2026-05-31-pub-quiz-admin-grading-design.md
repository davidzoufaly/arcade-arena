# Pub Quiz — Admin Grading Design

**Date:** 2026-05-31
**Status:** Approved (pending spec review)

## Goal

Move Pub Quiz scoring from players to admins. Today each team self-reports a
raw score on the play page after submitting all categories. Instead, the host
grades each submitted answer correct/incorrect in the admin view, scores
**+1 per correct answer** (bonus answers worth **+1 extra**), and submits
**per category** to publish each team's Pub Quiz total. Players stop scoring —
after submitting their last category they simply wait for the host.

## Decisions (locked)

- **Player UX:** Remove the self-report score input. After all categories are
  submitted the player sees "awaiting host scoring."
- **Default mark:** Every question starts **incorrect** (unmarked). Admin
  clicks to mark a question correct.
- **Bonus value:** A correct bonus question = base 1 pt + bonus 1 pt = **2 pts**.
  Base and bonus are toggled separately.
- **Score model:** Store marks per team/category/question in Firebase. The PQ
  total is the **sum of correct marks across all graded categories** — submit
  recomputes the full total and writes it (idempotent, re-gradeable).
- **Grader layout:** Category-centric. Keep the existing category → question →
  per-team-row structure; add toggles to each row. One "Submit category" button
  per category block.
- **Toggle writes:** Local until submit. Toggling changes local UI state only;
  "Submit category" persists marks **and** publishes scores. On page load the
  grader hydrates toggles from previously-saved marks.
- **Timer:** Drop the Pub Quiz play-page timer/countdown/auto-zero logic
  entirely. The host paces verbally. Admin is the sole writer of `scores/PQ`.

## Data Model

New node, written only by the admin grader on submit:

```
lobbies/{id}/quiz/grades/{teamId}/{catId} = { [idx]: { q: true, b?: true } }
```

- `q: true` → base question `idx` correct (+1).
- `b: true` → bonus for question `idx` correct (+1 extra). Only present for
  questions flagged bonus on the category.
- Absent index / absent key = 0 points. Following the existing bonus-map
  convention, only `true` values are stored; clearing a mark deletes the key
  (never writes `false`). A category submitted with all-wrong answers writes
  `null` (clears that team/category grade node).

Score stays at `lobbies/{id}/scores/{teamId}/PQ`, written via the existing
`submitScore` path (which also pushes a `history` entry). No schema change to
scores.

## Pure Helper (shared/quiz.js)

Add a unit-testable helper:

```
teamQuizScore(grades, categories) -> integer
```

- `grades` = one team's grade map `{ [catId]: { [idx]: { q, b } } }`.
- `categories` = the lobby category map (for bounds + bonus flags).
- For each category present in both `grades` and `categories`, for each index
  `0..questionCount-1`: add 1 if `q` truthy; add 1 more if the index is flagged
  bonus on the category **and** `b` truthy.
- Marks outside `questionCount`, marks for categories no longer present, and
  `b` on non-bonus indices are ignored (defensive — stale grades never inflate).

This is the single source of truth for the PQ total; the grader calls it after
writing the just-submitted category's marks.

## Admin Grader (quiz-admin.html)

Evolve the existing `renderSubmissions` into a grader. New live listener on
`lobbies/{id}/quiz/grades`.

Per category block:

- For each question `i`, for each team **that submitted this category**: show
  the answer (as today) plus a correct/incorrect toggle button on the row. If
  `i` is a bonus question, also show the team's bonus answer row with its own
  separate toggle.
- Teams that did not submit the category render "—" with no toggle (cannot be
  graded; contributes 0).
- One **Submit category** button per block plus a status line (e.g.
  "Graded · N teams" or "Not yet graded").

Local state: a `pending` marks object keyed `[teamId][catId][idx] = { q, b }`,
seeded from saved `grades` on load. Toggling flips the local value and the
button's CSS class without a destructive full re-render. Live echoes of
`submissions`/`grades` must not clobber in-progress local edits (mirror the
existing `cat-name` focus guard pattern — re-render reflects `pending`).

On **Submit category** for category `c`:

1. For every team with answers in `c`, write
   `quiz/grades/{teamId}/{c.id}` = that team's pending marks for `c`
   (only `true` values; write `null` if none).
2. For each affected team, recompute the full PQ total with
   `teamQuizScore(updatedGrades, categories)` — using the freshly written `c`
   plus existing saved grades for other categories.
3. Write the total via `submitScore({ writer, lobbyId, teamId, gameKey: 'PQ',
   score: total })`. Reuse `firebaseWriter`.
4. Update the block status banner ("Category graded — N teams updated").

The category editor (names, question counts, bonus toggles, add/remove) is
unchanged.

## Player Page (games/quiz.html)

Remove everything related to self-report scoring and the timer:

- Remove the score input, `onSubmitScore`, `currentScore`, `renderScore`'s
  input/button.
- Remove all timer state and functions: `minutes`, `startTs`, `timerId`,
  `settled`, `timeUp`, `settle`, `autoZero`, `renderTimeUp`, `rearmCountdown`,
  `paintCountdown`, `startCountdown`, the `countdown` element, and the
  `timerStarts`/`timers` reads.
- Remove now-unused imports: `submitScore`, `firebaseWriter`, `resolveTimer`,
  `deadlineFor`, `isExpired`, `formatMMSS` and the `scorePath`/`startPath`
  constants.

Keep: the category answer flow, per-category submit, and the `isGameLockedFor`
lock gate. When all categories are submitted, the "all submitted" view shows:
"All N categories submitted — awaiting host scoring." with the back link, no
input.

## Rules Copy (shared/games-catalog.js)

Update the `PQ.rules` string: drop the "enter your raw score" line; state the
host grades answers after each category and bonus questions are worth extra.

## Testing

- Unit tests for `teamQuizScore` in `tests/quiz.test.js`: empty grades → 0;
  base-only correct; bonus adds extra only when the index is flagged bonus;
  out-of-range and stale-category marks ignored; multi-category sum.
- Run: `npm test` (vitest). These are the only automated tests; the pages are
  vanilla HTML modules verified manually against Firebase.

## Out of Scope

- No change to scoreboard aggregation (it already reads `scores/{team}/PQ`).
- No change to category editing, bonus flagging, or the lock/gate system.
- No per-question point weighting beyond base 1 / bonus +1.
