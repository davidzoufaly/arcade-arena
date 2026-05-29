# Admin Game Timers & Editable Rules — Design

**Date:** 2026-05-29
**Status:** Approved (brainstorming) · revised after subagent spec review

## Goal

Add two admin controls, alongside the existing per-game / per-team lock toggles in
the scoreboard **edit mode**, **for non-playable (manual-kind) games only**:

- **Time limit (⏱)** — set a per-game and/or per-team countdown in minutes. When a
  team enters a timed game, a countdown starts and is persisted (start timestamp in
  DB) so a page refresh cannot buy more time. The team must submit before the
  countdown ends or they are recorded a **0**.
- **Rules (📋)** — edit a manual game's rules text per-game and/or per-team. A
  per-team entry fully overrides the game's rules for that team, so the admin can
  hand specific teams tailored hints mid-event.

Both edits are **staged in the scoreboard edit draft and written on Save**. After
Save, teams see the change live — `games.html` already has realtime listeners;
`manual.html` does **not** today and gains new ones (see §5). "Automatically
updated" therefore means: live propagation to teams after the admin saves, with no
team-side refresh required.

This mirrors the shipped **admin-game-locks** feature
(`docs/superpowers/specs/2026-05-27-admin-game-locks-design.md`): same edit-mode,
same `{games, cells}` override shape, same client-side-advisory posture.

## Decisions (resolved during brainstorming)

1. **Commit model: staged into the edit Save.** The clock/rules modals edit the
   in-memory draft (parity with lock toggles). Nothing is written until the admin
   clicks the scoreboard **Save**. Cancel discards.
2. **Per-team rule is a FULL OVERRIDE.** Resolution precedence
   `cell > game > catalog default`.
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

- `gameKey` is a manual-kind catalog key. The illustrative set today is
  `MX, MB, SF, GD, HD, DG`, but **all gating uses `GAMES[g].kind === 'manual'` /
  `manualKeys()`**, never a hardcoded list (avoids drift if a manual game is added).
- **Absent `timers` → no limit anywhere.** (Unlike `locks`, the default is permissive.)
- **Absent `rules` → catalog default rules** (`GAMES[key].rules`) shown to everyone.
- `minutes` is a **positive integer**; `0` is **not** a stored value — it is the
  "clear" sentinel (see §2). The resolver also defensively treats any non-positive /
  non-finite / non-numeric stored value as "no limit".
- `text` is a free string (multi-line, same `\n\n` / `- ` convention `manual.html`'s
  `renderRules` already parses). A whitespace-only value clears the override.
- `timerStarts/{gameKey}/{teamId}` is written **once**, by the team, on first entry
  to a timed game, and **never overwritten** — this is what makes the countdown
  refresh-proof. Not part of the admin draft.
- **Empty maps round-trip as absent.** A `set` of `{}` (or `{games:{}, cells:{}}`)
  is pruned to `null` by RTDB, so a later `onValue` sees the node absent. The pure
  resolvers tolerate both shapes (optional chaining); this is a relied-upon
  behaviour and is regression-tested.

## 2. Pure module — `shared/game-config.js` (no Firebase imports, unit-tested)

One generic `{games, cells}` resolver/mutator reused for both timers and rules
(identical shape and `cell > game` precedence), plus timer arithmetic and small
display/predicate helpers. Same pattern and optional-chaining discipline as
`shared/game-lock.js`.

