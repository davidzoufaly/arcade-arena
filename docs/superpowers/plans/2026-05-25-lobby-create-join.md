# Lobby Create / Join Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single global Firebase state with isolated, password-protected lobbies. Host creates a lobby and gets credentials; teams join a lobby with their team password before reaching the game hub.

**Architecture:** A single new module `shared/lobby.js` owns lobby ID/password generation, the Firebase RTDB shape `/lobbies/{id}/...`, and the localStorage session. It exposes pure helpers plus a small `createLobbyApi({get, set})` factory that injects Firebase data ops — production code wires real `firebase/database` functions, tests inject fakes. `index.html` is rewritten into three view-states (create-join / credentials / hub). `scoreboard.html` reads `?lobby=` from the URL and prepends `/lobbies/{id}` to every `ref()` path.

**Tech Stack:** Vanilla JS ES modules, Firebase Realtime Database (web SDK 10.13 via CDN), Vitest for unit tests, no bundler in runtime (Vite only for dev).

**Spec:** [`docs/superpowers/specs/2026-05-25-lobby-create-join-design.md`](../specs/2026-05-25-lobby-create-join-design.md)

---

## File Map

**Create:**
- `ps-offsite-2026/shared/lobby.js` — id/pwd generators, validators, `createLobbyApi({get, set})` factory, session helpers.
- `ps-offsite-2026/shared/lobby.css` — landing-page styles (cards, credentials table, copy buttons). Linked from `index.html`.
- `tests/lobby.test.js` — vitest unit tests for `lobby.js`.

**Modify:**
- `ps-offsite-2026/index.html` — rewrite body into `#view-create-join` / `#view-credentials` / `#view-hub`. Drop old `TEAM_KEY` / `teamSelect` logic. Keep QR generator inside `#view-hub`.
- `ps-offsite-2026/scoreboard.html` — read `?lobby=` URL param; redirect to `index.html` if missing; namespace every `ref()` under `/lobbies/{id}/`; remove `ensureSeed()`.

---

## Task 1: Lobby ID + password generators

**Files:**
- Create: `ps-offsite-2026/shared/lobby.js`
- Create: `tests/lobby.test.js`

- [ ] **Step 1.1: Write failing tests for `generateLobbyId`, `generatePwd`, `isValidLobbyId`**

Create `tests/lobby.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { generateLobbyId, generatePwd, isValidLobbyId, ALPHABET } from '../ps-offsite-2026/shared/lobby.js';

describe('ALPHABET', () => {
  it('excludes ambiguous chars 0 O 1 I', () => {
    expect(ALPHABET).not.toMatch(/[01OI]/);
  });
  it('is 32 chars (uppercase A-Z minus I,O + digits 2-9)', () => {
    expect(ALPHABET.length).toBe(32);
  });
});

describe('generateLobbyId', () => {
  it('matches /^PS-[A-Z2-9]{4}$/ with no ambiguous chars', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateLobbyId();
      expect(id).toMatch(/^PS-[A-HJ-NP-Z2-9]{4}$/);
    }
  });
});

describe('generatePwd', () => {
  it('defaults to length 6 using ALPHABET', () => {
    const pwd = generatePwd();
    expect(pwd).toHaveLength(6);
    for (const c of pwd) expect(ALPHABET).toContain(c);
  });
  it('honors explicit length', () => {
    expect(generatePwd(10)).toHaveLength(10);
  });
});

describe('isValidLobbyId', () => {
  it('accepts PS-7K2X', () => {
    expect(isValidLobbyId('PS-7K2X')).toBe(true);
  });
  it('rejects lowercase', () => {
    expect(isValidLobbyId('ps-7k2x')).toBe(false);
  });
  it('rejects ambiguous chars', () => {
    expect(isValidLobbyId('PS-0K2X')).toBe(false);
    expect(isValidLobbyId('PS-OK2X')).toBe(false);
    expect(isValidLobbyId('PS-1K2X')).toBe(false);
    expect(isValidLobbyId('PS-IK2X')).toBe(false);
  });
  it('rejects wrong length', () => {
    expect(isValidLobbyId('PS-7K2')).toBe(false);
    expect(isValidLobbyId('PS-7K2XY')).toBe(false);
  });
  it('rejects missing prefix', () => {
    expect(isValidLobbyId('7K2X')).toBe(false);
  });
});
```

- [ ] **Step 1.2: Run tests — must fail with "module not found"**

```bash
npx vitest run tests/lobby.test.js
```

Expected: FAIL — `Failed to load url ../ps-offsite-2026/shared/lobby.js`.

- [ ] **Step 1.3: Create `lobby.js` with minimal exports**

```js
// ps-offsite-2026/shared/lobby.js
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_ID_RE = /^PS-[A-HJ-NP-Z2-9]{4}$/;

function pick(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function generateLobbyId() {
  return `PS-${pick(4)}`;
}

export function generatePwd(len = 6) {
  return pick(len);
}

export function isValidLobbyId(s) {
  return typeof s === 'string' && LOBBY_ID_RE.test(s);
}
```

- [ ] **Step 1.4: Run tests — must pass**

