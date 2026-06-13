# Admin /games portal + dynamic per-lobby game model — design

Date: 2026-06-13
Branch: rebrand-games-scifi
Covers 2do.md "Game Portal" bullets: admin /games page (#1), move admin off
scoreboard (#2), game-list UI with actions (#3), create non-playable games
(#6), default-added rules (#7), plus folded items team-rename (#13) and
winners popover + full-screen confetti (#12).

## Goal

Turn the portal's static game list into a per-lobby, admin-managed set. The
admin manages games from an admin view of `/games` (not the scoreboard):
add/remove games to the lobby, lock/unlock, edit rules + timer, and create
custom host-scored ("non-playable") games. Teams see only the games the admin
added. Scoreboard becomes score-entry + grading + live leaderboard only.

## Decisions (locked with user)

1. Admin /games surface lives **inside `games.html`**, role-switched: an admin
   session renders a management view; a team session renders the player grid.
   (Today admins are redirected to scoreboard — that redirect is removed for
   games.html.)
2. **Game management moves off scoreboard** into the /games admin view:
   add/remove, lock/unlock, rules, timer. Scoreboard keeps per-team **score
   entry**, **quiz grading**, **reset**, live leaderboard, and the new winners
   celebration.
3. Custom games are **host-scored** (kind `manual`): admin sets name, an emoji
   (plain text emoji input), rules text, and an optional timer. Host enters
   their scores on the scoreboard like other host-scored games.
4. **Per-team granularity is kept** for lock/timer/rules (not just game-level).
5. **Removing a game (eye-off) hides it everywhere** — team grid AND scoreboard.
   Scores stay in the DB and are ignored while removed; re-adding restores them.
6. Team rename (#13) and winners popover + full-screen confetti (#12) are
   included in this phase.

## Data model

Built-in defaults stay in `ps-offsite-2026/shared/games-catalog.js` (the 8
games). A new per-lobby node stores only deltas:

```
lobbies/{id}/games/{key}: {
  added: boolean,            // visible in lobby (teams + scoreboard)
  // custom games only:
  custom: true,
  name: string,
  emoji: string,
  rules: string,
  kind: "manual",
  order: number              // creation order, for stable sort
}
```

- Built-in keys (`GZ PM DN FL GD HD DG PQ`) appear in this node only to carry an
  explicit `added` flag once toggled; their name/emoji/href/kind come from the
  static catalog (rules continue to resolve via the existing `rules` node).
- Custom keys: `CU` + 4 chars from the safe ALPHABET (collision-checked against
  built-ins + existing custom keys).

### Default-added rule (#7)

When `added` is unset for a key, the default is `kind === 'play'`. So a fresh
lobby shows the 4 playable games and hides the manual + quiz games until the
admin adds them. No migration of existing lobbies required (absence = default).

### New shared module: `shared/lobby-games.js`

Pure functions, unit-tested:

- `resolveCatalog(staticGames, lobbyGamesNode)` → ordered array of effective
  games `{ key, name, emoji, kind, href?, custom, added }`. Order: built-ins in
  catalog order, then customs by `order`. `added` resolved via the default rule.
- `addedKeys(effectiveCatalog)` → keys where `added` is true (used by team grid
  + scoreboard to filter).
- `nextCustomKey(existingKeys, rng)` → unique `CU####` key.
- `makeCustomGame({name, emoji, rules, order})` → the node object to write.
- Validation: `validateCustomGame(input)` → `{ok, error}` (name non-empty,
  emoji non-empty/short, rules string).

## Admin /games view (games.html, admin session)

Replaces the player grid when `isAdminSession`. Renders a vertical list of all
effective games (added and not-added shown; not-added are visually dimmed).

Per game row:

- emoji · name · kind tag (Playable / Host-scored / Quiz / Custom)
- **👁 add/remove** — toggles `games/{key}/added`. Removing hides it from teams
  and scoreboard.
- **🔒/🔓 lock** — game-level all-teams lock via existing `game-lock.js`
  (`setGame`/`toggleGame` on `locks.games[key]`).
- **📋 rules** — modal editing `rules.games[key]` (existing `game-config.js`
  `setGameOverride`). Empty falls back to catalog/custom default.
- **⏱ timer** — host-scored + custom games only; modal editing
  `timers.games[key]` (existing `setGameOverride`).
- **⋯ per-team** — expander revealing one row per team with per-team
  lock/timer/rules controls writing the `cells` level
  (`locks.cells[key][teamId]`, `timers.cells[key][teamId]`,
  `rules.cells[key][teamId]`). Reuses existing resolve + cell write helpers.

Plus a **“+ New game”** form (name, emoji, rules, optional timer) → writes a
custom host-scored game and adds it (`added: true`).

Writes are applied directly (no buffered edit-mode here — each toggle/save is an
immediate Firebase write), consistent with simplicity; modals confirm
rules/timer edits.

## Player grid (games.html, team session)

Built from `resolveCatalog` then filtered to `addedKeys`. Otherwise unchanged
(emoji tiles, lock/timer/score badges). Custom games render like manual games
(route to `manual.html?key=...`); `manual.html` resolves the game from the
effective catalog (built-in static OR custom from the lobby node) rather than
static-only.

## Scoreboard changes

- Reads effective catalog (via resolver) and renders only `addedKeys` columns.
  Removed games drop out of the matrix; their scores are ignored by
  `computeLeader`.
- **Edit mode shrinks to score entry only**: score-cell inputs + team-name
  inputs (see rename). The lock / timer / rules buttons and their modals are
  removed from scoreboard (moved to /games admin).
- Reset + quiz grading unchanged.

## Team rename (#13)

- `teams/{id}/name` is the source of truth (already exists).
- **Topbar**: for a team session, the “Team N” label gets an inline rename
  affordance (pencil → input → save) writing `teams/{teamId}/name`. Mounted in
  `shared/topbar.js`.
- **Scoreboard edit mode**: each team’s name cell becomes a text input; saved
  with the score edits to `teams/{id}/name`.
- Validation: non-empty, trimmed, max ~24 chars, HTML-escaped on render.

## Winners celebration (#12)

- Scoreboard admin-only button **“Celebrate winner”**.
- On click: a popover/modal names the current leader (`computeLeader()` →
  team name + total points) and triggers **full-screen** confetti (extend the
  existing `confetti()` to cover the viewport and raise piece count; current
  impl already appends to a fixed container — widen it and trigger manually).
- Auto leader-change confetti stays as-is (smaller, automatic).

## Files touched

- New: `shared/lobby-games.js`, `tests/lobby-games.test.js`,
  `docs/.../this-spec.md`.
- `games.html` — admin view + form + player-grid filter; remove admin→scoreboard
  redirect.
- `shared/games-catalog.js` — unchanged shape; consumed by resolver.
- `shared/topbar.js` — team rename affordance; allow admin to stay on games.html.
- `games/manual.html` — resolve custom games from the lobby node.
- `scoreboard.html` — filter to added games; drop lock/timer/rules editing; add
  team-name inputs in edit mode; add winners button + popover + full-screen
  confetti.
- Possibly small CSS in `shared/lobby.css` / scoreboard styles for the admin
  list + rename + popover.

## Out of scope (later phases)

- Individuals-vs-teams mode (#9, #17) — Phase B.
- Bundling MediaPipe models into the repo (#16) — Phase C.

## Review revisions (v2 — after subagent code review)

A code review against the actual sources surfaced two critical gaps and several
others. Resolutions, now binding:

### C1 — Ranking is filtered in THREE places, not one
`computeLeader` is not the only score-summing path. All currently iterate the
**static** `allEnteredKeys()`:
- `scoreboard.html:632` (`computeLeader`) and `:683` (`render`) — swap to
  `addedKeys(effectiveCatalog)`.
- **`shared/topbar.js:82`** `subscribeTeamPoints` — the live "— pts" badge on
  every team page. Must also sum over the lobby's resolved + added catalog, and
  must include custom (`CU####`) score keys (static `allEnteredKeys` never sees
  them). **topbar.js therefore must subscribe to `lobbies/{id}/games`** (today it
  reads root once) so its total matches the scoreboard. Added to scope.

### C2 — Admin session has no `teamId`; the redirect lives in topbar.js
`resolveSession()` returns `{ lobbyId, role:'admin' }` with no `teamId`
(`lobby.js:139`). The whole games.html player path assumes `session.teamId`
(`tileHref` :169-172, `resolveLock` :179, six `onValue` listeners on
`scores/${teamId}` etc. :246-274). There is **no redirect inside games.html** —
admins are steered away by `topbar.js` nav (admin nav omits the Games link,
`brandHref = scoreHref`, :35-43).

Binding design:
- games.html gets an **early guard**: `if (isAdminSession(session)) {
  renderAdminGames(); return; }` placed **before** any teamId-dependent listener.
- The admin branch subscribes to `lobbies/{id}/games`, `/locks`, `/timers`,
  `/rules`, `/teams` — never to `scores/{teamId}`.
- `topbar.js` admin nav keeps a **Games** link so admins can reach the admin view.

### M2 — manual.html must resolve custom games asynchronously
`manual.html:97` uses synchronous static `getGame(key)` and rejects non-manual
(:106). For a custom key it must first read `lobbies/{id}/games/{key}`. Rules
resolution precedence becomes: `rules.cells[key][teamId]` → `rules.games[key]` →
**custom node `games/{key}/rules`** → static catalog `rules`. The live rules
listener (:281) keeps reading `lobbies/{id}/rules`; only the default fallback
source changes for custom games.

### M3 — Immediate writes + cascade-clear
The pure helpers (`setGame`/`setGameOverride`) cascade-clear that game's `cells`
(`game-lock.js:52`, `game-config.js:58`). With per-toggle immediate writes, a
game-level lock/timer/rules change instantly wipes per-team overrides set in the
expander. This is the existing designed semantics; the admin UI must **warn on a
game-level change when per-team overrides exist** ("this clears per-team
settings for X"). Per-toggle flow: read node → deep-clone → apply helper → write
whole node back.

### M4 — Filter the other counters too
After filtering columns to `addedKeys`, also filter: scoreboard `gameCount`
numerator (`:701-708`, currently `Object.keys(t.scores)`), `submissionCount`
(`:790`, from unfiltered `history`), and make the hardcoded "8 games · one
winner" subtitle (`:337`) dynamic from `addedKeys.length`.

### M5 — Custom-game delete (now in scope)
Admin can **delete** a custom game (trash action, with confirm) — not just
remove. Delete removes `games/{key}`. Orphaned `scores/{team}/{key}` and
`history` entries are left as-is (ignored — key no longer in catalog).
`nextCustomKey` must avoid reuse of any key still present in `scores` or
`history`, not only live custom keys, to prevent a recreated game inheriting a
dead game's points.

### m1 — Keep new module out of the theme.js import chain
`tests/lobby.test.js` is already red at HEAD: `lobby.js` → `theme.js:71` touches
`document` at import under the node test env. `lobby-games.js` must import
**nothing** from `lobby.js`/`theme.js` so `tests/lobby-games.test.js` stays
green. (Pre-existing failure, not a regression from this work.)

### m2 — `order` assignment
New custom game `order = 1 + max(existing custom orders, 0)`. Built-ins keep
static catalog order. Gaps after delete are harmless (sort only).

### m3 — Topbar shows the stored team name
Topbar currently labels by id ("Team N", `:42`). It will show the **stored
`teams/{id}/name`** (fallback "Team {id}") so a rename is visible there too.

### m5 — Security posture unchanged (acknowledged)
Firebase rules stay open by design (one-day event, non-public URL). The new
`games/*` write surface lets any lobby-id holder add/flip/inject games; all
rendered fields are `esc()`-escaped (no stored XSS), but the catalog is
corruptible — accepted, same posture as existing open scores/locks writes.

### m6 — Behavior change for in-flight lobbies (no data migration)
Existing lobbies have no `games` node, so the default rule hides GD/HD/DG/PQ
until an admin adds them (today all 8 show). Intended per #7; flagged so it
isn't read as data loss.

### Scope additions from review
`shared/topbar.js` (ranking filter + subscribe to games node + stored name) and
`shared/ranking.js` (if it sums by static keys — verify and route through
addedKeys) join the touched-files list. Custom delete + key-reuse safety join
`lobby-games.js`.

## Testing

- Unit: `lobby-games.js` (resolveCatalog ordering, default-added rule,
  nextCustomKey uniqueness, validateCustomGame, addedKeys).
- Existing catalog/lobby/score tests stay green.
- Manual: create lobby → admin /games add/remove/lock/rules/timer + create
  custom game → team sees only added games → host scores custom game on
  scoreboard → rename a team from topbar and from scoreboard → celebrate winner.
