# Top-bar Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified fixed top navigation bar (brand + dashboard/scoreboard links + lobby/team display + leave button) to stations 1, 2, dino, flappy, and the scoreboard.

**Architecture:** New shared ES module `topbar.js` injects a `<header class="ps-topbar">` into `<body>` of each consumer page. A new `resolveSession()` helper in `shared/lobby.js` reads `?lobby=&team=` URL params first, then `getSession()`, otherwise null → redirect to hub. Canvas-game pages (dino, flappy) get their fixed-position HUD elements shifted down 56px so they sit below the bar.

**Tech Stack:** Vanilla JS ES modules, plain CSS, Vitest for unit tests. No build step (Vite serves the pages directly).

**Spec:** [docs/superpowers/specs/2026-05-25-topbar-nav-design.md](../specs/2026-05-25-topbar-nav-design.md)

---

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `ps-offsite-2026/shared/lobby.js` | Modify | Add `resolveSession()` exporting `{lobbyId,teamId}` or null. |
| `tests/lobby.test.js` | Modify | Add `describe('resolveSession')` block. |
| `ps-offsite-2026/shared/topbar.css` | Create | Bar styles + body offset rule. |
| `ps-offsite-2026/shared/topbar.js` | Create | `mountTopbar({activePage})` — builds DOM, wires leave, handles no-session redirect. |
| `ps-offsite-2026/scoreboard.html` | Modify | Add bar snippet (`./` prefix). Shift sticky page `<header>` to `top:56px`. |
| `ps-offsite-2026/stations/1-gesture-lock.html` | Modify | Add bar snippet (`../`). Remove team-picker UI + wiring. Init `state.teamId` from `resolveSession`. |
| `ps-offsite-2026/stations/2-pantomime.html` | Modify | Same pattern as station 1 for its `teamId` local var. |
| `ps-offsite-2026/dino/index.html` | Modify | Add bar snippet. Shift `#debug` top:148→204, `#finger-meter` top:60→116. |
| `ps-offsite-2026/dino/style.css` | Modify | `#cam { top: 16px }` → `top: 72px`. |
| `ps-offsite-2026/dino/main.js` | Modify | Replace `getTeamFromURL()` with `resolveSession().teamId`. |
| `ps-offsite-2026/flappy/index.html` | Modify | Add bar snippet. Shift `#debug` top:148→204, `#noise-meter` top:60→116, `#noise-label` top:30→86. |
| `ps-offsite-2026/flappy/main.js` | Modify | Replace `getTeamFromURL()` with `resolveSession().teamId`. |
| `ps-offsite-2026/shared/neon.css` | Modify | `.hud { top: 16px }` → `top: 72px`. `.banner { top: 16px }` → `top: 72px`. |

Hub (`index.html`) is **not** modified.

---

## Task 1: Add `resolveSession()` to shared/lobby.js (TDD)

**Files:**
- Modify: `tests/lobby.test.js`
- Modify: `ps-offsite-2026/shared/lobby.js`

- [ ] **Step 1: Write failing tests**

Append the following block to the end of `tests/lobby.test.js` (after the existing `createLobbyApi.verifyTeamPwd` describe):

