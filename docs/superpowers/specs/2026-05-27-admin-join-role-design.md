# Admin as a join role — design

**Date:** 2026-05-27
**Build plan item:** "admin view -> při joinu do lobby je pod týmama ještě join as admin -> to chce admin heslo -> vidím scoreboard + admin akce (reset scoreboard)"

## Problem

Admin access today is implicit and action-scoped:

- The scoreboard always renders a **Reset** button; clicking it calls `requireAdmin()`, which prompts for the admin password and caches it per-lobby in `sessionStorage`.
- A separate **"View scoreboard"** spectator card on the index lets anyone open a lobby's board read-only.
- There is no admin *identity*: you cannot "be" an admin, you only momentarily authenticate to perform one action.

We want admin to be an explicit **join role**, parallel to joining a team: you pick "Enter as Admin" from the team list, type the admin password once, land on the scoreboard, and stay admin across refresh/navigation until you leave.

## Decisions (locked with user)

1. **Spectator card removed entirely.** No anonymous viewing. The only entry points are "join a team" or "Enter as Admin".
2. **"Enter as Admin" lives in the team list**, shown after the lobby ID is entered and teams are revealed.
3. **Admin is a persisted session** (localStorage), parallel to a team session. Topbar shows `Admin`; **Leave** clears it; Reset no longer re-prompts each click.
4. **Drop the spectator concept.** A raw `scoreboard.html?lobby=PS-XXXX` link with no session redirects to index.
5. **Session model: discriminated union on the existing key** (Approach A). One identity per browser per lobby — team OR admin, never both.

## Architecture

Single localStorage key (`SESSION_KEY`, unchanged) holds a discriminated union:

- Team:  `{ lobbyId, teamId, teamPwd }`  (unchanged)
- Admin: `{ lobbyId, role: 'admin', adminPwd }`

### Units changed

**`shared/lobby.js`**
- `getSession()` validates *either* shape. Team shape as today; admin shape requires `role === 'admin'` and string `adminPwd`. Invalid → cleared, returns null.
- Add `isAdminSession(s)` helper: `s?.role === 'admin'`.
- `resolveSession()` becomes role-aware:
  - URL `?lobby=&team=` → team context `{ lobbyId, teamId }` (unchanged).
  - else `getSession()`: team → `{ lobbyId, teamId }`; admin → `{ lobbyId, role: 'admin' }`.
  - else null.
- `setSession` / `clearSession` unchanged (generic JSON).

**`index.html`**
- Delete the "View scoreboard" card markup, the `spectateLobbyId`/`spectateBtn`/`spectateErr` elements, and the entire spectator flow JS block.
- In `revealTeamPicker`, append an **"Enter as Admin"** option below the team radios (same `name="teamPick"`, sentinel value e.g. `value="__admin__"`).
- When the admin option is selected, relabel the password field to "Admin password"; when a team is selected, label reverts to "Team password".
- `doJoin(lobbyId)`:
  - admin selected → `verifyAdminPwd(lobbyId, pwd)`; on success `setSession({ lobbyId, role:'admin', adminPwd: pwd })` and redirect to `scoreboard.html?lobby=<id>` (no `team`).
  - team selected → existing path unchanged.
- Bootstrap redirect at bottom: if an admin session exists, redirect to `scoreboard.html?lobby=<id>`; if a team session exists, redirect to games (as today).

**`shared/topbar.js`**
- Replace the two-mode (team / spectator) logic with two modes: **team** and **admin**.
  - team: nav = Games + Scoreboard, info = `Lobby … · Team N · — pts`, points subscription as today.
  - admin: nav = Scoreboard only, info = `Lobby … · Admin`, no points subscription, brand → scoreboard, Leave label = "Leave".
- `mountTopbar`: resolve session; if neither team nor admin → `location.replace(index)`. Remove the `spectator` variable and the `isValidLobbyId(urlLobby)` spectator branch.

**`scoreboard.html`**
- Render the Reset control **only when the current session is an admin session** for this lobby. Otherwise omit it (a team viewing the board sees no admin actions).
- `resetAll()` keeps the `confirm()` dialog. `requireAdmin` still guards it (cheap, and covers the edge case of a stale session), but with an admin session it resolves without a prompt.

**`shared/admin-gate.js`**
- `requireAdmin(lobbyId)`:
  1. If a persisted admin session exists and its `lobbyId` matches → return true (optionally verify `adminPwd` against DB; rotation does not exist, so a match is sufficient).
  2. Else fall back to today's behavior: check `sessionStorage` cache, else `prompt()`, verify, cache.
- This preserves the in-game restart path: a player's device (team session) where the organizer types the admin password to restart an already-played game. Games 1–4 call `requireAdmin` unchanged.

## Data flow

```
index: enter lobby ID → Continue → team list (+ "Enter as Admin")
  ├─ pick team  + team pwd  → setSession(team)  → games.html?lobby&team
  └─ Enter as Admin + admin pwd → setSession(admin) → scoreboard.html?lobby

scoreboard: resolveSession()
  ├─ admin session (matches lobby) → render board + Reset
  ├─ team session                  → render board, no Reset
  └─ none                          → redirect index

game page (already played): requireAdmin(lobbyId)
  ├─ admin session matches → allow restart (no prompt)
  └─ team session          → prompt admin pwd → allow/deny
```

## Error handling

- Wrong admin password on join → existing inline `joinErr` banner ("Wrong password.").
- Admin session present but lobby in URL differs from session lobby → treat as not-admin for that lobby (Reset hidden; `requireAdmin` falls back to prompt).
- Corrupt/legacy session JSON → `getSession` clears it and returns null (existing behavior).

## Testing

No automated suite in this project; verification is manual in the browser:

1. Create lobby → note admin pwd. Join flow shows teams **and** "Enter as Admin".
2. Enter as Admin with correct pwd → lands on scoreboard, topbar shows `Admin`, Reset visible.
3. Refresh scoreboard → still admin, no re-prompt.
4. Reset → confirm dialog → scores/history wiped, teams kept.
5. Leave (admin) → session cleared → back to index.
6. Join as a team → open Scoreboard from topbar → board renders, **no** Reset button.
7. Open `scoreboard.html?lobby=PS-XXXX` with no session → redirects to index.
8. As a team on an already-played game, click restart → admin-pwd prompt still appears and works.
9. Wrong admin pwd on join → inline error, no session set.

## Out of scope (YAGNI)

- Multiple admin actions beyond Reset (only Reset exists per the build plan).
- Admin password rotation / DB re-verification on every action.
- Simultaneous team+admin identity on one device.
