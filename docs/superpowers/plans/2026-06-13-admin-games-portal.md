# Admin /games Portal + Dynamic Per-Lobby Game Model — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin manage a lobby's game set from an admin view of `/games` (add/remove, lock, rules, timer, create custom host-scored games), with teams seeing only added games and scoreboard reduced to score-entry + grading + leaderboard + winner celebration.

**Architecture:** Built-in games stay in the static `shared/games-catalog.js`. A new per-lobby Firebase node `lobbies/{id}/games/{key}` stores only deltas (`added` flag; full definition for custom games). A new pure module `shared/lobby-games.js` merges static + per-lobby data into an effective catalog. `games.html` role-switches: admin → management view, team → filtered player grid. Ranking everywhere (scoreboard + topbar pts badge) routes through the effective added catalog so removed/custom games count correctly.

**Tech Stack:** Vanilla ESM, Vite, Firebase Realtime DB (CDN SDK), Vitest. No framework.

**Spec:** `docs/superpowers/specs/2026-06-13-admin-games-portal-design.md` (read it; v2 review revisions are binding).

---

## File Structure

- **Create** `ps-offsite-2026/shared/lobby-games.js` — pure: merge static catalog + per-lobby node into effective catalog; added-keys filter; custom-key generation; validation. No Firebase, no `lobby.js`/`theme.js` import (keeps its test green vs the pre-existing `document` crash).
- **Create** `tests/lobby-games.test.js` — unit tests for the above.
- **Modify** `ps-offsite-2026/shared/topbar.js` — admin nav keeps Games link; pts badge sums over effective added catalog incl. custom keys; subscribe stays on root (already reads `lobbies/{id}`, which now includes `games`); display stored team name.
- **Modify** `ps-offsite-2026/games.html` — early admin guard → management view (list + actions + per-team expander + new-game form + delete); team path filters grid to added keys; custom tiles route to `manual.html`.
- **Modify** `ps-offsite-2026/games/manual.html` — resolve game from static OR per-lobby custom node (async); rules fallback precedence for custom games.
- **Modify** `ps-offsite-2026/scoreboard.html` — columns/ranking/counters filter to added keys; dynamic subtitle; remove lock/timer/rules editing UI; team-name inputs in edit mode; winners button + popover + full-screen confetti.
- **Reuse unchanged** `shared/game-lock.js`, `shared/game-config.js` (cell/game write helpers), `shared/ranking.js` (per-game rank points).

---

## Task 1: Pure module `lobby-games.js` + tests

**Files:**
- Create: `ps-offsite-2026/shared/lobby-games.js`
- Test: `tests/lobby-games.test.js`

- [ ] **Step 1: Write the failing tests**

Create `tests/lobby-games.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { GAMES } from '../ps-offsite-2026/shared/games-catalog.js';
import {
  resolveCatalog, addedKeys, nextCustomKey, makeCustomGame, validateCustomGame,
  SAFE_ALPHABET,
} from '../ps-offsite-2026/shared/lobby-games.js';

describe('resolveCatalog', () => {
  it('with no lobby node: playable added, manual/quiz not added', () => {
    const eff = resolveCatalog(GAMES, null);
    const byKey = Object.fromEntries(eff.map(g => [g.key, g]));
    expect(byKey.GZ.added).toBe(true);   // play
    expect(byKey.FL.added).toBe(true);   // play
    expect(byKey.GD.added).toBe(false);  // manual
    expect(byKey.PQ.added).toBe(false);  // quiz
  });

  it('explicit added flag overrides the default', () => {
    const eff = resolveCatalog(GAMES, { GD: { added: true }, GZ: { added: false } });
    const byKey = Object.fromEntries(eff.map(g => [g.key, g]));
    expect(byKey.GD.added).toBe(true);
    expect(byKey.GZ.added).toBe(false);
  });

  it('built-ins keep static name/emoji/kind/href', () => {
    const eff = resolveCatalog(GAMES, null);
    const gz = eff.find(g => g.key === 'GZ');
    expect(gz.name).toBe(GAMES.GZ.name);
    expect(gz.emoji).toBe(GAMES.GZ.emoji);
    expect(gz.kind).toBe('play');
    expect(gz.href).toBe(GAMES.GZ.href);
    expect(gz.custom).toBe(false);
  });

  it('includes custom games as host-scored manual, ordered after built-ins by order', () => {
    const node = {
      CUAAAA: { custom: true, name: 'Tug of War', emoji: '🪢', rules: 'pull', kind: 'manual', order: 2, added: true },
      CUBBBB: { custom: true, name: 'Karaoke', emoji: '🎤', rules: 'sing', kind: 'manual', order: 1, added: true },
    };
    const eff = resolveCatalog(GAMES, node);
    const builtinCount = Object.keys(GAMES).length;
    expect(eff.slice(0, builtinCount).every(g => !g.custom)).toBe(true);
    const customs = eff.slice(builtinCount);
    expect(customs.map(g => g.key)).toEqual(['CUBBBB', 'CUAAAA']); // by order 1,2
    expect(customs[0]).toMatchObject({ name: 'Karaoke', emoji: '🎤', kind: 'manual', custom: true, added: true });
  });

  it('custom game added defaults to true when flag absent', () => {
    const eff = resolveCatalog(GAMES, { CUZZZZ: { custom: true, name: 'X', emoji: '❓', rules: '', kind: 'manual', order: 1 } });
    expect(eff.find(g => g.key === 'CUZZZZ').added).toBe(true);
  });
});

describe('addedKeys', () => {
  it('returns only added keys preserving order', () => {
    const eff = resolveCatalog(GAMES, { GD: { added: true } });
    const keys = addedKeys(eff);
    expect(keys).toContain('GZ');
    expect(keys).toContain('GD');
    expect(keys).not.toContain('PQ');
    expect(keys.indexOf('GZ')).toBeLessThan(keys.indexOf('GD'));
  });
});

describe('nextCustomKey', () => {
  it('produces CU + 4 safe-alphabet chars', () => {
    let calls = 0;
    const rng = () => (calls++ % SAFE_ALPHABET.length) / SAFE_ALPHABET.length;
    const key = nextCustomKey(new Set(), rng);
    expect(key).toMatch(/^CU[A-HJ-NP-Z2-9]{4}$/);
  });

  it('never returns a taken key (built-in, live custom, or orphaned score/history key)', () => {
    const taken = new Set(['GZ', 'CUAAAA']);
    // rng forces "AAAA" first (taken as CUAAAA), then "AAAB"
    const seq = ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'B'];
    let i = 0;
    const rng = () => SAFE_ALPHABET.indexOf(seq[i++]) / SAFE_ALPHABET.length;
    const key = nextCustomKey(taken, rng);
    expect(taken.has(key)).toBe(false);
    expect(key).toBe('CUAAAB');
  });
});

describe('makeCustomGame', () => {
  it('builds a host-scored, added custom node object', () => {
    const g = makeCustomGame({ name: ' Quiz Night ', emoji: '🎤', rules: 'sing', order: 3 });
    expect(g).toEqual({ custom: true, name: 'Quiz Night', emoji: '🎤', rules: 'sing', kind: 'manual', order: 3, added: true });
  });
});

describe('validateCustomGame', () => {
  it('accepts a valid game', () => {
    expect(validateCustomGame({ name: 'Karaoke', emoji: '🎤', rules: 'sing' })).toEqual({ ok: true });
  });
  it('rejects empty name', () => {
    expect(validateCustomGame({ name: '   ', emoji: '🎤', rules: '' }).ok).toBe(false);
  });
  it('rejects too-long name', () => {
    expect(validateCustomGame({ name: 'x'.repeat(41), emoji: '🎤', rules: '' }).ok).toBe(false);
  });
  it('rejects empty emoji', () => {
    expect(validateCustomGame({ name: 'X', emoji: '', rules: '' }).ok).toBe(false);
  });
  it('rejects over-long emoji field', () => {
    expect(validateCustomGame({ name: 'X', emoji: 'abcdefghi', rules: '' }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/lobby-games.test.js`
