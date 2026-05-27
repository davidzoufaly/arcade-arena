# Top-bar Navigation — Design

Date: 2026-05-25
Scope: BUILD_PLAN.md task "better ui navigace → top bar"

## Goal

Add a unified top navigation bar to all station pages and the scoreboard so a joined team can:

- See which lobby and team they are in.
- Jump back to the dashboard (hub).
- Jump to the scoreboard.
- Leave the lobby and return to the create/join landing page.

The hub (`index.html`) is out of scope; its existing lobby-strip stays.

## Scope decisions

| Decision               | Choice                                           |
| ---------------------- | ------------------------------------------------ |
| Pages covered          | Stations (1, 2, dino, flappy) + scoreboard       |
| Layout                 | Brand left, nav center, info + leave right       |
| Leave button           | Immediate (no confirm dialog)                    |
| Active page indicator  | Highlight current via `aria-current="page"`     |
| Position               | `fixed; top: 0` — required for canvas games (dino/flappy) whose canvas is sized to `window.innerHeight`. Non-canvas pages get `body { padding-top: 56px }`. |
| No-session behavior    | `location.replace('<prefix>index.html')`         |
| Integration            | Shared ES module + CSS, auto-injects into `<body>` |
| Session source         | URL params first, `getSession()` fallback        |
| Team display           | `Team N` (id only)                               |
| Internal team picker   | Removed from station pages                       |

## Architecture

Two new shared files:

- `ps-offsite-2026/shared/topbar.js`
- `ps-offsite-2026/shared/topbar.css`

One addition to existing helper:

- `ps-offsite-2026/shared/lobby.js` gains `resolveSession()` which returns `{ lobbyId, teamId }` from URL params if present, otherwise from `getSession()`, otherwise `null`.

Each consumer page (4 stations + scoreboard) adds two lines:

```html
<link rel="stylesheet" href="<prefix>shared/topbar.css">
<script type="module">
  import { mountTopbar } from '<prefix>shared/topbar.js';
  mountTopbar({ activePage: 'dashboard' });
</script>
```

`<prefix>` is `../` for stations, `./` for scoreboard.

The hub (`index.html`) is untouched.

## `mountTopbar({ activePage })`

```js
export function mountTopbar({ activePage }) {
  const session = resolveSession();
  if (!session) {
    location.replace(hubPath());
    return;
  }
  const header = buildHeader(session, activePage);
  document.body.insertBefore(header, document.body.firstChild);
}
```

- `activePage`: `'dashboard' | 'scoreboard'`. Added as `aria-current="page"` on the matching `<a>`.
- `hubPath()` / `scoreboardPath()` compute prefix from `location.pathname`:
  - Contains `/stations/`, `/dino/`, or `/flappy/` → prefix `'../'`
  - Else → prefix `'./'`
- The leave handler:
  ```js
  clearSession();
  location.href = hubPath();
  ```
- Scoreboard link href: `${prefix}scoreboard.html?lobby=${encodeURIComponent(session.lobbyId)}`.

## DOM structure

```html
<header class="ps-topbar">
  <a class="ps-topbar-brand" href="../index.html">PS Offsite</a>
  <nav class="ps-topbar-nav">
    <a data-nav="dashboard" href="../index.html">Dashboard</a>
    <a data-nav="scoreboard" href="../scoreboard.html?lobby=PS-AB23">Scoreboard</a>
  </nav>
  <div class="ps-topbar-info">
    Lobby <code>PS-AB23</code> · <strong>Team 3</strong>
  </div>
  <button class="ps-topbar-leave" type="button">Leave</button>
</header>
```

## Styling

`topbar.css` declares its own scoped tokens (some pages use a different palette — e.g., dino/flappy load `neon.css` which only defines `--brand`, `--score`, etc.; stations 1/2 + hub use `--accent`, `--muted`, etc.). The bar must look the same regardless of host page.

```css
.ps-topbar {
  --tb-bg: rgba(10, 14, 26, 0.92);
  --tb-border: rgba(255, 255, 255, 0.08);
  --tb-text: #f5f7fb;
  --tb-muted: #8b95b5;
  --tb-accent: #00d4ff;
  --tb-accent-2: #ff00aa;
  --tb-bad: #ff4d6d;

  position: fixed; top: 0; left: 0; right: 0;
  height: 56px; z-index: 1000;
  display: flex; align-items: center; gap: 16px; padding: 0 24px;
  background: var(--tb-bg);
  border-bottom: 1px solid var(--tb-border);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  color: var(--tb-text);
  backdrop-filter: blur(8px);
}
```

- Brand `font-weight: 800; font-size: 16px;` + `linear-gradient(90deg, var(--tb-accent), var(--tb-accent-2))` text fill.
- Nav links: `color: var(--tb-muted)`, hover `color: var(--tb-text)`, padding `8px 12px`, no underline.
- Active link (`[aria-current="page"]`): `color: var(--tb-accent)`, `border-bottom: 2px solid var(--tb-accent)`.
- `.ps-topbar-info`: `margin-left: auto; font-size: 13px; color: var(--tb-muted);` — `<code>` accent, `<strong>` text.
- `.ps-topbar-leave`: transparent bg, `1px solid var(--tb-bad)`, `color: var(--tb-bad)`, `padding: 6px 14px; border-radius: 8px; font-size: 13px;`. Hover: bg `rgba(255,77,109,0.08)`.

