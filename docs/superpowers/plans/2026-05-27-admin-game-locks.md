# Admin Game Locks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin lock/unlock games from the scoreboard at three granularities (all / per-game / per-team-game), defaulting to all-locked so teams cannot enter a game until the host opens it.

**Architecture:** A new pure module `shared/game-lock.js` holds all lock state resolution (precedence: cell > game > all, default `"locked"`) and cascade-clear write helpers, fully unit-tested. A thin glue module `shared/game-gate.js` reads the lock node from Firebase and renders a locked screen, reused by every game page. The scoreboard gains edit-mode-only lock controls staged alongside score edits and applied on Save; `games.html` shows locked tiles live; each game page blocks entry on load and blocks submission as a guard.

**Tech Stack:** Vanilla JS (ES modules), Firebase Realtime Database, Vite, Vitest. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-05-27-admin-game-locks-design.md`

---

## File Structure

- **Create** `ps-offsite-2026/shared/game-lock.js` — pure lock resolution + write/toggle helpers. No Firebase imports.
- **Create** `tests/game-lock.test.js` — unit tests for the pure module.
- **Create** `ps-offsite-2026/shared/game-gate.js` — Firebase glue: `isGameLockedFor()` + `renderLockedScreen()`. No unit test (thin glue, mirrors `shared/admin-gate.js`).
- **Modify** `ps-offsite-2026/scoreboard.html` — edit-mode lock controls (ALL / per-game / per-cell), staged-with-Save, Reset moved into edit mode, cell/header tint, CSS.
- **Modify** `ps-offsite-2026/games.html` — locks listener + locked tiles.
- **Modify** `ps-offsite-2026/games/3-dino.js`, `4-flappy.js`, `1-gesture-lock.html`, `2-pantomime.html`, `games/manual.html` — load-time gate + submit-time guard.

No `vite.config.js` change (no new HTML entry points).

---

## Task 1: Pure lock module `shared/game-lock.js` (TDD)

**Files:**
- Create: `ps-offsite-2026/shared/game-lock.js`
- Test: `tests/game-lock.test.js`

- [ ] **Step 1: Write the failing test**

Create `tests/game-lock.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  resolveLock, resolveGameLock, resolveAllLock, isUnlocked,
  setAll, setGame, setCell, toggleAll, toggleGame, toggleCell,
  LOCKED, UNLOCKED,
} from '../ps-offsite-2026/shared/game-lock.js';

describe('resolveLock precedence', () => {
  it('cell overrides game overrides all', () => {
    const locks = {
      all: UNLOCKED,
      games: { GZ: LOCKED },
      cells: { GZ: { 3: UNLOCKED } },
    };
    expect(resolveLock(locks, 'GZ', 3)).toBe(UNLOCKED); // cell wins
    expect(resolveLock(locks, 'GZ', 1)).toBe(LOCKED);   // game wins (no cell)
    expect(resolveLock(locks, 'PM', 1)).toBe(UNLOCKED); // all wins (no game/cell)
  });
});

describe('resolveLock defaults to locked on absent node / level', () => {
  it('returns LOCKED for undefined locks', () => {
    expect(resolveLock(undefined, 'GZ', 1)).toBe(LOCKED);
  });
  it('returns LOCKED for empty object', () => {
    expect(resolveLock({}, 'GZ', 1)).toBe(LOCKED);
  });
  it('returns LOCKED when games map present but key absent', () => {
    expect(resolveLock({ games: {} }, 'GZ', 1)).toBe(LOCKED);
  });
  it('returns LOCKED when cells map present but game/team absent', () => {
    expect(resolveLock({ cells: { GZ: {} } }, 'GZ', 1)).toBe(LOCKED);
  });
});

describe('missing teamId degrades to game/all level', () => {
  it('ignores cell overrides when teamId is undefined', () => {
    const locks = { all: UNLOCKED, cells: { GZ: { 3: LOCKED } } };
    expect(resolveLock(locks, 'GZ', undefined)).toBe(UNLOCKED); // no crash, no phantom match
  });
});

describe('resolveGameLock / resolveAllLock', () => {
  it('resolveGameLock ignores cells', () => {
    const locks = { all: LOCKED, games: { GZ: UNLOCKED }, cells: { GZ: { 1: LOCKED } } };
    expect(resolveGameLock(locks, 'GZ')).toBe(UNLOCKED);
    expect(resolveGameLock(locks, 'PM')).toBe(LOCKED); // falls to all
  });
  it('resolveAllLock defaults to locked', () => {
    expect(resolveAllLock(undefined)).toBe(LOCKED);
    expect(resolveAllLock({ all: UNLOCKED })).toBe(UNLOCKED);
  });
});

describe('isUnlocked', () => {
  it('is true only when resolved state is unlocked', () => {
    expect(isUnlocked({ all: UNLOCKED }, 'GZ', 1)).toBe(true);
    expect(isUnlocked({}, 'GZ', 1)).toBe(false);
  });
});

