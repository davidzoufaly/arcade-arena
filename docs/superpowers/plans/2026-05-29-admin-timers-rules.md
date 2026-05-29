# Admin Game Timers & Editable Rules Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add two admin controls (per-game/per-team **time limit** and **editable rules**) to the scoreboard edit mode for non-playable (manual) games, with a refresh-proof countdown and auto-0 on expiry.

**Architecture:** Mirror the shipped `game-lock.js` pattern. A new pure module `shared/game-config.js` resolves `{games, cells}` overrides (precedence `cell > game`) and does timer arithmetic. Admin edits are staged in the scoreboard edit draft and written on Save to two new Firebase nodes (`timers`, `rules`); a third team-written node (`timerStarts`) persists each team's countdown start so a refresh cannot buy time. The player library badges/intercepts timed games; the manual detail page renders a live countdown and auto-submits 0 at expiry.

**Tech Stack:** Vanilla JS (ES modules, no framework), Firebase Realtime Database (CDN imports), Vitest for pure-module unit tests, Vite dev/build.

**Spec:** `docs/superpowers/specs/2026-05-29-admin-timers-rules-design.md`

---

## File Structure

- **New** `ps-offsite-2026/shared/game-config.js` — pure override resolution + write helpers + timer arithmetic + `formatMMSS`. No Firebase imports.
- **New** `tests/game-config.test.js` — vitest unit tests for the module.
- **Modify** `ps-offsite-2026/scoreboard.html` — generalize the edit draft to `{locks, timers, rules}`; add manual-only clock/rules icons + modals + CSS; write dirty nodes on Save; clear `timerStarts` on Reset.
- **Modify** `ps-offsite-2026/games.html` — `timers` listener; ⏱ badge; warning-modal tile interception.
- **Modify** `ps-offsite-2026/games/manual.html` — new `onValue`+`set` imports; resolved + live rules; timer flow; single-settle guard; auto-0.

No catalog change (`GAMES[key].rules` stays the fallback). No vite/build change (all three HTML files are already entry points; modals are in-page overlays).

---

## Task 1: Pure module — override resolution + typed reads

**Files:**
- Create: `ps-offsite-2026/shared/game-config.js`
- Test: `tests/game-config.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/game-config.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  resolveOverride, hasOverride, resolveTimer, resolveRule,
} from '../ps-offsite-2026/shared/game-config.js';

describe('resolveOverride precedence', () => {
  it('cell overrides game; absent => undefined', () => {
    const node = { games: { SF: 10 }, cells: { SF: { 3: 20 } } };
    expect(resolveOverride(node, 'SF', 3)).toBe(20); // cell wins
    expect(resolveOverride(node, 'SF', 1)).toBe(10); // game wins (no cell)
    expect(resolveOverride(node, 'MX', 1)).toBeUndefined(); // none
  });
  it('optional-chaining safe on absent node / level (no throw)', () => {
    expect(resolveOverride(undefined, 'SF', 1)).toBeUndefined();
    expect(resolveOverride({}, 'SF', 1)).toBeUndefined();
    expect(resolveOverride({ games: {} }, 'SF', 1)).toBeUndefined();
    expect(resolveOverride({ cells: { SF: {} } }, 'SF', 1)).toBeUndefined();
  });
  it('missing teamId degrades to game level', () => {
    const node = { games: { SF: 10 }, cells: { SF: { 3: 20 } } };
    expect(resolveOverride(node, 'SF', undefined)).toBe(10);
  });
});

describe('hasOverride', () => {
  it('reflects presence at the requested level', () => {
    const node = { games: { SF: 10 }, cells: { SF: { 3: 20 } } };
    expect(hasOverride(node, 'SF', 3)).toBe(true);   // cell level
    expect(hasOverride(node, 'SF', 1)).toBe(true);   // degrades to game
    expect(hasOverride(node, 'SF')).toBe(true);      // game level
    expect(hasOverride(node, 'MX')).toBe(false);
    expect(hasOverride(undefined, 'SF', 3)).toBe(false);
  });
});

describe('resolveTimer normalization', () => {
  it('returns positive minutes, else undefined for junk/absent', () => {
    expect(resolveTimer({ games: { SF: 15 } }, 'SF')).toBe(15);
    expect(resolveTimer({ games: { SF: '15' } }, 'SF')).toBe(15); // string coerced
    expect(resolveTimer({ games: { SF: 0 } }, 'SF')).toBeUndefined();
    expect(resolveTimer({ games: { SF: -5 } }, 'SF')).toBeUndefined();
    expect(resolveTimer({ games: { SF: 'abc' } }, 'SF')).toBeUndefined();
    expect(resolveTimer(undefined, 'SF')).toBeUndefined();
  });
});

describe('resolveRule', () => {
  it('returns override, else fallback', () => {
    expect(resolveRule({ games: { SF: 'custom' } }, 'SF', 1, 'default')).toBe('custom');
    expect(resolveRule({ cells: { SF: { 3: 'hint' } } }, 'SF', 3, 'default')).toBe('hint');
    expect(resolveRule(undefined, 'SF', 1, 'default')).toBe('default');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game-config.test.js`
Expected: FAIL — "Failed to resolve import '../ps-offsite-2026/shared/game-config.js'".

- [ ] **Step 3: Write minimal implementation**

Create `ps-offsite-2026/shared/game-config.js`:

```js
// ps-offsite-2026/shared/game-config.js
// Pure per-game / per-team config-override resolution + write helpers for
// timers and rules, plus timer arithmetic. No Firebase imports (testable).
// Mirrors shared/game-lock.js.
//
// Stored shape (Firebase nodes lobbies/{id}/timers and lobbies/{id}/rules):
//   { games: { [gameKey]: value },
//     cells: { [gameKey]: { [teamId]: value } } }
// Precedence: cell > game. Absent => undefined (no override). No "all" level.

// Raw override read. Optional chaining REQUIRED: `??` only guards null/undefined
// VALUES, not missing intermediate objects, so `cells[k][t]` would throw on the
// common absent-node case. teamId undefined => cell branch undefined => degrades.
export function resolveOverride(node, gameKey, teamId) {
  return node?.cells?.[gameKey]?.[teamId] ?? node?.games?.[gameKey];
}

// True iff an override exists at the requested level (cell if teamId given, else
// game). Needed because resolveRule returns the fallback for an absent override,
// so the UI cannot otherwise distinguish "set" from "unset" for tinting.
export function hasOverride(node, gameKey, teamId) {
  return resolveOverride(node, gameKey, teamId) !== undefined;
}

// Minutes (positive number) or undefined. Normalizes junk (0, negative, NaN,
// non-numeric string) to undefined so corrupted DB data can never produce a
// NaN/0 deadline.
export function resolveTimer(timers, gameKey, teamId) {
  const v = Number(resolveOverride(timers, gameKey, teamId));
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export function resolveRule(rules, gameKey, teamId, fallback) {
  return resolveOverride(rules, gameKey, teamId) ?? fallback;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/game-config.test.js`
Expected: PASS (4 describe blocks green).

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/game-config.js tests/game-config.test.js
git commit -m "feat(game-config): override resolution + typed timer/rule reads"
```

---

## Task 2: Pure module — cascade write helpers (set vs clear)

**Files:**
- Modify: `ps-offsite-2026/shared/game-config.js`
- Test: `tests/game-config.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/game-config.test.js`:

```js
import { setGameOverride, setCellOverride } from '../ps-offsite-2026/shared/game-config.js';

describe('setGameOverride SET vs CLEAR', () => {
  it('SET writes game value AND cascade-clears that game cells', () => {
    const node = { games: {}, cells: { SF: { 3: 20 } } };
    setGameOverride(node, 'SF', 15);
    expect(node.games.SF).toBe(15);
    expect(node.cells.SF).toBeUndefined(); // cascade-cleared
  });
  it('CLEAR (empty/0) deletes only the game key, PRESERVES cells', () => {
    const node = { games: { SF: 15 }, cells: { SF: { 3: 20 } } };
    setGameOverride(node, 'SF', 0);   // clear
    expect(node.games.SF).toBeUndefined();
    expect(node.cells.SF[3]).toBe(20); // preserved
    setGameOverride(node, 'MX', '');   // clear absent key: no throw
    expect(node.games.MX).toBeUndefined();
  });
  it('lazily creates games on a draft cloned from {}', () => {
    const node = {};
    setGameOverride(node, 'SF', 15);
    expect(node.games.SF).toBe(15);
  });
});

