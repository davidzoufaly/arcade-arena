# Pub Quiz Admin Grading Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move Pub Quiz scoring from player self-report to host grading — the admin marks each answer correct/incorrect (+1 each, bonus +1 extra) and submits per category to publish each team's total.

**Architecture:** A new pure helper `teamQuizScore` sums correct marks from a `quiz/grades` Firebase node. The admin page (`quiz-admin.html`) gains per-row toggles and per-category submit that recompute + publish the total via the existing `submitScore` path. The play page (`games/quiz.html`) loses its self-report input and its entire timer/auto-zero block. The PQ timer control is also stripped from `scoreboard.html` and `games.html`.

**Tech Stack:** Vanilla ES-module HTML pages, Firebase Realtime Database (`set`/`update`/`push`/`get`/`onValue`), Vitest for the one pure helper.

---

## File Structure

- `ps-offsite-2026/shared/quiz.js` — add pure `teamQuizScore(grades, categories)` helper.
- `tests/quiz.test.js` — add `teamQuizScore` unit tests.
- `ps-offsite-2026/quiz-admin.html` — turn the submissions view into a grader (toggles, pending state, per-category submit, recompute + publish).
- `ps-offsite-2026/games/quiz.html` — remove self-report score input + all timer logic; show "awaiting host scoring".
- `ps-offsite-2026/shared/games-catalog.js` — update the `PQ.rules` copy.
- `ps-offsite-2026/scoreboard.html` — drop `'quiz'` from the timer-control `kind` branch.
- `ps-offsite-2026/games.html` — drop `'quiz'` from the tile-timer `kind` branch.

Data model (written only by the grader):
```
lobbies/{id}/quiz/grades/{teamId}/{catId} = { [idx]: { q: true, b?: true } }
```
Only `true` stored; clearing writes `null`. Score stays at `lobbies/{id}/scores/{teamId}/PQ`.

---

## Task 1: `teamQuizScore` pure helper (TDD)

**Files:**
- Modify: `ps-offsite-2026/shared/quiz.js`
- Test: `tests/quiz.test.js`

- [ ] **Step 1: Write the failing tests**

Add to the bottom of `tests/quiz.test.js`, and add `teamQuizScore` to the import list at the top (the `from '../ps-offsite-2026/shared/quiz.js'` import):

```js
describe('teamQuizScore', () => {
  const cats = {
    c1: { order: 0, name: 'A', questionCount: 3, bonus: { 1: true } },
    c2: { order: 1, name: 'B', questionCount: 2 },
  };

  it('returns 0 for empty/missing grades', () => {
    expect(teamQuizScore(null, cats)).toBe(0);
    expect(teamQuizScore({}, cats)).toBe(0);
  });

  it('scores 1 per correct base question', () => {
    const grades = { c1: { 0: { q: true }, 2: { q: true } }, c2: { 0: { q: true } } };
    expect(teamQuizScore(grades, cats)).toBe(3);
  });

  it('adds +1 extra only when the index is flagged bonus and base is correct', () => {
    // c1 idx 1 is bonus, correct base + correct bonus = 2
    expect(teamQuizScore({ c1: { 1: { q: true, b: true } } }, cats)).toBe(2);
    // idx 0 is NOT bonus: a stray b adds nothing, base still 1
    expect(teamQuizScore({ c1: { 0: { q: true, b: true } } }, cats)).toBe(1);
  });

  it('scores 0 for a lone bonus with no correct base', () => {
    expect(teamQuizScore({ c1: { 1: { b: true } } }, cats)).toBe(0);
  });

  it('ignores indices >= questionCount and grades for absent categories', () => {
    const grades = {
      c1: { 5: { q: true } },        // out of range
      gone: { 0: { q: true } },      // category no longer exists
    };
    expect(teamQuizScore(grades, cats)).toBe(0);
  });

  it('coerces Firebase string keys and sums across categories', () => {
    const grades = { c1: { '0': { q: true }, '1': { q: true, b: true } }, c2: { '1': { q: true } } };
    // c1: idx0 base 1, idx1 base+bonus 2 => 3 ; c2: idx1 base 1 => total 4
    expect(teamQuizScore(grades, cats)).toBe(4);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- quiz`
