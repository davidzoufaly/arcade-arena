# Admin Game Timers & Editable Rules — Design

**Date:** 2026-05-29
**Status:** Approved (brainstorming)

## Goal

Add two admin controls, alongside the existing per-game / per-team lock toggles in
the scoreboard **edit mode**, **for non-playable (manual-kind) games only**:

- **Time limit (⏱)** — set a per-game and/or per-team countdown in minutes. When a
  team enters a timed game, a countdown starts and is persisted (start timestamp in
  DB) so a page refresh cannot buy more time. The team must submit before the
  countdown ends or they are recorded a **0**.
- **Rules (📋)** — edit a manual game's rules text per-game and/or per-team. A
  per-team entry fully overrides the game's rules for that team, so the admin can
  hand specific teams tailored hints mid-event. Edits go live to teams (via the
  existing realtime listeners) once the admin saves.

This mirrors the shipped **admin-game-locks** feature
(`docs/superpowers/specs/2026-05-27-admin-game-locks-design.md`): same edit-mode,
same `{games, cells}` override shape, same client-side-advisory posture.

## Decisions (resolved during brainstorming)

1. **Commit model: staged into the edit Save.** The clock/rules modals edit the
   in-memory draft (parity with lock toggles). Nothing is written until the admin
   clicks the scoreboard **Save**. Cancel discards. After Save, teams receive the
   change live through their existing `onValue` listeners (this is the
   "automatically updated" behaviour — live propagation, not a Save bypass).
2. **Per-team rule is a FULL OVERRIDE.** Resolution precedence
   `cell > game > catalog default`. A per-team rule replaces the base rules for that
   team entirely (no append/merge).
3. **Timers are game-level + per-team override.** Precedence `cell > game`. No
   "all" level. Default (absent) → no limit.
4. **Time-up = auto-0 on expiry + late-submit-0.** When the countdown reaches 0 on
   the detail page the score auto-submits as `0` and the input locks. A submit
   attempt after the deadline also records `0`.

## 1. Data model (Firebase Realtime Database)

Three new nodes under each lobby, parallel to the existing `locks` node:

```
lobbies/{id}/
  timers:      { games: { [gameKey]: minutes },
                 cells: { [gameKey]: { [teamId]: minutes } } }      // admin config
  rules:       { games: { [gameKey]: text },
                 cells: { [gameKey]: { [teamId]: text } } }         // admin config
  timerStarts: { [gameKey]: { [teamId]: <ms-epoch> } }             // team-written
```

- `gameKey` is restricted to manual-kind catalog keys: `MX, MB, SF, GD, HD, DG`.
- **Absent `timers` → no limit anywhere.** (Unlike `locks`, the default is permissive.)
- **Absent `rules` → catalog default rules** (`GAMES[key].rules`) shown to everyone.
- `minutes` is a positive integer. Clearing a value (empty input or `0`) deletes
  that override.
- `text` is a free string (multi-line, same `\n\n`/`- ` convention `manual.html`'s
  `renderRules` already parses). Clearing (empty) deletes the override.
- `timerStarts/{gameKey}/{teamId}` is written **once**, by the team, on first entry
  to a timed game, and **never overwritten** — this is what makes the countdown
  refresh-proof. Not part of the admin draft.

## 2. Pure module — `shared/game-config.js` (no Firebase imports, unit-tested)

One generic `{games, cells}` resolver/mutator reused for both timers and rules
(identical shape and `cell > game` precedence), plus timer arithmetic. Same pattern
and optional-chaining discipline as `shared/game-lock.js`.

```js
// Read — precedence cell > game. Optional chaining REQUIRED (a missing
// intermediate object would throw on the common absent-node case).
resolveOverride(node, gameKey, teamId)
  // node?.cells?.[gameKey]?.[teamId] ?? node?.games?.[gameKey] ?? undefined

resolveTimer(timers, gameKey, teamId)
  // resolveOverride(...) -> a positive number (minutes) or undefined (= no limit)

resolveRule(rules, gameKey, teamId, fallback)
  // resolveOverride(rules, gameKey, teamId) ?? fallback   (fallback = catalog default)

// Cascade-clear writes on an in-memory draft (cloned from a possibly-absent node).
// Lazily create nested objects. Passing an empty/zero value DELETES the override.
setGameOverride(draft, gameKey, value)
  // value empty -> delete draft.games[gameKey]; else set it.
  // Either way, clear that game's cell overrides (mirrors setGame's cascade-clear).
setCellOverride(draft, gameKey, teamId, value)
  // value empty -> delete draft.cells[gameKey][teamId]; else set it.

// Timer arithmetic (pure).
deadlineFor(startTs, minutes)          // startTs + minutes * 60000
remainingMs(startTs, minutes, now)     // max(0, deadlineFor - now)
isExpired(startTs, minutes, now)       // now >= deadlineFor
```

