# Pub Quiz Bonus Questions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the admin flag any question in a Pub Quiz category as a "bonus" question, which shows the team a second answer field; both answers are stored and shown to the admin. Scoring stays self-report.

**Architecture:** Additive to the merged Pub Quiz feature. Add a `bonus` flag map on each category (`quiz/categories/{catId}/bonus/{idx}: true`) and a `bonusAnswers` map on submissions. A new pure `bonusIndices` helper in `shared/quiz.js`; the play page renders the extra input; the admin page toggles flags + shows bonus answers. No scoring/ranking change.

**Tech Stack:** Vanilla JS (ES modules), Firebase Realtime DB, Vite, Vitest. No framework. App code under `ps-offsite-2026/`; tests at repo-root `tests/`.

**Spec:** docs/superpowers/specs/2026-05-31-pub-quiz-bonus-design.md

---

## File Structure

- Modify: `ps-offsite-2026/shared/quiz.js` — `orderedCategories` carries `bonus`; new `bonusIndices`.
- Modify: `tests/quiz.test.js` — fix the breaking exact-match test; cover `bonus` carry + `bonusIndices`.
- Modify: `ps-offsite-2026/shared/games-catalog.js` — append a bonus line to `PQ.rules`.
- Modify: `ps-offsite-2026/games/quiz.html` — render bonus input + collect `bonusAnswers` + CSS.
- Modify: `ps-offsite-2026/quiz-admin.html` — bonus chip toggles + prune on count decrease + bonus answers in submissions + CSS.

Data model (additive):
```
quiz/categories/{catId}/bonus/{idx}: true                  // flagged indices only
quiz/submissions/{teamId}/{catId}/bonusAnswers/{idx}: str  // beside answers, flagged only
```

---

## Task 1: quiz.js — `bonus` map + `bonusIndices` helper

**Files:**
- Modify: `ps-offsite-2026/shared/quiz.js`
- Test: `tests/quiz.test.js`

- [ ] **Step 1: Update tests (TDD)**

In `tests/quiz.test.js`, change the import line:
```js
import {
  seedCategories, orderedCategories, currentCategoryId,
  allCategoriesSubmitted, nextOrder,
  DEFAULT_CATEGORY_COUNT, DEFAULT_QUESTION_COUNT,
} from '../ps-offsite-2026/shared/quiz.js';
```
to:
```js
import {
  seedCategories, orderedCategories, currentCategoryId,
  allCategoriesSubmitted, nextOrder, bonusIndices,
  DEFAULT_CATEGORY_COUNT, DEFAULT_QUESTION_COUNT,
} from '../ps-offsite-2026/shared/quiz.js';
```

In the `describe('orderedCategories', ...)` block, the existing exact-match assertion:
```js
    expect(orderedCategories(cats)[0]).toEqual({ id: 'a', order: 0, name: 'A', questionCount: 2 });
```
must become (now carries `bonus`):
```js
    expect(orderedCategories(cats)[0]).toEqual({ id: 'a', order: 0, name: 'A', questionCount: 2, bonus: {} });
```

Add a new test inside that same `describe('orderedCategories', ...)` block, after the `'returns [] for null/empty'` test:
```js
  it('carries the bonus map (default {} when absent)', () => {
    const cats = {
      a: { order: 0, name: 'A', questionCount: 3, bonus: { 1: true } },
      b: { order: 1, name: 'B', questionCount: 2 },
    };
    const out = orderedCategories(cats);
    expect(out[0].bonus).toEqual({ 1: true });
    expect(out[1].bonus).toEqual({});
  });
```