Expected: FAIL — `teamQuizScore is not a function` / `not exported`.

- [ ] **Step 3: Implement the helper**

Append to `ps-offsite-2026/shared/quiz.js`:

```js
// Total Pub Quiz points for ONE team's grade map. grades is
// { [catId]: { [idx]: { q?:true, b?:true } } }; categories is the lobby
// category map (for questionCount bounds + bonus flags). +1 per correct base
// question (q), +1 extra only when the index is flagged bonus AND the base is
// also correct. Stale categories, out-of-range indices, and bonus marks on
// non-bonus indices are ignored so old grades never inflate the score.
export function teamQuizScore(grades, categories) {
  const cats = categories || {};
  let total = 0;
  for (const [catId, marks] of Object.entries(grades || {})) {
    const cat = cats[catId];
    if (!cat) continue;
    const qc = cat.questionCount ?? 0;
    const bonus = cat.bonus || {};
    for (const [k, m] of Object.entries(marks || {})) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i >= qc) continue;
      if (!m || !m.q) continue;
      total += 1;
      if (bonus[i] && m.b) total += 1;
    }
  }
  return total;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- quiz`
Expected: PASS (all `teamQuizScore` cases green, existing cases still green).

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/quiz.js tests/quiz.test.js
git commit -m "feat(quiz): teamQuizScore helper — sum correct marks (bonus needs base)"
```

---

## Task 2: Update PQ rules copy

**Files:**
- Modify: `ps-offsite-2026/shared/games-catalog.js:13`

- [ ] **Step 1: Replace the PQ rules string**

In `ps-offsite-2026/shared/games-catalog.js`, find the `PQ:` entry and replace its `rules` value. The current second bullet mentions entering a raw score — remove it and state the host grades.

Old `rules` value:
```
'The host reads each question aloud. Type your team\'s answer for every question in the current category, then submit to lock it in and reveal the next category.\n\n- One category at a time — once you submit, those answers can\'t be changed.\n- After the last category, enter your raw score (number of correct answers), same as the other manual games.\n- Some questions are bonus questions — they show a second answer field worth extra points.'
```

New `rules` value:
```
'The host reads each question aloud. Type your team\'s answer for every question in the current category, then submit to lock it in and reveal the next category.\n\n- One category at a time — once you submit, those answers can\'t be changed.\n- After the last category you\'re done — the host marks every answer and scores your team.\n- Some questions are bonus questions — they show a second answer field worth an extra point.'
```

- [ ] **Step 2: Verify the file still parses**

Run: `npm test -- quiz`
Expected: PASS (no test depends on the copy; this just confirms no syntax break).

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/shared/games-catalog.js
git commit -m "docs(quiz): rules — host grades answers, no player self-report"
```

---

## Task 3: Strip self-report + timer from the play page

**Files:**
- Modify: `ps-offsite-2026/games/quiz.html`

This page currently reads/writes the PQ score and runs a countdown that auto-zeros the score. All of that goes; only the category-answer flow + lock gate stay.

- [ ] **Step 1: Trim the imports**

Replace the two import lines (`games/quiz.html:88-89`):

```js
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
import { resolveTimer, resolveRule, deadlineFor, isExpired, formatMMSS } from '../shared/game-config.js';
```

with (drop `submitScore`/`firebaseWriter` entirely, keep only `resolveRule`):

```js
import { resolveRule } from '../shared/game-config.js';
```

- [ ] **Step 2: Remove the writer + score/start paths and timer state**

Delete the `writer` line (`games/quiz.html:117`):
```js
const writer = firebaseWriter({ db, ref, update, push });
```

In the path block (`games/quiz.html:120-122`), delete `scorePath` and `startPath`, keep `subsPath`:
```js
const scorePath = `${LOBBY}/scores/${session.teamId}/${KEY}`;   // DELETE
const startPath = `${LOBBY}/timerStarts/${KEY}/${session.teamId}`; // DELETE
```