describe('cascade-clear writes against a draft cloned from an absent node', () => {
  it('setAll sets baseline and clears games + cells', () => {
    const draft = { all: LOCKED, games: { GZ: UNLOCKED }, cells: { GZ: { 1: UNLOCKED } } };
    setAll(draft, UNLOCKED);
    expect(draft).toEqual({ all: UNLOCKED, games: {}, cells: {} });
  });
  it('setGame on empty draft lazily creates games and clears that game cells', () => {
    const draft = {};
    setGame(draft, 'GZ', UNLOCKED);
    expect(draft.games).toEqual({ GZ: UNLOCKED });
    const draft2 = { cells: { GZ: { 1: LOCKED }, PM: { 2: LOCKED } } };
    setGame(draft2, 'GZ', LOCKED);
    expect(draft2.games).toEqual({ GZ: LOCKED });
    expect(draft2.cells).toEqual({ PM: { 2: LOCKED } }); // only GZ cells cleared
  });
  it('setCell on empty draft lazily creates nested maps', () => {
    const draft = {};
    setCell(draft, 'GZ', 3, UNLOCKED);
    expect(draft.cells).toEqual({ GZ: { 3: UNLOCKED } });
  });
});

describe('toggles flip resolved state at their level', () => {
  it('toggleAll flips baseline and clears specifics', () => {
    const draft = { games: { GZ: UNLOCKED } };
    toggleAll(draft); // resolved all = locked (absent) -> unlocked
    expect(draft).toEqual({ all: UNLOCKED, games: {}, cells: {} });
  });
  it('toggleGame flips game-resolved state', () => {
    const draft = { all: UNLOCKED };
    toggleGame(draft, 'GZ'); // resolved game = unlocked (from all) -> locked
    expect(draft.games.GZ).toBe(LOCKED);
  });
  it('toggleCell flips cell-resolved state', () => {
    const draft = { all: LOCKED };
    toggleCell(draft, 'GZ', 3); // resolved cell = locked -> unlocked
    expect(draft.cells.GZ[3]).toBe(UNLOCKED);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game-lock.test.js`
Expected: FAIL — `Failed to resolve import "../ps-offsite-2026/shared/game-lock.js"`.

- [ ] **Step 3: Write the module**

Create `ps-offsite-2026/shared/game-lock.js`:

```js
// ps-offsite-2026/shared/game-lock.js
// Pure lock-state resolution + cascade-clear write helpers. No Firebase imports.
//
// Stored shape (Firebase node lobbies/{lobbyId}/locks):
//   { all: "locked"|"unlocked",
//     games: { [gameKey]: "locked"|"unlocked" },
//     cells: { [gameKey]: { [teamId]: "locked"|"unlocked" } } }
// Absent node / level => "locked" (default). Precedence: cell > game > all.

export const LOCKED = 'locked';
export const UNLOCKED = 'unlocked';

// Optional chaining is REQUIRED: `??` only guards null/undefined VALUES, not
// missing intermediate objects, so `cells[k][t]` would throw on the common
// (absent-node) case. teamId undefined => cell branch is undefined => degrades.
export function resolveLock(locks, gameKey, teamId) {
  return locks?.cells?.[gameKey]?.[teamId]
    ?? locks?.games?.[gameKey]
    ?? locks?.all
    ?? LOCKED;
}

export function resolveGameLock(locks, gameKey) {
  return locks?.games?.[gameKey] ?? locks?.all ?? LOCKED;
}

export function resolveAllLock(locks) {
  return locks?.all ?? LOCKED;
}

export function isUnlocked(locks, gameKey, teamId) {
  return resolveLock(locks, gameKey, teamId) === UNLOCKED;
}

function flip(value) {
  return value === UNLOCKED ? LOCKED : UNLOCKED;
}

// Cascade-clear writes: a lower-level write wipes more-specific overrides below.
// All mutate `draft` in place and return it. They lazily create nested objects
// because the draft is cloned from a possibly-absent node.
export function setAll(draft, value) {
  draft.all = value;
  draft.games = {};
  draft.cells = {};
  return draft;
}

export function setGame(draft, gameKey, value) {
  draft.games ??= {};
  draft.games[gameKey] = value;
  if (draft.cells) delete draft.cells[gameKey];
  return draft;
}

export function setCell(draft, gameKey, teamId, value) {
  draft.cells ??= {};
  draft.cells[gameKey] ??= {};
  draft.cells[gameKey][teamId] = value;
  return draft;
}

// Toggles flip the current RESOLVED state at their level, then cascade-write.
export function toggleAll(draft) {
  return setAll(draft, flip(resolveAllLock(draft)));
}

export function toggleGame(draft, gameKey) {
  return setGame(draft, gameKey, flip(resolveGameLock(draft, gameKey)));
}

export function toggleCell(draft, gameKey, teamId) {
  return setCell(draft, gameKey, teamId, flip(resolveLock(draft, gameKey, teamId)));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/game-lock.test.js`
Expected: PASS — all tests green.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/game-lock.js tests/game-lock.test.js
git commit -m "feat(locks): pure game-lock resolution + cascade-clear helpers"
```

---

## Task 2: Firebase glue `shared/game-gate.js`

Thin glue (reads the lock node, renders a locked screen). No unit test — mirrors the untested `shared/admin-gate.js` glue pattern. Verified by build in Task 6.

**Files:**
- Create: `ps-offsite-2026/shared/game-gate.js`

- [ ] **Step 1: Write the module**

Create `ps-offsite-2026/shared/game-gate.js`:

```js
// ps-offsite-2026/shared/game-gate.js
// Firebase glue around game-lock.js: read the lock node for one (game, team)
// and render a full-page "locked" screen. Caller injects ref/get/db so this
// stays dependency-light and matches the per-page Firebase setup.
import { resolveLock, LOCKED } from './game-lock.js';

// Returns true if the game is locked for this team.
// Fail-open on read error: a transient Firebase read failure should not trap
// teams. (Default-locked still applies when the node is simply ABSENT — that
// path returns a real snapshot whose value resolves to "locked".)
export async function isGameLockedFor({ db, ref, get, lobbyId, teamId, gameKey }) {
  if (!lobbyId) return false;
  try {
    const snap = await get(ref(db, `lobbies/${lobbyId}/locks`));
    const locks = snap.exists() ? snap.val() : null;
    return resolveLock(locks, gameKey, teamId) === LOCKED;
  } catch (e) {
    console.error('lock check failed', e);
    return false;
  }
}

export function renderLockedScreen(catalogHref) {
  document.body.innerHTML = `
    <div style="max-width:560px;margin:80px auto;padding:32px;background:#1b2540;border-radius:16px;border:1px solid rgba(255,255,255,0.06);color:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;text-align:center">
      <div style="font-size:48px;margin-bottom:12px">🔒</div>
      <h1 style="font-size:24px;margin-bottom:12px">Game locked</h1>
      <p style="color:#8b95b5;margin-bottom:20px">This game isn't open for your team right now. The host decides when it unlocks — check the games list.</p>
      <a href="${catalogHref}" style="color:#00d4ff;font-weight:700;text-decoration:none">← Back to games</a>
    </div>`;
}
```

- [ ] **Step 2: Commit**

```bash
git add ps-offsite-2026/shared/game-gate.js
git commit -m "feat(locks): game-gate glue (isGameLockedFor + locked screen)"
```

---

## Task 3: Scoreboard edit-mode lock controls

Adds: live lock state, in-memory `lockDraft` cloned at edit start, ALL/per-game/per-cell toggles (staged), Reset moved into edit mode, cell/header tint, CSS. Scores still read from the DOM at Save; lock changes write the whole `/locks` node only if dirty.

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html`

- [ ] **Step 1: Add CSS for lock buttons + tint**

In `ps-offsite-2026/scoreboard.html`, find the `.cell-input:focus` rule:

```css
  .cell-input:focus { outline: none; border-color: var(--accent); box-shadow: 0 0 0 2px rgba(0,212,255,0.25); }
```

Insert immediately AFTER it:

```css
  .lock-btn {
    background: transparent; border: none; cursor: pointer;
    font-size: 14px; line-height: 1; padding: 2px 4px; margin-top: 4px;
    opacity: 0.85;
  }
  .lock-btn:hover { opacity: 1; transform: scale(1.12); }
  .cell-game.edit.locked .cell-input { border-color: rgba(255,77,109,0.6); box-shadow: inset 0 0 0 1px rgba(255,77,109,0.22); }
  .cell-game.edit.unlocked .cell-input { border-color: rgba(0,230,118,0.55); }
  .matrix-head .cell-game.lk-locked { color: #ff4d6d; }
  .matrix-head .cell-game.lk-unlocked { color: var(--good); }
  .lock-all { white-space: nowrap; }
```

- [ ] **Step 2: Import the lock helpers**

Find:

```js
import { getSession, isAdminSession } from './shared/lobby.js';
```

Add immediately after it:

```js
import {
  resolveLock, resolveGameLock, resolveAllLock,
  toggleAll, toggleGame, toggleCell,
} from './shared/game-lock.js';
```

- [ ] **Step 3: Add lock state module variables**

Find:

```js
let state = { teams: [], history: [] };
let initialized = false;
let editing = false;
let lastUpdate = null;
let connected = true;
```

Replace with:

```js
let state = { teams: [], history: [] };
let initialized = false;
let editing = false;
let lastUpdate = null;
let connected = true;
let locks = null;            // latest live lock node
let lockDraft = null;        // editable clone while editing
let pendingScores = null;    // {teamId: {gameKey: typedValue}} preserved across re-renders
let locksDirty = false;      // only write /locks on Save if a toggle changed it
```

- [ ] **Step 4: Track the live lock node in the onValue handler**

Find:

```js
onValue(ref(db, LOBBY_PATH), snap => {
  lastUpdate = Date.now();
  renderLiveStatus();
  state = snapshotToState(snap);
```

Replace with:

```js
onValue(ref(db, LOBBY_PATH), snap => {
  lastUpdate = Date.now();
  renderLiveStatus();
  locks = snap.val()?.locks ?? null;
  state = snapshotToState(snap);
```

- [ ] **Step 5: Rework `renderControls` — Reset into edit mode + ALL toggle**

Find the whole `renderControls` function:

```js
function renderControls() {
  const controls = document.getElementById('controls');
  controls.innerHTML = '';
  if (!isAdmin) return;
  if (editing) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', saveEdits);
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', cancelEdits);
    controls.append(saveBtn, cancelBtn);
  } else {
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', startEdits);
    const resetBtn = document.createElement('button');
    resetBtn.className = 'danger';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', resetAll);
    controls.append(editBtn, resetBtn);
  }
}
```

Replace with:

```js
function renderControls() {
  const controls = document.getElementById('controls');
  controls.innerHTML = '';
  if (!isAdmin) return;
  if (editing) {
    const saveBtn = document.createElement('button');
    saveBtn.className = 'primary';
    saveBtn.textContent = 'Save';
    saveBtn.addEventListener('click', saveEdits);
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', cancelEdits);
    const allBtn = document.createElement('button');
    allBtn.className = 'lock-all';
    allBtn.textContent = resolveAllLock(lockDraft) === 'locked' ? 'Unlock all' : 'Lock all';
    allBtn.addEventListener('click', () => {
      captureScoreInputs();
      toggleAll(lockDraft);
      locksDirty = true;
      renderControls();
      render();
    });
    const resetBtn = document.createElement('button');
    resetBtn.className = 'danger';
    resetBtn.textContent = 'Reset';
    resetBtn.addEventListener('click', resetAll);
    controls.append(saveBtn, cancelBtn, allBtn, resetBtn);
  } else {
    const editBtn = document.createElement('button');
    editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', startEdits);
    controls.append(editBtn);
  }
}
```

- [ ] **Step 6: Initialise + tear down the draft in start/cancel/save**

Find:

```js
function startEdits() {
  editing = true;
  renderControls();
  render();
}

function cancelEdits() {
  editing = false;
  renderControls();
  render();
}
```

Replace with:

```js
function startEdits() {
  editing = true;
  lockDraft = locks ? JSON.parse(JSON.stringify(locks)) : {};
  pendingScores = {};
  locksDirty = false;
  renderControls();
  render();
}

function cancelEdits() {
  editing = false;
  lockDraft = null;
  pendingScores = null;
  locksDirty = false;
  renderControls();
  render();
}

// Snapshot current score inputs so a lock-toggle re-render doesn't lose typing.
function captureScoreInputs() {
  pendingScores ??= {};
  for (const el of document.querySelectorAll('.cell-input')) {
    (pendingScores[el.dataset.team] ??= {})[el.dataset.game] = el.value;
  }
}

// Wire lock toggle buttons after each editing render (innerHTML wipes listeners).
function wireLockButtons() {
  for (const btn of document.querySelectorAll('.lock-btn')) {
    btn.addEventListener('click', () => {
      captureScoreInputs();
      const g = btn.dataset.game;
      if (btn.dataset.team !== undefined) toggleCell(lockDraft, g, Number(btn.dataset.team));
      else toggleGame(lockDraft, g);
      locksDirty = true;
      render();
    });
  }
}
```

- [ ] **Step 7: Persist lock draft on Save**

Find:

```js
  for (const [path, val] of writes) await set(ref(db, path), val);
  editing = false;
  renderControls();
  render();
}
```

Replace with:

```js
  for (const [path, val] of writes) await set(ref(db, path), val);
  if (locksDirty) await set(ref(db, `${LOBBY_PATH}/locks`), lockDraft);
  editing = false;
  lockDraft = null;
  pendingScores = null;
  locksDirty = false;
  renderControls();
  render();
}
```

- [ ] **Step 8: Render per-game lock toggle in the header**

Find:

```js
  const headCells = gameKeys.map(g => {
    const closed = submittedByGame[g] === teamCount && teamCount > 0;
    const cls = closed ? 'closed' : 'open';
    const label = closed ? 'closed' : `open ${submittedByGame[g]}/${teamCount}`;
    return `<div class="cell-game ${cls}">${escapeHtml(GAMES[g].name)}<br><span class="game-status ${cls}">${label}</span></div>`;
  }).join('');
```

Replace with:

```js
  const headCells = gameKeys.map(g => {
    const closed = submittedByGame[g] === teamCount && teamCount > 0;
    const cls = closed ? 'closed' : 'open';
    const label = closed ? 'closed' : `open ${submittedByGame[g]}/${teamCount}`;
    if (editing) {
      const gs = resolveGameLock(lockDraft, g);
      const icon = gs === 'locked' ? '🔒' : '🔓';
      const title = gs === 'locked' ? 'Locked for all teams — click to unlock' : 'Unlocked for all teams — click to lock';
      return `<div class="cell-game ${cls} lk-${gs}">${escapeHtml(GAMES[g].name)}<br><span class="game-status ${cls}">${label}</span><br><button class="lock-btn" data-game="${g}" title="${title}">${icon}</button></div>`;
    }
    return `<div class="cell-game ${cls}">${escapeHtml(GAMES[g].name)}<br><span class="game-status ${cls}">${label}</span></div>`;
  }).join('');
```

- [ ] **Step 9: Render per-cell lock toggle + tint, using preserved typed values**

Find:

```js
      if (editing) {
        return `<div class="cell-game edit"><input class="cell-input" type="number" min="0" step="1" inputmode="numeric" data-team="${t.id}" data-game="${g}" value="${v ?? ''}" placeholder="-"></div>`;
      }
```

Replace with:

```js
      if (editing) {
        const cs = resolveLock(lockDraft, g, t.id);
        const icon = cs === 'locked' ? '🔒' : '🔓';
        const title = cs === 'locked' ? 'Locked for this team — click to unlock' : 'Unlocked for this team — click to lock';
        const typed = pendingScores?.[String(t.id)]?.[g];
        const val = typed !== undefined ? typed : (v ?? '');
        return `<div class="cell-game edit ${cs}"><input class="cell-input" type="number" min="0" step="1" inputmode="numeric" data-team="${t.id}" data-game="${g}" value="${val}" placeholder="-"><button class="lock-btn" data-game="${g}" data-team="${t.id}" title="${title}">${icon}</button></div>`;
      }
```

- [ ] **Step 10: Wire lock buttons after the editing render**

Find:

```js
  list.innerHTML = head + rows;
  document.getElementById('subtitle').textContent = editing
```

Replace with:

```js
  list.innerHTML = head + rows;
  if (editing) wireLockButtons();
  document.getElementById('subtitle').textContent = editing
```

- [ ] **Step 11: Verify the build compiles**

Run: `npm run build`
Expected: PASS — `dist/` produced, no errors referencing `scoreboard` or `game-lock`.

- [ ] **Step 12: Manual smoke check**

Run: `npm run dev`, open the scoreboard with an admin session (`?lobby=PS-XXXX`), create/join a lobby first if needed. Verify:
- Non-edit: only an **Edit** button (no Reset).
- Click **Edit** → **Save · Cancel · Unlock all · Reset** appear; each game header and each cell shows a 🔒/🔓 button; cells tinted red (locked) by default.
- Type a score in one cell, then toggle a different cell's lock → the typed score is NOT lost.
- Toggle **Unlock all** → all headers/cells turn green/🔓. Toggle a single game's header lock → only that column turns red. Toggle one cell → only that cell turns red.
- **Save** → reload page; lock state persists. **Cancel** on a fresh edit → lock changes discarded.

- [ ] **Step 13: Commit**

```bash
git add ps-offsite-2026/scoreboard.html
git commit -m "feat(locks): scoreboard edit-mode lock controls (all/game/cell) + Reset in edit"
```

---

## Task 4: Locked tiles on `games.html`

**Files:**
- Modify: `ps-offsite-2026/games.html`

- [ ] **Step 1: Add CSS for locked tiles**

In `ps-offsite-2026/games.html`, find:

```css
  .tile.soon   { opacity: 0.4; pointer-events: none; border-style: dashed; }
```

Insert immediately AFTER it:

```css
  .tile.locked { opacity: 0.5; pointer-events: none; border-style: dashed; border-color: rgba(255,77,109,0.4); }
  .tile.locked .tile-tag { background: rgba(255,77,109,0.12); color: #ff4d6d; }
  .tile .lock-badge { position: absolute; top: 10px; left: 12px; font-size: 16px; }
```

- [ ] **Step 2: Import the lock resolver**

Find:

```js
import { GAMES } from './shared/games-catalog.js';
```

Replace with:

```js
import { GAMES } from './shared/games-catalog.js';
import { resolveLock } from './shared/game-lock.js';
```

- [ ] **Step 3: Hold latest scores + locks in module state**

Find:

```js
const grid = document.getElementById('grid');
const subtitle = document.getElementById('subtitle');
```

Replace with:

```js
const grid = document.getElementById('grid');
const subtitle = document.getElementById('subtitle');

let currentScores = null;
let currentLocks = null;
```

- [ ] **Step 4: Rewrite `render` to use module state + lock gating**

Find the whole `render` function:

```js
function render(scoresForTeam) {
  const html = Object.entries(GAMES).map(([key, g]) => {
    const href = tileHref(key, g);
    const tag = g.kind === 'play' ? 'Playable' : g.kind === 'manual' ? 'Manual entry' : 'Coming soon';
    const score = scoresForTeam?.[key];
    const tick = score !== undefined ? '<div class="check" title="Submitted">✓</div>' : '';
    const scoreLine = score !== undefined
      ? `<div class="score-line">Raw: <strong>${esc(String(score))}</strong></div>`
      : '';
    const tag2 = `<span class="tile-tag">${tag}</span>`;
    const open = g.kind === 'soon' ? '<div' : '<a';
    const close = g.kind === 'soon' ? '</div>' : '</a>';
    const hrefAttr = href ? ` href="${href}"` : '';
    return `${open} class="tile ${g.kind}"${hrefAttr}>
      <div class="tile-emoji">${g.emoji}</div>
      <h3>${esc(g.name)}</h3>
      ${scoreLine}
      ${tag2}
      ${tick}
    ${close}`;
  }).join('');
  grid.innerHTML = html;

  const submitted = scoresForTeam ? Object.keys(scoresForTeam).length : 0;
  const total = Object.values(GAMES).filter(g => g.kind !== 'soon').length;
  subtitle.textContent = `Lobby ${session.lobbyId} · Team ${session.teamId} · ${submitted}/${total} games submitted`;
}
```

Replace with:

```js
function render() {
  const scoresForTeam = currentScores;
  const html = Object.entries(GAMES).map(([key, g]) => {
    const lockedTile = g.kind !== 'soon' && resolveLock(currentLocks, key, session.teamId) === 'locked';
    const href = lockedTile ? null : tileHref(key, g);
    const baseTag = g.kind === 'play' ? 'Playable' : g.kind === 'manual' ? 'Manual entry' : 'Coming soon';
    const tag = lockedTile ? 'Locked' : baseTag;
    const score = scoresForTeam?.[key];
    const tick = score !== undefined ? '<div class="check" title="Submitted">✓</div>' : '';
    const scoreLine = score !== undefined
      ? `<div class="score-line">Raw: <strong>${esc(String(score))}</strong></div>`
      : '';
    const lockBadge = lockedTile ? '<div class="lock-badge" title="Locked by host">🔒</div>' : '';
    const tag2 = `<span class="tile-tag">${tag}</span>`;
    const tileCls = lockedTile ? `${g.kind} locked` : g.kind;
    const isDiv = g.kind === 'soon' || lockedTile;
    const open = isDiv ? '<div' : '<a';
    const close = isDiv ? '</div>' : '</a>';
    const hrefAttr = href ? ` href="${href}"` : '';
    return `${open} class="tile ${tileCls}"${hrefAttr}>
      <div class="tile-emoji">${g.emoji}</div>
      <h3>${esc(g.name)}</h3>
      ${scoreLine}
      ${tag2}
      ${tick}
      ${lockBadge}
    ${close}`;
  }).join('');
  grid.innerHTML = html;

  const submitted = scoresForTeam ? Object.keys(scoresForTeam).length : 0;
  const total = Object.values(GAMES).filter(g => g.kind !== 'soon').length;
  subtitle.textContent = `Lobby ${session.lobbyId} · Team ${session.teamId} · ${submitted}/${total} games submitted`;
}
```

- [ ] **Step 5: Subscribe to scores AND locks**

Find:

```js
onValue(ref(db, `lobbies/${session.lobbyId}/scores/${session.teamId}`), snap => {
  render(snap.exists() ? snap.val() : null);
});
```

Replace with:

```js
onValue(ref(db, `lobbies/${session.lobbyId}/scores/${session.teamId}`), snap => {
  currentScores = snap.exists() ? snap.val() : null;
  render();
});

onValue(ref(db, `lobbies/${session.lobbyId}/locks`), snap => {
  currentLocks = snap.exists() ? snap.val() : null;
  render();
});
```

- [ ] **Step 6: Verify build + smoke check**

Run: `npm run build`
Expected: PASS.

Manual: `npm run dev`, open `games.html?lobby=PS-XXXX&team=1`. With no locks set, every playable/manual tile shows greyed + 🔒 + "Locked", not clickable. From the scoreboard, unlock one game → its tile turns clickable live without refresh.

- [ ] **Step 7: Commit**

```bash
git add ps-offsite-2026/games.html
git commit -m "feat(locks): locked tiles on games page, live via locks listener"
```

---

## Task 5: Per-game entry + submit guards

Each game page checks the lock on load (after the already-played check, so already-played wins) and re-checks immediately before submitting (so a lock landing mid-play blocks the write — both the score update and the history push, since the guard wraps the whole `submitScore` call).

**Files:**
- Modify: `ps-offsite-2026/games/3-dino.js`
- Modify: `ps-offsite-2026/games/4-flappy.js`
- Modify: `ps-offsite-2026/games/1-gesture-lock.html`
- Modify: `ps-offsite-2026/games/2-pantomime.html`
- Modify: `ps-offsite-2026/games/manual.html`

- [ ] **Step 1: Dino — import the gate**

In `ps-offsite-2026/games/3-dino.js`, find:

```js
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
```

Add immediately after it:

```js
import { isGameLockedFor, renderLockedScreen } from '../shared/game-gate.js';
```

- [ ] **Step 2: Dino — load gate in `boot`**

Find:

```js
async function boot() {
  if (session?.lobbyId) {
    try {
      const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${state.teamId}/${GAME_CODE}`));
      if (snap.exists()) { enterAlreadyPlayed(snap.val()); return; }
    } catch (e) { console.error('score check failed', e); }
  }
  goto('setup');
}
```

Replace with:

```js
async function boot() {
  if (session?.lobbyId) {
    try {
      const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${state.teamId}/${GAME_CODE}`));
      if (snap.exists()) { enterAlreadyPlayed(snap.val()); return; }
    } catch (e) { console.error('score check failed', e); }
    if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: state.teamId, gameKey: GAME_CODE })) {
      renderLockedScreen(catalogHref);
      return;
    }
  }
  goto('setup');
}
```

- [ ] **Step 3: Dino — submit guard in `phaseEnter.final`**

Find:

```js
  const trySubmit = () => submitScore({
    writer, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
  });
  trySubmit().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });
```

Replace with:

```js
  const trySubmit = async () => {
    if (await isGameLockedFor({ db, ref, get, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE })) {
      const err = new Error('locked'); err.locked = true; throw err;
    }
    return submitScore({
      writer, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
    });
  };
  trySubmit().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    if (e.locked) {
      status.className = 'save-status bad';
      status.textContent = 'LOCKED — score not saved';
      status.onclick = null;
      return;
    }
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });
```

- [ ] **Step 4: Flappy — import the gate**

In `ps-offsite-2026/games/4-flappy.js`, find:

```js
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
```

Add immediately after it:

```js
import { isGameLockedFor, renderLockedScreen } from '../shared/game-gate.js';
```

- [ ] **Step 5: Flappy — load gate in `boot`**

Find:

```js
async function boot() {
  if (session?.lobbyId) {
    try {
      const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${state.teamId}/${GAME_CODE}`));
      if (snap.exists()) { enterAlreadyPlayed(snap.val()); return; }
    } catch (e) { console.error('score check failed', e); }
  }
  goto('setup');
}
```

Replace with:

```js
async function boot() {
  if (session?.lobbyId) {
    try {
      const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${state.teamId}/${GAME_CODE}`));
      if (snap.exists()) { enterAlreadyPlayed(snap.val()); return; }
    } catch (e) { console.error('score check failed', e); }
    if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: state.teamId, gameKey: GAME_CODE })) {
      renderLockedScreen(catalogHref);
      return;
    }
  }
  goto('setup');
}
```

- [ ] **Step 6: Flappy — submit guard in `phaseEnter.final`**

Find:

```js
  const trySubmit = () => submitScore({
    writer, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
  });
  trySubmit().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });
```

Replace with:

```js
  const trySubmit = async () => {
    if (await isGameLockedFor({ db, ref, get, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE })) {
      const err = new Error('locked'); err.locked = true; throw err;
    }
    return submitScore({
      writer, lobbyId: session?.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
    });
  };
  trySubmit().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    if (e.locked) {
      status.className = 'save-status bad';
      status.textContent = 'LOCKED — score not saved';
      status.onclick = null;
      return;
    }
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });
```

- [ ] **Step 7: Gesture Lock — import the gate**

In `ps-offsite-2026/games/1-gesture-lock.html`, find:

```js
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
```

Add immediately after it:

```js
import { isGameLockedFor, renderLockedScreen } from '../shared/game-gate.js';
```

- [ ] **Step 8: Gesture Lock — load gate in `boot`**

Find:

```js
async function boot() {
  const teamId = _session?.teamId ?? 0;
  if (session?.lobbyId) {
    try {
      const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${teamId}/${GAME_CODE}`));
      if (snap.exists()) { enterAlreadyPlayed(snap.val()); return; }
    } catch (e) { console.error('score check failed', e); }
  }
  goto('setup');
}
```

Replace with:

```js
async function boot() {
  const teamId = _session?.teamId ?? 0;
  if (session?.lobbyId) {
    try {
      const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${teamId}/${GAME_CODE}`));
      if (snap.exists()) { enterAlreadyPlayed(snap.val()); return; }
    } catch (e) { console.error('score check failed', e); }
    if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId, gameKey: GAME_CODE })) {
      renderLockedScreen(catalogHref);
      return;
    }
  }
  goto('setup');
}
```

- [ ] **Step 9: Gesture Lock — submit guard in `phaseEnter.final`**

Find:

```js
  const attempt = () => submitScore({
    writer, lobbyId: session.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
  });
  attempt().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });
```

Replace with:

```js
  const attempt = async () => {
    if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: state.teamId, gameKey: GAME_CODE })) {
      const err = new Error('locked'); err.locked = true; throw err;
    }
    return submitScore({
      writer, lobbyId: session.lobbyId, teamId: state.teamId, gameKey: GAME_CODE, score,
    });
  };
  attempt().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    if (e.locked) {
      status.className = 'save-status bad';
      status.textContent = 'LOCKED — score not saved';
      status.onclick = null;
      return;
    }
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });
```

- [ ] **Step 10: Pantomime — import the gate**

In `ps-offsite-2026/games/2-pantomime.html`, find:

```js
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
```

Add immediately after it:

```js
import { isGameLockedFor, renderLockedScreen } from '../shared/game-gate.js';
```

- [ ] **Step 11: Pantomime — load gate in `boot`**

Find:

```js
async function boot() {
  teamId = _session?.teamId ?? 0;
  if (session?.lobbyId) {
    try {
      const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${teamId}/${GAME_CODE}`));
      if (snap.exists()) { enterAlreadyPlayed(snap.val()); return; }
    } catch (e) { console.error('score check failed', e); }
  }
  goto('setup');
}
```

Replace with:

```js
async function boot() {
  teamId = _session?.teamId ?? 0;
  if (session?.lobbyId) {
    try {
      const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${teamId}/${GAME_CODE}`));
      if (snap.exists()) { enterAlreadyPlayed(snap.val()); return; }
    } catch (e) { console.error('score check failed', e); }
    if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId, gameKey: GAME_CODE })) {
      renderLockedScreen(catalogHref);
      return;
    }
  }
  goto('setup');
}
```

- [ ] **Step 12: Pantomime — submit guard in `phaseEnter.final`**

Find:

```js
  const attempt = () => submitScore({
    writer, lobbyId: session.lobbyId, teamId, gameKey: GAME_CODE, score: final,
  });
  attempt().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });
```

Replace with:

```js
  const attempt = async () => {
    if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId, gameKey: GAME_CODE })) {
      const err = new Error('locked'); err.locked = true; throw err;
    }
    return submitScore({
      writer, lobbyId: session.lobbyId, teamId, gameKey: GAME_CODE, score: final,
    });
  };
  attempt().then(() => {
    status.className = 'save-status ok';
    status.textContent = 'SAVED ✓';
  }).catch(e => {
    if (e.locked) {
      status.className = 'save-status bad';
      status.textContent = 'LOCKED — score not saved';
      status.onclick = null;
      return;
    }
    console.error('submit failed', e);
    status.className = 'save-status bad';
    status.textContent = 'FAILED — TAP TO RETRY';
    status.onclick = () => phaseEnter.final();
  });
```

- [ ] **Step 13: Manual — import the gate**

In `ps-offsite-2026/games/manual.html`, find:

```js
import { resolveSession } from '../shared/lobby.js';
```

Add immediately after it:

```js
import { isGameLockedFor, renderLockedScreen } from '../shared/game-gate.js';
```

- [ ] **Step 14: Manual — load gate (gate the initial render)**

Find (the last lines of the script):

```js
render();
</script>
```

Replace with:

```js
(async () => {
  if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: key })) {
    renderLockedScreen(catalogHref);
    return;
  }
  render();
})();
</script>
```

- [ ] **Step 15: Manual — submit guard in the click handler**

Find:

```js
    btn.disabled = true;
    banner.className = '';
    banner.textContent = '';
    try {
      const saved = await submitScore({
        writer, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: key, score: raw,
      });
```

Replace with:

```js
    btn.disabled = true;
    banner.className = '';
    banner.textContent = '';
    try {
      if (await isGameLockedFor({ db, ref, get, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: key })) {
        banner.className = 'banner bad';
        banner.textContent = 'Locked — score not saved.';
        return;
      }
      const saved = await submitScore({
        writer, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: key, score: raw,
      });
```

Note: the existing `finally { btn.disabled = false; }` re-enables the button after the early `return`, so no extra cleanup is needed.

- [ ] **Step 16: Verify build**

Run: `npm run build`
Expected: PASS — all five game entry points compile.

- [ ] **Step 17: Manual smoke check**

Run: `npm run dev`. With all games locked (fresh lobby), deep-link a playable game, e.g. `games/3-dino.html?lobby=PS-XXXX&team=1` → "Game locked" screen with a back link (no game starts). Unlock that game from the scoreboard, reload → game boots normally. Repeat the deep-link for `games/manual.html?key=MX&lobby=PS-XXXX&team=1`. Confirm an already-submitted team still sees its "Already submitted" view even when the game is locked.

- [ ] **Step 18: Commit**

```bash
git add ps-offsite-2026/games/3-dino.js ps-offsite-2026/games/4-flappy.js ps-offsite-2026/games/1-gesture-lock.html ps-offsite-2026/games/2-pantomime.html ps-offsite-2026/games/manual.html
git commit -m "feat(locks): per-game entry + submit guards on all game pages"
```

---

## Task 6: Full verification

**Files:** none (verification only).

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: PASS — existing suites plus `game-lock.test.js` all green.

- [ ] **Step 2: Production build**

Run: `npm run build`
Expected: PASS — `dist/` builds with no errors.

- [ ] **Step 3: End-to-end manual pass**

Run: `npm run dev`. As admin on the scoreboard:
1. Fresh lobby → confirm a team's `games.html` shows everything locked (default-locked).
2. Edit → Unlock all → Save. Team page: all tiles clickable.
3. Edit → lock one game (header) → Save. Team page: only that game locked.
4. Edit → unlock that game's header, then lock it for one team (cell) → Save. That team's tile locked; other teams' unlocked.
5. Confirm locked games still show existing scores on the scoreboard and still count in totals.

- [ ] **Step 4: Commit (only if any fix-ups were needed)**

```bash
git add -A
git commit -m "chore(locks): verification fix-ups"
```

---

## Self-Review Notes

- **Spec coverage:** data model (Task 1 module + scoreboard write), resolution/cascade (Task 1), edit-mode draft + staged Save + Reset-in-edit (Task 3), scoreboard UI all/game/cell (Task 3), team-side locked tiles + live (Task 4), game-page load gate + whole-`submitScore` guard + already-played-wins (Task 5), client-side-advisory enforcement (Tasks 2/5; rules unchanged — no task needed), tests incl. absent-node + missing-teamId regressions (Task 1). All covered.
- **Type consistency:** `lockDraft` is the cloned node `{ all, games, cells }` throughout; `resolveLock`/`toggleCell` take `(locks, gameKey, teamId)`; lock values are the strings `"locked"`/`"unlocked"` (exported `LOCKED`/`UNLOCKED`) everywhere.
- **No placeholders:** every code step shows full before/after.