describe('setCellOverride SET vs CLEAR', () => {
  it('SET writes one cell entry, lazily creating nesting', () => {
    const node = {};
    setCellOverride(node, 'SF', 3, 20);
    expect(node.cells.SF[3]).toBe(20);
  });
  it('CLEAR deletes one entry, leaving an empty map (resolver still works)', () => {
    const node = { cells: { SF: { 3: 20 } } };
    setCellOverride(node, 'SF', 3, '');
    expect(node.cells.SF[3]).toBeUndefined();
    expect(resolveOverride(node, 'SF', 3)).toBeUndefined();
  });
  it('string-keyed teamId (Firebase snapshot shape) sets and clears', () => {
    const node = { cells: { SF: { '3': 20 } } }; // string key as RTDB returns
    expect(resolveOverride(node, 'SF', 3)).toBe(20); // number access coerces
    setCellOverride(node, 'SF', 3, '');
    expect(node.cells.SF['3']).toBeUndefined();
  });
  it('rules string "0" is a valid value, not a clear', () => {
    const node = {};
    setCellOverride(node, 'SF', 3, '0');
    expect(node.cells.SF[3]).toBe('0');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game-config.test.js`
Expected: FAIL — "setGameOverride is not a function" / import error.

- [ ] **Step 3: Write minimal implementation**

Append to `ps-offsite-2026/shared/game-config.js`:

```js
// "Empty" => clear the override. Strings are checked by trim only (so rules text
// like "0" stays a valid value); numbers by finite-and-positive (so a 0/NaN
// minutes clears). The clock modal pre-coerces its input with Number().
function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
  return false;
}

// SET (non-empty): write the game value AND cascade-clear that game's cells
// (a fresh game-level value should not leave shadowed per-team overrides behind,
// mirroring setGame in game-lock.js).
// CLEAR (empty): delete ONLY the game key; LEAVE cells intact (nothing shadows
// them once the game value is gone, so they stay meaningful).
export function setGameOverride(node, gameKey, value) {
  if (isEmpty(value)) {
    if (node.games) delete node.games[gameKey];
  } else {
    node.games ??= {};
    node.games[gameKey] = value;
    if (node.cells) delete node.cells[gameKey];
  }
  return node;
}

export function setCellOverride(node, gameKey, teamId, value) {
  if (isEmpty(value)) {
    if (node.cells?.[gameKey]) delete node.cells[gameKey][teamId];
  } else {
    node.cells ??= {};
    node.cells[gameKey] ??= {};
    node.cells[gameKey][teamId] = value;
  }
  return node;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/game-config.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/game-config.js tests/game-config.test.js
git commit -m "feat(game-config): cascade set/clear write helpers"
```

---

## Task 3: Pure module — timer arithmetic + formatMMSS

**Files:**
- Modify: `ps-offsite-2026/shared/game-config.js`
- Test: `tests/game-config.test.js`

- [ ] **Step 1: Write the failing test**

Append to `tests/game-config.test.js`:

```js
import { deadlineFor, remainingMs, isExpired, formatMMSS } from '../ps-offsite-2026/shared/game-config.js';

describe('timer arithmetic', () => {
  const start = 1_000_000;
  const mins = 2; // 120000 ms
  it('deadlineFor adds minutes in ms', () => {
    expect(deadlineFor(start, mins)).toBe(start + 120_000);
  });
  it('remainingMs clamps at 0', () => {
    expect(remainingMs(start, mins, start)).toBe(120_000);
    expect(remainingMs(start, mins, start + 119_999)).toBe(1);
    expect(remainingMs(start, mins, start + 120_000)).toBe(0);
    expect(remainingMs(start, mins, start + 999_999)).toBe(0);
  });
  it('isExpired true at and past the deadline, false the ms before', () => {
    expect(isExpired(start, mins, start + 119_999)).toBe(false);
    expect(isExpired(start, mins, start + 120_000)).toBe(true);
  });
});

describe('formatMMSS', () => {
  it('formats remaining ms as M:SS, clamping negatives', () => {
    expect(formatMMSS(0)).toBe('0:00');
    expect(formatMMSS(1)).toBe('0:01');      // ceil: any remaining shows >=1s
    expect(formatMMSS(1000)).toBe('0:01');
    expect(formatMMSS(65_000)).toBe('1:05');
    expect(formatMMSS(-5000)).toBe('0:00');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game-config.test.js`
Expected: FAIL — "deadlineFor is not a function".

- [ ] **Step 3: Write minimal implementation**

Append to `ps-offsite-2026/shared/game-config.js`:

```js
// Timer arithmetic (pure). Callers guarantee a positive `minutes`.
export function deadlineFor(startTs, minutes) {
  return startTs + minutes * 60000;
}

export function remainingMs(startTs, minutes, now) {
  return Math.max(0, deadlineFor(startTs, minutes) - now);
}

export function isExpired(startTs, minutes, now) {
  return now >= deadlineFor(startTs, minutes);
}

// Remaining ms -> "M:SS" (ceil so the last partial second still reads >= 0:01;
// exactly 0 reads 0:00). Clamps negatives.
export function formatMMSS(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
```

- [ ] **Step 4: Run the whole suite to verify it passes**

Run: `npm test`
Expected: PASS — all existing suites plus `game-config.test.js`.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/game-config.js tests/game-config.test.js
git commit -m "feat(game-config): timer arithmetic + formatMMSS"
```

---

## Task 4: Scoreboard — generalize edit draft to {locks, timers, rules}

Pure refactor/rename. No new behavior; locks must keep working exactly as before. This isolates the rename so the next task only adds features.

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html`

- [ ] **Step 1: Update the module-state globals**

In `scoreboard.html`, find the state block (currently `let locks = null;`, `let lockDraft = null;`, `let pendingScores = null;`, `let locksDirty = false;`) and replace those four lines with:

```js
let locks = null, timers = null, rules = null;  // latest live nodes
let draft = null;                                // { locks, timers, rules } while editing
let dirty = { locks: false, timers: false, rules: false };
let pendingScores = null;
```

- [ ] **Step 2: Cache timers/rules in the onValue handler**

In the `onValue(ref(db, LOBBY_PATH), ...)` handler, find `locks = snap.val()?.locks ?? null;` and replace with:

```js
locks = snap.val()?.locks ?? null;
timers = snap.val()?.timers ?? null;
rules = snap.val()?.rules ?? null;
```

- [ ] **Step 3: Generalize startEdits / cancelEdits**

Replace the existing `startEdits` and `cancelEdits` functions with:

```js
function startEdits() {
  editing = true;
  draft = {
    locks: locks ? JSON.parse(JSON.stringify(locks)) : {},
    timers: timers ? JSON.parse(JSON.stringify(timers)) : {},
    rules: rules ? JSON.parse(JSON.stringify(rules)) : {},
  };
  dirty = { locks: false, timers: false, rules: false };
  pendingScores = {};
  renderControls();
  render();
}

function cancelEdits() {
  editing = false;
  draft = null;
  dirty = { locks: false, timers: false, rules: false };
  pendingScores = null;
  renderControls();
  render();
}
```

- [ ] **Step 4: Update renderControls "Lock all" handler**

In `renderControls`, the `allBtn` block currently reads `resolveAllLock(lockDraft)`, calls `toggleAll(lockDraft)`, and sets `locksDirty = true`. Replace those three references with `resolveAllLock(draft.locks)`, `toggleAll(draft.locks)`, and `dirty.locks = true` respectively. (Leave the rest of the handler — `captureScoreInputs()`, `renderControls()`, `render()` — unchanged.)

- [ ] **Step 5: Update saveEdits lock write**

In `saveEdits`, replace `if (locksDirty) await set(ref(db, `${LOBBY_PATH}/locks`), lockDraft);` with:

```js
if (dirty.locks) await set(ref(db, `${LOBBY_PATH}/locks`), draft.locks);
```

And replace the reset block at the end of `saveEdits` (`lockDraft = null; ... locksDirty = false;`) so it matches `cancelEdits`'s reset:

```js
editing = false;
draft = null;
dirty = { locks: false, timers: false, rules: false };
pendingScores = null;
renderControls();
render();
```

- [ ] **Step 6: Rename the lock-button wiring + render references**

Rename `wireLockButtons` to `wireEditButtons` (definition + the `if (editing) wireLockButtons();` call at the end of `render`). Inside it, replace `toggleCell(lockDraft, ...)` → `toggleCell(draft.locks, ...)` and `toggleGame(lockDraft, ...)` → `toggleGame(draft.locks, ...)` and `locksDirty = true` → `dirty.locks = true`.

In `render`, the editing branches reference `lockDraft`: replace `resolveGameLock(lockDraft, g)` → `resolveGameLock(draft.locks, g)` (header branch) and `resolveLock(lockDraft, g, t.id)` → `resolveLock(draft.locks, g, t.id)` (cell branch).

- [ ] **Step 7: Verify locks still work (regression)**

Run: `npm test` — Expected: PASS (no test touches scoreboard, but confirms nothing broke imports).
Run: `npm run dev`, open `http://localhost:5173/scoreboard.html?lobby=<id>` as admin (join a lobby as admin first via `index.html`). Verify: Edit → toggle a lock (🔒/🔓) on a header and a cell → type a score → Save persists both; Cancel discards. Behavior identical to before.

- [ ] **Step 8: Commit**

```bash
git add ps-offsite-2026/scoreboard.html
git commit -m "refactor(scoreboard): generalize edit draft to {locks,timers,rules}"
```

---

## Task 5: Scoreboard — clock/rules icons, modals, save, reset

Adds the two manual-only controls on top of the Task 4 draft. Leaves the scoreboard fully working: icons appear in edit mode, modals stage into the draft, Save persists, Reset clears timer starts.

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html`

- [ ] **Step 1: Import the new pure-module helpers**

Below the existing `import { resolveLock, ... } from './shared/game-lock.js';` line, add:

```js
import {
  resolveOverride, hasOverride, setGameOverride, setCellOverride,
} from './shared/game-config.js';
```

- [ ] **Step 2: Add CSS for the edit-button row + modals**

In the `<style>` block, after the existing `.lock-btn` rules, add:

```css
.lock-btn { font-size: 14px; }                 /* was 16px — make room for the row */
.edit-btns { display: flex; flex-wrap: wrap; gap: 2px; justify-content: center; margin-top: 4px; }
.cfg-btn {
  background: transparent; border: none; cursor: pointer;
  font-size: 12px; line-height: 1; padding: 2px 3px; opacity: 0.7; color: var(--text);
  font-family: inherit;
}
.cfg-btn:hover { opacity: 1; transform: scale(1.1); }
.cfg-btn.set { opacity: 1; color: var(--accent); font-weight: 800; }

.modal-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.modal-box {
  background: var(--card); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 14px; padding: 24px; width: min(460px, 92vw); box-shadow: var(--shadow);
}
.modal-box h2 { font-size: 18px; margin-bottom: 16px; }
.modal-body label {
  display: block; font-size: 13px; color: var(--muted);
  margin-bottom: 8px; text-transform: uppercase; letter-spacing: 1px;
}
.modal-body input, .modal-body textarea {
  width: 100%; background: var(--bg-2); color: var(--text);
  border: 1px solid rgba(255,255,255,0.12); border-radius: 10px;
  padding: 12px; font-size: 16px; font-family: inherit;
}
.modal-body textarea { resize: vertical; min-height: 140px; line-height: 1.5; }
.modal-actions { display: flex; gap: 10px; margin-top: 18px; justify-content: flex-end; }
```

- [ ] **Step 3: Add an editButtonsHtml helper**

Add this function near `render` (e.g. just above it):

```js
// Build the edit-mode button row for a game header (teamId undefined) or a cell.
function editButtonsHtml(g, teamId) {
  const isCell = teamId !== undefined;
  const lockState = isCell ? resolveLock(draft.locks, g, teamId) : resolveGameLock(draft.locks, g);
  const lockIcon = lockState === 'locked' ? '🔒' : '🔓';
  const lockTitle = lockState === 'locked'
    ? (isCell ? 'Locked for this team — click to unlock' : 'Locked for all teams — click to unlock')
    : (isCell ? 'Unlocked for this team — click to lock' : 'Unlocked for all teams — click to lock');
  const teamAttr = isCell ? ` data-team="${teamId}"` : '';
  let html = `<button class="lock-btn" data-game="${g}"${teamAttr} title="${lockTitle}">${lockIcon}</button>`;
  if (GAMES[g].kind === 'manual') {
    const mins = resolveOverride(draft.timers, g, teamId);
    const minsSet = hasOverride(draft.timers, g, teamId);
    const clockLabel = minsSet ? `⏱${mins}` : '⏱';
    html += `<button class="cfg-btn clock-btn ${minsSet ? 'set' : ''}" data-game="${g}"${teamAttr} title="Set time limit (minutes)">${clockLabel}</button>`;
    const rulesSet = hasOverride(draft.rules, g, teamId);
    html += `<button class="cfg-btn rules-btn ${rulesSet ? 'set' : ''}" data-game="${g}"${teamAttr} title="Edit rules / hint">📋</button>`;
  }
  return `<span class="edit-btns">${html}</span>`;
}
```

- [ ] **Step 4: Use editButtonsHtml in render (header + cell editing branches)**

In `render`, replace the header editing branch (currently builds the `lk-${gs}` div with a single lock button) with:

```js
if (editing) {
  const gs = resolveGameLock(draft.locks, g);
  return `<div class="cell-game ${cls} lk-${gs}">${escapeHtml(GAMES[g].name)}<br><span class="game-status ${cls}">${label}</span><br>${editButtonsHtml(g)}</div>`;
}
```

Replace the cell editing branch (currently builds `.cell-game edit ${cs}` with input + single lock button) with:

```js
if (editing) {
  const cs = resolveLock(draft.locks, g, t.id);
  const typed = pendingScores?.[String(t.id)]?.[g];
  const val = typed !== undefined ? typed : (v ?? '');
  return `<div class="cell-game edit ${cs}"><input class="cell-input" type="number" min="0" step="1" inputmode="numeric" data-team="${t.id}" data-game="${g}" value="${escapeHtml(String(val))}" placeholder="-">${editButtonsHtml(g, t.id)}</div>`;
}
```

- [ ] **Step 5: Wire clock/rules buttons in wireEditButtons**

At the end of `wireEditButtons` (after the existing `.lock-btn` loop), add:

```js
for (const btn of document.querySelectorAll('.clock-btn')) {
  btn.addEventListener('click', () => openClockModal(btn.dataset.game, btn.dataset.team));
}
for (const btn of document.querySelectorAll('.rules-btn')) {
  btn.addEventListener('click', () => openRulesModal(btn.dataset.game, btn.dataset.team));
}
```

- [ ] **Step 6: Add the modal functions**

Add near `wireEditButtons`:

```js
function openModal({ title, bodyHtml, onConfirm }) {
  const overlay = document.createElement('div');
  overlay.className = 'modal-overlay';
  overlay.innerHTML = `
    <div class="modal-box">
      <h2>${title}</h2>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions">
        <button id="modalCancel">Cancel</button>
        <button class="primary" id="modalConfirm">Confirm</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#modalCancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#modalConfirm').addEventListener('click', () => { onConfirm(); close(); });
  const field = overlay.querySelector('#cfgInput');
  if (field) field.focus();
}

// Prefill with the OWN-LEVEL override only (not the resolved cell>game value), so
// clearing removes exactly this level and the modal never silently pins an
// inherited value.
function openClockModal(g, teamRaw) {
  const teamId = teamRaw !== undefined ? Number(teamRaw) : undefined;
  const cur = teamId !== undefined ? draft.timers?.cells?.[g]?.[teamId] : draft.timers?.games?.[g];
  const level = teamId !== undefined ? `Team ${teamId}` : 'all teams';
  openModal({
    title: `⏱ Time limit · ${escapeHtml(GAMES[g].name)} · ${level}`,
    bodyHtml: `<label>Minutes (blank or 0 = no limit)</label>
      <input id="cfgInput" type="number" min="1" step="1" inputmode="numeric" value="${cur != null ? escapeHtml(String(cur)) : ''}">`,
    onConfirm: () => {
      const val = Number(document.getElementById('cfgInput').value);
      captureScoreInputs();
      if (teamId !== undefined) setCellOverride(draft.timers, g, teamId, val);
      else setGameOverride(draft.timers, g, val);
      dirty.timers = true;
      render();
    },
  });
}

function openRulesModal(g, teamRaw) {
  const teamId = teamRaw !== undefined ? Number(teamRaw) : undefined;
  const cur = teamId !== undefined ? draft.rules?.cells?.[g]?.[teamId] : draft.rules?.games?.[g];
  const level = teamId !== undefined ? `Team ${teamId} (hint)` : 'all teams';
  openModal({
    title: `📋 Rules · ${escapeHtml(GAMES[g].name)} · ${level}`,
    bodyHtml: `<label>Rules text (blank = use default)</label>
      <textarea id="cfgInput" placeholder="${escapeHtml(GAMES[g].rules || '')}">${cur != null ? escapeHtml(String(cur)) : ''}</textarea>`,
    onConfirm: () => {
      const val = document.getElementById('cfgInput').value.trim();
      captureScoreInputs();
      if (teamId !== undefined) setCellOverride(draft.rules, g, teamId, val);
      else setGameOverride(draft.rules, g, val);
      dirty.rules = true;
      render();
    },
  });
}
```

- [ ] **Step 7: Persist timers/rules on Save**

In `saveEdits`, directly after the `if (dirty.locks) ...` write line, add:

```js
if (dirty.timers) await set(ref(db, `${LOBBY_PATH}/timers`), draft.timers);
if (dirty.rules) await set(ref(db, `${LOBBY_PATH}/rules`), draft.rules);
```

- [ ] **Step 8: Update the edit-mode subtitle copy**

In `render`, find the editing subtitle string `Editing raw scores · clear a cell to remove · Save to apply` and replace it with:

```js
`Editing scores · clock/rules per game & team (manual) · clear a cell to remove · Save to apply`
```

- [ ] **Step 9: Clear timerStarts on Reset**

In `resetAll`, after the two existing `set(... /scores, null)` and `set(... /history, null)` writes, add:

```js
await set(ref(db, `${LOBBY_PATH}/timerStarts`), null);
```

- [ ] **Step 10: Verify manually**

Run: `npm test` — Expected: PASS (regression).
Run: `npm run dev`, open scoreboard as admin → Edit. Verify:
- ⏱ and 📋 buttons appear ONLY on manual-game columns/cells, never on the 4 playable columns; the 🔒 lock button still appears everywhere.
- Clicking ⏱ on a manual header → modal → enter `15` → Confirm → header clock shows `⏱15` (tinted). Typed scores in other cells are NOT lost.
- Clicking 📋 → textarea shows the catalog rules as greyed placeholder, empty value → type a hint → Confirm → icon tints.
- Save → reload page → reopen Edit → the `⏱15` and the rules override are still there (persisted).
- Clear: open ⏱, blank the field, Confirm → override removed after Save.
- Reset (with confirm) wipes scores; reopening a timed game later starts a fresh countdown (verified in Task 7).

- [ ] **Step 11: Commit**

```bash
git add ps-offsite-2026/scoreboard.html
git commit -m "feat(scoreboard): manual-game time-limit + rules editing in edit mode"
```

---

## Task 6: Player library — timer badge + warning-modal interception

**Files:**
- Modify: `ps-offsite-2026/games.html`

- [ ] **Step 1: Import resolveTimer**

Below `import { resolveLock } from './shared/game-lock.js';`, add:

```js
import { resolveTimer } from './shared/game-config.js';
```

- [ ] **Step 2: Add CSS for the badge + warning modal**

In the `<style>` block, after the `.tile .lock-badge` rule, add:

```css
.tile .timer-badge {
  position: absolute; top: 10px; left: 12px;
  font-size: 12px; font-weight: 800; color: var(--accent);
  background: rgba(0,212,255,0.12); padding: 2px 7px; border-radius: 999px;
}
.tile.timed { cursor: pointer; }

.tw-overlay {
  position: fixed; inset: 0; background: rgba(0,0,0,0.6);
  display: flex; align-items: center; justify-content: center; z-index: 200;
}
.tw-box {
  background: var(--card); border: 1px solid rgba(255,255,255,0.12);
  border-radius: 14px; padding: 26px; width: min(440px, 92vw); text-align: center;
}
.tw-box h2 { font-size: 20px; margin-bottom: 12px; }
.tw-box p { color: var(--muted); line-height: 1.6; margin-bottom: 20px; font-size: 15px; }
.tw-box strong { color: var(--text); }
.tw-actions { display: flex; gap: 10px; justify-content: center; }
.tw-actions button {
  background: var(--card); border: 1px solid rgba(255,255,255,0.12); color: var(--text);
  padding: 12px 18px; border-radius: 10px; font-size: 16px; font-weight: 700;
  cursor: pointer; font-family: inherit;
}
.tw-actions button.go { background: linear-gradient(135deg, var(--accent), #0099cc); border: none; color: #001; }
```

- [ ] **Step 3: Track the timers node**

Find `let currentLocks = null;` and add below it:

```js
let currentTimers = null;
```

- [ ] **Step 4: Add the timers listener**

After the existing `onValue(ref(db, `lobbies/${session.lobbyId}/locks`), ...)` block, add:

```js
onValue(ref(db, `lobbies/${session.lobbyId}/timers`), snap => {
  currentTimers = snap.exists() ? snap.val() : null;
  render();
});
```

- [ ] **Step 5: Compute timed state + badge in render, render timed tiles as divs**

In `render`, inside the `Object.entries(GAMES).map(([key, g]) => {` body, after the line `const lockBadge = lockedTile ? ... : '';`, add:

```js
const mins = (g.kind === 'manual' && !lockedTile && score === undefined)
  ? resolveTimer(currentTimers, key, session.teamId) : undefined;
const timed = mins !== undefined;
const timerBadge = timed ? `<div class="timer-badge" title="Time limit">⏱ ${mins}m</div>` : '';
```

Then change the element-type decision. Replace:

```js
const isDiv = g.kind === 'soon' || lockedTile;
const open = isDiv ? '<div' : '<a';
const close = isDiv ? '</div>' : '</a>';
const hrefAttr = href ? ` href="${href}"` : '';
```

with:

```js
const isDiv = g.kind === 'soon' || lockedTile || timed;
const open = isDiv ? '<div' : '<a';
const close = isDiv ? '</div>' : '</a>';
// timed tiles carry the destination in data-href; a click handler shows the warning modal.
const hrefAttr = timed ? ` data-href="${href}" data-name="${esc(g.name)}" data-mins="${mins}"` : (href ? ` href="${href}"` : '');
const tileCls2 = timed ? `${tileCls} timed` : tileCls;
```

Update the returned template's class + emoji line to use `tileCls2` and include `timerBadge`. Replace the `return \`${open} class="tile ${tileCls}"${hrefAttr}>` opening and the badges section so the template reads:

```js
return `${open} class="tile ${tileCls2}"${hrefAttr}>
  <div class="tile-emoji">${g.emoji}</div>
  <h3>${esc(g.name)}</h3>
  ${scoreLine}
  ${tag2}
  ${tick}
  ${lockBadge}
  ${timerBadge}
${close}`;
```

- [ ] **Step 6: Wire the warning modal after grid render**

At the end of `render`, after `grid.innerHTML = html;`, add:

```js
for (const el of grid.querySelectorAll('.tile.timed')) {
  el.addEventListener('click', () => openTimeWarning(el.dataset.href, el.dataset.name, el.dataset.mins));
}
```

And add this function (top-level in the module, e.g. after `render`):

```js
function openTimeWarning(href, name, mins) {
  const overlay = document.createElement('div');
  overlay.className = 'tw-overlay';
  overlay.innerHTML = `
    <div class="tw-box">
      <h2>⏱ ${esc(name)} has a ${esc(mins)}-minute limit</h2>
      <p>Entering starts your countdown <strong>now</strong>. You must submit your score before it reaches 0, or you'll be recorded a <strong>0</strong>.</p>
      <div class="tw-actions">
        <button id="twCancel">Cancel</button>
        <button class="go" id="twGo">Enter game</button>
      </div>
    </div>`;
  document.body.appendChild(overlay);
  const close = () => overlay.remove();
  overlay.querySelector('#twCancel').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('#twGo').addEventListener('click', () => { location.href = href; });
}
```

- [ ] **Step 7: Verify manually**

Run: `npm run dev`. As admin, set a 1-minute limit on a manual game (e.g. Cipher) for all teams; Save. As a team (join lobby, unlock that game), open `games.html`. Verify:
- Cipher tile shows a `⏱ 1m` badge.
- Clicking the tile does NOT navigate immediately — it shows the warning modal. Cancel stays; "Enter game" navigates to `manual.html?key=SF...`.
- A locked game still shows locked and does not open the warning (lock wins).
- A game the team already submitted shows the ✓ + score and links straight through (no warning), even if it has a limit.

- [ ] **Step 8: Commit**

```bash
git add ps-offsite-2026/games.html
git commit -m "feat(games): timed-tile badge + entry warning modal"
```

---

## Task 7: Manual detail — live rules, countdown, auto-0

Full rewrite of the `manual.html` module script (the timer flow is tightly coupled to render and submit, so a partial edit would leave a non-working page). The new script keeps all existing behavior for non-timed games and adds the timer flow for timed ones.

**Files:**
- Modify: `ps-offsite-2026/games/manual.html` (replace the entire `<script type="module"> ... </script>` block)
- Add CSS to the `<style>` block.

- [ ] **Step 1: Add countdown CSS**

In the `<style>` block, after the `.banner.bad` rule, add:

```css
.countdown {
  background: var(--card); border: 1px solid rgba(0,212,255,0.4);
  border-radius: 14px; padding: 16px; margin-bottom: 20px;
  font-size: 30px; font-weight: 900; text-align: center; letter-spacing: 1px;
  color: var(--accent); font-variant-numeric: tabular-nums;
}
.countdown.low { color: var(--bad); border-color: rgba(255,77,109,0.6); }
```

- [ ] **Step 2: Replace the module script**

Replace the entire `<script type="module"> ... </script>` block at the bottom of `manual.html` with:

```html
<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, get, set, update, push, onValue } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { resolveSession } from '../shared/lobby.js';
import { isGameLockedFor, renderLockedScreen } from '../shared/game-gate.js';
import { mountTopbar } from '../shared/topbar.js';
import { getGame } from '../shared/games-catalog.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
import { resolveTimer, resolveRule, deadlineFor, isExpired, formatMMSS } from '../shared/game-config.js';

const session = resolveSession();
if (!session) {
  location.replace('../index.html');
  throw new Error('no session');
}
mountTopbar({ activePage: 'games' });

const params = new URLSearchParams(location.search);
const key = params.get('key');
const game = getGame(key);

const container = document.getElementById('container');
const catalogHref = `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

if (!game || game.kind !== 'manual') {
  container.innerHTML = `
    <h1>Unknown game</h1>
    <p style="color:#8b95b5;margin-top:10px">No manual game registered for key <code>${esc(key ?? '(none)')}</code>.</p>
    <a class="back-link" href="${catalogHref}">← Back to catalog</a>
  `;
  throw new Error('unknown manual game');
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const writer = firebaseWriter({ db, ref, update, push });

const scorePath = `lobbies/${session.lobbyId}/scores/${session.teamId}/${key}`;
const startPath = `lobbies/${session.lobbyId}/timerStarts/${key}/${session.teamId}`;

// --- timer state
let minutes;            // resolved limit (positive number) or undefined
let startTs = null;     // ms epoch of entry, for timed games
let timerId = null;
let settled = false;    // one-shot latch for timed games (coordinates submit vs auto-0)
let currentRules = null;

function settle() {
  if (settled) return false;
  settled = true;
  if (timerId !== null) { clearInterval(timerId); timerId = null; }
  return true;
}

function renderRules(text) {
  const blocks = String(text || '').split(/\n\s*\n/);
  return blocks.map(b => {
    const lines = b.split('\n');
    if (lines.every(l => l.startsWith('- '))) {
      return `<ul>${lines.map(l => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
    }
    return `<p>${esc(b.replace(/\n/g, ' '))}</p>`;
  }).join('');
}

// Re-render ONLY the rules block (live admin edits must not wipe the score input
// or the countdown). No-op until the shell exists.
function renderRulesBlock() {
  const el = container.querySelector('.rules');
  if (!el) return;
  el.innerHTML = renderRules(resolveRule(currentRules, key, session.teamId, game.rules));
}

// Build the page shell once. mode: 'normal' | 'countdown' | 'readonly' | 'expired'.
function renderShell(current, mode) {
  const submitted = current !== null;
  const readOnly = mode === 'readonly' || mode === 'expired';
  const showCountdown = mode === 'countdown' || mode === 'expired';
  const btnLabel = submitted ? 'Resubmit' : 'Submit score';
  container.innerHTML = `
    <div class="head">
      <div class="emoji">${game.emoji}</div>
      <h1>${esc(game.name)}</h1>
    </div>
    <div class="countdown" ${showCountdown ? '' : 'hidden'} id="countdown"></div>
    <div class="rules"></div>
    <div class="panel">
      ${submitted ? `<div class="current">Currently submitted: <strong>${esc(String(current))}</strong> pts</div>` : ''}
      <label for="score">${submitted ? 'Resubmit raw score' : 'Raw score'}</label>
      <input id="score" type="number" min="0" step="1" inputmode="numeric" value="${submitted ? esc(String(current)) : ''}" ${readOnly ? 'disabled' : ''} />
      <button id="submitBtn" ${readOnly ? 'disabled' : ''}>${btnLabel}</button>
      <div id="banner"></div>
      <a class="back-link" href="${catalogHref}">← Back to catalog</a>
    </div>
  `;
  renderRulesBlock();
  wireSubmit();
}

function wireSubmit() {
  const input = document.getElementById('score');
  const btn = document.getElementById('submitBtn');
  const banner = document.getElementById('banner');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const raw = parseInt(input.value, 10);
    if (!Number.isFinite(raw) || raw < 0) {
      banner.className = 'banner bad';
      banner.textContent = 'Enter a non-negative integer.';
      return;
    }
    // Timed games: settle FIRST (sync, before any await) to win the race vs the
    // interval auto-0. Non-timed games never settle (resubmit stays allowed).
    if (minutes) {
      if (!settle()) return; // auto-0 already fired
    }
    btn.disabled = true;
    banner.className = '';
    banner.textContent = '';
    try {
      if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: key })) {
        banner.className = 'banner bad';
        banner.textContent = 'Locked — score not saved.';
        if (minutes) { settled = false; } // re-arm
        btn.disabled = false;
        return;
      }
      const late = minutes && isExpired(startTs, minutes, Date.now());
      const toSave = late ? 0 : raw;
      const saved = await submitScore({
        writer, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: key, score: toSave,
      });
      banner.className = late ? 'banner bad' : 'banner ok';
      banner.innerHTML = late
        ? `⏱ Time's up — <strong>0</strong> recorded.`
        : `Saved <strong>${esc(String(saved))}</strong> pts.`;
      const cd = document.getElementById('countdown');
      if (cd) cd.hidden = true;
      // Timed game: keep input disabled (one-shot). Non-timed: re-enable for resubmit.
    } catch (e) {
      banner.className = 'banner bad';
      banner.textContent = 'Save failed: ' + (e.message || 'unknown error');
      if (minutes) { settled = false; }
      btn.disabled = false;
    } finally {
      if (!minutes) btn.disabled = false;
    }
  });
}

async function autoZero() {
  if (!settle()) return;
  try {
    await submitScore({ writer, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: key, score: 0 });
  } catch (e) {
    console.error('auto-0 failed', e);
  }
  const banner = document.getElementById('banner');
  const input = document.getElementById('score');
  const btn = document.getElementById('submitBtn');
  const cd = document.getElementById('countdown');
  if (cd) { cd.classList.add('low'); cd.textContent = "⏱ Time's up"; }
  if (input) input.disabled = true;
  if (btn) btn.disabled = true;
  if (banner) { banner.className = 'banner bad'; banner.innerHTML = `⏱ Time's up — <strong>0</strong> recorded.`; }
}

function startCountdown() {
  const tick = () => {
    const remaining = deadlineFor(startTs, minutes) - Date.now();
    const cd = document.getElementById('countdown');
    if (cd) {
      cd.hidden = false;
      cd.textContent = `⏱ ${formatMMSS(remaining)} left`;
      cd.classList.toggle('low', remaining <= 30000);
    }
    if (remaining <= 0) autoZero();
  };
  tick();
  timerId = setInterval(tick, 1000);
}

// Live rules listener (the only realtime listener on this page).
onValue(ref(db, `lobbies/${session.lobbyId}/rules`), snap => {
  currentRules = snap.exists() ? snap.val() : null;
  renderRulesBlock();
});

(async () => {
  if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: key })) {
    renderLockedScreen(catalogHref);
    return;
  }
  // Read score + timers ONCE at boot (already-played branch and the limit are
  // decided at entry).
  const [scoreSnap, timersSnap] = await Promise.all([
    get(ref(db, scorePath)),
    get(ref(db, `lobbies/${session.lobbyId}/timers`)),
  ]);
  const current = scoreSnap.exists() ? scoreSnap.val() : null;
  const timers = timersSnap.exists() ? timersSnap.val() : null;
  minutes = resolveTimer(timers, key, session.teamId);

  // Score-first: a team that already played keeps its result; never stamp a start.
  if (current !== null) {
    renderShell(current, minutes ? 'readonly' : 'normal');
    return;
  }
  if (!minutes) {
    renderShell(null, 'normal');
    return;
  }
  // Timed, no score yet: establish/reuse the refresh-proof start timestamp.
  const startSnap = await get(ref(db, startPath));
  if (startSnap.exists()) {
    startTs = startSnap.val();
  } else {
    startTs = Date.now();
    await set(ref(db, startPath), startTs);
  }
  if (isExpired(startTs, minutes, Date.now())) {
    renderShell(null, 'expired');
    autoZero();
  } else {
    renderShell(null, 'countdown');
    startCountdown();
  }
})();
</script>
```

- [ ] **Step 3: Run the suite (regression)**

Run: `npm test`
Expected: PASS (no manual.html tests, but confirms imports resolve).

- [ ] **Step 4: Verify manually — non-timed game unchanged**

Run: `npm run dev`. As a team, open an unlocked manual game with NO limit. Verify it behaves exactly as before: rules render, submit works, resubmit works.

- [ ] **Step 5: Verify manually — timed game countdown + refresh-proof + late-0**

As admin set a 1-minute limit on Cipher (all teams), Save. As a team, enter via the warning modal. Verify:
- A live `⏱ 0:59 left` countdown ticks down at the top; turns red under 30s.
- **Refresh the page** mid-countdown → the countdown resumes from where it was (no reset), proving the DB start timestamp is reused.
- Submit a score before 0 → "Saved N pts"; reopening shows read-only "already played" (no resubmit on a timed game).
- New team, enter, let the countdown hit 0 without submitting → input locks, "⏱ Time's up — 0 recorded", and the scoreboard shows 0 for that team/game.
- New team, enter, wait past 0, then refresh → loads straight into "Time's up — 0 recorded" (expired-on-arrival auto-0).
- Live rules: while a team sits on the page, admin edits that game's rules and Saves → the rules block updates without a refresh, and the score input / countdown are preserved.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/games/manual.html
git commit -m "feat(manual): live rules + refresh-proof countdown + auto-0"
```

---

## Task 8: Final verification — full suite + build + smoke

**Files:** none (verification only).

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: PASS — all suites including `game-config.test.js`.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: build succeeds, `dist/` written, no new entry points needed (scoreboard/games/manual already in `vite.config.js`).

- [ ] **Step 3: End-to-end smoke (dev or preview)**

Run: `npm run dev`. Walk the full flow once: create lobby → join as admin → Edit → set a time limit + a rules override on one manual game (game level) and a per-team override on another (cell level) → Save. Join as a team, unlock those games. Confirm: ⏱ badge in library, warning modal on entry, countdown on detail, refresh-proof, auto-0 at expiry, per-team rule override shows only for that team, per-team time limit applies only to that team. Confirm playable games are completely unaffected (no icons, no countdown).

- [ ] **Step 4: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "chore(timers-rules): verification pass"
```

---

## Notes for the implementer

- **Pure module is the only unit-tested code.** The three HTML pages have no DOM test harness in this repo (vitest covers `shared/*.js` logic only), so their tasks rely on `npm test` for regression + the explicit manual smoke steps. Do not skip the manual steps.
- **Enforcement is client-side advisory** (open Firebase rules, no auth) — matches the existing locks/scores posture. Do not add Firebase Auth or rules changes; out of scope.
- **Known benign gap:** a team that enters a timed game then closes the tab before 0 and never returns is not auto-zeroed; it simply has no score = 0 rank points (≤ an auto-0), so no advantage. Documented in the spec's non-goals; do not "fix" it.
- **Single-settle latch only applies to timed games.** Non-timed manual games must keep allowing resubmit (no `settle()`).
- Match the existing code style: 2-space indent, no semicolyon-free lines, vanilla DOM, `esc`/`escapeHtml` on all interpolated user/admin text.
```