In the live-state block (`games/quiz.html:124-135`), delete `currentScore` and the entire timer-state group, leaving only:
```js
let categories = null;
let catsLoaded = false;
let submissions = null;
let currentRules = null;
```
(Delete `currentScore`, `minutes`, `startTs`, `timerId`, `settled`, `timeUp` and the `settle()` function at lines 137-142.)

- [ ] **Step 3: Simplify `shell` (remove the countdown element)**

Replace `shell` (`games/quiz.html:147-153`) with:

```js
function shell(inner) {
  return `
    <div class="head"><div class="emoji">${game.emoji}</div><h1>${esc(game.name)}</h1></div>
    <div class="rules">${renderRules(rulesText())}</div>
    ${inner}`;
}
```

- [ ] **Step 4: Simplify `render` (drop timeUp + countdown paints)**

Replace `render` (`games/quiz.html:155-167`) with:

```js
function render() {
  if (!catsLoaded) return; // keep "Loading…" until first categories snapshot
  const ordered = orderedCategories(categories);
  if (ordered.length === 0) {
    container.innerHTML = shell(`<div class="panel"><h2>Quiz not ready</h2><p class="current">The host hasn't set up any categories yet. Check back soon.</p><a class="back-link" href="${catalogHref}">← Back to catalog</a></div>`);
    return;
  }
  const curId = currentCategoryId(categories, submissions);
  if (curId !== null) { renderCategory(ordered.find(c => c.id === curId), ordered); return; }
  renderDone(ordered);
}
```

- [ ] **Step 5: Drop countdown + timeUp checks from `renderCategory` / `submitCategory`**

In `renderCategory` (`games/quiz.html:169-190`), delete the `if (minutes) paintCountdown();` line (near line 188).

In `submitCategory` (`games/quiz.html:192-220`), delete the two timer guards at the top:
```js
if (timeUp) return;                                          // DELETE
if (minutes && isExpired(startTs, minutes, Date.now())) return; // DELETE
```
Everything else in `submitCategory` (lock check, `set` of the submission) stays unchanged.

- [ ] **Step 6: Replace `renderScore` with `renderDone`**

Replace the entire `renderScore` function (`games/quiz.html:222-239`) with:

```js
function renderDone(ordered) {
  container.innerHTML = shell(`
    <div class="progress">All ${ordered.length} categories submitted</div>
    <div class="panel">
      <p class="current">You're done — the host will mark your answers and score your team. Nothing more to do here.</p>
      <a class="back-link" href="${catalogHref}">← Back to catalog</a>
    </div>`);
}
```

- [ ] **Step 7: Delete the score-submit + timer functions**

Delete these functions entirely:
- `onSubmitScore` (`games/quiz.html:241-272`)
- `autoZero` (`games/quiz.html:274-283`)
- `renderTimeUp` (`games/quiz.html:285-293`)
- `rearmCountdown` (`games/quiz.html:295-299`)
- `paintCountdown` (`games/quiz.html:301-308`)
- `startCountdown` (`games/quiz.html:310-323`)

- [ ] **Step 8: Simplify the boot IIFE**

Replace the boot block (`games/quiz.html:325-362`) with (drop the score read, timer resolve, startPath handling, the `rules` listener stays, no `startCountdown`):

```js
(async () => {
  if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: KEY })) {
    renderLockedScreen(catalogHref);
    return;
  }
  // Attach live listeners only AFTER the lock gate passes, so a locked team
  // never briefly sees quiz content.
  onValue(ref(db, `${LOBBY}/quiz/categories`), snap => {
    categories = snap.exists() ? snap.val() : null; catsLoaded = true; render();
  });
  onValue(ref(db, subsPath), snap => {
    submissions = snap.exists() ? snap.val() : null; render();
  });
  onValue(ref(db, `${LOBBY}/rules`), snap => {
    currentRules = snap.exists() ? snap.val() : null;
    const el = container.querySelector('.rules');
    if (el) el.innerHTML = renderRules(rulesText());
  });
})();
```

- [ ] **Step 9: Trim now-dead Firebase imports**

The `firebase-database.js` import (`games/quiz.html:82`) lists `get, set, update, push, onValue`. After the edits the page no longer uses `update` or `push` (those were only for `writer`). Confirm by searching the `<script>`: `update(` and `push(` should have zero matches. Update the import to:
```js
import { getDatabase, ref, get, set, onValue } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
```
(`get` is still used by the lock gate; `set` by `submitCategory`; `onValue` by the listeners.)

- [ ] **Step 10: Verify no dangling references**

Run from repo root:
```bash
grep -nE 'minutes|startTs|timerId|timeUp|currentScore|paintCountdown|autoZero|submitScore|firebaseWriter|resolveTimer|deadlineFor|isExpired|formatMMSS|scorePath|startPath|countdown' ps-offsite-2026/games/quiz.html
```
Expected: no matches (the `.countdown` CSS at lines 65-71 may remain — that is dead style, optional to remove; if you remove it, also fine). If any JS reference remains, fix it.

- [ ] **Step 11: Commit**

```bash
git add ps-offsite-2026/games/quiz.html
git commit -m "feat(quiz): play page — drop self-report score + timer, await host scoring"
```

---

## Task 4: Remove the PQ timer control from scoreboard + games tiles

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html:687`
- Modify: `ps-offsite-2026/games.html:160`

- [ ] **Step 1: Scoreboard — drop `'quiz'` from the clock-config branch**

In `ps-offsite-2026/scoreboard.html` change line 687 from:
```js
  if (GAMES[g].kind === 'manual' || GAMES[g].kind === 'quiz') {
```
to:
```js
  if (GAMES[g].kind === 'manual') {
```
(This removes the "set time limit" clock button for PQ. The lock button above it is untouched.)

- [ ] **Step 2: games.html — drop `'quiz'` from the tile-timer branch**

In `ps-offsite-2026/games.html` change line 160 from:
```js
    const mins = (g.kind === 'manual' || g.kind === 'quiz') ? resolveTimer(currentTimers, key, session.teamId) : undefined;
```
to:
```js
    const mins = (g.kind === 'manual') ? resolveTimer(currentTimers, key, session.teamId) : undefined;
```
(With `mins` undefined for PQ, `hasTimer` is false → no timer badge, no entry-warning interception. PQ renders as a plain playable tile.)

- [ ] **Step 3: Verify PQ is no longer timer-wired**

Run from repo root:
```bash
grep -nE "kind === 'quiz'" ps-offsite-2026/scoreboard.html ps-offsite-2026/games.html
```
Expected: no matches.

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/scoreboard.html ps-offsite-2026/games.html
git commit -m "feat(quiz): remove PQ timer control from scoreboard + games tiles"
```

---

## Task 5: Admin grader — toggles, per-category submit, recompute + publish

**Files:**
- Modify: `ps-offsite-2026/quiz-admin.html`

The submissions view becomes a grader. Add a `grades` listener + once-only `pending` seed, per-row correct/bonus toggles, and a per-category Submit button that writes marks and publishes each affected team's PQ total.

- [ ] **Step 1: Extend the Firebase + helper imports**

Change the `firebase-database.js` import (`quiz-admin.html:88`) from:
```js
import { getDatabase, ref, set, push, onValue } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
```
to (add `get`, `update`):
```js
import { getDatabase, ref, get, set, update, push, onValue } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
```

Change the quiz-helper import (`quiz-admin.html:93`) from:
```js
import { orderedCategories, nextOrder } from './shared/quiz.js';
```
to:
```js
import { orderedCategories, nextOrder, teamQuizScore } from './shared/quiz.js';
```

Add a new import line right after it:
```js
import { submitScore, firebaseWriter } from './shared/score-submit.js';
```

- [ ] **Step 2: Add grader state + writer**

After the `const session = ...; const isAdmin = ...;` lines and the existing
`let categories = null, submissions = null, teams = [];` (`quiz-admin.html:112`), change that state line to add `grades` and add the pending object + writer:

```js
let categories = null, submissions = null, teams = [], grades = null;
const pending = {};               // pending[teamId][catId][idx] = { q:bool, b:bool }
const writer = firebaseWriter({ db, ref, update, push });
```

- [ ] **Step 3: Add pending helpers (seed once, read, toggle)**

Add these functions just above `renderSubmissions` (`quiz-admin.html:193`):

```js
// Seed local marks from saved grades — ONCE per cell. Never re-hydrate a cell
// the admin has already touched, so a live grades echo can't wipe edits.
function seedPending() {
  const g = grades || {};
  for (const teamId of Object.keys(g)) {
    for (const catId of Object.keys(g[teamId] || {})) {
      const marks = g[teamId][catId] || {};
      pending[teamId] ??= {};
      pending[teamId][catId] ??= {};
      for (const idx of Object.keys(marks)) {
        if (!(idx in pending[teamId][catId])) {
          const m = marks[idx] || {};
          pending[teamId][catId][idx] = { q: !!m.q, b: !!m.b };
        }
      }
    }
  }
}
function getMark(teamId, catId, idx) {
  return pending[teamId]?.[catId]?.[idx] || { q: false, b: false };
}
function toggleMark(teamId, catId, idx, field) {
  pending[teamId] ??= {};
  pending[teamId][catId] ??= {};
  const cur = pending[teamId][catId][idx] || { q: false, b: false };
  cur[field] = !cur[field];
  pending[teamId][catId][idx] = cur;
}
```

- [ ] **Step 4: Replace `renderSubmissions` with the grader render**

Replace the entire `renderSubmissions` function (`quiz-admin.html:193-223`) with the version below. It adds a toggle button to every per-team answer row, a separate bonus toggle, and a Submit button + status line per category.

```js
function renderSubmissions() {
  const el = document.getElementById('submissionsView');
  const ordered = orderedCategories(categories);
  if (ordered.length === 0) {
    el.innerHTML = `<h2>Grading</h2><p class="muted">No categories yet.</p>`;
    return;
  }
  el.innerHTML = `<h2>Grading</h2>` + ordered.map(c => {
    const n = c.questionCount || 0;
    let qhtml = '';
    for (let i = 0; i < n; i++) {
      const isBonus = !!c.bonus?.[i];
      const rows = teams.map(t => {
        const sub = submissions?.[t.id]?.[c.id];
        const submitted = !!sub;
        const a = sub?.answers?.[i];
        const text = submitted ? (a && a.length ? esc(a) : '(blank)') : '—';
        const mark = getMark(t.id, c.id, i);
        const toggle = submitted
          ? `<button class="mark ${mark.q ? 'ok' : ''}" data-team="${t.id}" data-cat="${c.id}" data-idx="${i}" data-field="q">${mark.q ? '✓' : '✗'}</button>`
          : '';
        let html = `<div class="sub-row"><span class="team">${esc(t.name)}</span><span class="ans ${a && a.length ? '' : 'empty'}">${text}</span>${toggle}</div>`;
        if (isBonus) {
          const b = sub?.bonusAnswers?.[i];
          const btext = submitted ? (b && b.length ? esc(b) : '(blank)') : '—';
          const bToggle = submitted
            ? `<button class="mark ${mark.b ? 'ok' : ''}" data-team="${t.id}" data-cat="${c.id}" data-idx="${i}" data-field="b">${mark.b ? '✓' : '✗'}</button>`
            : '';
          html += `<div class="sub-row sub-bonus"><span class="team">↳ Bonus</span><span class="ans bonus-ans ${b && b.length ? '' : 'empty'}">${btext}</span>${bToggle}</div>`;
        }
        return html;
      }).join('');
      const title = isBonus ? `Question ${i + 1} <span class="bonus-tag">bonus</span>` : `Question ${i + 1}`;
      qhtml += `<div class="q-block"><div class="q-title">${title}</div>${rows}</div>`;
    }
    const body = qhtml || '<p class="muted">No questions.</p>';
    return `<div class="cat-block" data-cat="${c.id}">
      <h3>${esc(c.name)}</h3>${body}
      <div class="grade-actions"><button class="primary submit-cat" data-cat="${c.id}">Submit category</button><span class="grade-status muted" data-cat="${c.id}"></span></div>
    </div>`;
  }).join('');

  for (const btn of el.querySelectorAll('.mark')) {
    btn.addEventListener('click', () => {
      toggleMark(btn.dataset.team, btn.dataset.cat, Number(btn.dataset.idx), btn.dataset.field);
      const on = getMark(btn.dataset.team, btn.dataset.cat, Number(btn.dataset.idx))[btn.dataset.field];
      btn.classList.toggle('ok', on);
      btn.textContent = on ? '✓' : '✗';
    });
  }
  for (const btn of el.querySelectorAll('.submit-cat')) {
    btn.addEventListener('click', () => submitCategoryGrades(btn.dataset.cat));
  }
}
```

- [ ] **Step 5: Add the per-category submit + recompute logic**

Add this function right after the new `renderSubmissions` (still inside the `<script>`):

```js
// Persist marks for one category (all teams that submitted it), then recompute
// + publish each affected team's PQ total. The recompute uses LOCAL pending for
// the just-submitted category (the live grades listener has not echoed the
// write yet) merged over the live grades snapshot for every other category.
async function submitCategoryGrades(catId) {
  const cat = (categories || {})[catId];
  if (!cat) return;
  const n = cat.questionCount || 0;
  const status = document.querySelector(`.grade-status[data-cat="${catId}"]`);
  const btn = document.querySelector(`.submit-cat[data-cat="${catId}"]`);
  if (btn) btn.disabled = true;
  if (status) { status.className = 'grade-status muted'; status.textContent = 'Saving…'; }
  try {
    const affected = teams.filter(t => submissions?.[t.id]?.[catId]);
    let updated = 0;
    for (const t of affected) {
      // Build this category's grade node from local pending.
      const node = {};
      for (let i = 0; i < n; i++) {
        const m = getMark(t.id, catId, i);
        const entry = {};
        if (m.q) entry.q = true;
        if (cat.bonus?.[i] && m.q && m.b) entry.b = true;
        if (Object.keys(entry).length) node[i] = entry;
      }
      const hasMarks = Object.keys(node).length > 0;
      await set(ref(db, `${LOBBY}/quiz/grades/${t.id}/${catId}`), hasMarks ? node : null);

      // Recompute full total: other categories from the live snapshot, this
      // category from the freshly built node.
      const teamGrades = { ...(grades?.[t.id] || {}) };
      if (hasMarks) teamGrades[catId] = node; else delete teamGrades[catId];
      const total = teamQuizScore(teamGrades, categories);

      // No-op guard: only write PQ (and push history) when the total changed.
      const cur = await get(ref(db, `${LOBBY}/scores/${t.id}/PQ`));
      const prev = cur.exists() ? cur.val() : null;
      if (prev !== total) {
        await submitScore({ writer, lobbyId, teamId: t.id, gameKey: 'PQ', score: total });
        updated++;
      }
    }
    if (status) { status.className = 'grade-status good'; status.textContent = `Graded · ${affected.length} teams · ${updated} score${updated === 1 ? '' : 's'} updated`; }
  } catch (e) {
    if (status) { status.className = 'grade-status bad'; status.textContent = 'Save failed: ' + (e.message || 'unknown error'); }
  } finally {
    if (btn) btn.disabled = false;
  }
}
```

Note: `lobbyId` is already defined at the top of the script (`quiz-admin.html:95`); `LOBBY` and `db` likewise.

- [ ] **Step 6: Add the `grades` listener and seed call**

In the boot IIFE, after the existing `quiz/submissions` listener (`quiz-admin.html:250-252`), add a `quiz/grades` listener:

```js
  onValue(ref(db, `${LOBBY}/quiz/grades`), snap => {
    grades = snap.exists() ? snap.val() : null; seedPending(); renderSubmissions();
  });
```

Also call `seedPending()` is driven by this listener; no change needed in `renderAll`.

- [ ] **Step 7: Add the toggle + status styles**

In the `<style>` block (after the `.q-title .bonus-tag` rule at `quiz-admin.html:75`), add:

```css
.sub-row .mark {
  margin-left: auto; width: 34px; height: 30px; flex: 0 0 auto;
  background: var(--bg-2); border: 1px solid rgba(255,255,255,0.12); color: var(--bad);
  border-radius: 8px; font-size: 15px; font-weight: 800; cursor: pointer; font-family: inherit;
}
.sub-row .mark.ok { background: rgba(0,230,118,0.16); border-color: rgba(0,230,118,0.5); color: var(--good); }
.grade-actions { display: flex; align-items: center; gap: 12px; margin-top: 12px; }
.grade-status { font-size: 14px; }
.grade-status.good { color: var(--good); }
.grade-status.bad { color: var(--bad); }
```

- [ ] **Step 8: Update the remove-category confirm copy**

In `removeCat` (`quiz-admin.html:182-185`), change the confirm text so the host knows removing a graded category drops its points on the next recompute:

```js
async function removeCat(id) {
  if (!confirm('Remove this category? Team submissions and any grades for it stay in the database but are hidden here — and the next time you submit a category, its points drop out of the published totals.')) return;
  await set(ref(db, `${LOBBY}/quiz/categories/${id}`), null);
}
```

- [ ] **Step 9: Run the unit tests (regression guard)**

Run: `npm test -- quiz`
Expected: PASS (Task 5 changes no helper; this confirms nothing imported broke the test build).

- [ ] **Step 10: Commit**

```bash
git add ps-offsite-2026/quiz-admin.html
git commit -m "feat(quiz): admin grader — per-answer toggles + per-category submit publishes PQ"
```

---

## Task 6: Manual end-to-end verification

**Files:** none (manual check against a live lobby; pages are Firebase-backed and have no automated integration tests).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 2: Manual flow (document results in the PR description)**

With a dev lobby + at least 2 teams:
1. As a team, answer + submit every category on `games/quiz.html`. Confirm the final view reads "You're done — the host will mark your answers…" with no score input and no countdown.
2. Confirm the PQ tile on `games.html` shows no "⏱ min limit" badge and opens directly (no time-warning dialog).
3. As host on `scoreboard.html`, confirm the PQ row shows the lock control but no clock/time-limit control.
4. On `quiz-admin.html`, mark some answers ✓ (incl. a bonus ✓), leave others ✗, click "Submit category". Confirm the status line reports teams graded + scores updated, and the team's PQ on the scoreboard equals base-correct + bonus-correct.
5. Re-click "Submit category" with no changes → status shows "0 scores updated" (no-op guard; no new history entry).
6. Reload `quiz-admin.html` → previously-marked toggles re-hydrate from saved grades.

- [ ] **Step 3: Commit (only if any fixup was needed)**

```bash
git add -A
git commit -m "fix(quiz): grading e2e verification fixups"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1 + 5), `teamQuizScore` (Task 1), player await-host + timer removal (Task 3), scoreboard/games timer removal (Task 4), grader toggles + local-pending + once-only seed + per-category submit + recompute-from-pending + no-op guard (Task 5), bonus-requires-base (Task 1 helper + Task 5 node build), bonus-toggle-on-blank shown (Task 5 render), remove-category note (Task 5 step 8), rules copy (Task 2). All spec sections mapped.
- **Type consistency:** `teamQuizScore(grades, categories)`, `getMark`/`toggleMark(teamId, catId, idx, field)`, grade node `{ q:true, b?:true }`, `submitScore({ writer, lobbyId, teamId, gameKey, score })` — names match across tasks and match `score-submit.js`.
