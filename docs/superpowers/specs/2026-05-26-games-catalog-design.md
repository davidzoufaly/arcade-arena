# Games Catalog Page — Design

Date: 2026-05-26
Branch context: `games-impl`
Build plan refs: `BUILD_PLAN.md` lines 37–58.

## Goal

Replace the single host-centric `index.html` hub grid (4 game tiles) with a dedicated **team-facing games catalog page** showing all 11 planned games. Four are interactive (existing playable games); seven are manual-score entry (rules + numeric input). At the same time, **switch the scoring model** from typed `GAME-TEAM-SCORE` codes to direct raw-score writes from team devices, with rank-based normalization (1..N points per game) rendered live on the scoreboard.

## Scope

In scope:
- New page `games.html` (team catalog, default landing post-join).
- New page `games/manual.html` (single template, query-string `?key=XX`, for all 7 manual games).
- New module `shared/games-catalog.js` (single source of truth for game metadata).
- New module `shared/score-submit.js` (single write helper used by all games).
- Refactor of 4 playable games (`games/1-gesture-lock.html`, `games/2-pantomime.html`, `dino/main.js`, `flappy/main.js`) to auto-write raw score on game-end instead of displaying typed code.
- Refactor of `scoreboard.html` to compute rank points on render, remove code-typing UI.
- Cleanup of `index.html`: strip `.lobby-strip`, remove hub game tiles, keep QR section, add topbar.
- Topbar nav update: `Hub | Games | Scoreboard`.

Out of scope (deferred):
- Firebase security rules tightening for team-writable scores. Trust-based offsite environment; honor system is acceptable for v1.
- Pub Quiz interactivity. Tile is present but disabled (`kind: 'soon'`).
- Final copy for manual game rules (placeholder strings in catalog map; can be filled in iteratively without code changes).

## Decisions captured during brainstorming

| # | Question | Choice |
|---|---|---|
| 1 | Catalog location | New `games.html`, default landing post-join. Hub stays for host QR distribution. |
| 2 | Played-state source | Firebase `scores/{teamId}/{key}` subtree (same as scoreboard). |
| 3 | Scoring write path | Auto-submit raw score from team device. Codes dropped entirely. |
| 4 | Ranking timing | Live on every scoreboard render. |
| 5 | Tie handling | Average rank (fractional ranking: ties get mean of contended positions). |
| 6 | Manual game pages | Single template `games/manual.html?key=XX`. |
| 7a | "Lobby row" | Remove `.lobby-strip` — topbar already shows lobby + team + leave. |
| 7b | Pub Quiz | Visible but disabled (greyed tile, no click). |
| 8 | Manual raw score range | Free integer, no upper bound. Rank-based normalization makes scale irrelevant for fairness. |
| 9 | Tile layout | Uniform grid (11 same-size tiles), border color = kind, tick badge = played. |
| 10 | Impl strategy | All-in-one — schema change forces a cliff anyway. |

## Architecture

### Data model (Firebase Realtime DB)

Schema unchanged structurally; only **what we write** changes.

```
lobbies/{lobbyId}/
  teams/{teamId} = { name, pwd }                 (unchanged)
  adminPwd                                       (unchanged)
  scores/{teamId}/{gameKey} = <raw integer>      (was 0..100 normalized; now raw, free range)
  history/<push>                                 = { ts, gameKey, teamId, score }  (unchanged shape; `code` field dropped)
```

`gameKey` is the 2-letter map key (`GZ`, `PM`, `DN`, `FL`, `MX`, `MB`, `SF`, `GD`, `HD`, `DG`, `PQ`). PQ never has scores in v1.

### `shared/games-catalog.js`

Single source of truth. Imported by `games.html`, `games/manual.html`, `scoreboard.html`, `index.html`.

