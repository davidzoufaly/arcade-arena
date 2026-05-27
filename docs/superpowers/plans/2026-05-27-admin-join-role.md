# Admin as a Join Role — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make admin an explicit persisted join role (parallel to a team) reached via "Enter as Admin" in the lobby join list; remove the spectator card/concept.

**Architecture:** A single localStorage key holds a discriminated-union session — team `{lobbyId, teamId, teamPwd}` or admin `{lobbyId, role:'admin', adminPwd}`. The scoreboard shows admin actions only for an admin session; the topbar gains an admin mode; `requireAdmin` checks the persisted admin session first and falls back to the existing password prompt (so in-game restart still works on a player's device).

**Tech Stack:** Vanilla ES modules, Firebase Realtime DB (gstatic ESM), Vite dev server, Vitest for the pure `lobby.js` logic.

**Spec:** `docs/superpowers/specs/2026-05-27-admin-join-role-design.md`

**Conventions:**
- Run unit tests: `npx vitest run tests/lobby.test.js`
- Dev server (manual verification): `npm run dev` → opens `http://localhost:5173/index.html`
- Production build sanity check: `npm run build`
- `requireAdmin` and `admin-gate.js` cannot be unit-tested (top-level `import` of Firebase from an `https://` URL fails under Vitest/node). Verify those manually.

---

## File Structure

- **Modify** `ps-offsite-2026/shared/lobby.js` — session becomes a discriminated union; add `isAdminSession`; make `resolveSession` role-aware. *(unit-tested)*
- **Modify** `tests/lobby.test.js` — add admin-session + admin-resolveSession cases.
- **Modify** `ps-offsite-2026/shared/admin-gate.js` — `requireAdmin` checks persisted admin session first, prompt fallback unchanged. *(manual)*
- **Modify** `ps-offsite-2026/index.html` — delete spectator card + flow; add "Enter as Admin" to the team picker; admin branch in `doJoin`; admin-aware bootstrap redirect. *(manual)*
- **Modify** `ps-offsite-2026/shared/topbar.js` — replace team/spectator modes with team/admin modes. *(manual)*
- **Modify** `ps-offsite-2026/scoreboard.html` — render Reset only for an admin session. *(manual)*
- **Modify** `BUILD_PLAN.md` — tick the admin-view item.

---

## Task 1: Session model in `lobby.js` (TDD)

**Files:**
- Modify: `ps-offsite-2026/shared/lobby.js` (`getSession`, add `isAdminSession`, `resolveSession`)
- Test: `tests/lobby.test.js`

- [ ] **Step 1: Write the failing tests**

Add these blocks to `tests/lobby.test.js`. Put the `isAdminSession` import on the existing import from `'../ps-offsite-2026/shared/lobby.js'` at the top (add `isAdminSession,` to the named imports). Append the test blocks at the end of the file.

```js
describe('getSession admin shape', () => {
  it('round-trips an admin session', () => {
    mockLocalStorage();
    setSession({ lobbyId: 'PS-7K2X', role: 'admin', adminPwd: 'ABCDEF' });
    expect(getSession()).toEqual({ lobbyId: 'PS-7K2X', role: 'admin', adminPwd: 'ABCDEF' });
  });
  it('rejects an admin session with no adminPwd and clears it', () => {
    mockLocalStorage();
    globalThis.localStorage.setItem(SESSION_KEY, JSON.stringify({ lobbyId: 'PS-7K2X', role: 'admin' }));
    expect(getSession()).toBeNull();
    expect(globalThis.localStorage.getItem(SESSION_KEY)).toBeNull();
  });
  it('still accepts a team session', () => {
    mockLocalStorage();
    setSession({ lobbyId: 'PS-7K2X', teamId: 2, teamPwd: 'X' });
    expect(getSession()).toEqual({ lobbyId: 'PS-7K2X', teamId: 2, teamPwd: 'X' });
  });
});

describe('isAdminSession', () => {
  it('is true for an admin session', () => {
    expect(isAdminSession({ lobbyId: 'PS-7K2X', role: 'admin', adminPwd: 'X' })).toBe(true);
  });
  it('is false for a team session', () => {
    expect(isAdminSession({ lobbyId: 'PS-7K2X', teamId: 1, teamPwd: 'X' })).toBe(false);
  });
  it('is false for null', () => {
    expect(isAdminSession(null)).toBe(false);
  });
});

describe('resolveSession admin', () => {
  it('returns admin context from a stored admin session', async () => {
    mockLocation('');
    mockLocalStorage();
    const mod = await import('../ps-offsite-2026/shared/lobby.js');
    mod.setSession({ lobbyId: 'PS-AAAA', role: 'admin', adminPwd: 'X' });
    expect(mod.resolveSession()).toEqual({ lobbyId: 'PS-AAAA', role: 'admin' });
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/lobby.test.js`
Expected: FAIL — `isAdminSession is not a function` / admin round-trip returns `null` (current `getSession` rejects the admin shape).

- [ ] **Step 3: Implement the session union**

In `ps-offsite-2026/shared/lobby.js`, replace the whole `getSession` function with:

```js
export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.lobbyId === 'string') {
      if (parsed.role === 'admin' && typeof parsed.adminPwd === 'string') {
        return parsed;
      }
      if (Number.isInteger(parsed.teamId) && typeof parsed.teamPwd === 'string') {
        return parsed;
      }
    }
    localStorage.removeItem(SESSION_KEY);
    return null;
  } catch {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    return null;
  }
}

export function isAdminSession(s) {
  return !!s && s.role === 'admin';
}
```

Then replace the whole `resolveSession` function with:

```js
export function resolveSession() {
  const params = new URLSearchParams(location.search);
  const urlLobby = params.get('lobby');
  const urlTeam = params.get('team');
  if (urlLobby && urlTeam && isValidLobbyId(urlLobby)) {
    const teamId = parseInt(urlTeam, 10);
    if (Number.isInteger(teamId) && teamId > 0) {
      return { lobbyId: urlLobby, teamId };
    }
  }
  const s = getSession();
  if (!s) return null;
  if (isAdminSession(s)) return { lobbyId: s.lobbyId, role: 'admin' };
  return { lobbyId: s.lobbyId, teamId: s.teamId };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/lobby.test.js`
Expected: PASS (all existing + new cases).

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/lobby.js tests/lobby.test.js
git commit -m "feat(lobby): support admin session in discriminated-union model"
```

---

## Task 2: `requireAdmin` checks the persisted admin session first

**Files:**
- Modify: `ps-offsite-2026/shared/admin-gate.js`

No unit test (Firebase https import breaks under Vitest). Verified manually in Task 6.

- [ ] **Step 1: Add session imports**

In `ps-offsite-2026/shared/admin-gate.js`, change the lobby import line:

```js
import { createLobbyApi } from './lobby.js';
```

to:

```js
import { createLobbyApi, getSession, isAdminSession } from './lobby.js';
```

- [ ] **Step 2: Short-circuit on a matching admin session**

Replace the whole `requireAdmin` function body's opening so the persisted admin session is honored before any prompt. The full new function:

```js
export async function requireAdmin(lobbyId, { promptText } = {}) {
  if (!lobbyId) return false;
  const session = getSession();
  if (isAdminSession(session) && session.lobbyId === lobbyId) return true;
  const api = getApi();
  const key = storageKey(lobbyId);
  let cached = null;
  try { cached = sessionStorage.getItem(key); } catch {}
  if (cached && await api.verifyAdminPwd(lobbyId, cached)) return true;
  const entered = prompt(promptText || `Admin password for lobby ${lobbyId}:`);
  if (!entered) return false;
  const pwd = entered.trim().toUpperCase();
  const ok = await api.verifyAdminPwd(lobbyId, pwd);
  if (!ok) { alert('Wrong admin password.'); return false; }
  try { sessionStorage.setItem(key, pwd); } catch {}
  return true;
}
```

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/shared/admin-gate.js
git commit -m "feat(admin-gate): honor persisted admin session before prompting"
```

---

## Task 3: Index entry — remove spectator card, add "Enter as Admin"

**Files:**
- Modify: `ps-offsite-2026/index.html`

No unit test (DOM/Firebase page). Verified manually in Task 6.

- [ ] **Step 1: Delete the spectator card markup**

Remove this entire block from the `view-create-join` section (the third `.lobby-card`):

```html
      <div class="lobby-card">
        <h2>View scoreboard</h2>
        <label for="spectateLobbyId">Lobby ID</label>
        <input id="spectateLobbyId" type="text" placeholder="PS-XXXX" maxlength="7" autocomplete="off">
        <button id="spectateBtn">View scoreboard</button>
        <div id="spectateErr" class="lobby-banner err" hidden></div>
      </div>
```

- [ ] **Step 2: Give the join password label an id**

In the join card, change:

```html
          <label for="joinTeamPwd">Team password</label>
```

to:

```html
          <label for="joinTeamPwd" id="joinPwdLabel">Team password</label>
```

- [ ] **Step 3: Delete the spectator flow JS**

Remove this entire block from the `<script type="module">`:

```js
// ---------- spectator flow ----------
$('spectateLobbyId').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});
$('spectateBtn').addEventListener('click', async () => {
  hideErr('spectateErr');
  const id = $('spectateLobbyId').value.trim();
  if (!isValidLobbyId(id)) {
    showErr('spectateErr', 'Lobby ID format: PS-XXXX (uppercase, no 0/O/1/I).');
    return;
  }
  $('spectateBtn').disabled = true;
  try {
    await api.loadLobbyTeams(id);
    location.href = `scoreboard.html?lobby=${encodeURIComponent(id)}`;
  } catch (e) {
    if (e.code === 'NOT_FOUND') showErr('spectateErr', 'Lobby not found. Check the ID.');
    else showErr('spectateErr', e.message || 'Failed to load lobby.');
  } finally {
    $('spectateBtn').disabled = false;
  }
});
```

- [ ] **Step 4: Add the admin import**

Change the import from `./shared/lobby.js`:

```js
import {
  createLobbyApi, isValidLobbyId,
  getSession, setSession,
} from './shared/lobby.js';
```

to:

```js
import {
  createLobbyApi, isValidLobbyId,
  getSession, setSession, isAdminSession,
} from './shared/lobby.js';
```

- [ ] **Step 5: Append the "Enter as Admin" option in the team picker**

In `revealTeamPicker`, replace the `list.innerHTML = ...` assignment with one that appends the admin option and wires the label toggle. Replace:

```js
    const list = $('teamPickerList');
    list.innerHTML = teams.map((t, i) => `
      <label class="team-option">
        <input type="radio" name="teamPick" value="${t.id}" ${i === 0 ? 'checked' : ''}>
        <span>${esc(t.name)}</span>
      </label>
    `).join('');
    $('teamPicker').hidden = false;
    $('joinFinalBtn').onclick = () => doJoin(lobbyId);
```

with:

```js
    const list = $('teamPickerList');
    list.innerHTML = teams.map((t, i) => `
      <label class="team-option">
        <input type="radio" name="teamPick" value="${t.id}" ${i === 0 ? 'checked' : ''}>
        <span>${esc(t.name)}</span>
      </label>
    `).join('') + `
      <label class="team-option team-option-admin">
        <input type="radio" name="teamPick" value="__admin__">
        <span>Enter as Admin</span>
      </label>`;
    list.onchange = () => {
      const isAdmin = document.querySelector('input[name="teamPick"]:checked')?.value === '__admin__';
      $('joinPwdLabel').textContent = isAdmin ? 'Admin password' : 'Team password';
    };
    $('teamPicker').hidden = false;
    $('joinFinalBtn').onclick = () => doJoin(lobbyId);
```

- [ ] **Step 6: Add the admin branch to `doJoin`**

Replace the whole `doJoin` function with:

```js
async function doJoin(lobbyId) {
  hideErr('joinErr');
  const radio = document.querySelector('input[name="teamPick"]:checked');
  if (!radio) { showErr('joinErr', 'Pick a team.'); return; }
  const pwd = $('joinTeamPwd').value.trim().toUpperCase();
  if (!pwd) { showErr('joinErr', 'Enter password.'); return; }
  if (radio.value === '__admin__') {
    const ok = await api.verifyAdminPwd(lobbyId, pwd);
    if (!ok) { showErr('joinErr', 'Wrong admin password.'); return; }
    setSession({ lobbyId, role: 'admin', adminPwd: pwd });
    location.href = `scoreboard.html?lobby=${encodeURIComponent(lobbyId)}`;
    return;
  }
  const teamId = parseInt(radio.value, 10);
  const ok = await api.verifyTeamPwd(lobbyId, teamId, pwd);
  if (!ok) { showErr('joinErr', 'Wrong password.'); return; }
  setSession({ lobbyId, teamId, teamPwd: pwd });
  location.href = `games.html?lobby=${encodeURIComponent(lobbyId)}&team=${teamId}`;
}
```

- [ ] **Step 7: Make the bootstrap redirect admin-aware**

Replace the bottom bootstrap block:

```js
// ---------- bootstrap ----------
const session = getSession();
if (session) {
  location.replace(`games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`);
} else {
  show('view-create-join');
}
```

with:

```js
// ---------- bootstrap ----------
const session = getSession();
if (session && isAdminSession(session)) {
  location.replace(`scoreboard.html?lobby=${encodeURIComponent(session.lobbyId)}`);
} else if (session) {
  location.replace(`games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`);
} else {
  show('view-create-join');
}
```

- [ ] **Step 8: Commit**

```bash
git add ps-offsite-2026/index.html
git commit -m "feat(index): replace spectator card with Enter-as-Admin join option"
```

---

## Task 4: Topbar — team/admin modes

**Files:**
- Modify: `ps-offsite-2026/shared/topbar.js`

No unit test (DOM/Firebase). Verified manually in Task 6.

- [ ] **Step 1: Rebuild the header for admin instead of spectator**

Replace the whole `buildHeader` function with (renames the `spectator` param to `admin`, admin info shows `Admin`, leave label always `Leave`):

```js
function buildHeader({ lobbyId, teamId }, activePage, admin) {
  const pfx = prefix();
  const lobbyQ = `?lobby=${encodeURIComponent(lobbyId)}${teamId ? `&team=${teamId}` : ''}`;
  const indexHref    = `${pfx}index.html`;
  const gamesHref    = `${pfx}games.html${lobbyQ}`;
  const scoreHref    = `${pfx}scoreboard.html?lobby=${encodeURIComponent(lobbyId)}`;

  const nav = admin
    ? `<a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>`
    : `<a data-nav="games" href="${gamesHref}">Games</a>
       <a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>`;
  const info = admin
    ? `Lobby <code>${esc(lobbyId)}</code> · <strong>Admin</strong>`
    : `Lobby <code>${esc(lobbyId)}</code> · <strong>Team ${teamId}</strong> · <strong class="ps-topbar-pts" title="Total rank-points across all entered games">— pts</strong>`;
  const brandHref = admin ? scoreHref : gamesHref;
  const leaveLabel = 'Leave';

  const header = document.createElement('header');
  header.className = 'ps-topbar';
  header.innerHTML = `
    <a class="ps-topbar-brand" href="${brandHref}">PS Offsite</a>
    <nav class="ps-topbar-nav">${nav}</nav>
    <div class="ps-topbar-info">${info}</div>
    <button class="ps-topbar-leave" type="button">${leaveLabel}</button>
  `;
  const activeLink = header.querySelector(`a[data-nav="${activePage}"]`);
  if (activeLink) activeLink.setAttribute('aria-current', 'page');
  header.querySelector('.ps-topbar-leave').addEventListener('click', () => {
    clearSession();
    location.href = indexHref;
  });
  return header;
}
```

- [ ] **Step 2: Replace `mountTopbar`'s spectator logic with admin logic**

Replace the whole `mountTopbar` function with:

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
    subscribeTeamPoints(ctx.lobbyId, ctx.teamId, total => {
      ptsEl.textContent = `${formatPts(total)} pts`;
    });
  }
}
```

Note: `isValidLobbyId` may now be an unused import in this file. Remove it from the top import (`import { resolveSession, clearSession } from './lobby.js';`) to keep the file clean.

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/shared/topbar.js
git commit -m "feat(topbar): admin mode replaces spectator mode"
```