Add a brand-new describe block at the end of the file (before the final closing if any — just append it as a top-level `describe`):
```js
describe('bonusIndices', () => {
  it('returns flagged indices as sorted numbers', () => {
    expect(bonusIndices({ questionCount: 5, bonus: { 3: true, 1: true } })).toEqual([1, 3]);
  });
  it('coerces string keys (Firebase) to numbers', () => {
    expect(bonusIndices({ questionCount: 5, bonus: { '2': true } })).toEqual([2]);
  });
  it('filters out indices >= questionCount (stale flags)', () => {
    expect(bonusIndices({ questionCount: 3, bonus: { 1: true, 4: true } })).toEqual([1]);
  });
  it('returns [] when no bonus map', () => {
    expect(bonusIndices({ questionCount: 4 })).toEqual([]);
  });
  it('returns [] for empty/undefined category', () => {
    expect(bonusIndices({})).toEqual([]);
    expect(bonusIndices()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run, confirm FAIL**

Run: `cd /Users/davidzoufaly/code/ps-offsite && npx vitest run tests/quiz.test.js`
Expected: FAIL — `bonusIndices` not exported; the updated `toEqual` fails until `orderedCategories` carries `bonus`.

- [ ] **Step 3: Implement in `ps-offsite-2026/shared/quiz.js`**

In `orderedCategories`, change the mapped object to include `bonus`:
```js
export function orderedCategories(categories) {
  return Object.entries(categories || {})
    .map(([id, c]) => ({
      id,
      order: c?.order ?? 0,
      name: c?.name ?? '',
      questionCount: c?.questionCount ?? 0,
      bonus: c?.bonus ?? {},
    }))
    .sort((a, b) => a.order - b.order);
}
```

Add the new helper at the end of the file:
```js
// Sorted integer indices flagged as bonus AND within the question count.
// Firebase stores bonus keys as strings and only the value `true`; a cleared
// flag is deleted (absent), never false. Accepts any object with
// { questionCount, bonus } — an orderedCategories item or a raw category node.
export function bonusIndices({ questionCount = 0, bonus } = {}) {
  return Object.keys(bonus || {})
    .filter(k => bonus[k])
    .map(Number)
    .filter(i => Number.isInteger(i) && i >= 0 && i < questionCount)
    .sort((a, b) => a - b);
}
```

Also update the header comment's category-map line (line 6) to document the new field:
```js
//   { [catId]: { order:int, name:string, questionCount:int, bonus?:{ [idx]: true } } }
```

- [ ] **Step 4: Run, confirm PASS**

Run: `cd /Users/davidzoufaly/code/ps-offsite && npx vitest run tests/quiz.test.js`
Expected: PASS (all prior tests + the new ones).

- [ ] **Step 5: Commit**

```bash
cd /Users/davidzoufaly/code/ps-offsite
git add ps-offsite-2026/shared/quiz.js tests/quiz.test.js
git commit -m "feat(quiz): bonus flag map on categories + bonusIndices helper

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Catalog — mention bonus in PQ rules

**Files:**
- Modify: `ps-offsite-2026/shared/games-catalog.js`

- [ ] **Step 1: Append a bonus line to PQ.rules**

The current PQ entry (line 13) is:
```js
  PQ: { name: 'Pub Quiz',        emoji: '🎤', kind: 'quiz', rules: 'The host reads each question aloud. Type your team\'s answer for every question in the current category, then submit to lock it in and reveal the next category.\n\n- One category at a time — once you submit, those answers can\'t be changed.\n- After the last category, enter your raw score (number of correct answers), same as the other manual games.' },
```
Replace it with (one extra `\n- ...` list item appended to the rules string):
```js
  PQ: { name: 'Pub Quiz',        emoji: '🎤', kind: 'quiz', rules: 'The host reads each question aloud. Type your team\'s answer for every question in the current category, then submit to lock it in and reveal the next category.\n\n- One category at a time — once you submit, those answers can\'t be changed.\n- After the last category, enter your raw score (number of correct answers), same as the other manual games.\n- Some questions are bonus questions — they show a second answer field worth extra points.' },
```

- [ ] **Step 2: Verify no test regression**

Run: `cd /Users/davidzoufaly/code/ps-offsite && npx vitest run`
Expected: PASS — `GAMES.PQ.rules` is still a non-empty string; catalog tests unaffected.

- [ ] **Step 3: Commit**

```bash
cd /Users/davidzoufaly/code/ps-offsite
git add ps-offsite-2026/shared/games-catalog.js
git commit -m "feat(quiz): note bonus questions in Pub Quiz rules

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Play page — bonus input + bonusAnswers

**Files:**
- Modify: `ps-offsite-2026/games/quiz.html`

- [ ] **Step 1: Add bonus CSS**

In the `<style>` block, immediately after the existing rule:
```css
  .q input[type=text] {
    background: var(--bg-2); color: var(--text);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
    padding: 12px 14px; font-size: 17px; font-family: inherit; width: 100%;
  }