```bash
npx vitest run tests/lobby.test.js
```

Expected: all green.

- [ ] **Step 1.5: Commit**

```bash
git add ps-offsite-2026/shared/lobby.js tests/lobby.test.js
git commit -m "feat(lobby): id and password generators"
```

---

## Task 2: Session helpers (localStorage)

**Files:**
- Modify: `ps-offsite-2026/shared/lobby.js`
- Modify: `tests/lobby.test.js`

- [ ] **Step 2.1: Add failing tests for session helpers**

Append to `tests/lobby.test.js`:

```js
import { getSession, setSession, clearSession, SESSION_KEY, LEGACY_TEAM_KEY } from '../ps-offsite-2026/shared/lobby.js';

function mockLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
}

describe('session helpers', () => {
  it('round-trips a session', () => {
    mockLocalStorage();
    setSession({ lobbyId: 'PS-7K2X', teamId: 3, teamPwd: 'ABCDEF' });
    expect(getSession()).toEqual({ lobbyId: 'PS-7K2X', teamId: 3, teamPwd: 'ABCDEF' });
  });
  it('returns null when nothing stored', () => {
    mockLocalStorage();
    expect(getSession()).toBeNull();
  });
  it('returns null and clears on corrupt JSON', () => {
    mockLocalStorage();
    globalThis.localStorage.setItem(SESSION_KEY, '{not json');
    expect(getSession()).toBeNull();
    expect(globalThis.localStorage.getItem(SESSION_KEY)).toBeNull();
  });
  it('clearSession removes the key', () => {
    mockLocalStorage();
    setSession({ lobbyId: 'PS-7K2X', teamId: 1, teamPwd: 'X' });
    clearSession();
    expect(getSession()).toBeNull();
  });
  it('drops legacy team key on first import side-effect', () => {
    mockLocalStorage();
    globalThis.localStorage.setItem(LEGACY_TEAM_KEY, '7');
    // Re-import to trigger module-load side effect
    return import(`../ps-offsite-2026/shared/lobby.js?bust=${Date.now()}`).then(() => {
      expect(globalThis.localStorage.getItem(LEGACY_TEAM_KEY)).toBeNull();
    });
  });
});
```

- [ ] **Step 2.2: Run tests — session tests fail**

```bash
npx vitest run tests/lobby.test.js
```

Expected: FAIL — `getSession is not a function` etc.

- [ ] **Step 2.3: Implement session helpers**

Append to `ps-offsite-2026/shared/lobby.js`:

```js
export const SESSION_KEY = 'psOffsite2026.lobby';
export const LEGACY_TEAM_KEY = 'psOffsite2026.team';

// Drop stale key from the old (pre-lobby) version. Runs once per module load.
try {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_TEAM_KEY);
} catch {}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.lobbyId === 'string' &&
      Number.isInteger(parsed.teamId) &&
      typeof parsed.teamPwd === 'string'
    ) {
      return parsed;
    }
    localStorage.removeItem(SESSION_KEY);
    return null;
  } catch {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    return null;
  }
}

export function setSession(s) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(s));
}

export function clearSession() {
  localStorage.removeItem(SESSION_KEY);
}
```

- [ ] **Step 2.4: Run tests — must pass**

```bash
npx vitest run tests/lobby.test.js
```

Expected: all green.

- [ ] **Step 2.5: Commit**

```bash
git add ps-offsite-2026/shared/lobby.js tests/lobby.test.js
git commit -m "feat(lobby): localStorage session helpers"
```

---

## Task 3: `createLobbyApi` — createLobby with collision retry

**Files:**
- Modify: `ps-offsite-2026/shared/lobby.js`
- Modify: `tests/lobby.test.js`

The factory takes a `{get, set}` adapter (production wires Firebase, tests inject fakes). It returns async methods that operate on `/lobbies/{id}` paths.

- [ ] **Step 3.1: Add failing tests for `createLobby`**

Append to `tests/lobby.test.js`:

```js
import { createLobbyApi } from '../ps-offsite-2026/shared/lobby.js';

function fakeAdapter(initialData = {}) {
  let data = JSON.parse(JSON.stringify(initialData));
  const writes = [];
  return {
    data: () => data,
    writes: () => writes,
    get: async (path) => {
      const parts = path.split('/').filter(Boolean);
      let cur = data;
      for (const p of parts) {
        if (cur == null) return null;
        cur = cur[p];
      }
      return cur ?? null;
    },
    set: async (path, value) => {
      writes.push({ path, value });
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 0) { data = value; return; }
      let cur = data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
    },
  };
}

describe('createLobbyApi.createLobby', () => {
  it('writes a fresh lobby with teamCount teams', async () => {
    const a = fakeAdapter();
    const api = createLobbyApi(a);
    const result = await api.createLobby(4);

    expect(result.lobbyId).toMatch(/^PS-[A-HJ-NP-Z2-9]{4}$/);
    expect(result.adminPwd).toHaveLength(6);
    expect(result.teams).toHaveLength(4);
    expect(result.teams.map(t => t.id)).toEqual([1, 2, 3, 4]);
    for (const t of result.teams) {
      expect(t.name).toBe(`Team ${t.id}`);
      expect(t.pwd).toHaveLength(6);
    }

    const stored = a.data().lobbies[result.lobbyId];
    expect(stored.meta.teamCount).toBe(4);
    expect(stored.meta.adminPwd).toBe(result.adminPwd);
    expect(stored.teams[1].pwd).toBe(result.teams[0].pwd);
  });

  it('retries on collision up to 5 times', async () => {
    const a = fakeAdapter();
    // Pre-seed 4 collisions; 5th attempt should succeed.
    let calls = 0;
    const origGet = a.get;
    a.get = async (path) => {
      if (path.startsWith('lobbies/PS-') && calls < 4) {
        calls++;
        return { meta: { teamCount: 1, adminPwd: 'X', createdAt: 0 } };
      }
      return origGet(path);
    };
    const api = createLobbyApi(a);
    const result = await api.createLobby(2);
    expect(result.lobbyId).toBeTruthy();
    expect(calls).toBe(4);
  });

  it('throws after 5 collisions', async () => {
    const a = fakeAdapter();
    a.get = async () => ({ meta: { teamCount: 1, adminPwd: 'X', createdAt: 0 } });
    const api = createLobbyApi(a);
    await expect(api.createLobby(2)).rejects.toThrow(/collision/i);
  });

  it('rejects teamCount out of range', async () => {
    const api = createLobbyApi(fakeAdapter());
    await expect(api.createLobby(1)).rejects.toThrow(/team count/i);
    await expect(api.createLobby(21)).rejects.toThrow(/team count/i);
  });
});
```

- [ ] **Step 3.2: Run tests — must fail**

```bash
npx vitest run tests/lobby.test.js
```

Expected: FAIL — `createLobbyApi is not a function`.

- [ ] **Step 3.3: Implement `createLobbyApi.createLobby`**

Append to `ps-offsite-2026/shared/lobby.js`:

```js
const MAX_CREATE_RETRIES = 5;

export function createLobbyApi({ get, set }) {
  async function createLobby(teamCount) {
    if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 20) {
      throw new Error('team count must be 2..20');
    }
    let lobbyId = null;
    for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
      const candidate = generateLobbyId();
      const existing = await get(`lobbies/${candidate}`);
      if (!existing) { lobbyId = candidate; break; }
    }
    if (!lobbyId) throw new Error('lobby id collision after 5 attempts');

    const adminPwd = generatePwd(6);
    const teams = [];
    const teamsObj = {};
    for (let i = 1; i <= teamCount; i++) {
      const pwd = generatePwd(6);
      teams.push({ id: i, name: `Team ${i}`, pwd });
      teamsObj[i] = { id: i, name: `Team ${i}`, pwd };
    }
    await set(`lobbies/${lobbyId}`, {
      meta: { createdAt: Date.now(), teamCount, adminPwd },
      teams: teamsObj,
    });
    return { lobbyId, adminPwd, teams };
  }

  return { createLobby };
}
```

- [ ] **Step 3.4: Run tests — must pass**

```bash
npx vitest run tests/lobby.test.js
```

Expected: all green.

- [ ] **Step 3.5: Commit**

```bash
git add ps-offsite-2026/shared/lobby.js tests/lobby.test.js
git commit -m "feat(lobby): createLobby with collision retry"
```

---

## Task 4: `createLobbyApi` — loadLobbyTeams + verifyTeamPwd

**Files:**
- Modify: `ps-offsite-2026/shared/lobby.js`
- Modify: `tests/lobby.test.js`

- [ ] **Step 4.1: Add failing tests**

Append to `tests/lobby.test.js`:

```js
describe('createLobbyApi.loadLobbyTeams', () => {
  it('returns id+name list, no passwords', async () => {
    const a = fakeAdapter();
    const api = createLobbyApi(a);
    const { lobbyId } = await api.createLobby(3);
    const teams = await api.loadLobbyTeams(lobbyId);
    expect(teams).toEqual([
      { id: 1, name: 'Team 1' },
      { id: 2, name: 'Team 2' },
      { id: 3, name: 'Team 3' },
    ]);
    for (const t of teams) expect(t).not.toHaveProperty('pwd');
  });

  it('throws NOT_FOUND when lobby missing', async () => {
    const api = createLobbyApi(fakeAdapter());
    await expect(api.loadLobbyTeams('PS-AAAA')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});

describe('createLobbyApi.verifyTeamPwd', () => {
  it('returns true on match', async () => {
    const a = fakeAdapter();
    const api = createLobbyApi(a);
    const { lobbyId, teams } = await api.createLobby(2);
    const t1 = teams[0];
    expect(await api.verifyTeamPwd(lobbyId, t1.id, t1.pwd)).toBe(true);
  });

  it('returns false on wrong pwd', async () => {
    const a = fakeAdapter();
    const api = createLobbyApi(a);
    const { lobbyId } = await api.createLobby(2);
    expect(await api.verifyTeamPwd(lobbyId, 1, 'WRONG1')).toBe(false);
  });

  it('returns false when team missing', async () => {
    const a = fakeAdapter();
    const api = createLobbyApi(a);
    const { lobbyId } = await api.createLobby(2);
    expect(await api.verifyTeamPwd(lobbyId, 99, 'X')).toBe(false);
  });

  it('returns false when lobby missing', async () => {
    const api = createLobbyApi(fakeAdapter());
    expect(await api.verifyTeamPwd('PS-AAAA', 1, 'X')).toBe(false);
  });
});
```