---

## Task 5: Scoreboard — Reset only for an admin session

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html`

No unit test (DOM/Firebase). Verified manually in Task 6.

- [ ] **Step 1: Empty the static controls container**

Replace the header controls block:

```html
  <div class="controls">
    <button onclick="resetAll()" class="admin-btn danger"><span class="admin-chip">ADMIN</span>Reset</button>
  </div>
```

with:

```html
  <div class="controls" id="controls"></div>
```

- [ ] **Step 2: Import the session helpers**

In the main `<script type="module">` (the one importing `requireAdmin`), add the lobby import after the existing imports:

```js
import { getSession, isAdminSession } from './shared/lobby.js';
```

- [ ] **Step 3: Inject the Reset button only for an admin session**

Replace the existing `resetAll` definition and its `window.resetAll = resetAll;` line:

```js
async function resetAll() {
  if (!await requireAdmin(lobbyId)) return;
  if (!confirm(`Wipe scores and history for lobby ${lobbyId}? Teams are kept. This affects everyone in this lobby.`)) return;
  await set(ref(db, `${LOBBY_PATH}/scores`), null);
  await set(ref(db, `${LOBBY_PATH}/history`), null);
}
window.resetAll = resetAll;
```

with:

```js
async function resetAll() {
  if (!await requireAdmin(lobbyId)) return;
  if (!confirm(`Wipe scores and history for lobby ${lobbyId}? Teams are kept. This affects everyone in this lobby.`)) return;
  await set(ref(db, `${LOBBY_PATH}/scores`), null);
  await set(ref(db, `${LOBBY_PATH}/history`), null);
}