```js
export const GAMES = {
  GZ: { name: 'Gesture Lock',    emoji: '✋', kind: 'play',   href: 'games/1-gesture-lock.html' },
  PM: { name: 'Pantomime',       emoji: '🎭', kind: 'play',   href: 'games/2-pantomime.html' },
  DN: { name: 'Pipeline Dash',   emoji: '🛡️', kind: 'play',   href: 'dino/index.html' },
  FL: { name: 'Insight Monitor', emoji: '📊', kind: 'play',   href: 'flappy/index.html' },
  MX: { name: 'Math No-Brain',   emoji: '🧮', kind: 'manual', rules: '<placeholder>' },
  MB: { name: 'Math Big-Brain',  emoji: '🧠', kind: 'manual', rules: '<placeholder>' },
  SF: { name: 'Šifra',           emoji: '🔐', kind: 'manual', rules: '<placeholder>' },
  GD: { name: 'Gandalf',         emoji: '🧙', kind: 'manual', rules: '<placeholder>' },
  HD: { name: 'Hidden Document', emoji: '📄', kind: 'manual', rules: '<placeholder>' },
  DG: { name: 'Draw & Guess',    emoji: '🎨', kind: 'manual', rules: '<placeholder>' },
  PQ: { name: 'Pub Quiz',        emoji: '🎤', kind: 'soon' },
};

// helpers
export function getGame(key) { return GAMES[key] ?? null; }
export function playableKeys()  { return Object.keys(GAMES).filter(k => GAMES[k].kind === 'play'); }
export function manualKeys()    { return Object.keys(GAMES).filter(k => GAMES[k].kind === 'manual'); }
export function allEnteredKeys(){ return Object.keys(GAMES).filter(k => GAMES[k].kind !== 'soon'); }
```

`kind`:
- `'play'` — links to existing game route. Auto-submits on game-end.
- `'manual'` — links to `games/manual.html?key=XX`. Score entered by team.
- `'soon'` — Pub Quiz. Tile dimmed, no click handler, no score path.

Rules strings start as placeholders. Can be replaced with real copy without touching any other file.

### `shared/score-submit.js`

```js
import { ref, update, push } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';

export async function submitScore({ db, lobbyId, teamId, gameKey, score }) {
  const raw = Math.max(0, Math.round(Number(score) || 0));
  await update(ref(db, `lobbies/${lobbyId}/scores/${teamId}`), { [gameKey]: raw });
  await push(ref(db, `lobbies/${lobbyId}/history`), {
    ts: Date.now(), gameKey, teamId, score: raw,
  });
  return raw;
}
```

Single write path. Used by `games/manual.html`, all 4 playable end-screens, and scoreboard cell-edit (when admin manually overrides). All callers go through this so history + scores stay in sync.

### `games.html` (catalog)

New file. Team-facing landing post-join.

Responsibilities:
- Resolve session via `resolveSession()`; missing → `location.replace('index.html')`.
- Mount topbar with `activePage: 'games'`.
- Init Firebase, subscribe to `lobbies/{lobbyId}/scores/{teamId}` via `onValue` for live tick updates.
- Render uniform 3-column grid of 11 tiles (all entries from `GAMES`).
  - Border: cyan for `play`, magenta for `manual`, dim grey for `soon`.
  - Tick badge `✓` top-right when `scores[teamId][gameKey]` is defined.
  - Click: navigate to `href` (play) or `games/manual.html?key=XX&lobby=…&team=…` (manual). No click for `soon`.
- Empty subtitle line for now (e.g. "10 teams · 11 games · pick one").

### `games/manual.html`

New file. Template for all manual games.

Responsibilities:
- Parse `key` from query string. Unknown / missing key → render error + back link to `games.html`.
- Resolve session. Missing → redirect to `index.html`.
- Mount topbar with `activePage: 'games'`.
- Header: `{emoji} {name}` from `GAMES[key]`.
- Rules section: render `GAMES[key].rules` as text. Treat blank lines as paragraph breaks; lines starting with `- ` as bullets. No full markdown parser.
- Submit panel:
  - Pre-fetch current `scores/{teamId}/{key}` once on load (single `get`).
  - If exists: show "Current: N pts" + "Resubmit" button. Resubmit reveals input pre-filled with current value.
  - Input: `type=number`, `min=0`, no max, integer step.
  - Submit button → `submitScore(...)` → confirm UI ("Saved. Return to catalog" link).