- [ ] **Step 4.2: Run tests — must fail**

```bash
npx vitest run tests/lobby.test.js
```

Expected: FAIL — `loadLobbyTeams is not a function`.

- [ ] **Step 4.3: Implement the two methods**

In `lobby.js`, edit the `return` line at the bottom of `createLobbyApi` and add two methods above it:

```js
  async function loadLobbyTeams(lobbyId) {
    const teamsObj = await get(`lobbies/${lobbyId}/teams`);
    if (!teamsObj) {
      const err = new Error('lobby not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return Object.values(teamsObj)
      .filter(Boolean)
      .map(t => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.id - b.id);
  }

  async function verifyTeamPwd(lobbyId, teamId, pwd) {
    const stored = await get(`lobbies/${lobbyId}/teams/${teamId}/pwd`);
    return typeof stored === 'string' && stored === pwd;
  }

  return { createLobby, loadLobbyTeams, verifyTeamPwd };
```

- [ ] **Step 4.4: Run tests — must pass**

```bash
npx vitest run tests/lobby.test.js
```

Expected: all green.

- [ ] **Step 4.5: Commit**

```bash
git add ps-offsite-2026/shared/lobby.js tests/lobby.test.js
git commit -m "feat(lobby): loadLobbyTeams + verifyTeamPwd"
```

---

## Task 5: Landing CSS

**Files:**
- Create: `ps-offsite-2026/shared/lobby.css`

- [ ] **Step 5.1: Create the stylesheet**

```css
/* ps-offsite-2026/shared/lobby.css */
.lobby-cards {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 24px;
  margin-top: 32px;
}
.lobby-card {
  background: var(--card);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.lobby-card h2 {
  font-size: 22px;
  font-weight: 800;
  background: linear-gradient(90deg, var(--accent), var(--accent-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}
.lobby-card label {
  font-size: 12px;
  color: var(--muted);
  text-transform: uppercase;
  letter-spacing: 1px;
  font-weight: 700;
}
.lobby-card input {
  background: var(--bg-2);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--text);
  padding: 12px 14px;
  border-radius: 10px;
  font-size: 16px;
  font-family: inherit;
  width: 100%;
}
.lobby-card input:focus {
  outline: none;
  border-color: var(--accent);
  box-shadow: 0 0 0 3px rgba(0,212,255,0.15);
}
.lobby-card button {
  background: linear-gradient(135deg, var(--accent), #0099cc);
  border: none;
  color: #001;
  padding: 12px 18px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  font-family: inherit;
}
.lobby-card button[disabled] { opacity: 0.4; cursor: not-allowed; }

.lobby-banner {
  margin-top: 12px;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 13px;
}
.lobby-banner.err {
  background: rgba(255,77,109,0.15);
  color: #ff4d6d;
  border: 1px solid rgba(255,77,109,0.3);
}

.lobby-credentials {
  background: var(--card);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 16px;
  padding: 28px;
  margin-top: 24px;
}
.lobby-credentials .big {
  display: flex;
  align-items: center;
  gap: 16px;
  margin-bottom: 24px;
}
.lobby-credentials .big .code {
  font-family: ui-monospace, monospace;
  font-size: 28px;
  font-weight: 900;
  letter-spacing: 2px;
  color: var(--accent);
}
.lobby-credentials table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 8px;
}
.lobby-credentials th, .lobby-credentials td {
  text-align: left;
  padding: 10px 12px;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  font-size: 14px;
}
.lobby-credentials th {
  color: var(--muted);
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 1px;
}
.lobby-credentials td .code {
  font-family: ui-monospace, monospace;
  letter-spacing: 1.5px;
}
.lobby-credentials .copy-btn {
  background: var(--bg-2);
  border: 1px solid rgba(255,255,255,0.1);
  color: var(--text);
  border-radius: 8px;
  padding: 4px 10px;
  font-size: 12px;
  cursor: pointer;
  font-family: inherit;
}
.lobby-credentials .copy-btn:hover { background: var(--card); }
.lobby-credentials .continue {
  margin-top: 24px;
  background: linear-gradient(135deg, var(--accent), #0099cc);
  border: none;
  color: #001;
  padding: 12px 22px;
  border-radius: 10px;
  font-size: 15px;
  font-weight: 800;
  cursor: pointer;
  font-family: inherit;
}

.lobby-strip {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--card);
  border: 1px solid rgba(255,255,255,0.06);
  border-radius: 12px;
  padding: 14px 20px;
  margin-bottom: 24px;
}
.lobby-strip .info { font-size: 14px; }
.lobby-strip .info .code { font-family: ui-monospace, monospace; color: var(--accent); letter-spacing: 1.5px; }
.lobby-strip button {
  background: transparent;
  border: 1px solid rgba(255,255,255,0.15);
  color: var(--muted);
  padding: 8px 14px;
  border-radius: 8px;
  font-size: 13px;
  cursor: pointer;
  font-family: inherit;
}
.lobby-strip button:hover { color: var(--text); border-color: var(--accent); }

.team-picker {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.team-picker label.team-option {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: var(--bg-2);
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  cursor: pointer;
  font-size: 14px;
  text-transform: none;
  letter-spacing: 0;
}
.team-picker label.team-option input { width: auto; }
```