```js
function mockLocation(search = '') {
  globalThis.location = { search, pathname: '/test/', replace: () => {}, href: '' };
}

describe('resolveSession', () => {
  it('returns URL params when both are valid', async () => {
    mockLocation('?lobby=PS-7K2X&team=3');
    mockLocalStorage();
    const { resolveSession } = await import('../ps-offsite-2026/shared/lobby.js');
    expect(resolveSession()).toEqual({ lobbyId: 'PS-7K2X', teamId: 3 });
  });

  it('falls back to session when URL lobby is invalid', async () => {
    mockLocation('?lobby=ps-bad&team=3');
    mockLocalStorage();
    const mod = await import('../ps-offsite-2026/shared/lobby.js');
    mod.setSession({ lobbyId: 'PS-AAAA', teamId: 5, teamPwd: 'X' });
    expect(mod.resolveSession()).toEqual({ lobbyId: 'PS-AAAA', teamId: 5 });
  });

  it('falls back to session when URL team is missing', async () => {
    mockLocation('?lobby=PS-7K2X');
    mockLocalStorage();
    const mod = await import('../ps-offsite-2026/shared/lobby.js');
    mod.setSession({ lobbyId: 'PS-AAAA', teamId: 9, teamPwd: 'X' });
    expect(mod.resolveSession()).toEqual({ lobbyId: 'PS-AAAA', teamId: 9 });
  });

  it('falls back to session when URL team is non-numeric', async () => {
    mockLocation('?lobby=PS-7K2X&team=abc');
    mockLocalStorage();
    const mod = await import('../ps-offsite-2026/shared/lobby.js');
    mod.setSession({ lobbyId: 'PS-AAAA', teamId: 2, teamPwd: 'X' });
    expect(mod.resolveSession()).toEqual({ lobbyId: 'PS-AAAA', teamId: 2 });
  });

  it('falls back to session when URL team is <= 0', async () => {
    mockLocation('?lobby=PS-7K2X&team=0');
    mockLocalStorage();
    const mod = await import('../ps-offsite-2026/shared/lobby.js');
    mod.setSession({ lobbyId: 'PS-AAAA', teamId: 1, teamPwd: 'X' });
    expect(mod.resolveSession()).toEqual({ lobbyId: 'PS-AAAA', teamId: 1 });
  });

  it('returns null when neither URL nor session has data', async () => {
    mockLocation('');
    mockLocalStorage();
    const { resolveSession } = await import('../ps-offsite-2026/shared/lobby.js');
    expect(resolveSession()).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/lobby.test.js`
Expected: 6 tests FAIL with `resolveSession is not a function` or similar.

- [ ] **Step 3: Implement `resolveSession`**

Append at the end of `ps-offsite-2026/shared/lobby.js` (after `createLobbyApi`):

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
  if (s) return { lobbyId: s.lobbyId, teamId: s.teamId };
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/lobby.test.js`
Expected: ALL tests pass (existing + 6 new).

- [ ] **Step 5: Commit**

```bash
git add tests/lobby.test.js ps-offsite-2026/shared/lobby.js
git commit -m "feat(lobby): add resolveSession (URL params -> session fallback)"
```

---

## Task 2: Create topbar.css

**Files:**
- Create: `ps-offsite-2026/shared/topbar.css`

- [ ] **Step 1: Write the CSS file**

Create `ps-offsite-2026/shared/topbar.css` with this exact content:

```css
.ps-topbar {
  --tb-bg: rgba(10, 14, 26, 0.92);
  --tb-border: rgba(255, 255, 255, 0.08);
  --tb-text: #f5f7fb;
  --tb-muted: #8b95b5;
  --tb-accent: #00d4ff;
  --tb-accent-2: #ff00aa;
  --tb-bad: #ff4d6d;

  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: 56px;
  z-index: 1000;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 24px;
  background: var(--tb-bg);
  border-bottom: 1px solid var(--tb-border);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--tb-text);
  backdrop-filter: blur(8px);
}

