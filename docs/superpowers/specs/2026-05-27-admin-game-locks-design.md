# Admin Game Locks — Design

**Date:** 2026-05-27
**Status:** Approved (brainstorming)

## Goal

Let an admin (from the scoreboard) control which games teams can enter, at three
granularities:

- **ALL** — lock/unlock every game at once.
- **PER GAME** — lock/unlock one game for all teams.
- **PER GAME + TEAM** — lock/unlock one game for one team.

Higher granularity overrides lower. **Default: all games locked** — teams cannot
enter any game until the admin unlocks it.

## 1. Data model (Firebase Realtime Database)

New node under each lobby: `lobbies/{lobbyId}/locks`

```
locks
  all:   "locked" | "unlocked"                               // baseline; ABSENT => "locked"
  games: { [gameKey]: "locked" | "unlocked" }                // per-game override
  cells: { [gameKey]: { [teamId]: "locked" | "unlocked" } }  // per-team-game override
```

- `gameKey` = existing 2-char catalog key (GZ, PM, DN, FL, MX, MB, SF, GD, HD, DG).
- Whole `locks` node absent → everything locked. Brand-new lobby is all-locked
  with no migration or backfill.
- Values stored explicitly as `"locked"`/`"unlocked"` (not an unlock-only set),
  because a per-team **lock** override on an otherwise-unlocked game must be
  expressible.

## 2. Resolution + write helpers — `shared/game-lock.js` (pure, unit-tested)

Mirrors the existing pure-module pattern (`shared/ranking.js`,
`shared/score-submit.js`): no Firebase imports, fully testable.

**Read — precedence cell > game > all.** MUST use optional chaining — `??`
only guards `null`/`undefined` *values*, not missing intermediate objects, so the
naive `cells[k][t]` form throws `TypeError` on the default (absent-node) case:

```js
resolveLock(locks, gameKey, teamId)
  // locks?.cells?.[gameKey]?.[teamId] ?? locks?.games?.[gameKey] ?? locks?.all ?? "locked"
  // teamId missing (admin/sessionless) => cell branch is undefined => degrades to game/all

isUnlocked(locks, gameKey, teamId)
  // === resolveLock(...) === "unlocked"
```

Values are the strings `"locked"`/`"unlocked"`, so `??` never mistreats a present
`"locked"` as falsy — a per-team **lock** override on an unlocked game resolves
correctly.

**Cascade-clear writes** — operate on an in-memory draft, return it. Lazily create
nested objects (the draft is cloned from a possibly-absent node). A lower-level
write wipes more-specific overrides beneath it:

```js
setAll(draft, value)        // draft.all = value; draft.games = {}; draft.cells = {}
setGame(draft, key, value)  // draft.games ??= {}; draft.games[key] = value; delete draft.cells?.[key]
setCell(draft, key, team, value) // draft.cells ??= {}; draft.cells[key] ??= {}; draft.cells[key][team] = value
```

**Toggle helpers** — flip the current *resolved* state at that level, then call
the matching `set*`:

```js
toggleAll(draft)              // current = draft.all ?? "locked"; setAll(opposite)
toggleGame(draft, key)        // current = resolved game state; setGame(opposite)
toggleCell(draft, key, team)  // current = resolved cell state; setCell(opposite)
```

## 3. Edit-mode draft (scoreboard refactor)

Lock toggles are **staged with Save** (same buffer as score edits; Cancel discards
both). Today score values are read from the DOM only at Save time. Once a lock
toggle triggers a re-render, rebuilt `<input>` elements would lose typed scores —
so edit mode must stage **both** scores and locks in memory:

- `startEdits()` → `draft = { scores: {...current...}, locks: clone(locks) }`.
- Score `<input>` handlers and lock buttons mutate `draft`. `render()` reads from
  `draft` while editing.
- `saveEdits()` → write score diffs (existing per-cell logic) **and**
  `set(ref(db, LOBBY_PATH + '/locks'), draft.locks)` as one node write.
- `cancelEdits()` → drop `draft`, revert to live state.
- The `onValue` handler keeps skipping re-render while `editing` is true
  (unchanged).

**Concurrency:** the whole-`/locks`-node `set` is last-writer-wins — a second
admin's lock change during this admin's edit session is invisible (render skipped
while editing) and silently overwritten on Save. Accepted for the single-admin
offsite use case. Scores avoid this via per-cell diffs; locks are coarser by
design. If multi-admin ever matters, switch to per-changed-path writes.

## 4. Scoreboard UI (admin, edit mode only)

**Controls row:**

- Non-edit: **Edit** button only.
- Edit mode: **Save · Cancel · {Unlock all | Lock all} · Reset**.
  - ALL toggle label = the action it performs (`Unlock all` when `all === locked`,
    else `Lock all`). Mutates `draft` (staged).
  - **Reset** moves here from the non-edit row. It keeps its current behavior:
    immediate write + confirm dialog, NOT part of the staged draft.