- [ ] **Step 5.2: Commit**

```bash
git add ps-offsite-2026/shared/lobby.css
git commit -m "feat(lobby): landing page styles"
```

---

## Task 6: Rewrite `index.html`

**Files:**
- Modify: `ps-offsite-2026/index.html`

This rewrites the body into three view-states and wires `lobby.js` to Firebase. The existing QR generator section moves inside the hub view.

- [ ] **Step 6.1: Replace `<body>` content + script**

Open `ps-offsite-2026/index.html`. Replace lines 110–242 (everything between `<body>` and `</body>` inclusive of contents) with:

```html
<body>
<link rel="stylesheet" href="shared/lobby.css">
<main>
  <h1>PS Offsite 2026</h1>
  <div class="subtitle" id="subtitle">10 teams · 4 stations · one winner</div>

  <!-- ============== VIEW: create-join ============== -->
  <section id="view-create-join" hidden>
    <div class="lobby-cards">
      <div class="lobby-card">
        <h2>Create lobby</h2>
        <label for="createTeamCount">Number of teams</label>
        <input id="createTeamCount" type="number" min="2" max="20" value="10">
        <button id="createBtn">Create lobby</button>
        <div id="createErr" class="lobby-banner err" hidden></div>
      </div>
      <div class="lobby-card">
        <h2>Join lobby</h2>
        <label for="joinLobbyId">Lobby ID</label>
        <input id="joinLobbyId" type="text" placeholder="PS-XXXX" maxlength="7" autocomplete="off">
        <button id="joinContinueBtn">Continue</button>
        <div id="joinErr" class="lobby-banner err" hidden></div>
        <div id="teamPicker" hidden>
          <label>Pick your team</label>
          <div class="team-picker" id="teamPickerList"></div>
          <label for="joinTeamPwd">Team password</label>
          <input id="joinTeamPwd" type="text" maxlength="6" autocomplete="off">
          <button id="joinFinalBtn">Join</button>
        </div>
      </div>
    </div>
  </section>

  <!-- ============== VIEW: credentials ============== -->
  <section id="view-credentials" hidden>
    <div class="lobby-credentials">
      <div class="big">
        <div>
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Lobby ID</div>
          <div class="code" id="credLobbyId"></div>
        </div>
        <button class="copy-btn" data-copy="credLobbyId">Copy</button>
        <div style="margin-left:auto">
          <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px">Admin password</div>
          <div class="code" id="credAdminPwd"></div>
        </div>
        <button class="copy-btn" data-copy="credAdminPwd">Copy</button>
      </div>
      <table>
        <thead>
          <tr><th>#</th><th>Team</th><th>Password</th><th></th></tr>
        </thead>
        <tbody id="credTeamRows"></tbody>
      </table>
      <button class="continue" id="credContinueBtn">Continue → join lobby</button>
    </div>
  </section>

  <!-- ============== VIEW: hub ============== -->
  <section id="view-hub" hidden>
    <div class="lobby-strip">
      <div class="info">Lobby <span class="code" id="hubLobbyId"></span> · <strong id="hubTeamLabel"></strong></div>
      <button id="leaveBtn">Leave lobby</button>
    </div>
    <div class="grid">
      <a class="tile scoreboard" id="tileScoreboard" href="#">
        <div class="tile-emoji">🏆</div>
        <div>
          <div class="tile-num">CENTRAL</div>
          <h3>Scoreboard</h3>
          <p>Open this on the host laptop (projector / TV). Teams report submit codes here.</p>
        </div>
      </a>
      <a class="tile" id="tileGesture" href="#">
        <div class="tile-emoji">✋</div>
        <div class="tile-num">Station 1 · GZ</div>
        <h3>Gesture Lock</h3>
        <p>Unlock the vault with a 4-gesture sequence. MediaPipe Hands.</p>
        <span class="tile-tag">Gestures</span>
      </a>
      <a class="tile" id="tilePantomime" href="#">
        <div class="tile-emoji">🎭</div>
        <div class="tile-num">Station 2 · PM</div>
        <h3>CV Pantomime</h3>
        <p>Match poses to a ghost skeleton overlay. MediaPipe Pose.</p>
        <span class="tile-tag">Body pose</span>
      </a>
      <a class="tile tile-game" id="tileDino" href="#">
        <div class="tile-emoji">🛡️</div>
        <div class="tile-num">Station 3 · DN</div>
        <h3>Pipeline Dash</h3>
        <p>Run the ETL Knight past anomalies. Wave fingers to jump, fist to duck.</p>
        <span class="tile-tag">Hand vision</span>
      </a>
      <a class="tile tile-game" id="tileFlappy" href="#">
        <div class="tile-emoji">📊</div>
        <div class="tile-num">Station 4 · FL</div>
        <h3>Insight Monitor</h3>
        <p>Yell to fly the insight orb past data anomalies.</p>
        <span class="tile-tag">Voice</span>
      </a>
    </div>

    <div class="qr-section">
      <h2>QR codes for stations</h2>
      <p>Paste your deploy URL and QR codes generate for each station, scoped to this lobby and team.</p>
      <input class="base-url" id="baseUrl" type="url" placeholder="https://ps-offsite-2026.netlify.app/">
      <div class="qr-grid" id="qrGrid"></div>
    </div>
  </section>
</main>

<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, get, set } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import {
  createLobbyApi, isValidLobbyId,
  getSession, setSession, clearSession,
} from './shared/lobby.js';

if (!firebaseConfig?.databaseURL || firebaseConfig.databaseURL.includes('REPLACE_ME')) {
  document.body.innerHTML = '<div style="max-width:640px;margin:80px auto;padding:32px;background:#1b2540;border-radius:16px;color:#f5f7fb;font-family:system-ui">Firebase config missing. See SETUP.md.</div>';
  throw new Error('firebase config not filled in');
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Adapter wires Firebase into lobby API
const api = createLobbyApi({
  get: async (path) => {
    const snap = await get(ref(db, path));
    return snap.exists() ? snap.val() : null;
  },
  set: async (path, value) => set(ref(db, path), value),
});

const $ = id => document.getElementById(id);
function show(id) {
  for (const v of ['view-create-join', 'view-credentials', 'view-hub']) {
    $(v).hidden = (v !== id);
  }
}
function showErr(id, msg) {
  const el = $(id);
  el.textContent = msg;
  el.hidden = false;
}
function hideErr(id) { $(id).hidden = true; }

// ---------- create flow ----------
$('createBtn').addEventListener('click', async () => {
  hideErr('createErr');
  const n = parseInt($('createTeamCount').value, 10);
  if (!Number.isInteger(n) || n < 2 || n > 20) {
    showErr('createErr', 'Team count must be 2–20.');
    return;
  }
  $('createBtn').disabled = true;
  try {
    const { lobbyId, adminPwd, teams } = await api.createLobby(n);
    renderCredentials({ lobbyId, adminPwd, teams });
    show('view-credentials');
  } catch (e) {
    showErr('createErr', e.message || 'Failed to create lobby.');
  } finally {
    $('createBtn').disabled = false;
  }
});

function renderCredentials({ lobbyId, adminPwd, teams }) {
  $('credLobbyId').textContent = lobbyId;
  $('credAdminPwd').textContent = adminPwd;
  const tbody = $('credTeamRows');
  tbody.innerHTML = teams.map(t => `
    <tr>
      <td>${t.id}</td>
      <td>${t.name}</td>
      <td><span class="code" id="cred-team-${t.id}">${t.pwd}</span></td>
      <td><button class="copy-btn" data-copy="cred-team-${t.id}">Copy</button></td>
    </tr>
  `).join('');
  $('credContinueBtn').onclick = () => {
    $('joinLobbyId').value = lobbyId;
    show('view-create-join');
    revealTeamPicker(lobbyId);
  };
  document.querySelectorAll('.copy-btn').forEach(btn => {
    btn.onclick = () => {
      const id = btn.dataset.copy;
      const text = document.getElementById(id).textContent;
      navigator.clipboard.writeText(text);
      const orig = btn.textContent;
      btn.textContent = '✓';
      setTimeout(() => { btn.textContent = orig; }, 1200);
    };
  });
}

// ---------- join flow ----------
$('joinLobbyId').addEventListener('input', e => {
  e.target.value = e.target.value.toUpperCase();
});

$('joinContinueBtn').addEventListener('click', async () => {
  hideErr('joinErr');
  const id = $('joinLobbyId').value.trim();
  if (!isValidLobbyId(id)) {
    showErr('joinErr', 'Lobby ID format: PS-XXXX (uppercase, no 0/O/1/I).');
    return;
  }
  revealTeamPicker(id);
});

async function revealTeamPicker(lobbyId) {
  hideErr('joinErr');
  try {
    const teams = await api.loadLobbyTeams(lobbyId);
    const list = $('teamPickerList');
    list.innerHTML = teams.map((t, i) => `
      <label class="team-option">
        <input type="radio" name="teamPick" value="${t.id}" ${i === 0 ? 'checked' : ''}>
        <span>${t.name}</span>
      </label>
    `).join('');
    $('teamPicker').hidden = false;
    $('joinFinalBtn').onclick = () => doJoin(lobbyId);
  } catch (e) {
    if (e.code === 'NOT_FOUND') showErr('joinErr', 'Lobby not found. Check the ID.');
    else showErr('joinErr', e.message || 'Failed to load lobby.');
    $('teamPicker').hidden = true;
  }
}

async function doJoin(lobbyId) {
  hideErr('joinErr');
  const radio = document.querySelector('input[name="teamPick"]:checked');
  if (!radio) { showErr('joinErr', 'Pick a team.'); return; }
  const teamId = parseInt(radio.value, 10);
  const pwd = $('joinTeamPwd').value.trim().toUpperCase();
  if (!pwd) { showErr('joinErr', 'Enter team password.'); return; }
  const ok = await api.verifyTeamPwd(lobbyId, teamId, pwd);
  if (!ok) { showErr('joinErr', 'Wrong password.'); return; }
  setSession({ lobbyId, teamId, teamPwd: pwd });
  location.reload();
}

// ---------- hub ----------
function renderHub(session) {
  $('hubLobbyId').textContent = session.lobbyId;
  $('hubTeamLabel').textContent = `Team ${session.teamId}`;
  const q = `?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;
  $('tileScoreboard').href = `scoreboard.html${q}`;
  $('tileGesture').href = `stations/1-gesture-lock.html${q}`;
  $('tilePantomime').href = `stations/2-pantomime.html${q}`;
  $('tileDino').href = `dino/index.html${q}`;
  $('tileFlappy').href = `flappy/index.html${q}`;
  $('leaveBtn').onclick = () => { clearSession(); location.reload(); };
  $('baseUrl').addEventListener('input', renderQRs);
  renderQRs();
}