```
add:
```css
  .q.bonus label { color: var(--accent-2); }
  .q.bonus input[type=text] { border-color: rgba(255,0,170,0.45); }
```

- [ ] **Step 2: Render the bonus input in `renderCategory`**

Replace the question-building loop:
```js
  for (let i = 0; i < n; i++) {
    qs += `<div class="q"><label for="q${i}">Question ${i + 1}</label><input id="q${i}" type="text" autocomplete="off" /></div>`;
  }
```
with:
```js
  for (let i = 0; i < n; i++) {
    qs += `<div class="q"><label for="q${i}">Question ${i + 1}</label><input id="q${i}" type="text" autocomplete="off" /></div>`;
    if (cat.bonus?.[i]) {
      qs += `<div class="q bonus"><label for="qb${i}">Question ${i + 1} — Bonus</label><input id="qb${i}" type="text" autocomplete="off" /></div>`;
    }
  }
```
(`cat` is an `orderedCategories` item, so it carries `bonus` after Task 1.)

- [ ] **Step 3: Collect + write bonusAnswers in `submitCategory`**

Replace the answer-collection + write portion:
```js
  const n = cat.questionCount || 0;
  const answers = {};
  for (let i = 0; i < n; i++) answers[i] = document.getElementById(`q${i}`).value.trim();
  btn.disabled = true;
  try {
    if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: KEY })) {
      banner.className = 'banner bad'; banner.textContent = 'Locked — not saved.'; btn.disabled = false; return;
    }
    await set(ref(db, `${subsPath}/${cat.id}`), { submittedAt: Date.now(), answers });
```
with:
```js
  const n = cat.questionCount || 0;
  const answers = {};
  const bonusAnswers = {};
  for (let i = 0; i < n; i++) {
    answers[i] = document.getElementById(`q${i}`).value.trim();
    if (cat.bonus?.[i]) {
      const bEl = document.getElementById(`qb${i}`);
      if (bEl) bonusAnswers[i] = bEl.value.trim();
    }
  }
  btn.disabled = true;
  try {
    if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: KEY })) {
      banner.className = 'banner bad'; banner.textContent = 'Locked — not saved.'; btn.disabled = false; return;
    }
    const payload = { submittedAt: Date.now(), answers };
    if (Object.keys(bonusAnswers).length) payload.bonusAnswers = bonusAnswers;
    await set(ref(db, `${subsPath}/${cat.id}`), payload);
```

- [ ] **Step 4: Verify no test regression + manual check**

Run: `cd /Users/davidzoufaly/code/ps-offsite && npx vitest run`
Expected: PASS (no unit test for this page).
Manual (later, in browser): flag a question bonus in admin, open the quiz as a team — the flagged question shows a second magenta "— Bonus" input; submitting stores both.

- [ ] **Step 5: Commit**

```bash
cd /Users/davidzoufaly/code/ps-offsite
git add ps-offsite-2026/games/quiz.html
git commit -m "feat(quiz): render bonus answer field + store bonusAnswers on play page

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Admin — bonus toggle chips + prune + submissions display

**Files:**
- Modify: `ps-offsite-2026/quiz-admin.html`

- [ ] **Step 1: Add CSS**

In the `<style>` block, after the existing `.cat-row { ... }` rule, add:
```css
  .cat { display: flex; flex-direction: column; gap: 8px; }
  .qchips { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; padding: 0 4px 4px; }
  .qchips-label { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 1px; margin-right: 4px; }
  .qchip {
    background: var(--bg-2); border: 1px solid rgba(255,255,255,0.12); color: var(--muted);
    border-radius: 999px; padding: 4px 10px; font-size: 13px; font-weight: 700; cursor: pointer; font-family: inherit;
  }
  .qchip.on { background: rgba(255,0,170,0.16); border-color: rgba(255,0,170,0.5); color: #ff7ad0; }
```
And after the existing `.sub-row .ans.empty { ... }` rule, add:
```css
  .sub-bonus .team { color: var(--muted); }
  .sub-row .ans.bonus-ans { color: #ff7ad0; }
  .q-title .bonus-tag { color: #ff7ad0; font-weight: 800; margin-left: 6px; }
```