```js
// --- raw override read: precedence cell > game. Optional chaining REQUIRED
//     (a missing intermediate object would throw on the common absent-node case).
resolveOverride(node, gameKey, teamId)
  // node?.cells?.[gameKey]?.[teamId] ?? node?.games?.[gameKey]   // undefined when absent

hasOverride(node, gameKey, teamId)
  // true iff resolveOverride(...) !== undefined.
  // teamId omitted -> "is there a game-level override". Needed because resolveRule
  // returns the fallback for an absent override, so the UI cannot otherwise tell
  // "set to text" from "unset" when deciding whether to tint the icon.

// --- typed reads
resolveTimer(timers, gameKey, teamId)
  // const v = resolveOverride(timers, gameKey, teamId);
  // return Number.isFinite(v) && v > 0 ? v : undefined;   // normalize: junk/0 -> no limit
resolveRule(rules, gameKey, teamId, fallback)
  // resolveOverride(rules, gameKey, teamId) ?? fallback     // fallback = catalog default

// --- cascade writes on an in-memory draft (cloned from a possibly-absent node).
//     Lazily create nested objects. SET cascades; CLEAR is surgical.
setGameOverride(draft, gameKey, value)
  // SET (non-empty value): draft.games[gameKey] = value AND delete draft.cells[gameKey]
  //   (cascade-clear that game's cells, mirroring setGame — a fresh game-level value
  //    should not leave shadowed per-team overrides behind).
  // CLEAR (empty value): delete draft.games[gameKey] ONLY; LEAVE draft.cells[gameKey]
  //   intact (on clear there is nothing shadowing the cells, so they stay meaningful).
setCellOverride(draft, gameKey, teamId, value)
  // SET: draft.cells[gameKey][teamId] = value
  // CLEAR (empty): delete draft.cells[gameKey][teamId]

// --- timer arithmetic (pure). Callers guarantee a positive `minutes`.
deadlineFor(startTs, minutes)          // startTs + minutes * 60000
remainingMs(startTs, minutes, now)     // max(0, deadlineFor - now)
isExpired(startTs, minutes, now)       // now >= deadlineFor

// --- display (pure, so it is unit-tested rather than inline in manual.html)
formatMMSS(ms)                         // clamps negatives to 0 -> "M:SS" / "MM:SS"
```

- **"Empty" coercion happens in the mutator/modal layer**, not just the resolver.
  The clock modal does `Number(input.value)` and treats `'' | 0 | NaN | <=0` as
  clear; the rules modal treats trimmed-empty as clear. The resolver *also*
  normalizes defensively so corrupted DB data can never produce a `NaN`/`0`
  deadline.
- **String-keyed teamId:** `teamId` is a JS integer everywhere, but a draft cloned
  from a Firebase snapshot has string keys (`{ "3": 10 }`). Bracket access /
  `delete` coerce the number to a string key, identical to `setCell` in
  `game-lock.js`. This load-bearing coercion is exercised by a string-key test.

### Tests — `tests/game-config.test.js` (vitest)

- `resolveOverride` precedence (cell beats game); absent → `undefined`.
- Optional-chaining regression: `resolveOverride(undefined,'SF',1)`,
  `({},'SF',1)`, `({games:{}},'SF',1)` → `undefined` (no throw).
- Missing `teamId` degrades to game level; `hasOverride` with/without `teamId`.
- `resolveTimer` normalizes: stored `0`, `-5`, `NaN`, `"15"` (string), and absent →
  `undefined` for the junk/absent cases, a clean number where valid.
- `resolveRule` returns the override or the provided fallback (incl. fallback when
  override absent; whitespace-only override is cleared by the modal, not stored).
- `setGameOverride` **SET** clears that game's cells; **CLEAR** (empty/0) deletes
  only the game key and **preserves** existing cells — explicit regression for the
  clear-vs-set distinction.
- `setCellOverride` set/clear of a single entry; clearing the last cell leaves
  `cells[g] = {}` and the resolver still works (round-trip-to-absent tolerance).
- String-keyed `teamId` (`{ "3": 10 }`) set/clear/resolve.
- `deadlineFor` / `remainingMs` (clamped at 0) / `isExpired` boundaries:
  `now === deadline` → expired; `now === deadline - 1` → not expired, `remainingMs === 1`.
- `formatMMSS` zero/clamped/large values.

## 3. Scoreboard edit mode (`scoreboard.html`)

### Draft generalization (full rename)

Today edit mode uses four flat globals: `locks`, `lockDraft`, `pendingScores`,
`locksDirty`. Generalize to:

```
draft = { locks: clone(locks), timers: clone(timers), rules: clone(rules) }
dirty = { locks: false, timers: false, rules: false }
// pendingScores unchanged
```