function renderQRs() {
  const session = getSession();
  let base = $('baseUrl').value.trim();
  if (base && !base.endsWith('/')) base += '/';
  const grid = $('qrGrid');
  if (!base) {
    grid.innerHTML = '<div style="color:var(--muted); font-size:13px;">↑ Enter a URL to generate QR codes.</div>';
    return;
  }
  const q = `?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;
  const stations = [
    { name: 'Scoreboard', file: 'scoreboard.html' },
    { name: '1 · Gesture Lock', file: 'stations/1-gesture-lock.html' },
    { name: '2 · CV Pantomime', file: 'stations/2-pantomime.html' },
    { name: '3 · Pipeline Dash', file: 'dino/index.html' },
    { name: '4 · Insight Monitor', file: 'flappy/index.html' },
  ];
  grid.innerHTML = stations.map(s => {
    const url = base + s.file + q;
    const qr = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(url)}`;
    return `<div class="qr-tile">
      <img src="${qr}" alt="QR ${s.name}" />
      <div class="label">${s.name}</div>
      <div class="url">${url}</div>
    </div>`;
  }).join('');
}

// ---------- bootstrap ----------
const session = getSession();
if (session) {
  renderHub(session);
  show('view-hub');
} else {
  show('view-create-join');
}
</script>
</body>
```

- [ ] **Step 6.2: Manual smoke-test in browser**

```bash
npm run dev
```

Open the printed URL. With Firebase config filled in:
1. Page shows two cards (create + join).
2. Click "Create lobby" with default 10 → credentials view with lobby ID, admin pwd, 10 rows.
3. Click "Continue → join lobby" → back to create-join view with team picker visible.
4. Pick Team 1, paste its pwd, click Join → hub view.
5. Refresh → still hub.
6. Click "Leave lobby" → back to create-join.
7. Type a bad lobby ID → red banner "Lobby not found" after clicking Continue.

- [ ] **Step 6.3: Commit**

```bash
git add ps-offsite-2026/index.html
git commit -m "feat(lobby): landing with create / join / credentials / hub views"
```

---

## Task 7: Scope `scoreboard.html` to lobby

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html`