- [ ] **Step 2: Rewrite the category markup + wiring in `renderCatEditor`**

Replace the `el.innerHTML = ...` template and the wiring loop. The current code is:
```js
  el.innerHTML = `
    <h2>Categories</h2>
    <div class="cats">
      ${ordered.map(c => `
        <div class="cat-row" data-id="${c.id}">
          <input class="cat-name" type="text" value="${esc(c.name)}" />
          <div class="qcount">
            <button class="qminus" title="Fewer questions">−</button>
            <span class="qnum">${c.questionCount}</span>
            <button class="qplus" title="More questions">+</button>
          </div>
          <button class="cat-remove" title="Remove category">✕</button>
        </div>`).join('')}
    </div>
    <button id="addCat" class="primary">+ Add category</button>`;
  for (const row of el.querySelectorAll('.cat-row')) {
    const id = row.dataset.id;
    row.querySelector('.cat-name').addEventListener('change', e => {
      set(ref(db, `${LOBBY}/quiz/categories/${id}/name`), e.target.value.trim() || 'Category');
    });
    row.querySelector('.qplus').addEventListener('click', () => changeCount(id, +1));
    row.querySelector('.qminus').addEventListener('click', () => changeCount(id, -1));
    row.querySelector('.cat-remove').addEventListener('click', () => removeCat(id));
  }
  el.querySelector('#addCat').addEventListener('click', addCat);
```
Replace it with:
```js
  el.innerHTML = `
    <h2>Categories</h2>
    <div class="cats">
      ${ordered.map(c => `
        <div class="cat" data-id="${c.id}">
          <div class="cat-row">
            <input class="cat-name" type="text" value="${esc(c.name)}" />
            <div class="qcount">
              <button class="qminus" title="Fewer questions">−</button>
              <span class="qnum">${c.questionCount}</span>
              <button class="qplus" title="More questions">+</button>
            </div>
            <button class="cat-remove" title="Remove category">✕</button>
          </div>
          <div class="qchips">
            <span class="qchips-label">Bonus:</span>
            ${Array.from({ length: c.questionCount || 0 }, (_, i) =>
              `<button class="qchip ${c.bonus?.[i] ? 'on' : ''}" data-idx="${i}" title="Toggle bonus for question ${i + 1}">Q${i + 1}</button>`
            ).join('')}
          </div>
        </div>`).join('')}
    </div>
    <button id="addCat" class="primary">+ Add category</button>`;
  for (const catEl of el.querySelectorAll('.cat')) {
    const id = catEl.dataset.id;
    catEl.querySelector('.cat-name').addEventListener('change', e => {
      set(ref(db, `${LOBBY}/quiz/categories/${id}/name`), e.target.value.trim() || 'Category');
    });
    catEl.querySelector('.qplus').addEventListener('click', () => changeCount(id, +1));
    catEl.querySelector('.qminus').addEventListener('click', () => changeCount(id, -1));
    catEl.querySelector('.cat-remove').addEventListener('click', () => removeCat(id));
    for (const chip of catEl.querySelectorAll('.qchip')) {
      chip.addEventListener('click', () => toggleBonus(id, Number(chip.dataset.idx)));
    }
  }
  el.querySelector('#addCat').addEventListener('click', addCat);
```
(The `.cat-name` focus-guard at the top of `renderCatEditor` still works — the name input is unchanged and still has class `cat-name`.)

- [ ] **Step 3: Add `toggleBonus` + prune in `changeCount`**

Add a new function next to `changeCount`:
```js
async function toggleBonus(id, idx) {
  const cur = (categories || {})[id]?.bonus?.[idx];
  await set(ref(db, `${LOBBY}/quiz/categories/${id}/bonus/${idx}`), cur ? null : true);
}
```