- All Firebase init reuses adapter pattern from `index.html` (factor a small helper if convenient; not required for v1).

### Playable games refactor

For each of 4 playable games:

1. Replace `renderEndScreen(container, { game, team, score, max, code, message })` call with new contract:
   ```js
   renderEndScreen(container, { gameKey, score, saved, message });
   ```
   End screen content:
   - Big score number.
   - `Saved ✓` badge (or `Saving…` while pending; `Failed — tap to retry` on error).
   - "Return to catalog" link → `games.html?lobby=…&team=…`.
   - Replay hint (existing key).
2. On game-end, call `submitScore({ db, lobbyId, teamId, gameKey, score })`. Render end-screen with `saved: true` on resolve, `saved: false` + retry handler on reject.
3. Drop `generateCode` from `shared/score-panel.js` (dead). Keep `saveRun` + `loadRuns` + `showDebugIfRequested` (local debug history) untouched.

Touch list:
- `games/1-gesture-lock.html` — score path uses `shared/gesture-lock-logic.js`. Locate end-of-game callback, wire submit.
- `games/2-pantomime.html` — same shape via `shared/pantomime-logic.js`.
- `dino/main.js` — game-over branch.
- `flappy/main.js` — game-over branch.

Score values: keep whatever raw integer each game already produces (no normalization at game side). Ranking handles cross-game fairness.

### Scoreboard rewrite

`scoreboard.html`:

Removed:
- `GAMES` const (L431) → import from `shared/games-catalog.js`.
- Code-input + submit button + parse code logic (around L575–L611). UI elements deleted; `parseCode`/`onSubmitCode` handlers removed. History entry creation moves to `submitScore` (already there).

Render logic:
- For each game key in `allEnteredKeys()`:
  - Collect `{ teamId, raw }` from `scores`. Skip teams with no entry.
  - Sort by `raw` desc. Compute rank points using fractional ranking:
    - Group ties (same raw value).
    - For each group of size `g` occupying positions `p..p+g-1` (1-indexed from top), each tied team gets `points = N - ((p + (p + g - 1)) / 2 - 1)` where `N` = number of submitters for this game.
    - Equivalent: average position in group, then `N - avgPos + 1`.
  - Example: `N=4`, scores `[100, 90, 90, 70]` → positions `[1, 2.5, 2.5, 4]` → points `[4, 2.5, 2.5, 1]`.
  - Note: `N` is **number of submitters**, not number of teams in lobby. Means last-place rank-points scales with participation. If lobby has 9 teams but only 4 submitted, top gets 4 not 9. **Edge case to flag in spec review.**
- Cell renders: small raw (top) + bold rank-points (bottom). Tooltip on cell shows `"Rank N/M"`.
- Total column: sum of rank-points across all `allEnteredKeys()`.

Kept:
- Reset scores admin action.
- Normalization-check admin action.
- Double-click cell to edit raw score (writes via `submitScore`).
- Right-click team to remove.
- Export JSON.
- History list (read-only, no input).

#### Ranking edge case — clarification needed during plan review

Two possible behaviors for "N" in the rank-points formula:

- **(a) Submitters-only:** `N = count of teams who have a raw score for this game`. Simpler, no idea of "expected" team count, but penalizes early submitters when board fills out.
- **(b) Lobby-team-count:** `N = total teams in lobby`. Top always gets 9 points in a 9-team lobby. Teams with no score get 0 for that game.

This spec adopts **(b)** because user said "first place will give you 9 points, last place will give you 1 point" — implying `N` = team count, not submitter count. **Teams without a raw score for a given game get 0 rank-points for that game** (they did not play it; they are not ranked).

(If user wants (a) we change one line in the renderer; flag it during plan review.)

### `index.html` cleanup