const adminSession = getSession();
if (isAdminSession(adminSession) && adminSession.lobbyId === lobbyId) {
  const controls = document.getElementById('controls');
  const resetBtn = document.createElement('button');
  resetBtn.className = 'admin-btn danger';
  resetBtn.innerHTML = '<span class="admin-chip">ADMIN</span>Reset';
  resetBtn.addEventListener('click', resetAll);
  controls.appendChild(resetBtn);
}
```

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/scoreboard.html
git commit -m "feat(scoreboard): show Reset only for an admin session"
```

---

## Task 6: Manual end-to-end verification + build + build-plan tick

**Files:**
- Modify: `BUILD_PLAN.md`

- [ ] **Step 1: Run the unit suite**

Run: `npx vitest run`
Expected: PASS (lobby suite includes the new admin cases; nothing else regressed).

- [ ] **Step 2: Start the dev server**

Run: `npm run dev`
Opens `http://localhost:5173/index.html`. Requires a real `firebase-config.js` (already present in repo).

- [ ] **Step 3: Walk the golden path + edge cases in the browser**

Verify each:
1. Index shows **two** cards only (Create lobby, Join lobby). No "View scoreboard" card.
2. Create a lobby (e.g. 4 teams); note the admin password from the credentials view; Continue.
3. The team picker lists the teams **and** an "Enter as Admin" option at the bottom.
4. Selecting "Enter as Admin" relabels the password field to "Admin password"; selecting a team relabels it to "Team password".
5. Enter as Admin with the correct password → lands on `scoreboard.html?lobby=…`; topbar shows `Admin` and nav has Scoreboard only (no Games); a Reset button with the ADMIN chip is visible.
6. Refresh the scoreboard → still admin, Reset still visible, no password prompt.
7. Click Reset → confirm dialog → after a submitted score, scores/history clear and teams remain.
8. Click Leave (admin) → returns to index; opening the scoreboard URL again now redirects to index (no session).
9. In a second browser/profile, join as a real team → from the topbar open Scoreboard → board renders with **no** Reset button.
10. As that team, open an already-played game and trigger restart → the admin-password prompt still appears and a correct password allows the restart.
11. Wrong admin password on the join screen → inline "Wrong admin password." error, no redirect.
12. Open `scoreboard.html?lobby=PS-XXXX` directly with no session/localStorage → redirects to index.

