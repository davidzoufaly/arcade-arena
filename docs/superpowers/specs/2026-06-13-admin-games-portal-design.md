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

## Testing

- Unit: `lobby-games.js` (resolveCatalog ordering, default-added rule,
  nextCustomKey uniqueness, validateCustomGame, addedKeys).
- Existing catalog/lobby/score tests stay green.
- Manual: create lobby → admin /games add/remove/lock/rules/timer + create
  custom game → team sees only added games → host scores custom game on
  scoreboard → rename a team from topbar and from scoreboard → celebrate winner.