Expected: FAIL — cannot resolve `../ps-offsite-2026/shared/lobby-games.js`.

- [ ] **Step 3: Implement `lobby-games.js`**

Create `ps-offsite-2026/shared/lobby-games.js`:

```js
// Pure helpers for the per-lobby game model. NO imports from lobby.js/theme.js
// (those touch `document` at import and would break this module's unit test).
//
// Per-lobby Firebase node shape (lobbies/{id}/games/{key}):
//   built-in key:  { added: bool }                         // delta only
//   custom key:    { custom:true, name, emoji, rules, kind:'manual', order, added }
// Effective catalog merges the static built-in catalog with this node.

export const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Default visibility when no explicit `added` flag is stored.
function defaultAdded(kind) {
  return kind === 'play';
}

// staticGames: the GAMES object from games-catalog.js. node: lobby games node or null.
// Returns an ordered array: built-ins (catalog order) then customs (by order, then key).
export function resolveCatalog(staticGames, node) {
  const n = node || {};
  const builtins = Object.entries(staticGames).map(([key, g]) => ({
    key,
    name: g.name,
    emoji: g.emoji,
    kind: g.kind,
    href: g.href,
    rules: g.rules,
    custom: false,
    added: typeof n[key]?.added === 'boolean' ? n[key].added : defaultAdded(g.kind),
  }));

  const customs = Object.entries(n)
    .filter(([key, v]) => v && v.custom && !staticGames[key])
    .map(([key, v]) => ({
      key,
      name: v.name,
      emoji: v.emoji,
      kind: 'manual',
      href: undefined,
      rules: v.rules ?? '',
      custom: true,
      order: typeof v.order === 'number' ? v.order : 0,
      added: typeof v.added === 'boolean' ? v.added : true,
    }))
    .sort((a, b) => (a.order - b.order) || (a.key < b.key ? -1 : 1));

  return [...builtins, ...customs];
}

export function addedKeys(effectiveCatalog) {
  return effectiveCatalog.filter(g => g.added).map(g => g.key);
}

// taken: a Set of keys already in use (built-ins + live custom + orphaned score/
// history keys). rng: () => [0,1); injected for tests.
export function nextCustomKey(taken, rng = Math.random) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += SAFE_ALPHABET[Math.floor(rng() * SAFE_ALPHABET.length)];
    }
    const key = `CU${s}`;
    if (!taken.has(key)) return key;
  }
  throw new Error('could not allocate a free custom game key');
}

export function makeCustomGame({ name, emoji, rules, order }) {
  return {
    custom: true,
    name: String(name).trim(),
    emoji: String(emoji),
    rules: rules ? String(rules) : '',
    kind: 'manual',
    order,
    added: true,
  };
}

export function validateCustomGame({ name, emoji, rules }) {
  const n = String(name ?? '').trim();
  if (!n) return { ok: false, error: 'Name is required.' };
  if (n.length > 40) return { ok: false, error: 'Name must be 40 characters or fewer.' };
  const e = String(emoji ?? '');
  if (!e.trim()) return { ok: false, error: 'Icon (emoji) is required.' };
  if (e.length > 8) return { ok: false, error: 'Icon must be a single emoji.' };
  if (rules != null && typeof rules !== 'string') return { ok: false, error: 'Rules must be text.' };
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/lobby-games.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Run the full suite (no regressions)**

Run: `npx vitest run`
Expected: same as baseline — `tests/lobby.test.js` remains the only red suite (pre-existing `document is not defined`); everything else green, plus the new file green.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/shared/lobby-games.js tests/lobby-games.test.js
git commit -m "feat(games): pure per-lobby game-model module (resolveCatalog, addedKeys, custom games)"
```