**Every existing `lockDraft` / `locksDirty` reference migrates** — this touches
`startEdits`, `cancelEdits`, `saveEdits`, `wireLockButtons` (→ `wireEditButtons`),
`renderControls` (the "Lock all" button reads/sets `draft.locks` / `dirty.locks`),
and the two editing branches in `render()` (header + cell). The `onValue` handler
also caches `timers`/`rules` into module state alongside `locks`
(`snap.val()?.timers` / `?.rules`), used only as the clone source in `startEdits()`
(this page renders timer/rules controls **only in edit mode** — see View mode).

- `saveEdits()` writes score diffs (existing per-cell logic), then for each dirty
  node `set(ref(db, LOBBY_PATH + '/<node>'), draft.<node>)`. Writing an emptied node
  (`{}`) is fine — RTDB prunes it to the permissive default (§1). Writes are
  sequential and non-atomic, same accepted last-writer-wins posture as the locks
  write (single-admin offsite).
- **Edit-banner copy** (`#subtitle`, currently `Editing raw scores · clear a cell
  to remove · Save to apply`) updates to mention timers/rules are staged too, e.g.
  `Editing scores · clock/rules per game & team · Save to apply`.

### New per-game / per-cell controls (manual games only)

Beside the existing 🔒/🔓 lock toggle, **only when `GAMES[g].kind === 'manual'`**,
render two more icon-buttons in the column header (game level) and in each cell
(team level): **⏱ clock** and **📋 rules**. Playable-game columns keep only the
lock toggle. Buttons are re-wired after every editing render (`wireEditButtons`),
and `captureScoreInputs()` runs before any re-render so typed scores survive.

**Icon state:** tinted when `hasOverride(draft.<node>, g, [teamId])` at *that level*
(game header reflects a game-level override; a cell reflects a cell-level override).
The clock button shows its minutes compactly (e.g. `⏱15`).

**Cell layout (Critical — must be budgeted).** Game columns are a fixed `84px`
track inside a row with `overflow:hidden`; an editing manual cell currently holds a
full-width number input plus one lock button. Three buttons + a `⏱15` badge will
not fit by default. Therefore:

- Wrap the cell's buttons in a `display:flex; flex-wrap:wrap; gap:2px;
  justify-content:center` row beneath the input.
- Shrink the edit-mode icon buttons (font ≈ 12–13px, tight padding) so `🔒 ⏱15 📋`
  fits within ~84px (≈ 20 + 34 + 20 px). The clock minutes use a small inline badge,
  not full-size text.
- Header cells already stack via `<br>`; the two extra buttons go in a compact
  inline-flex row to avoid inflating header height excessively.

This CSS is part of the spec's scope (new rules in `scoreboard.html`'s `<style>`).

### Modals (admin-side, in `scoreboard.html`)

Self-built overlay matching the existing dark UI, opened by clicking the
corresponding icon. **Prefill uses the OWN-LEVEL override value only** (not the
resolved `cell > game` value), so clearing removes exactly that level and the modal
never silently pins an inherited value:

- **Clock modal:** `<input type="number" min="1" step="1">` (min **1**; `0`/empty =
  clear). Prefill: game modal ← `draft.timers?.games?.[g]`; cell modal ←
  `draft.timers?.cells?.[g]?.[t]` (blank when unset). **Confirm / Cancel.** Confirm
  → `Number(value)` → `setGameOverride`/`setCellOverride` on `draft.timers`,
  `dirty.timers = true`, re-render. Cancel → close, no draft change.
- **Rules modal:** `<textarea>` whose **placeholder shows the catalog default**
  (greyed preview) but whose *value* is the own-level override only
  (`draft.rules?.games?.[g]` / `…cells?.[g]?.[t]`, blank when unset). Confirm-without-
  typing on an unset entry is therefore a **no-op clear**, never a pin of the default.
  Confirm → trim → `setGameOverride`/`setCellOverride` on `draft.rules`,
  `dirty.rules = true`. Cancel → close.

Both modals call `captureScoreInputs()` before mutating + re-rendering. Opening a
modal does **not** re-render the matrix (overlay only), so typed scores are safe;
Cancel does not re-render either.

### Reset interaction

`resetAll()` today wipes `scores` + `history`. It must **also clear `timerStarts`**
(`set(.../timerStarts, null)`) so a team re-entering a timed game after a reset gets
a fresh countdown instead of an instantly-expired one. `timers`/`rules` config is
setup, not per-round progress, so Reset leaves them. Reset stays an immediate write
(not staged) and still `cancelEdits()` when invoked mid-edit, as today.

### View (non-edit) mode

Unchanged: the non-editing scoreboard shows **no** timer/rules icons or indicators
(parity with locks). Cached live `timers`/`rules` are used only to seed the draft.

## 4. Player library (`games.html`)

Add an `onValue` on the `timers` node (alongside the existing `scores` and `locks`
listeners). In `render()`, for each **manual** tile compute
`resolveTimer(currentTimers, key, session.teamId)`:

- **Lock check still wins first** (existing): a locked tile renders locked and is not
  enterable, regardless of timer. Decide button-vs-link only after the lock check,
  exactly where the current code nulls `href` for locked tiles.
- A tile is "submitted" when **`score !== undefined`** (same test the current render
  uses). An auto-0 stores `0`, which is defined → correctly counts as submitted (must
  gate on `=== undefined`, never falsiness, or a `0` would wrongly re-show the
  warning).
- Limit set **and `score === undefined` and not locked** → show a **⏱ {N}m** badge,
  and render the tile as a **button** (not a bare `<a>`) that opens a warning modal:

  > ⏱ **{game name} has a {N}-minute time limit.**
  > Entering starts your countdown now. You must submit your score before it reaches
  > 0, or you'll be recorded a **0**.
  > — **Enter game** / **Cancel**

  - **Enter game** → navigate to the same `manual.html?key=…&lobby=…&team=…` URL the
    tile would have used. **Cancel** → stay.
- Non-timed manual tiles, submitted tiles, and all playable tiles are unchanged
  (direct links; submitted tiles keep the ✓ + score line, no warning).

## 5. Manual detail: countdown + auto-0 (`games/manual.html`)

### New imports / listeners

`manual.html` today does one-shot `get` and imports only `get, update, push`. This
feature **adds `onValue` and `set`** to the Firebase import, and adds two listeners
(`rules`, and the team's `score`). The "live rules update" is therefore a **new**
realtime listener on this page, not an existing one.

### Rules

Render rules from `resolveRule(rules, key, teamId, game.rules)`. `render()` is split
so the rules block lives in its own `renderRulesBlock()` that targets the `.rules`
element only. A live `rules` `onValue` re-renders **just that block**, never
rebuilding `#container` — so the in-progress score input, the wired submit listener,
and the countdown DOM are preserved.

### Timer flow

Resolve the timer for `(key, teamId)` on load. **No limit → the page behaves exactly
as today** (no countdown, no auto-0). With a limit, in this order:

> 1. **Read the team's current score first.** If a score already exists →
>    render the existing read-only "already played" view; **do not** write
>    `timerStarts`, no countdown, no auto-0. (Scores win, mirroring the lock
>    design. Reading score-first prevents stamping a spurious start on a team that
>    played before the admin added the timer.)
> 2. No score yet → read `timerStarts/{key}/{teamId}`. **Absent → `set` `now`**
>    (get-then-set-if-absent; this is "entering"). Present → reuse it.
>    `deadline = deadlineFor(startTs, minutes)`.
> 3. `now < deadline` → render a prominent **MM:SS countdown** (`formatMMSS`) at the
>    top of the panel; input enabled. Arm a 1s interval.
> 4. `now >= deadline` on arrival → **auto-submit 0** (see guard below), lock input,
>    show **"⏱ Time's up — 0 recorded"**.

### Single-settle guard (Critical — race-safe)

A module-level latch prevents the manual submit and the interval-expiry callback
from both writing:

```
let settled = false;
function settle() { if (settled) return false; settled = true; clearInterval(timerId); return true; }
```

- The **interval tick** at 0 calls `settle()`; only if it returns true does it
  proceed to auto-submit 0.