If any step fails, fix the relevant task's file before continuing.

- [ ] **Step 4: Production build sanity check**

Run: `npm run build`
Expected: build succeeds with no errors.

- [ ] **Step 5: Tick the build-plan item**

In `BUILD_PLAN.md`, change line 60 from:

```
- [] admin view -> pri joinu do lobby je pod týmama ještě join as admin -> to chce admin heslo -> vidím scoreboard + admin akce (reset scoreboard)
```

to:

```
- [x] admin view -> pri joinu do lobby je pod týmama ještě join as admin -> to chce admin heslo -> vidím scoreboard + admin akce (reset scoreboard)
```

- [ ] **Step 6: Commit**

```bash
git add BUILD_PLAN.md
git commit -m "chore: mark admin-view join role done in build plan"
```

---

## Self-Review notes

- **Spec coverage:** spectator card removed (Task 3) ✓; spectator concept dropped / raw link redirects (Task 4 `mountTopbar` returns null→index) ✓; "Enter as Admin" in team list (Task 3) ✓; persisted admin session (Task 1 union + Task 3 `setSession`) ✓; topbar Admin mode (Task 4) ✓; Reset only for admin (Task 5) ✓; in-game restart preserved (Task 2 prompt fallback) ✓; error handling for wrong pwd / lobby mismatch / corrupt JSON (Tasks 3, 2/5, 1) ✓.
- **Type consistency:** session shapes `{lobbyId, teamId, teamPwd}` / `{lobbyId, role:'admin', adminPwd}` and `isAdminSession` used identically across `lobby.js`, `admin-gate.js`, `index.html`, `scoreboard.html`; `resolveSession` returns `{lobbyId, role:'admin'}` consumed via `ctx.role === 'admin'` in `topbar.js`. Sentinel `'__admin__'` defined and read only within `index.html`.
- **No placeholders:** every code step contains full replacement code.