**Per-game (column header):** small lock toggle (🔒/🔓) in each game header cell,
reflecting the resolved game-level state. Click → `toggleGame` on draft.

**Per-cell (table cell):** small lock toggle (🔒/🔓) inside each cell, beside the
existing number input. Reflects resolved cell state. Click → `toggleCell` on draft.

**Visual:** cells and headers are tinted by resolved lock state (locked = red-ish
border, unlocked = green-ish) so the admin reads the whole lock matrix at a glance.

**View mode:** unchanged — no lock controls or indicators.

## 5. Team-side enforcement

**`games.html`** — add an `onValue` listener on the `locks` node (alongside the
existing per-team scores listener). For each tile, compute
`isUnlocked(locks, key, session.teamId)`:

- Locked → render in the existing `soon`-style tile (greyed, `pointer-events:none`,
  🔒 icon + "Locked" tag, no `href`). Unlocks update live, no refresh.
- An already-submitted score line stays visible (read-only) on a locked tile.
- `teamId` comes from `session.teamId`. Admin / sessionless (no `teamId`) degrades
  to game/all-level resolution (no per-cell override) — acceptable, admins don't
  play.

**Game pages** — `games/1-gesture-lock.html`, `games/2-pantomime.html`,
`games/3-dino.html`, `games/4-flappy.html`, `games/manual.html`:

- Each page already has its own game-code constant `GAME_CODE` (playable pages
  hardcode it; `manual.html` reads `?key=`). Pass `GAME_CODE` into `resolveLock`.
- On load (inside the existing `boot()` `get`): `resolveLock` for this game + team.
  Locked → render a "Game locked" panel with a back link to `games.html` (no
  redirect flash).
- **Already-played wins over locked:** if the team already submitted, keep the
  existing read-only already-played view (no fresh entry happens there anyway).
  Lock only blocks *fresh* entry.
- **Submit-time guard:** re-check lock state immediately before the `submitScore`
  call (covers a lock landing while a team is mid-play). The guard wraps the whole
  `submitScore` — it must block BOTH the `scores` update and the `history` push,
  not just the score write. Blocked submit shows a distinct "Locked — score not
  saved" banner (not the generic submit-failure path).

## 6. Enforcement boundary, scope, non-goals

- **Locks are client-side advisory, NOT server-enforced.** Firebase rules are
  fully open (`.read:true`/`.write:true`, per `SETUP.md`) and the app has no
  Firebase Auth — admin "auth" is plaintext-password + UI gating only. A
  determined team could bypass via console/URL. This matches the existing posture
  for scores; locks add no real access control, only the normal-flow gate. Rules
  are **unchanged**.
- The locks Save write inherits the **same admin gate as score edits**: controls
  render only when `isAdmin` (session-derived). No extra `requireAdmin` prompt on
  Save (parity with the current score-edit path); `requireAdmin` stays on Reset.
- Lock gates **entry only**. Existing scores still display on the scoreboard and
  still count in rank-point calculations.
- **Default-locked first run:** a freshly created lobby writes no `/locks` node →
  every team sees a fully greyed games page until the admin unlocks. Intended;
  admin onboarding should set expectations so it's not mistaken for breakage.
- No view-mode lock indicator.
- No lock history/audit, no scheduled/timed unlocks.

## 7. Tests — `tests/game-lock.test.js` (vitest)

- `resolveLock` precedence: cell beats game beats all.
- Default `"locked"` on absent node / missing intermediate: `resolveLock(undefined,
  'GZ', 1)`, `resolveLock({}, 'GZ', 1)`, `resolveLock({games:{}}, 'GZ', 1)` all
  `=== "locked"` (regression guard for the optional-chaining bug).
- Missing `teamId` degrades to game/all level (no crash, no phantom cell match).
- `setAll` clears `games` + `cells`; `setGame` clears that game's `cells`;
  `setCell` sets a single entry. Run each against a draft cloned from an absent
  node (`{}`) to confirm lazy nested-object creation.
- `toggle*` flip the resolved state at their level.
- `isUnlocked` boolean wrapper.

## Files

- **New:** `ps-offsite-2026/shared/game-lock.js`, `tests/game-lock.test.js`.
- **Edit:** `ps-offsite-2026/scoreboard.html`, `ps-offsite-2026/games.html`,
  `ps-offsite-2026/games/1-gesture-lock.html`,
  `ps-offsite-2026/games/2-pantomime.html`,
  `ps-offsite-2026/games/3-dino.html`,
  `ps-offsite-2026/games/4-flappy.html`,
  `ps-offsite-2026/games/manual.html`.
- No vite/build config change (no new HTML entry points).