- The **manual submit handler** calls `settle()` synchronously **before any await**;
  only if true does it proceed. (Clearing the interval alone is insufficient — an
  already-dispatched callback can be mid-await. `submitScore` is non-idempotent: its
  `push` would append a second history row.)
- On any successful submit/auto-0, `settled` stays true and the input is locked.

### Submit-time guard

Wrap the existing lock-then-submit logic. Order: `settle()` → lock re-check
(existing) → **expiry re-check** → write. If `isExpired(startTs, minutes, now)` at
submit time, record **0** (not the typed value) with "⏱ Time's up — 0 recorded";
else record the typed value. The guard decides 0-vs-typed before the single
`submitScore` call, so both the `scores` write and the `history` push carry the same
value.

### timerStarts write

Per-team get-then-set-if-absent (uses the new `set` import, or an `update` with
`{[teamId]: now}`). A refresh or revisit reuses the stored timestamp → no extra
time. A within-team double first-write race is harmless and effectively never
happens at offsite scale.

## 6. Enforcement boundary, scope, non-goals

- **Client-side advisory, NOT server-enforced** — identical posture to locks and
  scores. Firebase rules stay fully open (`SETUP.md`); there is no Firebase Auth. A
  determined team could reset their own `timerStarts` or write a score via the
  console. Accepted for a one-day offsite where the URL is private. Rules unchanged.
- Timers, editable rules, and the two icons apply to **manual games only**. Playable
  games are untouched (own internal timing, dedicated pages).
- **Enter-then-abandon hole (known, benign).** Auto-0 fires from the live interval or
  on a later load — so a team that enters a timed game, sees the countdown, then
  closes the tab before 0 and never returns is never auto-zeroed and shows no score.
  This grants **no advantage**: an absent score contributes **0 rank points** in
  `ranking.js` (only numeric scores are ranked), which is ≤ what an auto-0 would
  earn. The admin can also manually enter a score. Documented, not mitigated in code.
- A timed game a team **never opens** has no `timerStarts` and is likewise just an
  unplayed game (0 rank points) — not auto-zeroed.
- **`submitScore` is two non-atomic writes** (`scores` then `history` `push`). A
  blip between them can leave a score with no history row. This pre-exists (locks /
  playable games share it) and is accepted unchanged here; the clean future fix is a
  single multi-path `update()`. Out of scope.
- The clock/rules edits inherit the **same admin gate as score/lock edits** (controls
  render only when `isAdmin`; no extra `requireAdmin` on Save). Reset keeps its
  `requireAdmin` + confirm.
- Auto-0 and late-0 go through the existing `submitScore` path, so the scoreboard,
  history, and rank-point math treat them as a normal `0`.
- **Clock-drift note:** the countdown uses each client's `Date.now()` against a
  DB-stored start written by the entering client. For one-day offsite phones on NTP
  this skew is sub-second; enforcement is per-submitting-client. Acceptable under the
  client-advisory posture.
- **Non-goals:** no all-level timer/rules, no pause/extend/reset of a running
  countdown, no per-change (path-level) writes, no audit log, no timers on playable
  games, no server-side enforcement, no view-mode indicators.

## Files

- **New:** `ps-offsite-2026/shared/game-config.js`, `tests/game-config.test.js`.
- **Edit:**
  - `ps-offsite-2026/scoreboard.html` — draft generalization + rename, manual-only
    clock/rules icons, two modals, cell/header CSS budget, edit-banner copy, reset
    clears `timerStarts`.
  - `ps-offsite-2026/games.html` — `timers` listener, ⏱ badge, warning-modal tile
    interception (gated `!locked && score === undefined`).
  - `ps-offsite-2026/games/manual.html` — add `onValue` + `set` imports, resolved
    rules + live rules-only re-render, timer flow, single-settle guard, submit-time
    expiry guard, `timerStarts` write.
- No catalog change (`GAMES[key].rules` remains the fallback). No vite/build change —
  `manual.html`, `games.html`, `scoreboard.html` are already entry points; no new
  HTML files; modals are in-page overlays.