Replace `changeCount` with a version that prunes stale flags on decrease:
```js
async function changeCount(id, delta) {
  const next = Math.max(1, curCount(id) + delta);
  await set(ref(db, `${LOBBY}/quiz/categories/${id}/questionCount`), next);
  if (delta < 0) {
    const bonus = (categories || {})[id]?.bonus || {};
    for (const k of Object.keys(bonus)) {
      if (Number(k) >= next) await set(ref(db, `${LOBBY}/quiz/categories/${id}/bonus/${k}`), null);
    }
  }
}
```

- [ ] **Step 4: Show bonus answers in `renderSubmissions`**

Replace the per-question loop body. Current:
```js
    for (let i = 0; i < n; i++) {
      const rows = teams.map(t => {
        const sub = submissions?.[t.id]?.[c.id];
        const submitted = !!sub;
        const a = sub?.answers?.[i];
        const text = submitted ? (a && a.length ? esc(a) : '(blank)') : '—';
        return `<div class="sub-row"><span class="team">${esc(t.name)}</span><span class="ans ${a && a.length ? '' : 'empty'}">${text}</span></div>`;
      }).join('');
      qhtml += `<div class="q-block"><div class="q-title">Question ${i + 1}</div>${rows}</div>`;
    }
```
Replace with:
```js
    for (let i = 0; i < n; i++) {
      const isBonus = !!c.bonus?.[i];
      const rows = teams.map(t => {
        const sub = submissions?.[t.id]?.[c.id];
        const submitted = !!sub;
        const a = sub?.answers?.[i];
        const text = submitted ? (a && a.length ? esc(a) : '(blank)') : '—';
        let html = `<div class="sub-row"><span class="team">${esc(t.name)}</span><span class="ans ${a && a.length ? '' : 'empty'}">${text}</span></div>`;
        if (isBonus) {
          const b = sub?.bonusAnswers?.[i];
          const btext = submitted ? (b && b.length ? esc(b) : '(blank)') : '—';
          html += `<div class="sub-row sub-bonus"><span class="team">↳ Bonus</span><span class="ans bonus-ans ${b && b.length ? '' : 'empty'}">${btext}</span></div>`;
        }
        return html;
      }).join('');
      const title = isBonus ? `Question ${i + 1} <span class="bonus-tag">bonus</span>` : `Question ${i + 1}`;
      qhtml += `<div class="q-block"><div class="q-title">${title}</div>${rows}</div>`;
    }
```

- [ ] **Step 5: Verify no test regression + manual check**

Run: `cd /Users/davidzoufaly/code/ps-offsite && npx vitest run`
Expected: PASS.
Manual (later): in Quiz Admin, each category shows a "Bonus: Q1 … QN" chip row; clicking a chip toggles its highlight + persists; shrinking the count via − drops chips and prunes flags above the new count; the submissions view shows a "↳ Bonus" answer line under flagged questions.

- [ ] **Step 6: Commit**

```bash
cd /Users/davidzoufaly/code/ps-offsite
git add ps-offsite-2026/quiz-admin.html
git commit -m "feat(quiz): admin bonus toggles + prune + bonus answers in submissions

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Full verification

- [ ] **Step 1: Run the whole suite**

Run: `cd /Users/davidzoufaly/code/ps-offsite && npx vitest run`
Expected: PASS — all suites green including the updated `quiz.test.js`.

- [ ] **Step 2: End-to-end smoke (browser)**

In a real lobby: admin flags Q3 of Category 1 as bonus → team opens quiz, sees Q3 main + "Q3 — Bonus" inputs, fills both, submits category → admin submissions view shows the team's Q3 answer + a "↳ Bonus" line with the bonus answer → admin shrinks Category 1 below 3 questions and confirms the bonus chip + flag for Q3 disappear. No console errors.

---

## Notes

- **Data contract:** play writes `quiz/submissions/{teamId}/{catId}/bonusAnswers/{idx}` (omitted when the category has no bonus questions); admin reads it with optional chaining, so the omitted case renders `—`/`(blank)` just like `answers`.
- **Stale flags:** every render loop is count-driven (`i < questionCount`), so flags with `idx >= count` are never displayed; `changeCount` prunes them proactively on decrease; `bonusIndices` filters them as the pure-logic safety net.
- **No scoring change:** final score remains one self-reported number (`scores/{teamId}/PQ`). Bonus is a collected answer only.