.ps-topbar-brand {
  font-weight: 800;
  font-size: 16px;
  text-decoration: none;
  background: linear-gradient(90deg, var(--tb-accent), var(--tb-accent-2));
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.ps-topbar-nav {
  display: flex;
  gap: 4px;
}

.ps-topbar-nav a {
  color: var(--tb-muted);
  text-decoration: none;
  padding: 8px 12px;
  font-size: 14px;
  border-bottom: 2px solid transparent;
}

.ps-topbar-nav a:hover {
  color: var(--tb-text);
}

.ps-topbar-nav a[aria-current="page"] {
  color: var(--tb-accent);
  border-bottom-color: var(--tb-accent);
}

.ps-topbar-info {
  margin-left: auto;
  font-size: 13px;
  color: var(--tb-muted);
}

.ps-topbar-info code {
  color: var(--tb-accent);
  font-family: ui-monospace, monospace;
}

.ps-topbar-info strong {
  color: var(--tb-text);
}

.ps-topbar-leave {
  background: transparent;
  border: 1px solid var(--tb-bad);
  color: var(--tb-bad);
  padding: 6px 14px;
  border-radius: 8px;
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
}

.ps-topbar-leave:hover {
  background: rgba(255, 77, 109, 0.08);
}

body.ps-topbar-host {
  padding-top: 56px;
}

@media (max-width: 640px) {
  .ps-topbar {
    flex-wrap: wrap;
    height: auto;
    min-height: 56px;
    padding: 8px 12px;
    gap: 8px;
  }
  .ps-topbar-brand {
    display: none;
  }
  .ps-topbar-nav a {
    font-size: 12px;
    padding: 6px 8px;
  }
  .ps-topbar-info {
    font-size: 12px;
    margin-left: 0;
    width: 100%;
    order: 99;
  }
  body.ps-topbar-host {
    padding-top: 96px;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add ps-offsite-2026/shared/topbar.css
git commit -m "feat(topbar): add topbar.css styles"
```

---

## Task 3: Create topbar.js

**Files:**
- Create: `ps-offsite-2026/shared/topbar.js`

- [ ] **Step 1: Write the module**

Create `ps-offsite-2026/shared/topbar.js` with this exact content:

```js
import { resolveSession, clearSession } from './lobby.js';

function prefix() {
  const p = location.pathname;
  if (p.includes('/stations/') || p.includes('/dino/') || p.includes('/flappy/')) {
    return '../';
  }
  return './';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function isCanvasGamePage() {
  return !!(document.getElementById('game') || document.getElementById('cam'));
}

function buildHeader({ lobbyId, teamId }, activePage) {
  const pfx = prefix();
  const hubHref = `${pfx}index.html`;
  const scoreHref = `${pfx}scoreboard.html?lobby=${encodeURIComponent(lobbyId)}`;

  const header = document.createElement('header');
  header.className = 'ps-topbar';
  header.innerHTML = `
    <a class="ps-topbar-brand" href="${hubHref}">PS Offsite</a>
    <nav class="ps-topbar-nav">
      <a data-nav="dashboard" href="${hubHref}">Dashboard</a>
      <a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>
    </nav>
    <div class="ps-topbar-info">
      Lobby <code>${esc(lobbyId)}</code> · <strong>Team ${teamId}</strong>
    </div>
    <button class="ps-topbar-leave" type="button">Leave</button>
  `;
  const activeLink = header.querySelector(`a[data-nav="${activePage}"]`);
  if (activeLink) activeLink.setAttribute('aria-current', 'page');
  header.querySelector('.ps-topbar-leave').addEventListener('click', () => {
    clearSession();
    location.href = hubHref;
  });
  return header;
}

export function mountTopbar({ activePage }) {
  const session = resolveSession();
  if (!session) {
    location.replace(`${prefix()}index.html`);
    return;
  }
  const header = buildHeader(session, activePage);
  document.body.insertBefore(header, document.body.firstChild);
  if (!isCanvasGamePage()) {
    document.body.classList.add('ps-topbar-host');
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add ps-offsite-2026/shared/topbar.js
git commit -m "feat(topbar): add mountTopbar module"
```

---

## Task 4: Wire scoreboard.html

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html`

- [ ] **Step 1: Add topbar link + script to head**

In `ps-offsite-2026/scoreboard.html`, find the closing `</style>` tag (around line 376 — last style block). Add immediately after it (before `</head>`):

```html
<link rel="stylesheet" href="./shared/topbar.css">
<script type="module">
  import { mountTopbar } from './shared/topbar.js';
  mountTopbar({ activePage: 'scoreboard' });
</script>
```

- [ ] **Step 2: Shift existing sticky header below topbar**

In the existing `<style>` block, locate the `header { ... }` rule (~line 33). Find the line `position: sticky; top: 0; z-index: 10;` and change to:

```css
    position: sticky; top: 56px; z-index: 10;
```

(Note: scoreboard's `<header>` z-index 10 is below topbar's 1000 — correct stacking.)

- [ ] **Step 3: Manual verification**

Run: `npm run dev`
- Open `http://localhost:5173/ps-offsite-2026/scoreboard.html` with no lobby param → expect redirect to hub (`/ps-offsite-2026/index.html`).
- From the hub, create a lobby (or join existing) → click Scoreboard tile.
- Verify: topbar visible at top (PS Offsite brand + Dashboard/Scoreboard links + Lobby code + Team N + Leave button), Scoreboard link highlighted accent blue.
- Scroll down: existing scoreboard sticky header sticks at `top: 56px` (below topbar).
- Click Leave → lands on hub create/join view (session cleared).
- Click Dashboard from a fresh visit → returns to hub.

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/scoreboard.html
git commit -m "feat(scoreboard): mount shared topbar; sticky header below bar"
```

---

## Task 5: Wire station 1 (gesture lock) + remove team picker

**Files:**
- Modify: `ps-offsite-2026/stations/1-gesture-lock.html`

- [ ] **Step 1: Add topbar stylesheet link**

In `ps-offsite-2026/stations/1-gesture-lock.html`, find the closing `</style>` tag of the inline styles. Add this line immediately after it (before `</head>`):

```html
<link rel="stylesheet" href="../shared/topbar.css">
```

- [ ] **Step 2: Mount topbar + resolve session in the main module script**

In the existing `<script type="module">` block (around line 322), locate the imports near the top. Just after the existing `import { ... } from '../shared/gesture-lock-logic.js';` line (around line 329), add:

```js
import { mountTopbar } from '../shared/topbar.js';
import { resolveSession } from '../shared/lobby.js';

mountTopbar({ activePage: 'dashboard' });
const _session = resolveSession();
```

(Note: if `resolveSession` returned null, `mountTopbar` already called `location.replace`; the rest of the script will still execute briefly but the page is unloading. The `_session` deref below is guarded.)

- [ ] **Step 3: Remove the team-picker UI**

Locate this block (around line 227-230):

```html
      <label>Team #:
        <select id="teamSelect"><option value="">—</option></select>
      </label>
```

Delete those 3 lines.

- [ ] **Step 4: Remove team-picker JS wiring**

Locate this block (around line 371-376):

```js
const teamSelect = $('teamSelect');
for (let i = 1; i <= 10; i++) {
  const o = document.createElement('option');
  o.value = i; o.textContent = `Team ${i}`;
  teamSelect.appendChild(o);
}
```

Delete those 6 lines.

Locate (around line 385):

```js
teamSelect.addEventListener('change', () => { startBtn.disabled = !teamSelect.value; });
```

Delete this line.

Locate (around line 386-392):

```js
startBtn.addEventListener('click', () => {
  state.teamId = parseInt(teamSelect.value, 10);
  state.teamSize = parseInt(teamSizeSel.value, 10);
  state.attempts = [];
  state.attemptIdx = 0;
  goto('loading');
});
```

Change the body of the handler so `state.teamId` reads from `_session`:

```js
startBtn.addEventListener('click', () => {
  state.teamId = _session?.teamId ?? 0;
  state.teamSize = parseInt(teamSizeSel.value, 10);
  state.attempts = [];
  state.attemptIdx = 0;
  goto('loading');
});
```

- [ ] **Step 5: Make startBtn enabled by default**

Locate (around line 234):

```html
      <button id="startBtn" disabled>Start camera</button>
```

Remove the `disabled` attribute:

```html
      <button id="startBtn">Start camera</button>
```

- [ ] **Step 6: Manual verification**

Run: `npm run dev`
- Visit station 1 without session/params → expect redirect to hub.
- From hub joined-view, click Gesture Lock tile (URL: `?lobby=...&team=...`).
- Verify: topbar shows correct lobby + team; setup card no longer has Team # dropdown; Start camera button is enabled immediately.
- Start a run, finish, verify result code reads `GZ-{teamId}-{score}`.

- [ ] **Step 7: Commit**

```bash
git add ps-offsite-2026/stations/1-gesture-lock.html
git commit -m "feat(station-1): mount topbar; drop team picker, take teamId from session"
```

---

## Task 6: Wire station 2 (pantomime) + remove team picker

**Files:**
- Modify: `ps-offsite-2026/stations/2-pantomime.html`

- [ ] **Step 1: Add topbar stylesheet link**

Find the `</style>` closing the styles block (around line 246). Add this line immediately after it (before `</head>`):

```html
<link rel="stylesheet" href="../shared/topbar.css">
```

- [ ] **Step 2: Mount topbar + resolve session in the main module script**

In the existing `<script type="module">` block (around line 348), just after the import block ending with `} from '../shared/pantomime-logic.js';` (around line 357), add:

```js
import { mountTopbar } from '../shared/topbar.js';
import { resolveSession } from '../shared/lobby.js';

mountTopbar({ activePage: 'dashboard' });
const _session = resolveSession();
```

- [ ] **Step 3: Remove the existing inline `← Scoreboard` link**

Locate (around line 249-252):

```html
<header>
  <h1><span class="station-badge">PM</span>CV Pantomime</h1>
  <a href="../scoreboard.html" style="color:var(--muted); text-decoration:none; font-size:13px">← Scoreboard</a>
</header>
```

Delete just the `<a href="../scoreboard.html" ...>...</a>` line. Leave `<header>` and `<h1>` in place.

- [ ] **Step 4: Remove the team-picker UI**

Locate (around line 264-266):

```html
      <label>Team number:
        <select id="teamSelect"><option value="">—</option></select>
      </label>
```

Delete those 3 lines.

- [ ] **Step 5: Remove team-picker JS wiring**

Locate (around line 430-438):

```js
const teamSelect = document.getElementById('teamSelect');
for (let i = 1; i <= 10; i++) {
  const opt = document.createElement('option');
  opt.value = i; opt.textContent = `Team ${i}`;
  teamSelect.appendChild(opt);
}
teamSelect.addEventListener('change', () => {
  document.getElementById('startBtn').disabled = !teamSelect.value;
});
```

Delete those 9 lines entirely.

Locate (around line 446-450):

```js
document.getElementById('startBtn').addEventListener('click', () => {
  teamId = parseInt(teamSelect.value, 10);
  teamSize = parseInt(teamSizeSel.value, 10);
  goto('loading');
});
```

Change to:

```js
document.getElementById('startBtn').addEventListener('click', () => {
  teamId = _session?.teamId ?? 0;
  teamSize = parseInt(teamSizeSel.value, 10);
  goto('loading');
});
```

- [ ] **Step 6: Make startBtn enabled by default**

Find `<button id="startBtn" disabled>Start camera</button>` (around line 270). Remove the `disabled` attribute:

```html
      <button id="startBtn">Start camera</button>
```

- [ ] **Step 7: Manual verification**

Run: `npm run dev`
- Visit station 2 without session/params → expect redirect to hub.
- From hub joined-view, click CV Pantomime tile.
- Verify: topbar populated; setup card has no Team # dropdown; Start camera is enabled; result code on completion includes the team id.

- [ ] **Step 8: Commit**

```bash
git add ps-offsite-2026/stations/2-pantomime.html
git commit -m "feat(station-2): mount topbar; drop team picker, take teamId from session"
```

---

## Task 7: Shift dino + flappy shared HUD offsets in neon.css

**Files:**
- Modify: `ps-offsite-2026/shared/neon.css`

- [ ] **Step 1: Shift `.hud` top**

In `ps-offsite-2026/shared/neon.css`, locate the `.hud { ... }` rule (around line 27). Change `top: 16px;` to `top: 72px;`:

```css
.hud {
  position: fixed;
  top: 72px; left: 16px;
  font-size: 24px;
  color: var(--score);
  text-shadow: 0 0 4px var(--score);
  pointer-events: none;
  z-index: 10;
}
```

- [ ] **Step 2: Shift `.banner` top**

Locate the `.banner { ... }` rule (around line 37). Change `top: 16px;` to `top: 72px;`:

```css
.banner {
  position: fixed;
  top: 72px; left: 50%;
  transform: translateX(-50%);
  font-size: 18px;
  color: var(--title);
  text-shadow: 0 0 6px var(--title);
  letter-spacing: 0.1em;
  z-index: 10;
  pointer-events: none;
}
```

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/shared/neon.css
git commit -m "style(neon): shift .hud and .banner top to clear 56px topbar"
```

---

## Task 8: Wire dino (Pipeline Dash)

**Files:**
- Modify: `ps-offsite-2026/dino/index.html`
- Modify: `ps-offsite-2026/dino/style.css`
- Modify: `ps-offsite-2026/dino/main.js`

- [ ] **Step 1: Add topbar stylesheet link in dino/index.html**

In `ps-offsite-2026/dino/index.html`, add this line immediately before `</head>` (around line 7):

```html
  <link rel="stylesheet" href="../shared/topbar.css">
```

(The `mountTopbar` call goes into `main.js` in Step 4 below.)

- [ ] **Step 2: Shift inline `#debug` and `#finger-meter` top**

In `ps-offsite-2026/dino/index.html`, locate the inline-styled `<div id="debug" ...>` (around line 24). Change `top:148px` to `top:204px`. Then locate `<div id="finger-meter" ...>` (around line 25). Change `top:60px` to `top:116px`.

Resulting lines:

```html
  <div id="debug" style="position:fixed;top:204px;right:16px;width:160px;font:11px/1.3 'Courier New',monospace;color:#0ff;background:rgba(0,0,0,0.5);padding:6px;z-index:11;text-shadow:0 0 4px #0ff"></div>
  <div id="finger-meter" style="position:fixed;left:16px;top:116px;width:170px;font:11px 'Courier New',monospace;color:#ffff00;background:rgba(0,0,0,0.5);padding:10px 12px;border:1px solid rgba(255,255,0,0.4);border-radius:8px;z-index:10;pointer-events:none">
```

- [ ] **Step 3: Shift `#cam` top in dino/style.css**

In `ps-offsite-2026/dino/style.css`, change the `#cam { top: 16px; ... }` block (line 1-10). Change `top: 16px;` to `top: 72px;`:

```css
#cam {
  position: fixed;
  top: 72px; right: 16px;
  width: 160px;
  height: 120px;
  border: 2px solid var(--hazard);
  box-shadow: 0 0 16px var(--hazard);
  z-index: 10;
  transform: scaleX(-1);
}
```

- [ ] **Step 4: Mount topbar + replace getTeamFromURL in dino/main.js**

In `ps-offsite-2026/dino/main.js`, locate line 5:

```js
import { generateCode, renderEndScreen, saveRun, showDebugIfRequested, getTeamFromURL } from '../shared/score-panel.js';
```

Change to:

```js
import { generateCode, renderEndScreen, saveRun, showDebugIfRequested } from '../shared/score-panel.js';
import { resolveSession } from '../shared/lobby.js';
import { mountTopbar } from '../shared/topbar.js';

mountTopbar({ activePage: 'dashboard' });
```

Then locate line 9:

```js
const TEAM = getTeamFromURL();
```

Change to:

```js
const TEAM = (resolveSession() ?? { teamId: 0 }).teamId;
```

(The 0 fallback never triggers in practice because `mountTopbar` redirects on missing session, but keeps the constant safe if `main.js` continues briefly while the redirect is pending.)

- [ ] **Step 5: Manual verification**

Run: `npm run dev`
- Visit dino without session/params → expect redirect to hub.
- From hub, click Pipeline Dash tile.
- Verify: topbar visible across top; #cam, .hud (score), .banner all visible below topbar (not under it); #finger-meter visible at left side below topbar.
- Start a game (SPACE) → gameplay works; end screen shows `DN-{teamId}-{score}` code.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/dino/index.html ps-offsite-2026/dino/style.css ps-offsite-2026/dino/main.js
git commit -m "feat(dino): mount topbar; shift HUD offsets; teamId via resolveSession"
```

---

## Task 9: Wire flappy (Insight Monitor)

**Files:**
- Modify: `ps-offsite-2026/flappy/index.html`
- Modify: `ps-offsite-2026/flappy/main.js`

- [ ] **Step 1: Add topbar stylesheet link in flappy/index.html**

In `ps-offsite-2026/flappy/index.html`, add this line immediately before `</head>` (around line 7):

```html
  <link rel="stylesheet" href="../shared/topbar.css">
```

(The `mountTopbar` call goes into `main.js` in Step 3 below.)

- [ ] **Step 2: Shift inline `#debug`, `#noise-meter`, `#noise-label` top**

In `ps-offsite-2026/flappy/index.html`:

- Locate `<div id="debug" ...>` (around line 24). Change `top:148px` to `top:204px`.
- Locate `<div id="noise-meter" ...>` (around line 25). Change `top:60px` to `top:116px`. Leave `bottom:60px` unchanged.
- Locate `<div id="noise-label" ...>` (around line 36). Change `top:30px` to `top:86px`.

Resulting lines:

```html
  <div id="debug" style="position:fixed;top:204px;right:16px;width:160px;font:11px/1.3 'Courier New',monospace;color:#0ff;background:rgba(0,0,0,0.5);padding:6px;z-index:11;text-shadow:0 0 4px #0ff"></div>
  <div id="noise-meter" style="position:fixed;left:16px;top:116px;bottom:60px;width:18px;background:rgba(255,255,255,0.05);border:1px solid rgba(255,90,60,0.5);border-radius:9px;z-index:10;overflow:hidden;pointer-events:none">
```

```html
  <div id="noise-label" style="position:fixed;left:8px;top:86px;width:34px;font:10px 'Courier New',monospace;color:#ff5a3c;text-align:center;z-index:10;pointer-events:none;letter-spacing:0.05em">VOICE</div>
```

- [ ] **Step 3: Mount topbar + replace getTeamFromURL in flappy/main.js**

In `ps-offsite-2026/flappy/main.js`, locate line 5:

```js
import { generateCode, renderEndScreen, saveRun, showDebugIfRequested, getTeamFromURL } from '../shared/score-panel.js';
```

Change to:

```js
import { generateCode, renderEndScreen, saveRun, showDebugIfRequested } from '../shared/score-panel.js';
import { resolveSession } from '../shared/lobby.js';
import { mountTopbar } from '../shared/topbar.js';

mountTopbar({ activePage: 'dashboard' });
```

Then line 9:

```js
const TEAM = getTeamFromURL();
```

Change to:

```js
const TEAM = (resolveSession() ?? { teamId: 0 }).teamId;
```

- [ ] **Step 4: Manual verification**

Run: `npm run dev`
- Visit flappy without session/params → expect redirect to hub.
- From hub, click Insight Monitor tile.
- Verify: topbar visible; .hud (score) and .banner visible below topbar; #noise-meter + #noise-label + #debug positioned correctly (no overlap with topbar).
- Start a game (SPACE) → end screen shows `FL-{teamId}-{score}` code.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/flappy/index.html ps-offsite-2026/flappy/main.js
git commit -m "feat(flappy): mount topbar; shift HUD offsets; teamId via resolveSession"
```

---

## Task 10: Final regression sweep

**Files:** none (manual checks only)

- [ ] **Step 1: Full vitest run**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Cross-page smoke test**

Run: `npm run dev`

For each of: scoreboard, station 1, station 2, dino, flappy:
- Open the page via hub tile (after creating + joining a lobby).
- Confirm: topbar present; Dashboard link returns to hub; Scoreboard link goes to scoreboard with correct lobby param; Leave button clears session + lands on create/join view.
- Confirm: active link highlighted only on scoreboard page; both nav links unstyled on station pages.
- On 360px-wide viewport (DevTools responsive): topbar wraps cleanly, brand text hides, info row drops below nav.

- [ ] **Step 3: Score code regression**

For station 1, station 2, dino, flappy:
- Run a full game.
- Confirm the end-screen code shows the lobby's actual team id (matches the team you joined as in the hub).

- [ ] **Step 4: Mark BUILD_PLAN line done**

Edit `BUILD_PLAN.md` lines 22-26. Change `- [] better ui navigace` and its sub-items to `[x]`:

```md
- [x] better ui navigace
    - [x] top bar
        - [x] dashboard + scoreboard
        - [x] lobby id + team number
        - [x] leave lobby -> redirect to landingpage (create lobby)
```

- [ ] **Step 5: Commit BUILD_PLAN update**

```bash
git add BUILD_PLAN.md
git commit -m "chore: mark top-bar nav done in build plan"
```