- [ ] **Step 7.1: Add lobby-param read + path prefix + redirect**

Open `ps-offsite-2026/scoreboard.html`. Locate the `<script type="module">` block (around line 366). Replace lines from `const STATIONS = {` down to (but not including) `let state = ` with:

```js
const STATIONS = {
  GZ: 'Gesture Lock',
  PM: 'CV Pantomime',
  DN: 'Pipeline Dash',
  FL: 'Insight Monitor',
};

const lobbyId = new URLSearchParams(location.search).get('lobby');
if (!lobbyId) {
  location.replace('index.html');
  throw new Error('no lobby in url');
}
const P = `lobbies/${lobbyId}`;

function showSetupNeeded(msg) {
  document.body.innerHTML = `
    <div style="max-width:640px;margin:80px auto;padding:32px;background:#1b2540;border-radius:16px;border:1px solid rgba(255,255,255,0.06);color:#f5f7fb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6">
      <h1 style="font-size:24px;margin-bottom:16px;background:linear-gradient(90deg,#00d4ff,#ff00aa);-webkit-background-clip:text;background-clip:text;color:transparent">Firebase setup needed</h1>
      <p style="color:#8b95b5;margin-bottom:16px">${msg}</p>
      <p>Follow <a href="SETUP.md" style="color:#00d4ff">SETUP.md</a> to create a Firebase project, then copy <code>firebase-config.example.js</code> to <code>firebase-config.js</code> and fill in your values.</p>
    </div>`;
}

if (!firebaseConfig?.databaseURL || firebaseConfig.databaseURL.includes('REPLACE_ME')) {
  showSetupNeeded('Your <code>firebase-config.js</code> still has placeholder values.');
  throw new Error('firebase config not filled in');
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
```

