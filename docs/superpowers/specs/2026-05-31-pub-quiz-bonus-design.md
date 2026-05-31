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
  - **Input contract:** accepts any object carrying `{ questionCount, bonus }` —
    both an `orderedCategories` item (play page passes `cat`) and a raw Firebase
    category node satisfy this; tests pass a literal `{ questionCount, bonus }`.
  - **Firebase string keys:** `bonus` keys arrive as strings (`"3"`). Coerce with
    `Number(k)` before the `< questionCount` comparison and before the numeric
    sort. Filter on truthiness (Firebase only stores `true`; a cleared flag is
    deleted via `set(...,null)`, i.e. absent, never `false`).

### 3. Team play page — `games/quiz.html`

- In `renderCategory`, for each question `i` in `0..questionCount-1`:
  - Always render the main input `#q${i}`, labelled `Question i+1`.
  - If `cat.bonus?.[i]` is truthy, render a second input `#qb${i}` directly under
    it, labelled `Question i+1 — Bonus`, visually distinct (a `.bonus` class —
    accent-2 / magenta tint). `#qb${i}` does not collide with existing IDs
    (`q{i}`, `submitCat`, `banner`, `countdown`, `score`, `submitScore`).
  - The `i < questionCount` loop bound means stale bonus flags (`idx >= count`)
    are never read on the play page — no extra filtering needed here.
  - This relies on the §2 change: `cat` is an `orderedCategories` item (from
    `ordered.find(...)`), so it carries `bonus` only after that lands.
- On `submitCategory`, collect as today into `answers:{i:str}`, and additionally
  build `bonusAnswers:{i:str}` for flagged indices only (trimmed). Write the
  submission node as `{ submittedAt, answers, bonusAnswers }`. Omit
  `bonusAnswers` entirely when the category has no bonus questions (keep the
  node clean).
- Lock gate, countdown/auto-0, completion/score flow unchanged.

### 4. Admin page — `quiz-admin.html`

- **Categories editor:** below each category row, add a chip row of buttons
  `Q1 … QN` iterated over `0..questionCount-1` (count-driven, NOT
  `Object.keys(bonus)`, so stale flags above the count get no chip). A chip is
  highlighted when that index is bonus. Clicking a chip toggles it:
  `set(quiz/categories/{id}/bonus/{idx}, true)` to flag, `set(..., null)` to
  clear. The toggle fires a categories `onValue` echo → `renderCatEditor`
  rebuild, same as the existing `qplus`/`qminus` buttons; chips are buttons (not
  text inputs) so the `.cat-name` focus-guard does not block them and rebuild
  only costs a transient `:focus` ring (cosmetic, acceptable).
- **`changeCount` decrease:** after writing the new count, prune any bonus flags
  with `idx >= newCount` (so shrinking a category drops orphaned flags).
- **Submissions view:** for a bonus question index, render the team's main
  answer and, on a second line, the labelled `Bonus:` answer read via
  `sub?.bonusAnswers?.[i]` (optional chaining — handles the omitted-node case,
  yielding the same `—` / `(blank)` treatment as `answers`). The index is bonus
  iff `c.bonus?.[i]` is truthy. Non-bonus questions render exactly as before.

### 5. Rules text (minor)

- Append one line to `GAMES.PQ.rules` noting that some questions have a bonus
  field worth extra points. Keeps teams oriented. Single-line addition to the
  catalog entry.

## Tests

`tests/quiz.test.js`:
- **Update the existing exact-match assertion** (`orderedCategories(cats)[0]`
  `toEqual({id,order,name,questionCount})`): it now must include `bonus: {}`,
  else `toEqual` deep-equality fails. (The `seedCategories` assertions are
  unaffected — seed emits no `bonus` key.)
- `orderedCategories`: add an assertion that a category WITH a `bonus` map
  carries it through unchanged, and one without gets `bonus: {}`.
- `bonusIndices`: returns flagged indices as numbers, sorted ascending; filters
  out indices `>= questionCount`; coerces string keys (`{"3": true}` → `3`);
  `[]` when no `bonus` map; `[]` for empty category.

No new tests for the HTML pages (consistent with the repo — pages are untested).

## Out of scope (YAGNI)

- No app-side bonus point values or structured scoring (self-report only).
- No per-bonus weighting / multiple bonus fields per question (exactly one bonus
  input per flagged question).
- No migration of existing submissions (additive; old submissions simply have no
  `bonusAnswers`).