---

## Task 2: Topbar — admin Games link, stored team name, lobby-aware pts

**Files:**
- Modify: `ps-offsite-2026/shared/topbar.js`

**Why:** Spec C1 (pts badge must sum over the lobby's added catalog incl. custom keys), C2 (admin must be able to reach the Games admin view), m3 (show stored team name).

- [ ] **Step 1: Import the resolver and catalog**

In `shared/topbar.js`, replace the import line `import { allEnteredKeys } from './games-catalog.js';` with:

```js
import { GAMES } from './games-catalog.js';
import { resolveCatalog, addedKeys } from './lobby-games.js';
```

- [ ] **Step 2: Admin nav keeps a Games link**

In `buildHeader`, change the admin `nav` branch so admins can open the management view. Replace the `const nav = admin ? ... : ...;` block with:

```js
  const nav = admin
    ? `<a data-nav="games" href="${gamesHref}">Games</a>
       <a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>
       <a data-nav="quiz-admin" href="${quizAdminHref}">Quiz</a>`
    : `<a data-nav="games" href="${gamesHref}">Games</a>
       <a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>`;
```

Note: `gamesHref` for an admin has no `&team=` (teamId is undefined) — `buildHeader`'s `lobbyQ` already guards `${teamId ? ... : ''}`, so the admin link is `games.html?lobby=XXXX`. Good.

- [ ] **Step 3: Display the stored team name (fallback "Team N")**

`buildHeader` currently hardcodes `Team ${teamId}` in `info`. Thread an optional `teamName`:

Change the signature `function buildHeader({ lobbyId, teamId }, activePage, admin) {` to `function buildHeader({ lobbyId, teamId }, activePage, admin, teamName) {` and change the non-admin `info` to:

```js
  const info = admin
    ? `Lobby <code>${esc(lobbyId)}</code> · <strong>Admin</strong>`
    : `Lobby <code>${esc(lobbyId)}</code> · <strong class="ps-topbar-team">${esc(teamName || `Team ${teamId}`)}</strong> · <strong class="ps-topbar-pts" title="Total rank-points across all entered games">— pts</strong>`;
```

- [ ] **Step 4: Make the pts sum lobby-aware (added catalog incl. custom)**

Replace `subscribeTeamPoints` body's loop source. The function already reads the whole `lobbies/{id}` snapshot — now also read `root.games`. Replace:

```js
    let total = 0;
    for (const g of allEnteredKeys()) {
```

with:

```js
    let total = 0;
    const keys = addedKeys(resolveCatalog(GAMES, root.games || null));
    for (const g of keys) {
```

(`teamCount` and `scoresObj` lines stay; custom keys are now included because `resolveCatalog` surfaces added customs and `scoresObj[t.id]?.[g]` reads their scores.)

- [ ] **Step 5: Pass the live team name into the header + keep it updated**

`mountTopbar` builds the header once. Add the team name from the same root snapshot. Replace the `subscribeTeamPoints` call site and header build in `mountTopbar` with:

```js
export function mountTopbar({ activePage }) {
  const ctx = resolveSession();
  if (!ctx) {
    location.replace(`${prefix()}index.html`);
    return;
  }
  const admin = ctx.role === 'admin';
  const header = buildHeader(ctx, activePage, admin);
  document.body.insertBefore(header, document.body.firstChild);
  if (!isCanvasGamePage()) {
    document.body.classList.add('ps-topbar-host');
  }
  if (!admin) {
    const ptsEl = header.querySelector('.ps-topbar-pts');
    const teamEl = header.querySelector('.ps-topbar-team');
    subscribeTeam(ctx.lobbyId, ctx.teamId, ({ total, teamName }) => {
      ptsEl.textContent = `${formatPts(total)} pts`;
      if (teamName) teamEl.textContent = teamName;
    });
  }
}
```

Rename `subscribeTeamPoints` to `subscribeTeam` and have its `onUpdate` receive `{ total, teamName }`. In the `onValue` callback, after computing `total`, add:

```js
    const teamName = root.teams?.[teamId]?.name;
    onUpdate({ total, teamName });
```

(remove the old `onUpdate(total)` call).

- [ ] **Step 6: Manual verification (no DOM unit harness here)**

Run: `npx vitest run` → still only `lobby.test.js` red (pre-existing).
Then build + open the app (see Task 9 verification). Confirm: a team player sees their team name in the topbar; the pts badge matches the scoreboard total after Task 6; an admin sees a "Games" nav link.

- [ ] **Step 7: Commit**

```bash
git add ps-offsite-2026/shared/topbar.js
git commit -m "feat(topbar): admin Games link, stored team name, lobby-aware pts (added catalog + custom keys)"
```

---

## Task 3: Player grid filters to added games

**Files:**
- Modify: `ps-offsite-2026/games.html` (script: import + `render` source + tileHref for custom)

**Why:** Teams must see only added games; custom games route to manual.html.

- [ ] **Step 1: Import the resolver; subscribe to the games node**

In the `<script type="module">` of `games.html`, after `import { GAMES } from './shared/games-catalog.js';` add:

```js
import { resolveCatalog, addedKeys } from './shared/lobby-games.js';
```

Add a module-level `let currentGamesNode = null;` next to the other `let current...` declarations, and add a listener alongside the existing ones:

```js
onValue(ref(db, `lobbies/${session.lobbyId}/games`), snap => {
  currentGamesNode = snap.exists() ? snap.val() : null;
  render();
});
```

- [ ] **Step 2: Build the grid from the effective added catalog**

In `render()`, replace `const html = Object.entries(GAMES).map(([key, g]) => {` with:

```js
  const effective = resolveCatalog(GAMES, currentGamesNode);
  const shown = effective.filter(g => g.added);
  const html = shown.map(g => {
    const key = g.key;
```

The body uses `g.kind`, `g.icon` (none now → emoji), `g.emoji`, `g.name`, `g.href` — all present on the effective entry. Update the closing of the loop: change `}).join('');` to stay, but fix the two aggregate lines below it:

```js
  const submitted = shown.filter(g => isGameSubmitted(g.key, g)).length;
  const total = shown.length;
  subtitle.textContent = `${submitted}/${total} games completed`;
```

(Previously these used `Object.entries(GAMES)` / `Object.values(GAMES)` and a `kind!=='soon'` filter — `soon` no longer exists; `shown` is the correct denominator.)

- [ ] **Step 3: Route custom games through manual.html**

`tileHref(key, g)` currently keys off `g.kind`. Custom games have `kind: 'manual'`, so they already hit the `manual` branch: `games/manual.html?key=${key}...`. No change needed — confirm by reading `tileHref`. (manual.html is taught to resolve custom keys in Task 5.)

- [ ] **Step 4: Manual verification**

Build + open a fresh lobby as a team (Task 9). Expected: only the 4 playable tiles show (GD/HD/DG/PQ hidden until admin adds them). No console errors. `X/4 games completed` subtitle.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/games.html
git commit -m "feat(games): team grid shows only added games via resolveCatalog"
```

---

## Task 4: Admin management view inside games.html

**Files:**
- Modify: `ps-offsite-2026/games.html` (early admin guard + admin render + styles)

**Why:** Spec #1/#2/#3/#6 + C2. Admin session renders management UI; never touches `scores/{teamId}` listeners.

- [ ] **Step 1: Add the early admin guard before team listeners**

In `games.html`, the script currently does `const session = resolveSession(); if (!session) {...}; mountTopbar(...);` then sets up team listeners. Import the admin check and branch. After `import { resolveSession } from './shared/lobby.js';` change to:

```js
import { resolveSession, isAdminSession } from './shared/lobby.js';
```

Immediately after `mountTopbar({ activePage: 'games' });` and after `const app = initializeApp(firebaseConfig); const db = getDatabase(app);`, insert:

```js
if (isAdminSession(session)) {
  mountAdminGames(db, session.lobbyId);
} else {
  mountTeamGrid(db, session);
}
```

Wrap the EXISTING team code (the `grid`/`subtitle` consts, `render`, `openTimeWarning`, and all six `onValue(... scores/locks/timers/timerStarts/quiz ...)` listeners plus the new `games` listener from Task 3) into a function `function mountTeamGrid(db, session) { ... }`. This is a mechanical wrap — do not change the bodies beyond Task 3's edits. The admin path must not run any `scores/${session.teamId}` subscription (admin has no teamId).

- [ ] **Step 2: Add the admin view markup container**

In the `<body><main>` of `games.html`, the team view uses `<h1>Games</h1><div class="subtitle" id="subtitle">…</div><div class="grid" id="grid"></div>`. Add an admin container after the grid:

```html
  <section id="admin-games" hidden>
    <h1>Manage games</h1>
    <p class="subtitle" id="adminSub">Add games to the lobby, lock them, set rules &amp; timers, or create your own.</p>
    <div id="adminList" class="admin-list"></div>
    <div class="admin-newgame">
      <h2>Create a game</h2>
      <input id="ngName" type="text" maxlength="40" placeholder="Game name">
      <input id="ngEmoji" type="text" maxlength="8" placeholder="Icon (emoji)">
      <textarea id="ngRules" rows="3" placeholder="Rules (optional)"></textarea>
      <input id="ngTimer" type="number" min="0" placeholder="Time limit (min, optional)">
      <button id="ngCreate">Create game</button>
      <div id="ngErr" class="lobby-banner err" hidden></div>
    </div>
  </section>
```

`mountTeamGrid` should leave `#admin-games` hidden; `mountAdminGames` should hide `#grid`/its `<h1>`/`#subtitle` (wrap the team heading+subtitle+grid in a `<section id="team-view">` and toggle that section vs `#admin-games`).

- [ ] **Step 3: Add admin-list styles**

In the `<style>` of `games.html`, add:

```css
  .admin-list { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
  .admin-row {
    display: flex; align-items: center; gap: 12px;
    background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px;
  }
  .admin-row.not-added { opacity: 0.5; }
  .admin-row .ar-emoji { font-size: 24px; width: 32px; text-align: center; }
  .admin-row .ar-name { font-weight: 800; flex: 1; }
  .admin-row .ar-kind { font-size: 11px; text-transform: uppercase; letter-spacing: 1px; color: var(--muted); }
  .admin-row .ar-actions { display: flex; gap: 6px; }
  .admin-row .ar-actions button {
    background: var(--bg-2); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 6px 9px; font-size: 14px; cursor: pointer; font-family: inherit;
  }
  .admin-row .ar-actions button.on { border-color: var(--accent); color: var(--accent); }
  .admin-newgame { background: var(--card); border: 1px solid var(--border); border-radius: 12px; padding: 16px; display: flex; flex-direction: column; gap: 8px; max-width: 520px; }
  .admin-newgame input, .admin-newgame textarea {
    background: var(--bg-2); border: 1px solid var(--border); color: var(--text);
    border-radius: 8px; padding: 8px 10px; font-family: inherit; font-size: 15px;
  }
  .admin-perteam { padding: 8px 14px 4px; display: flex; flex-direction: column; gap: 6px; }
  .admin-perteam .apt-row { display: flex; align-items: center; gap: 8px; font-size: 13px; }
  .admin-perteam .apt-row .apt-name { flex: 1; color: var(--muted); }
```

- [ ] **Step 4: Implement `mountAdminGames`**

Add this function to the script. It subscribes to `games`, `locks`, `timers`, `rules`, `teams` (never `scores/{teamId}`), and renders the list. It writes deltas directly (immediate writes). Uses the reused pure helpers.

```js
import { resolveCatalog, addedKeys, nextCustomKey, makeCustomGame, validateCustomGame } from './shared/lobby-games.js';
import { setGameOverride, setCellOverride, resolveTimer, resolveRule, hasOverride } from './shared/game-config.js';
import { setGame, toggleGame, setCell, resolveGameLock, resolveLock } from './shared/game-lock.js';
import { get, set, update } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
```

(Adjust the existing top `import { getDatabase, ref, onValue } ...` to also import `get, set, update` — combine into the one firebase-database import already present.)

```js
function mountAdminGames(db, lobbyId) {
  document.getElementById('team-view').hidden = true;
  const section = document.getElementById('admin-games');
  section.hidden = false;
  const listEl = document.getElementById('adminList');

  let gamesNode = null, locks = null, timers = null, rules = null, teams = [];

  const path = p => `lobbies/${lobbyId}/${p}`;
  onValue(ref(db, path('games')),  s => { gamesNode = s.val() || null; render(); });
  onValue(ref(db, path('locks')),  s => { locks = s.val() || null; render(); });
  onValue(ref(db, path('timers')), s => { timers = s.val() || null; render(); });
  onValue(ref(db, path('rules')),  s => { rules = s.val() || null; render(); });
  onValue(ref(db, path('teams')),  s => { teams = s.exists() ? Object.values(s.val()) : []; render(); });

  async function writeNode(name, mutate) {
    const snap = await get(ref(db, path(name)));
    const node = snap.exists() ? snap.val() : {};
    mutate(node);
    await set(ref(db, path(name)), node);
  }

  function esc(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}

  function render() {
    const eff = resolveCatalog(GAMES, gamesNode);
    listEl.innerHTML = eff.map(g => {
      const added = g.added;
      const locked = resolveGameLock(locks, g.key) === 'locked';
      const mins = resolveTimer(timers, g.key);
      const kindLabel = g.custom ? 'Custom' : g.kind === 'play' ? 'Playable' : g.kind === 'quiz' ? 'Quiz' : 'Host-scored';
      const canTimer = g.kind !== 'play'; // host-scored + custom
      return `<div class="admin-row ${added ? '' : 'not-added'}" data-key="${g.key}">
        <span class="ar-emoji">${g.emoji}</span>
        <span class="ar-name">${esc(g.name)} <span class="ar-kind">${kindLabel}${mins ? ` · ⏱ ${mins}m` : ''}</span></span>
        <span class="ar-actions">
          <button data-act="eye" class="${added ? 'on' : ''}" title="${added ? 'Remove from lobby' : 'Add to lobby'}">${added ? '👁' : '🚫'}</button>
          <button data-act="lock" class="${locked ? '' : 'on'}" title="${locked ? 'Locked' : 'Unlocked'}">${locked ? '🔒' : '🔓'}</button>
          <button data-act="rules" title="Edit rules">📋</button>
          ${canTimer ? `<button data-act="timer" title="Set time limit">⏱</button>` : ''}
          <button data-act="perteam" title="Per-team overrides">⋯</button>
          ${g.custom ? `<button data-act="delete" title="Delete game">🗑</button>` : ''}
        </span>
      </div>`;
    }).join('');
    for (const row of listEl.querySelectorAll('.admin-row')) {
      const key = row.dataset.key;
      row.querySelector('[data-act="eye"]').onclick   = () => toggleAdded(key);
      row.querySelector('[data-act="lock"]').onclick  = () => writeNode('locks', n => toggleGame(n, key));
      row.querySelector('[data-act="rules"]').onclick = () => editRules(key);
      const t = row.querySelector('[data-act="timer"]'); if (t) t.onclick = () => editTimer(key);
      row.querySelector('[data-act="perteam"]').onclick = () => togglePerTeam(row, key);
      const d = row.querySelector('[data-act="delete"]'); if (d) d.onclick = () => deleteCustom(key);
    }
  }

  function perTeamOverridesExist(key) {
    return !!(locks?.cells?.[key] || timers?.cells?.[key] || rules?.cells?.[key]);
  }

  async function toggleAdded(key) {
    await writeNode('games', node => {
      const cur = resolveCatalog(GAMES, node).find(g => g.key === key);
      node[key] = { ...(node[key] || {}), added: !(cur?.added) };
    });
  }

  async function editRules(key) {
    if (perTeamOverridesExist(key) && !confirm('Setting game-level rules clears any per-team rules for this game. Continue?')) return;
    const eff = resolveCatalog(GAMES, gamesNode).find(g => g.key === key);
    const current = resolveRule(rules, key, undefined, eff?.rules ?? '');
    const next = prompt('Rules for ' + (eff?.name ?? key) + ' (blank = default):', current ?? '');
    if (next === null) return;
    await writeNode('rules', n => setGameOverride(n, key, next));
  }

  async function editTimer(key) {
    if (perTeamOverridesExist(key) && !confirm('Setting a game-level timer clears any per-team timers for this game. Continue?')) return;
    const cur = resolveTimer(timers, key);
    const raw = prompt('Time limit in minutes (blank or 0 = no limit):', cur ?? '');
    if (raw === null) return;
    await writeNode('timers', n => setGameOverride(n, key, Number(raw)));
  }

  function togglePerTeam(row, key) {
    const existing = row.nextElementSibling?.classList.contains('admin-perteam');
    if (existing) { row.nextElementSibling.remove(); return; }
    const box = document.createElement('div');
    box.className = 'admin-perteam';
    box.innerHTML = teams.sort((a,b)=>a.id-b.id).map(t => {
      const locked = resolveLock(locks, key, t.id) === 'locked';
      const mins = resolveTimer(timers, key, t.id);
      return `<div class="apt-row" data-team="${t.id}">
        <span class="apt-name">${esc(t.name || ('Team ' + t.id))}</span>
        <button data-pt="lock">${locked ? '🔒' : '🔓'}</button>
        <button data-pt="timer">⏱${mins ? ' ' + mins + 'm' : ''}</button>
        <button data-pt="rules">📋</button>
      </div>`;
    }).join('');
    for (const r of box.querySelectorAll('.apt-row')) {
      const teamId = Number(r.dataset.team);
      r.querySelector('[data-pt="lock"]').onclick = () => writeNode('locks', n => {
        const cur = resolveLock(n, key, teamId) === 'locked';
        setCell(n, key, teamId, cur ? 'unlocked' : 'locked');
      });
      r.querySelector('[data-pt="timer"]').onclick = async () => {
        const cur = resolveTimer(timers, key, teamId);
        const raw = prompt('Per-team time limit (min, blank=clear):', cur ?? '');
        if (raw === null) return;
        await writeNode('timers', n => setCellOverride(n, key, teamId, Number(raw)));
      };
      r.querySelector('[data-pt="rules"]').onclick = async () => {
        const eff = resolveCatalog(GAMES, gamesNode).find(g => g.key === key);
        const cur = resolveRule(rules, key, teamId, eff?.rules ?? '');
        const next = prompt('Per-team rules (blank=clear):', cur ?? '');
        if (next === null) return;
        await writeNode('rules', n => setCellOverride(n, key, teamId, next));
      };
    }
    row.insertAdjacentElement('afterend', box);
  }

  async function deleteCustom(key) {
    if (!confirm('Delete this game? Its past scores are kept but hidden.')) return;
    await set(ref(db, path('games/' + key)), null);
  }

  // --- create custom game
  document.getElementById('ngCreate').onclick = async () => {
    const errEl = document.getElementById('ngErr');
    errEl.hidden = true;
    const name = document.getElementById('ngName').value;
    const emoji = document.getElementById('ngEmoji').value;
    const rulesTxt = document.getElementById('ngRules').value;
    const timerRaw = document.getElementById('ngTimer').value;
    const v = validateCustomGame({ name, emoji, rules: rulesTxt });
    if (!v.ok) { errEl.textContent = v.error; errEl.hidden = false; return; }
    // gather taken keys: built-ins + live custom + orphaned score/history keys
    const [gSnap, sSnap, hSnap] = await Promise.all([
      get(ref(db, path('games'))), get(ref(db, path('scores'))), get(ref(db, path('history'))),
    ]);
    const taken = new Set(Object.keys(GAMES));
    if (gSnap.exists()) Object.keys(gSnap.val()).forEach(k => taken.add(k));
    if (sSnap.exists()) Object.values(sSnap.val()).forEach(byTeam => Object.keys(byTeam || {}).forEach(k => taken.add(k)));
    if (hSnap.exists()) Object.values(hSnap.val()).forEach(h => h?.gameKey && taken.add(h.gameKey));
    const node = gSnap.exists() ? gSnap.val() : {};
    const maxOrder = Math.max(0, ...Object.values(node).filter(v => v?.custom).map(v => v.order || 0));
    const key = nextCustomKey(taken);
    const minutes = Number(timerRaw);
    await set(ref(db, path('games/' + key)), makeCustomGame({ name, emoji, rules: rulesTxt, order: maxOrder + 1 }));
    if (Number.isFinite(minutes) && minutes > 0) {
      await writeNode('timers', n => setGameOverride(n, key, minutes));
    }
    document.getElementById('ngName').value = '';
    document.getElementById('ngEmoji').value = '';
    document.getElementById('ngRules').value = '';
    document.getElementById('ngTimer').value = '';
  };
}
```

Note: wrap the team-view heading/subtitle/grid in `<section id="team-view">…</section>` (Step 2 referenced it). Update `mountTeamGrid` to set `document.getElementById('admin-games').hidden = true;` defensively.

- [ ] **Step 5: Manual verification**

Build + open the app. Join a lobby as **Admin** (Enter as Admin on index). Navigate to the Games link. Expected:
- A management list of all 8 games; GD/HD/DG/PQ rows dimmed (not added).
- Click 👁 on Pub Quiz → row un-dims; open a team session in another browser → Pub Quiz now appears in the team grid.
- 🔒/🔓 toggles lock (team grid reflects it).
- 📋 edits rules (team's manual.html shows new text).
- ⏱ on a host-scored game sets a limit (shown on the team tile).
- ⋯ expands per-team rows; setting a per-team lock differs from the game level.
- Create a game (name+emoji) → appears in admin list as Custom + added → shows in team grid → routes to manual.html.
- 🗑 deletes a custom game.
- No console error about `scores/undefined`.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/games.html
git commit -m "feat(games): admin management view (add/remove, lock, rules, timer, per-team, custom games)"
```

---

## Task 5: manual.html resolves custom games

**Files:**
- Modify: `ps-offsite-2026/games/manual.html`

**Why:** Spec M2. Custom keys (`CU####`) aren't in the static catalog; manual.html must read the per-lobby node and resolve rules with the right precedence.

- [ ] **Step 1: Read the per-lobby game node before deciding "unknown"**

`manual.html` currently does `const game = getGame(key);` then rejects `!game || game.kind !== 'manual'`. Replace the static-only resolution with a resolver that also checks the lobby node. After the Firebase app/db are initialized (the file already creates `app`/`db`), and before the `if (!game ...)` guard, fetch the node:

```js
import { resolveCatalog } from '../shared/lobby-games.js';
// ... after db is created:
const gamesSnap = await get(ref(db, `lobbies/${session.lobbyId}/games`));
const effective = resolveCatalog(GAMES, gamesSnap.exists() ? gamesSnap.val() : null);
const game = effective.find(g => g.key === key) || null;
```

Ensure `GAMES` and `get` are imported (the file imports `getGame` from games-catalog and `ref`/`get` from firebase-database — add `GAMES` to the catalog import and `get` to the firebase import if missing). The reject guard becomes:

```js
if (!game || (game.kind !== 'manual')) {
  // ... existing "Unknown game" screen ...
}
```

(Custom games have `kind: 'manual'`, so they pass. Built-in manual games still resolve identically.)

- [ ] **Step 2: Rules fallback precedence for custom games**

manual.html's live rules listener resolves `rules.cells/games` then falls back to the game's default text. The default must be the effective game's `rules` (custom node rules OR built-in catalog rules — `resolveCatalog` already put the right one in `game.rules`). Find where it computes the displayed rules (uses `resolveRule(..., fallback)`); set the fallback to `game.rules`. If the code referenced `getGame(key).rules`, change it to the resolved `game.rules`.

- [ ] **Step 3: Manual verification**

Build + open. As admin create a custom game with rules "Bring the flag to the desk." and a 5-min timer; add it. As a team, open that tile → manual.html shows the name, emoji, the rules text, and the 5-minute timer warning. Built-in manual games (Gandalf, Hidden Document, Draw & Guess) still open with their rules.

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/games/manual.html
git commit -m "feat(manual): resolve custom games from the per-lobby node + rules precedence"
```

---

## Task 6: Scoreboard filters to added games; drop game-config editing

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html`

**Why:** Spec C1/M4 (ranking + counters filter to added; dynamic subtitle), spec §3 (remove lock/timer/rules editing — moved to /games).

- [ ] **Step 1: Import the resolver; subscribe to the games node**

In scoreboard's script, add `import { resolveCatalog, addedKeys } from './shared/lobby-games.js';`. The main `onValue(ref(db, LOBBY_PATH), ...)` already receives the whole lobby; capture `root.games` into state (e.g. `state.gamesNode = root.games || null;` in `snapshotToState` or alongside it). Compute once per render: `const eff = resolveCatalog(GAMES, state.gamesNode); const gameKeys = addedKeys(eff);`.

- [ ] **Step 2: Replace static key sources with `gameKeys`**

Find every `allEnteredKeys()` and `Object.entries(GAMES)`/`Object.keys(GAMES)` used to build columns or sum points:
- `render()` column iteration → iterate `eff.filter(g => g.added)` (so custom columns appear with emoji+name).
- `computeLeader()` per-game loop → iterate `gameKeys`.
- `gameCount` numerator/denominator → numerator = count of `gameKeys` with a score for the team; denominator = `gameKeys.length`.
- `submissionCount` → count history entries whose `gameKey` is in `gameKeys` (filter `h.gameKey`).

- [ ] **Step 3: Dynamic subtitle**

Replace the hardcoded `<div class="subtitle" id="subtitle">8 games · one winner</div>` content by setting it in `render()`:

```js
document.getElementById('subtitle').textContent = `${gameKeys.length} games · one winner`;
```

- [ ] **Step 4: Remove lock/timer/rules editing UI**

Delete the lock/clock/rules buttons in edit mode and their modals/handlers: `editButtonsHtml`, `openClockModal`, `openRulesModal`, `toggleAll`/`toggleGame`/`toggleCell` wiring, and the Lock-all control. Keep `startEdits`/`saveEdits`/`cancelEdits` but reduce `draft`/`dirty` to **scores only** (and team names — Task 7). Remove writes to `locks`/`timers`/`rules` from `saveEdits`. The live listeners for `locks`/`timers`/`rules` may remain (read-only) only if still used to display lock/timer badges on the board; if the board doesn't show them, remove those listeners too. Keep displaying a 🔒 marker on locked cells if it already does (read-only).

- [ ] **Step 5: Manual verification**

Build + open scoreboard as admin. Expected: leaderboard shows only added-game columns (custom games included once added). No lock/clock/rules buttons in edit mode — only score inputs. Subtitle reads "N games · one winner" matching added count. Remove a game in /games admin → its column disappears here and its points stop counting; the team's pts badge (topbar) matches.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/scoreboard.html
git commit -m "feat(scoreboard): columns/ranking/counters follow added games; drop lock/timer/rules editing"
```

---

## Task 7: Team rename (scoreboard edit + topbar inline)

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html` (name inputs in edit mode)
- Modify: `ps-offsite-2026/shared/topbar.js` (inline self-rename)

**Why:** Spec #13.

- [ ] **Step 1: Scoreboard — editable team-name cells**

In `render()`, when in edit mode, render each team's name cell as `<input class="name-edit" data-team="${t.id}" maxlength="24" value="${esc(t.name || ('Team '+t.id))}">` instead of static text. In `wireEditButtons`/edit capture, collect name edits into the draft (e.g. `draft.names[teamId] = el.value.trim()`), and in `saveEdits` write each changed name to `lobbies/{id}/teams/{teamId}/name` (use `update`/`set` per changed team). Validation: non-empty after trim (fall back to existing name if blank), max 24 chars (enforced by maxlength), escape on render.

- [ ] **Step 2: Topbar — self-rename affordance**

In `buildHeader`, wrap the team name in a button: `<strong class="ps-topbar-team" title="Click to rename">${esc(teamName || 'Team '+teamId)}</strong>`. In `mountTopbar` (non-admin branch), after grabbing `teamEl`, add a click handler:

```js
    teamEl.style.cursor = 'pointer';
    teamEl.onclick = async () => {
      const next = prompt('Rename your team:', teamEl.textContent);
      if (next == null) return;
      const name = next.trim().slice(0, 24);
      if (!name) return;
      const { getDatabase, ref, set } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js');
      const { getApps, getApp } = await import('https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js');
      const db = getDatabase(getApps().length ? getApp() : undefined);
      await set(ref(db, `lobbies/${ctx.lobbyId}/teams/${ctx.teamId}/name`), name);
    };
```

(The live `subscribeTeam` listener already updates `teamEl.textContent` from `teams/{id}/name`, so the rename reflects immediately.)

- [ ] **Step 3: Manual verification**

Build + open. As a team, click the team name in the topbar → rename → topbar + scoreboard reflect the new name live. As admin on scoreboard, enter edit mode, change a team name in its cell, Save → name updates for that team's topbar too. Quiz-admin shows the new name.

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/scoreboard.html ps-offsite-2026/shared/topbar.js
git commit -m "feat(teams): rename from scoreboard edit mode and topbar self-rename"
```

---

## Task 8: Winner celebration (admin button + popover + full-screen confetti)

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html`

**Why:** Spec #12.

- [ ] **Step 1: Add the admin button**

In the scoreboard header controls (next to Edit/Reset), add an admin-only button: `<button id="celebrateBtn" type="button">🎉 Celebrate winner</button>`.

- [ ] **Step 2: Popover + full-screen confetti handler**

The existing `confetti()` appends pieces to `#confetti` (`position:fixed; inset:0`, already full-screen). Add a manual celebration that names the leader and fires a bigger burst:

```js
document.getElementById('celebrateBtn').onclick = () => {
  const leader = computeLeader();           // returns the top team (id, name, total)
  if (!leader) return;
  confetti(120);                            // bigger burst (see Step 3)
  const dialog = document.createElement('dialog');
  dialog.className = 'winner-pop';
  dialog.innerHTML = `<h2>🏆 ${esc(leader.name || ('Team ' + leader.id))}</h2>
    <p>${formatPtsMaybe(leader.total)} points — current leader</p>
    <button id="winClose">Close</button>`;
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('#winClose').onclick = () => dialog.close();
  dialog.showModal();
};
```

If `computeLeader()` currently returns only an id, extend it to also return `{ id, name, total }` (read the team name from state). Reuse any existing points formatter; if none, inline `Math.round(total*10)/10`.

- [ ] **Step 3: Parameterize confetti count**

Change `function confetti() {` to `function confetti(count = 60) {` and use `count` in the spawn loop (currently hardcoded 60). The auto leader-change call stays `confetti()` (default 60); the celebrate call passes 120.

- [ ] **Step 4: Popover styles**

Add:

```css
  .winner-pop { background: var(--card); color: var(--text); border: 1px solid var(--border); border-radius: 16px; padding: 28px 32px; text-align: center; }
  .winner-pop::backdrop { background: rgba(0,0,0,0.5); }
  .winner-pop h2 { font-size: 28px; margin-bottom: 8px; }
  .winner-pop button { margin-top: 16px; background: var(--bg-2); border: 1px solid var(--border); color: var(--text); border-radius: 10px; padding: 10px 18px; font-weight: 700; cursor: pointer; font-family: inherit; }
```

- [ ] **Step 5: Manual verification**

Build + open scoreboard as admin with a few scores entered. Click 🎉 Celebrate winner → full-screen confetti rains + a popover names the leading team and its points. Close dismisses it. The button is not visible to a team (admin-only — gate by the existing admin flag/edit controls visibility).

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/scoreboard.html
git commit -m "feat(scoreboard): admin winner celebration — popover + full-screen confetti"
```

---

## Task 9: Full build + regression + smoke

**Files:** none (verification only)

- [ ] **Step 1: Unit tests**

Run: `npx vitest run`
Expected: all green except the pre-existing `tests/lobby.test.js` `document is not defined` suite (unchanged baseline). New `lobby-games.test.js` green.

- [ ] **Step 2: Build**

Run: `npm run build` (Vite). Expected: builds with no errors. (If the project serves source directly, run `npm run dev` and use that URL instead.)

- [ ] **Step 3: End-to-end smoke (browser)**

With Firebase config present, open the app and run the spec's manual checklist:
create lobby → admin /games add/remove/lock/rules/timer + create custom game → team sees only added games, custom routes to manual.html, timer warning works → host scores the custom game on scoreboard → remove a game and confirm column + points drop everywhere (scoreboard + topbar pts) → rename a team from topbar and from scoreboard edit → 🎉 celebrate winner shows popover + confetti.

- [ ] **Step 4: Final commit (docs)**

Mark this plan's checkboxes complete and update `2do.md` (strike the Game Portal bullets covered). Commit:

```bash
git add 2do.md docs/superpowers/plans/2026-06-13-admin-games-portal.md
git commit -m "docs: tick off admin /games portal bullets"
```

---

## Notes for the implementer

- **Immediate writes** in the admin view (each toggle = one Firebase write) are intentional — there is no Save/Cancel buffer here, unlike scoreboard score entry. The two confirm-prompts (game-level rules/timer when per-team overrides exist) guard the cascade-clear in `setGameOverride`.
- **Do not import `lobby.js` or `theme.js` from `lobby-games.js`** — they touch `document` at import and would re-introduce the node-test crash.
- The pre-existing red `tests/lobby.test.js` (theme.js `document` access) is **out of scope** for this plan; don't "fix" it here unless asked.
- Firebase security rules remain open by design (one-day event). The new `games/*` write surface is consistent with that; all rendered fields are `esc()`-escaped.