"Empty" for timers means `'' | 0 | null | undefined | non-finite`; for rules means
`'' | null | undefined` (after trim). `setGameOverride` cascade-clears that game's
`cells` for the same reason `setGame` does in `game-lock.js`: a fresh game-level
value should not leave stale, now-shadowed per-team overrides behind.

### Tests — `tests/game-config.test.js` (vitest)

- `resolveOverride` precedence: cell beats game; absent → `undefined`.
- Optional-chaining regression: `resolveOverride(undefined, 'SF', 1)`,
  `resolveOverride({}, 'SF', 1)`, `resolveOverride({games:{}}, 'SF', 1)` → `undefined`
  (no throw).
- Missing `teamId` degrades to game level (no crash, no phantom cell match).
- `resolveTimer` returns minutes or `undefined`; `resolveRule` returns override or
  the provided fallback.
- `setGameOverride` sets, and clears that game's cells; clearing (empty/0) deletes.
- `setCellOverride` sets one entry; clearing deletes it. Run against a draft cloned
  from `{}` to confirm lazy nested-object creation.
- `deadlineFor` / `remainingMs` (clamped at 0) / `isExpired` boundary at exactly the
  deadline (`now === deadline` → expired).

## 3. Scoreboard edit mode (`scoreboard.html`)

### Draft generalization

Today edit mode stages `lockDraft` + `pendingScores` with a single `locksDirty`
flag. Generalize to a draft object:

```
draft = { locks: clone(locks), timers: clone(timers), rules: clone(rules) }
dirty = { locks: false, timers: false, rules: false }
```

- `startEdits()` clones all three live nodes into `draft`, resets `dirty`,
  initializes `pendingScores = {}`.
- `saveEdits()` writes the score diffs (existing per-cell logic), then writes each
  node whose `dirty` flag is set: `set(ref(db, LOBBY_PATH + '/timers'), draft.timers)`
  and `.../rules`, alongside the existing `.../locks` write.
- `cancelEdits()` drops `draft`, `dirty`, `pendingScores`.
- The `onValue` handler still skips re-render while `editing` (unchanged), and now
  also caches `timers` and `rules` into module state (like `locks`).

### New per-game / per-cell controls (manual games only)

Beside the existing 🔒/🔓 lock toggle, **only for `GAMES[g].kind === 'manual'`**,
render two more icon-buttons:

- **⏱ clock** — in the column header (game level) and in each cell (team level).
  Tinted/badged when an override is set (show the minutes, e.g. `⏱15`).
- **📋 rules** — same two placements; tinted when an override is set.

Playable-game columns keep only the lock toggle. The icon buttons must survive the
`innerHTML` re-render the same way lock buttons do: re-wire listeners after each
editing render (extend the existing `wireLockButtons()` into `wireEditButtons()`),
and call `captureScoreInputs()` before any re-render so typed scores are not lost.

### Modals (admin-side, in `scoreboard.html`)

Self-built overlay matching the existing dark UI. Each opened by clicking the
corresponding icon; prefilled with the **resolved current value** for that
(game) or (game, team).

- **Clock modal:** `<input type="number" min="0" step="1">` minutes + **Confirm /
  Cancel**. Confirm → `setGameOverride(draft.timers, g, mins)` or
  `setCellOverride(draft.timers, g, t, mins)`, set `dirty.timers = true`, re-render.
  Empty/0 clears the override. Cancel → close, no draft change.
- **Rules modal:** `<textarea>` + **Confirm / Cancel**. Confirm →
  `setGameOverride(draft.rules, …)` / `setCellOverride(draft.rules, …)`, set
  `dirty.rules = true`. Empty clears (back to catalog default). Cancel → close.

Both modals call `captureScoreInputs()` before mutating + re-rendering.

### Concurrency

Whole-node `set` on Save is last-writer-wins, same accepted trade-off as `locks`
(single-admin offsite). `timerStarts` is team-written and never part of the admin
draft, so admin Save cannot clobber a running countdown.

## 4. Player library (`games.html`)

Add an `onValue` listener on the `timers` node (alongside the existing `scores` and
`locks` listeners). In `render()`, for each **manual** tile compute
`resolveTimer(currentTimers, key, session.teamId)`:

- **Lock check still wins first** (existing behaviour): a locked tile renders locked
  and is not enterable, regardless of timer.
