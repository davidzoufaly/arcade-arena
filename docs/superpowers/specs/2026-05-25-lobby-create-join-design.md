# Lobby Create / Join — Design

**Date:** 2026-05-25
**Scope:** BUILD_PLAN.md lines 32–33 only. Landing screen, lobby creation, lobby join with team password. Does NOT include enforcement of team password on score submissions, admin actions, or scoreboard matrix view — those are separate specs.

## Goal

Replace the current single-global Firebase state (`/teams`, `/scores`, `/history`) with isolated, password-protected lobbies. A host creates a lobby, receives credentials (lobby ID + admin password + per-team passwords), distributes them to teams. Each team joins a lobby and picks a team by entering its password. After joining, the existing hub/games experience continues, scoped to that lobby.

## Non-goals

- Enforcing team password on score writes from game pages (later spec).
- Admin actions (reset, normalize) gated by admin password (later spec).
- Scoreboard matrix view (later spec).
- Multi-device / cross-device session sync.
- Real authentication (Firebase Auth). Plain passwords in RTDB are acceptable for single-event offsite scope.

## Data model (Firebase Realtime DB)

```
/lobbies/{lobbyId}
  meta:
    createdAt: <ms epoch>
    teamCount: <int 2..20>
    adminPwd: <string, 6 chars>
  teams/{teamId}:                    # teamId = 1..teamCount
    id: <int>
    name: "Team {n}"                 # default; rename out of scope
    pwd: <string, 6 chars>
  scores/{teamId}/{stationCode}: <int>   # written later by games
  history/{pushKey}: { ts, code, station, teamId, score }
```

- `lobbyId` format: `PS-XXXX` where `XXXX` is 4 chars from alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no ambiguous `0/O/1/I`). Total keyspace ≈ 1M; collision check on create with up to 5 retries.
- `adminPwd`, team `pwd`: 6 chars from same alphabet.
- Plain text storage in RTDB. Acceptable for scope (single-day event, low-stakes data, no PII).
- Existing global `/teams`, `/scores`, `/history` keys removed.

## Routes & flows

### `index.html` — two view-states

State derived from `getSession()` (localStorage `psOffsite2026.lobby`).

**A. No session → `createJoin` view**

Two cards side by side:

1. **Create lobby**
   - Input: `teamCount` (number, 2–20, default 10).
   - Button: "Create lobby" → calls `createLobby(db, teamCount)`.
   - On success → transition to `credentials` view (in-memory, not persisted to session yet).

2. **Join lobby**
   - Input: `lobbyId` (uppercase, format-validated as `PS-XXXX`).
   - Button: "Continue" → calls `loadLobbyTeams(db, lobbyId)`.
   - On success → reveal team picker: list of teams (radio) + password input + "Join" button.
   - "Join" → calls `verifyTeamPwd(db, lobbyId, teamId, pwd)`. On success → `setSession(...)` → reload page → `hub` view.

**B. `credentials` view (transient, after create)**

- Big read-only display of `lobbyId` and `adminPwd` with copy buttons.
- Table of teams: columns `#`, `Name`, `Password`, copy-button-per-row.
- "Continue → join lobby" button — pre-fills lobby ID and drops into join flow.

**C. Session present → `hub` view**

- Header strip: "Lobby `PS-7K2X` · Team N" + "Leave lobby" button (clears session → reload → `createJoin`).
- Existing game tiles + scoreboard link, with `?lobby={id}&team={n}` appended to each href.
- Existing QR generator section retained.

### `scoreboard.html`

- Reads `?lobby={id}` from URL.
- No param → redirect to `index.html`.
- Param present → all `ref(db, ...)` calls namespaced under `/lobbies/{id}/...`.
- Submit-code form: unchanged UI for now. Password enforcement deferred.

### Game pages (`stations/1-gesture-lock.html`, `stations/2-pantomime.html`, `dino/index.html`, `flappy/index.html`)

Out of scope. Continue to function as today. Wiring lobby+team+pwd into score writes happens in a follow-up spec.

## Components / file layout

### New files

**`ps-offsite-2026/shared/lobby.js`** — pure logic + session helpers.

Exports:

```js
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateLobbyId();           // "PS-XXXX"
export function generatePwd(len = 6);        // alphanum
export function isValidLobbyId(s);           // regex check
export async function createLobby(db, teamCount);
  // returns { lobbyId, adminPwd, teams: [{id, name, pwd}] }
  // writes /lobbies/{id} once via set()
  // retries up to 5 times on collision
export async function loadLobbyTeams(db, lobbyId);
  // returns [{id, name}]  (no passwords)
  // throws { code: 'NOT_FOUND' } if lobby missing
export async function verifyTeamPwd(db, lobbyId, teamId, pwd);
  // returns boolean
export function getSession();      // { lobbyId, teamId, teamPwd } | null
export function setSession(s);
export function clearSession();
```

`SESSION_KEY = 'psOffsite2026.lobby'`. On first `lobby.js` module load, `localStorage.removeItem('psOffsite2026.team')` runs once to drop stale key from previous version.

**`ps-offsite-2026/shared/lobby.css`** — landing-specific styles. Cards, credentials table, copy buttons. Uses existing CSS vars from `index.html` (`--bg`, `--card`, `--accent`, etc.) — extract those to `lobby.css` `:root` and link from both.

### Modified files

**`ps-offsite-2026/index.html`** — body rewritten into three sections (`#view-create-join`, `#view-credentials`, `#view-hub`), toggled by inline `<script type="module">`. Existing `TEAM_KEY` / `teamSelect` logic deleted. Existing QR generator code retained inside `#view-hub`.

**`ps-offsite-2026/scoreboard.html`** — minimal change:

- Read `?lobby=` URL param. Missing → redirect to `index.html`.
- Prepend `/lobbies/{id}` to every `ref()` path (`teams`, `scores`, `history`, root subscription).
- Remove `ensureSeed()` — lobby creation already seeds teams via `createLobby`.
- Header shows lobby ID for context.

Full revamp (matrix view, admin actions) is a later spec.

### Out of scope, but flagged for impl plan

- Game pages stay unchanged in this iteration. They will pick up `?lobby` later.

## Error handling

| Case | Behavior |
| --- | --- |
| Lobby ID collision on create | Retry up to 5 times. After 5 failures → inline red banner "Couldn't allocate lobby ID, please retry". |
| `createLobby` Firebase write fails | Red banner with raw error message + retry button. |
| Join: lobby not found | Red banner "Lobby not found. Check the ID." |
| Join: wrong team password | Red banner "Wrong password." (Don't reveal whether team is valid.) |
| `localStorage` JSON parse error | Catch, clear key, fall back to `createJoin` view silently. |
| Firebase config missing / placeholder | Reuse existing `showSetupNeeded()` UI from `scoreboard.html`. |
| `teamCount` out of range | Disable Create button + inline hint "2–20 teams". |

## Testing

### Automated (vitest)

`tests/lobby.test.js` — pure-logic tests for `lobby.js`:

- `generateLobbyId()` always matches `/^PS-[A-Z2-9]{4}$/`, no ambiguous chars.
- `generatePwd(6)` length 6, alphabet matches.
- `isValidLobbyId('PS-7K2X')` true; `'ps-7k2x'`, `'PS-0K2X'`, `'PS-7K2'` false.
- `setSession({...}) → getSession()` round-trip via mock localStorage; corrupt JSON returns null.

Firebase-backed functions (`createLobby`, `loadLobbyTeams`, `verifyTeamPwd`) tested via injected mock `db` object with stubbed `get`/`set` — verify path strings + retry-on-collision logic.

### Manual smoke

Sequence on live (or emulator) Firebase:

1. Open `index.html` fresh tab → see `createJoin`.
2. Create with `teamCount=4` → credentials view shows 1 lobby ID + 4 team rows + admin pwd.
3. Copy lobby ID + team 2 pwd.
4. Click "Continue → join lobby" → lobby ID pre-filled → pick team 2 → paste pwd → "Join".
5. Hub view shows "Lobby PS-XXXX · Team 2". Refresh → still in hub.
6. Click "Leave lobby" → back to `createJoin`.
7. "Join lobby" → enter wrong lobby ID → red banner.
8. Enter correct ID → wrong pwd → red banner.
9. `scoreboard.html` direct → redirect to `index.html`.
10. From hub, click scoreboard tile → `scoreboard.html?lobby=PS-XXXX` loads with empty leaderboard.

## Open questions resolved during brainstorm

- Lobby ID format: `PS-XXXX` short readable.
- DB model: namespace `/lobbies/{id}/...`; drop existing global keys.
- Password storage: plain text.
- Client state: `localStorage`.
- Credentials distribution: on-screen table with copy buttons (no print / export).
- Landing: repurpose `index.html`.
