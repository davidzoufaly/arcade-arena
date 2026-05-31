# Pub Quiz — Bonus Questions — Design

**Date:** 2026-05-31
**Status:** Approved (design), pending implementation plan
**Builds on:** [2026-05-31-pub-quiz-design.md](2026-05-31-pub-quiz-design.md) (Pub Quiz feature, already merged to main)

## Summary

Any question in a Pub Quiz category can be flagged as a **bonus** question. A
bonus question shows the team a second input field (a "bonus answer") in
addition to the main one, signalling there are extra points to earn. Scoring
stays self-report — the bonus answer is collected and shown to the admin; the
team still enters one final raw score that accounts for any bonus points. The
admin flags bonus questions per-index in the Quiz Admin category editor.

## Decisions (locked)

- **Toggle:** Admin marks individual question indices as bonus (per-question, not
  per-category) in the Quiz Admin categories editor.
- **Scoring:** Unchanged. Final score is one self-reported number. Bonus adds a
  collected answer field only — no app-side bonus point tracking, no
  ranking/scoring code change.
- **Approach A (additive):** keep `questionCount` int; add a `bonus` flag map on
  the category. No restructure of the question-count model.

## Architecture (Approach A)

All paths relative to `ps-offsite-2026/`. Additive to the existing Pub Quiz
feature — no breaking changes to the count model, lobby seed, lock/timer/rules,
or frozen-render behavior.

### 1. Data model (additive)

```
quiz/categories/{catId}/bonus/{idx}: true
    // only flagged indices present; absent = normal question

quiz/submissions/{teamId}/{catId}/bonusAnswers/{idx}: string
    // stored beside the existing answers/{idx}; only for flagged indices
```

- A bonus flag with `idx >= questionCount` is stale (count shrank after
  flagging). It is ignored at render time everywhere, and pruned proactively by
  the admin `changeCount` path when the count decreases.
- Seed (`lobby.js`) is unchanged — fresh categories have no bonus flags.

### 2. Pure helpers — `shared/quiz.js`

- `orderedCategories` output gains `bonus: c?.bonus ?? {}` so consumers get the
  flag map alongside `{id, order, name, questionCount}`.
- New `bonusIndices(category)` → sorted array of integer indices that are
  flagged AND `< questionCount` (filters stale flags). Pure, unit-tested.
  Signature: `bonusIndices({ questionCount, bonus })`.

### 3. Team play page — `games/quiz.html`

- In `renderCategory`, for each question `i` in `0..questionCount-1`:
  - Always render the main input, labelled `Question i+1`.
  - If `cat.bonus?.[i]` is truthy, render a second input directly under it,
    labelled `Question i+1 — Bonus`, visually distinct (a `.bonus` class —
    accent-2 / magenta tint).
- On `submitCategory`, collect as today into `answers:{i:str}`, and additionally
  build `bonusAnswers:{i:str}` for flagged indices only (trimmed). Write the
  submission node as `{ submittedAt, answers, bonusAnswers }`. Omit
  `bonusAnswers` entirely when the category has no bonus questions (keep the
  node clean).
- Lock gate, countdown/auto-0, completion/score flow unchanged.

### 4. Admin page — `quiz-admin.html`

- **Categories editor:** below each category row, add a chip row of buttons
  `Q1 … QN` (N = questionCount). A chip is highlighted when that index is bonus.
  Clicking a chip toggles it: `set(quiz/categories/{id}/bonus/{idx}, true)` to
  flag, `set(..., null)` to clear. The chip row re-renders with the count.
- **`changeCount` decrease:** after writing the new count, prune any bonus flags
  with `idx >= newCount` (so shrinking a category drops orphaned flags).
- **Submissions view:** for a bonus question index, render the team's main
  answer and, on a second line, the labelled `Bonus:` answer (same
  not-submitted `—` / submitted-blank `(blank)` treatment). Non-bonus questions
  render exactly as before.

### 5. Rules text (minor)

- Append one line to `GAMES.PQ.rules` noting that some questions have a bonus
  field worth extra points. Keeps teams oriented. Single-line addition to the
  catalog entry.

## Tests

`tests/quiz.test.js`:
- `bonusIndices`: returns flagged indices sorted; filters out indices
  `>= questionCount`; `[]` when no `bonus` map; `[]` for empty.
- `orderedCategories`: carries the `bonus` map through (default `{}` when
  absent).

No new tests for the HTML pages (consistent with the repo — pages are untested).

## Out of scope (YAGNI)

- No app-side bonus point values or structured scoring (self-report only).
- No per-bonus weighting / multiple bonus fields per question (exactly one bonus
  input per flagged question).
- No migration of existing submissions (additive; old submissions simply have no
  `bonusAnswers`).