- Limit set **and not yet submitted** → show a **⏱ {N}m** badge on the tile (style
  parallel to the existing 🔒 lock badge / ✓ check).
- Tile click is **intercepted** for a timed, enterable, not-yet-submitted manual
  game: the tile renders as a button (not a bare `<a href>`) that opens a **warning
  modal**:

  > ⏱ **{game name} has a {N}-minute time limit.**
  > Entering starts your countdown now. You must submit your score before it reaches
  > 0, or you'll be recorded a **0**.
  > — **Enter game** / **Cancel**

  - **Enter game** → navigate to the same `manual.html?key=…&lobby=…&team=…` URL the
    tile would have used. **Cancel** → stay on the library.
- Non-timed manual tiles and all playable tiles are unchanged (direct links).
- Already-submitted tiles keep the existing ✓ + score line and link straight to the
  read-only detail (no warning — the countdown is moot once a score exists).

## 5. Manual detail: countdown + auto-0 (`games/manual.html`)

### Rules

Render rules from `resolveRule(rules, key, teamId, game.rules)` instead of the raw
`game.rules`. Add an `onValue` on the `rules` node so a live admin edit re-renders
the rules block without a refresh (the score input/banner state is preserved — only
the `.rules` block is re-rendered, not the whole panel).

### Timer flow

Resolve the timer for `(key, teamId)` on load. **No limit → page behaves exactly as
today** (no countdown, no auto-0). With a limit:

1. Read `timerStarts/{key}/{teamId}`.
   - **Absent → write `now`** (get-then-set-if-absent; this is "entering the game").
   - Present → reuse it. `deadline = deadlineFor(startTs, minutes)`.
2. Read the team's current score for this game.
   - **Already submitted → render the existing read-only "already played" view**;
     no countdown, no auto-0. (Scores win, mirroring the lock design's
     "already-played wins over locked".)
3. No score yet:
   - `now < deadline` → render a prominent **MM:SS countdown** at the top of the
     panel; input enabled.
   - `now >= deadline` (expired before arrival) → **auto-submit 0** via `submitScore`,
     lock the input, show **"⏱ Time's up — 0 recorded"**.
4. While the page is open and not yet expired: a 1s interval updates the countdown;
   at 0 it **auto-submits 0** via `submitScore`, locks the input, shows the time-up
   banner. The interval is cleared on a successful manual submit and on auto-0.

### Submit-time guard

Wrap the existing lock-then-submit logic. The order is: lock re-check (existing) →
**expiry re-check** → write. If `isExpired(startTs, minutes, now)` at submit time,
record **0** (not the typed value) and show "⏱ Time's up — 0 recorded". Otherwise
record the typed value. The guard covers **both** the `scores` update and the
`history` push (whole `submitScore`), same as the lock guard.

### timerStarts write

Per-team get-then-set-if-absent. A refresh or revisit reuses the stored timestamp,
so no extra time is granted. (Within one team a double first-write race is harmless
and effectively never happens at offsite scale.)

## 6. Enforcement boundary, scope, non-goals

- **Client-side advisory, NOT server-enforced** — identical posture to locks and
  scores. Firebase rules stay fully open (`SETUP.md`); there is no Firebase Auth.
  A determined team could reset their own `timerStarts` or write a score via the
  console. Accepted for a one-day offsite where the URL is private. Rules
  **unchanged**.
- Timers, editable rules, and the two icons apply to **manual games only**. Playable
  games are untouched (they have their own internal timing and dedicated pages).
- Auto-0 fires only **after** a team has entered (has a `timerStarts`). A timed game
  a team never opens simply has no score, like any unplayed game — it is **not**
  auto-zeroed.
- The clock/rules edits inherit the **same admin gate as score/lock edits**: controls
  render only when `isAdmin`; no extra `requireAdmin` prompt on Save (parity).
- Auto-0 and late-0 go through the existing `submitScore` path, so the scoreboard,
  history, and rank-point math treat them as a normal `0` submission.
- **Non-goals:** no all-level timer/rules, no pause/extend/reset of a running
  countdown, no per-change (path-level) writes, no audit log, no timers on playable
  games, no server-side enforcement.

## Files

- **New:** `ps-offsite-2026/shared/game-config.js`, `tests/game-config.test.js`.
- **Edit:** `ps-offsite-2026/scoreboard.html`, `ps-offsite-2026/games.html`,
  `ps-offsite-2026/games/manual.html`.
- No catalog change (`GAMES[key].rules` remains the fallback). No vite/build config
  change (no new HTML entry points).