Diff summary:
- Remove `.lobby-strip` element + its CSS.
- Remove the 4 game tiles + scoreboard tile from `view-hub` (the entire `.grid` block becomes just the QR section header).
- Add a "Host view" banner explaining the page is for QR distribution.
- Add an "Open Games catalog" button that links to `games.html?lobby=…&team=…` for the host's own device.
- Add QR for `games.html` itself in `renderQRs` (alongside existing 5 QRs).
- Mount topbar in `view-hub` with `activePage: 'hub'`.
- `doJoin` (L348): replace `location.reload()` with `location.href = 'games.html?lobby=…&team=…'`. Teams skip hub.
- Credentials → "Continue → join lobby" flow unchanged. Host who continues into join → upon successful join → lands on `games.html` (their own team's catalog).

### Topbar update

`shared/topbar.js` `buildHeader`:
- Compute `gamesHref = ${pfx}games.html?lobby=…&team=…`.
- Nav becomes three links: `Hub | Games | Scoreboard`.
- Rename current "Dashboard" → "Hub".
- Existing `activePage` semantics extended: `'hub' | 'games' | 'scoreboard'`.

## File touch list

New:
- `ps-offsite-2026/games.html`
- `ps-offsite-2026/games/manual.html`
- `ps-offsite-2026/shared/games-catalog.js`
- `ps-offsite-2026/shared/score-submit.js`

Modified:
- `ps-offsite-2026/index.html` — strip lobby-strip, remove hub tiles, add host banner, add games QR, mount topbar, change post-join redirect.
- `ps-offsite-2026/scoreboard.html` — import GAMES, drop code-input UI, rewrite render to use rank points, route cell-edit through submitScore.
- `ps-offsite-2026/shared/topbar.js` — add Games nav slot, rename Dashboard→Hub.
- `ps-offsite-2026/shared/score-panel.js` — drop generateCode + code-bearing renderEndScreen path; rewrite end-screen for auto-saved flow.
- `ps-offsite-2026/games/1-gesture-lock.html` — wire submitScore on game-end.
- `ps-offsite-2026/games/2-pantomime.html` — wire submitScore on game-end.
- `ps-offsite-2026/dino/main.js` — wire submitScore on game-over.
- `ps-offsite-2026/flappy/main.js` — wire submitScore on game-over.
- `BUILD_PLAN.md` — tick off catalog page items (L37–L58).

## Risks & mitigations

- **Schema cliff.** Existing lobbies in Firebase with old code-typed scores remain usable; the values are already raw integers. Only the *write path* changes. No migration needed.
- **Race on game-end auto-submit.** Two team members on two devices both finish the same game → last write wins on `update`. Acceptable; document in spec.
- **No security against score tampering.** Out of scope. Trust-based offsite.
- **Manual rules placeholders.** Spec ships with placeholder rules text. Real copy can be filled in later without code changes.

## Testing

- Manual smoke: create lobby → join as Team 1 → catalog renders 11 tiles, all unticked → play Dino, watch tile turn ticked live → open scoreboard, see Team 1 with rank points for DN.
- Manual: 3 teams submit raw scores 100/90/70 for one game in a 4-team lobby. Verify rank points = 4/3/2 and the un-submitted team has 0.
- Manual: two teams tie at 90 in a 4-team lobby with [100, 90, 90, 70]. Verify points = 4/2.5/2.5/1.
- Manual game flow: open `games/manual.html?key=MX`, enter 17, submit, see tick on catalog, see rank in scoreboard.
- Topbar regression: nav from any game page to Hub/Games/Scoreboard works; "Leave" clears session.

## Open questions for plan-writing stage

1. Confirm ranking N = lobby-team-count (b) vs submitters-only (a). Spec assumes (b).
2. Replay / resubmit semantics: keep **latest** raw score or **best** raw score? Spec currently says "last write wins" for both playable replay and manual resubmit. Best-of-N is more retry-friendly but needs a max() write helper.
3. Confirm placeholder rules strings are OK to ship (real copy can land later).
4. Should "Hub" tile/link be visible to all teams, or only to whoever created the lobby? Spec currently lets anyone navigate to Hub via topbar (it's the QR distribution view; harmless if a team opens it).