Body offset rule (also in topbar.css):

```css
body.ps-topbar-host { padding-top: 56px; }
```

`mountTopbar` adds the class only when the page is NOT a canvas game (detection: presence of `<canvas#game>` or `<canvas#cam>`). Canvas games leave body padding at 0 and rely on HUD offsets instead.

## Responsive

Single breakpoint `@media (max-width: 640px)`:

- Brand text hidden (`display: none`).
- Nav links shrink (`font-size: 12px; gap: 8px`).
- Info row wraps under nav (`flex-wrap: wrap`).
- Topbar height grows to ~80px when wrapped.

No hamburger menu — content is small enough.

## Per-page changes

### `ps-offsite-2026/stations/1-gesture-lock.html`

- Add `<link>` + `<script type=module>` snippet to `<head>`.
- Remove `<select id="teamSelect">` + its label from setup card.
- Initialize `state.teamId` from `resolveSession().teamId` at bootstrap.
- Remove `teamSelect.addEventListener('change', ...)` and its gating of the start button.
- Keep team-size select untouched (separate BUILD_PLAN task).

### `ps-offsite-2026/stations/2-pantomime.html`

Same pattern: snippet + remove team picker + set `teamId` from session.

### `ps-offsite-2026/dino/index.html` and `ps-offsite-2026/flappy/index.html`

- Add `<link>` + `<script type=module>` snippet.
- Remove any team-picker UI present.
- Set `state.teamId` from `resolveSession().teamId` at bootstrap.

**HUD offset adjustments** (topbar sits over the top 56px of the canvas):

`ps-offsite-2026/shared/neon.css`:

- `.hud { top: 16px; }` → `top: 72px;`
- `.banner { top: 16px; }` → `top: 72px;`

`ps-offsite-2026/dino/style.css`:

- `#cam { top: 16px; }` → `top: 72px;`

`ps-offsite-2026/dino/index.html` inline styles:

- `#debug { top: 148px; }` → `top: 204px;`
- `#finger-meter { top: 60px; }` → `top: 116px;`

Flappy's HUD elements: audit `ps-offsite-2026/flappy/` for any inline `top:` offsets at implementation time; shift each by +56px.

Canvas itself stays sized to `window.innerWidth/innerHeight`. Topbar overlays top 56px of canvas content — acceptable because gameplay action is at/below center (ground for dino; horizontal flight for flappy).

### `ps-offsite-2026/scoreboard.html`

- Add snippet with `./` prefix, `activePage: 'scoreboard'`.
- Keep existing page `<header>` (title + reset button) — content header, sits below topbar.
- Body gets `ps-topbar-host` class automatically (no `#game`/`#cam` canvas present) → 56px top padding.
- Existing scoreboard `<header>` is `position: sticky; top: 0;` — change to `top: 56px;` so it sticks below the fixed topbar when scrolled.

### `ps-offsite-2026/shared/lobby.js`

Add and export:

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

## Edge cases

- **No session AND no URL params:** redirect to hub via `location.replace` (no back-button trap).
- **Invalid `?team=` (non-numeric, ≤0):** falls through to `getSession()`; if that's also missing, redirect.
- **User clicks Dashboard while still joined:** hub re-renders the joined-hub view from `getSession()`. Expected.
- **User clicks Leave on scoreboard:** session clears, redirect to hub create/join view. Other tabs (e.g. station on a phone) still hold session in their localStorage — leaving on one device does not log out other devices. Accepted.

## Testing

Manual checks:

1. Open station via hub link → topbar shows correct lobby + team; Dashboard returns to hub; Scoreboard link carries `?lobby=`; Leave clears + lands on create/join view.
2. Open station with `?lobby=PS-AB23&team=3` directly → topbar populated.
3. Open station with no params but joined session → topbar populated.
4. Open station with no params + no session → redirected to hub.
5. Open scoreboard via topbar from a station → still shows same lobby.
6. 360px viewport → topbar wraps cleanly, no overflow.
7. Score-code generation on each station unchanged (uses `state.teamId`).
8. Dino + flappy: HUD elements (score, banner, cam, debug, finger-meter) visible below topbar, not clipped.
9. Scoreboard: existing sticky page header sticks below topbar (not behind it) on scroll.

Automated:

- Vitest unit for `resolveSession()` covering: URL params valid, URL params invalid + session present, neither.
- No DOM tests for `mountTopbar` (lightweight + manual coverage sufficient).

## Out of scope

- Hub navigation redesign.
- Team-size selector removal (BUILD_PLAN line 32 — separate task).
- Scoreboard admin functions (separate BUILD_PLAN item).
- Confirm-on-leave dialog (deferred; user chose immediate).