- [ ] **Step 7.2: Replace every bare DB path with the lobby-scoped path**

In the same script block, edit:

- `ref(db, 'teams')` → `ref(db, \`${P}/teams\`)`
- `ref(db, '/')` (in `onValue`) → `ref(db, P)`
- ``ref(db, `teams/${nextId}`)`` → ``ref(db, `${P}/teams/${nextId}`)``
- ``ref(db, `teams/${id}`)`` → ``ref(db, `${P}/teams/${id}`)``
- ``ref(db, `scores/${id}`)`` → ``ref(db, `${P}/scores/${id}`)``
- ``ref(db, '/')`` inside `resetAll` → ``ref(db, P)`` (and the reset value drops the `teams:` seed — only wipe scores/history; keep the meta+teams created by `createLobby`)
- ``ref(db, `scores/${parsed.teamId}`)`` → ``ref(db, `${P}/scores/${parsed.teamId}`)``
- ``ref(db, 'history')`` → ``ref(db, `${P}/history`)``
- Import: `set` is still needed, no change.

- [ ] **Step 7.3: Remove `ensureSeed()` and its call**

Delete the entire `function seedTeamsObj() { ... }` and `async function ensureSeed() { ... }` definitions and the `ensureSeed()` call. Lobby creation already wrote `/lobbies/{id}/teams`. The leaderboard renders whatever is at `${P}` regardless.

- [ ] **Step 7.4: Update `resetAll` to preserve teams**

Replace the body of `resetAll`:

```js
async function resetAll() {
  if (!confirm('Wipe ALL scores and start over? Affects ALL connected scoreboards.')) return;
  await set(ref(db, `${P}/scores`), null);
  await set(ref(db, `${P}/history`), null);
}
```

- [ ] **Step 7.5: Update `importData` to write under `P`**

Replace its `set(ref(db, '/'), ...)` call:

```js
await set(ref(db, P), { teams: teamsObj, scores: scoresObj, history: historyObj });
```

(Keep the rest of `importData` as-is.)

- [ ] **Step 7.6: Add lobby ID to header subtitle**

In the same script block, locate `document.getElementById('subtitle').textContent = ...` near the end of `render()`. Replace with:

```js
document.getElementById('subtitle').textContent = `Lobby ${lobbyId} · ${state.teams.length} teams · ${state.history.length} submissions`;
```

- [ ] **Step 7.7: Manual smoke-test**

```bash
npm run dev
```

1. From hub (Task 6) click Scoreboard tile → `scoreboard.html?lobby=PS-XXXX` opens with the teams that lobby seeded.
2. Submit `GZ-1-50` → shows on row 1.
3. Open `scoreboard.html` directly (no `?lobby=`) in a new tab → redirect to `index.html`.
4. Open `scoreboard.html?lobby=PS-FAKE` (no such lobby) → empty leaderboard (acceptable; lobby creation enforces existence elsewhere).

- [ ] **Step 7.8: Commit**

```bash
git add ps-offsite-2026/scoreboard.html
git commit -m "feat(scoreboard): scope to lobby via ?lobby= URL param"
```

---

## Task 8: Full test sweep + final commit checkpoint

**Files:** none

- [ ] **Step 8.1: Run the whole vitest suite**

```bash
npm test
```

Expected: all tests pass, including the existing audio/gesture/pantomime/score-panel/stages tests and the new lobby tests.

- [ ] **Step 8.2: Run the build**

```bash
npm run build
```

Expected: build succeeds. (If `index.html` has any syntax errors, Vite will flag them here.)

- [ ] **Step 8.3: Update BUILD_PLAN.md checkboxes**

Open `BUILD_PLAN.md`. Mark line 32 (`- []`) and line 33 (`- []`) as `- [x]`. Leave related lines (26, 27-30, 34) unchecked — they are separate follow-ups.

- [ ] **Step 8.4: Commit**

```bash
git add BUILD_PLAN.md
git commit -m "chore: mark lobby create/join done in build plan"
```

---

## Self-review notes

- **Spec coverage:** Tasks 1–4 cover all `lobby.js` exports from spec section 3. Task 5 covers lobby.css. Task 6 covers all three view-states + the leave/QR behavior from spec section 2. Task 7 covers the scoreboard ?lobby change + ensureSeed removal. Task 8 closes the build-plan checkbox.
- **Error handling:** Task 6 wires every case from spec section 4 except the corrupt-localStorage case, which is handled inside `getSession()` (covered by Task 2 test).
- **Out-of-scope spec items:** Game pages and the broader scoreboard revamp are explicitly deferred and not in any task — that matches the spec scope.
- **Type consistency:** `createLobby` returns `{lobbyId, adminPwd, teams: [{id, name, pwd}]}` in Task 3 and is consumed with the same shape in Task 6. `loadLobbyTeams` returns `[{id, name}]` in Task 4 and Task 6 reads `.id`/`.name`. `getSession()` returns `{lobbyId, teamId, teamPwd}` (Task 2) and that exact shape is set in Task 6's `doJoin`.
