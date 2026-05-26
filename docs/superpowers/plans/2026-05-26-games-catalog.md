# Games Catalog Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a team-facing 11-game catalog page (4 playable + 7 manual + 1 disabled) and switch scoring from typed `GAME-TEAM-SCORE` codes to direct raw-score writes with rank-based normalization (1..N points per game) rendered live on the scoreboard.

**Architecture:** New `games.html` becomes the default landing post-join. A shared `games-catalog.js` map is the single source of truth for game metadata, imported by `games.html`, the new manual-entry template `games/manual.html`, and the scoreboard. All score writes go through a new `score-submit.js` helper. Scoreboard reads raw scores and computes rank points on render.

**Tech Stack:** Vanilla HTML/JS modules, Vite, Vitest, Firebase Realtime Database (already configured).

**Spec:** [docs/superpowers/specs/2026-05-26-games-catalog-design.md](../specs/2026-05-26-games-catalog-design.md)

---

## Resolved open questions (from spec)

Before starting: confirm with user (or assume defaults below).

- **Ranking N** = lobby-team-count (b). Top of 9-team lobby always gets 9 pts. Unsubmitted teams get 0.
- **Replay/resubmit** = last write wins (latest, not best). One write helper, no max() logic.
- **Placeholder rules** ship as-is; real copy lands later via map edits.
- **Hub** link is in topbar for all teams; harmless QR distribution view.

If any of these change, the plan still applies — only one or two task bodies need a tweak.

---

## File structure

**New files:**

- `ps-offsite-2026/shared/games-catalog.js` — central game metadata map, 11 entries, helpers.
- `ps-offsite-2026/shared/score-submit.js` — single write path (raw score + history push).
- `ps-offsite-2026/shared/ranking.js` — pure function: raw scores → rank points (avg-rank ties).
- `ps-offsite-2026/games.html` — team-facing catalog page (default post-join landing).
- `ps-offsite-2026/games/manual.html` — single template for all 7 manual-entry games.
- `tests/games-catalog.test.js`
- `tests/score-submit.test.js`
- `tests/ranking.test.js`

**Modified files:**

- `ps-offsite-2026/index.html` — host hub: strip `.lobby-strip`, drop game tiles, add host banner, mount topbar, add games-catalog QR, change post-join redirect.
- `ps-offsite-2026/scoreboard.html` — import GAMES, drop code-input UI, render rank-points via `ranking.js`, route cell-edit through `submitScore`.
- `ps-offsite-2026/shared/topbar.js` — add Games slot, rename Dashboard→Hub.
- `ps-offsite-2026/shared/score-panel.js` — drop `generateCode`, rewrite `renderEndScreen` for auto-saved flow.
- `ps-offsite-2026/games/1-gesture-lock.html` — auto-submit raw score on game-end.
- `ps-offsite-2026/games/2-pantomime.html` — auto-submit raw score on game-end.
- `ps-offsite-2026/dino/main.js` — auto-submit raw score on game-over.
- `ps-offsite-2026/flappy/main.js` — auto-submit raw score on game-over.
- `tests/score-panel.test.js` — drop `generateCode` tests; add tests for new contract.
- `BUILD_PLAN.md` — tick off lines 37–58.

---

## Task 1: Shared games catalog map

**Files:**
- Create: `ps-offsite-2026/shared/games-catalog.js`
- Create: `tests/games-catalog.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/games-catalog.test.js
import { describe, it, expect } from 'vitest';
import {
  GAMES, getGame, playableKeys, manualKeys, allEnteredKeys,
} from '../ps-offsite-2026/shared/games-catalog.js';

describe('GAMES catalog', () => {
  it('exposes all 11 games with required fields', () => {
    const keys = Object.keys(GAMES);
    expect(keys).toHaveLength(11);
    for (const k of keys) {
      expect(GAMES[k].name).toBeTruthy();
      expect(GAMES[k].emoji).toBeTruthy();
      expect(['play', 'manual', 'soon']).toContain(GAMES[k].kind);
    }
  });

  it('has exactly 4 playable games with href', () => {
    const ks = playableKeys();
    expect(ks.sort()).toEqual(['DN', 'FL', 'GZ', 'PM']);
    for (const k of ks) expect(GAMES[k].href).toBeTruthy();
  });

  it('has exactly 7 manual games with rules', () => {
    const ks = manualKeys();
    expect(ks).toHaveLength(7);
    for (const k of ks) expect(typeof GAMES[k].rules).toBe('string');
  });

  it('marks Pub Quiz as soon (no href, no rules)', () => {
    expect(GAMES.PQ.kind).toBe('soon');
  });

  it('allEnteredKeys excludes soon', () => {
    expect(allEnteredKeys()).not.toContain('PQ');
    expect(allEnteredKeys()).toHaveLength(10);
  });

  it('getGame returns null for unknown key', () => {
    expect(getGame('ZZ')).toBeNull();
    expect(getGame('GZ')).toBe(GAMES.GZ);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- tests/games-catalog.test.js`
Expected: FAIL — `Failed to resolve import "../ps-offsite-2026/shared/games-catalog.js"`.

- [ ] **Step 3: Create the catalog module**

```js
// ps-offsite-2026/shared/games-catalog.js
export const GAMES = {
  GZ: { name: 'Gesture Lock',    emoji: '✋', kind: 'play',   href: 'games/1-gesture-lock.html' },
  PM: { name: 'Pantomime',       emoji: '🎭', kind: 'play',   href: 'games/2-pantomime.html' },
  DN: { name: 'Pipeline Dash',   emoji: '🛡️', kind: 'play',   href: 'dino/index.html' },
  FL: { name: 'Insight Monitor', emoji: '📊', kind: 'play',   href: 'flappy/index.html' },
  MX: { name: 'Math No-Brain',   emoji: '🧮', kind: 'manual', rules: 'Simple arithmetic round. Team writes answers, count correct out of total.\n\n- Submit number of correct answers as raw score.' },
  MB: { name: 'Math Big-Brain',  emoji: '🧠', kind: 'manual', rules: 'Harder math round. Same scoring: count correct.\n\n- Submit number of correct answers as raw score.' },
  SF: { name: 'Šifra',           emoji: '🔐', kind: 'manual', rules: 'Crack the cipher. Faster team = higher raw score.\n\n- Submit raw points awarded by host.' },
  GD: { name: 'Gandalf',         emoji: '🧙', kind: 'manual', rules: 'Prompt-injection challenge. Each cracked level scores points.\n\n- Submit total points reached.' },
  HD: { name: 'Hidden Document', emoji: '📄', kind: 'manual', rules: 'Find the document hidden in the office. Faster team = higher raw score.\n\n- Submit raw points awarded by host.' },
  DG: { name: 'Draw & Guess',    emoji: '🎨', kind: 'manual', rules: 'Draw the prompt, teammates guess.\n\n- Submit raw points awarded by host.' },
  PQ: { name: 'Pub Quiz',        emoji: '🎤', kind: 'soon' },
};

export function getGame(key) {
  return GAMES[key] ?? null;
}

export function playableKeys() {
  return Object.keys(GAMES).filter(k => GAMES[k].kind === 'play');
}

export function manualKeys() {
  return Object.keys(GAMES).filter(k => GAMES[k].kind === 'manual');
}

export function allEnteredKeys() {
  return Object.keys(GAMES).filter(k => GAMES[k].kind !== 'soon');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/games-catalog.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/games-catalog.js tests/games-catalog.test.js
git commit -m "feat(catalog): shared games-catalog map with 11 games"
```

---

## Task 2: Ranking helper (rank-points from raw scores)

**Files:**
- Create: `ps-offsite-2026/shared/ranking.js`
- Create: `tests/ranking.test.js`

- [ ] **Step 1: Write the failing test**

```js
// tests/ranking.test.js
import { describe, it, expect } from 'vitest';
import { rankPointsByTeam } from '../ps-offsite-2026/shared/ranking.js';

describe('rankPointsByTeam', () => {
  it('returns N points for top, 1 for bottom in N-team lobby', () => {
    // N=4 teams, all submitted. Scores 100/90/70/50.
    const result = rankPointsByTeam({
      teamCount: 4,
      raw: { 1: 100, 2: 90, 3: 70, 4: 50 },
    });
    expect(result).toEqual({ 1: 4, 2: 3, 3: 2, 4: 1 });
  });

  it('handles ties with average rank (4-team, [100, 90, 90, 70])', () => {
    const result = rankPointsByTeam({
      teamCount: 4,
      raw: { 1: 100, 2: 90, 3: 90, 4: 70 },
    });
    expect(result).toEqual({ 1: 4, 2: 2.5, 3: 2.5, 4: 1 });
  });

  it('handles 3-way tie at top of 5-team', () => {
    // 3 tied at top → avg of positions 1,2,3 = 2 → points = 5 - 2 + 1 = 4
    const result = rankPointsByTeam({
      teamCount: 5,
      raw: { 1: 90, 2: 90, 3: 90, 4: 50, 5: 10 },
    });
    expect(result).toEqual({ 1: 4, 2: 4, 3: 4, 4: 2, 5: 1 });
  });

  it('assigns 0 to teams without a raw score', () => {
    // teamCount=4, only teams 1 and 2 submitted.
    const result = rankPointsByTeam({
      teamCount: 4,
      raw: { 1: 100, 2: 90 },
    });
    // Submitters rank against teamCount=4 → 1st=4, 2nd=3. Non-submitters=0.
    expect(result).toEqual({ 1: 4, 2: 3 });
  });

  it('returns empty object when no team submitted', () => {
    expect(rankPointsByTeam({ teamCount: 9, raw: {} })).toEqual({});
  });

  it('ignores non-numeric raw values', () => {
    const result = rankPointsByTeam({
      teamCount: 3,
      raw: { 1: 50, 2: null, 3: undefined },
    });
    expect(result).toEqual({ 1: 3 });
  });
});

describe('rankPointsByTeam — totals across games', () => {
  it('sums to expected total for a 3-game / 3-team example', () => {
    // Build a tiny scoreboard via per-game calls.
    const teamCount = 3;
    const games = {
      GZ: { 1: 100, 2: 80, 3: 60 },        // → 3,2,1
      DN: { 1: 50,  2: 50, 3: 10 },        // → 2.5, 2.5, 1
      MX: { 1: 5,   3: 20 },               // → 2, _, 3   (team 2 didn't submit)
    };
    const perGame = Object.fromEntries(
      Object.entries(games).map(([k, raw]) => [k, rankPointsByTeam({ teamCount, raw })])
    );
    const totals = { 1: 0, 2: 0, 3: 0 };
    for (const k of Object.keys(perGame)) {
      for (const [t, pts] of Object.entries(perGame[k])) {
        totals[t] += pts;
      }
    }
    expect(totals[1]).toBeCloseTo(3 + 2.5 + 2);   // 7.5
    expect(totals[2]).toBeCloseTo(2 + 2.5);        // 4.5  (no MX)
    expect(totals[3]).toBeCloseTo(1 + 1 + 3);      // 5
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- tests/ranking.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the ranker**

```js
// ps-offsite-2026/shared/ranking.js
//
// Convert a map of raw scores into rank-points using fractional ranking
// (avg-rank for ties). The top submitter in an N-team lobby always gets
// N points; non-submitters are absent from the result (caller treats as 0).
export function rankPointsByTeam({ teamCount, raw }) {
  const entries = Object.entries(raw)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([id, v]) => ({ id, raw: v }));
  if (entries.length === 0) return {};

  entries.sort((a, b) => b.raw - a.raw);

  const out = {};
  let i = 0;
  while (i < entries.length) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1].raw === entries[i].raw) j++;
    // Tie group spans positions i..j (0-indexed). Convert to 1-indexed ranks.
    const avgPos = (i + 1 + j + 1) / 2;
    const points = teamCount - avgPos + 1;
    for (let k = i; k <= j; k++) {
      out[entries[k].id] = points;
    }
    i = j + 1;
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/ranking.test.js`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/ranking.js tests/ranking.test.js
git commit -m "feat(ranking): pure rank-points helper with avg-rank ties"
```

---

## Task 3: Shared score-submit helper

**Files:**
- Create: `ps-offsite-2026/shared/score-submit.js`
- Create: `tests/score-submit.test.js`

The helper takes an injected DB-adapter so tests can run without Firebase.

- [ ] **Step 1: Write the failing test**

```js
// tests/score-submit.test.js
import { describe, it, expect, vi } from 'vitest';
import { submitScore } from '../ps-offsite-2026/shared/score-submit.js';

function makeFakeWriter() {
  return {
    updates: [],
    pushes: [],
    async update(path, patch) { this.updates.push({ path, patch }); },
    async push(path, value)   { this.pushes.push({ path, value }); return 'fake-key'; },
  };
}

describe('submitScore', () => {
  it('writes raw integer to scores/{teamId}/{gameKey}', async () => {
    const w = makeFakeWriter();
    await submitScore({ writer: w, lobbyId: 'PS-AB12', teamId: 3, gameKey: 'DN', score: 47 });
    expect(w.updates).toEqual([
      { path: 'lobbies/PS-AB12/scores/3', patch: { DN: 47 } },
    ]);
  });

  it('pushes a history entry with ts/gameKey/teamId/score', async () => {
    const w = makeFakeWriter();
    const before = Date.now();
    await submitScore({ writer: w, lobbyId: 'PS-AB12', teamId: 3, gameKey: 'DN', score: 47 });
    expect(w.pushes).toHaveLength(1);
    expect(w.pushes[0].path).toBe('lobbies/PS-AB12/history');
    expect(w.pushes[0].value.gameKey).toBe('DN');
    expect(w.pushes[0].value.teamId).toBe(3);
    expect(w.pushes[0].value.score).toBe(47);
    expect(w.pushes[0].value.ts).toBeGreaterThanOrEqual(before);
  });

  it('rounds to nearest integer', async () => {
    const w = makeFakeWriter();
    await submitScore({ writer: w, lobbyId: 'L', teamId: 1, gameKey: 'GZ', score: 12.7 });
    expect(w.updates[0].patch.GZ).toBe(13);
  });

  it('clamps negatives to 0', async () => {
    const w = makeFakeWriter();
    await submitScore({ writer: w, lobbyId: 'L', teamId: 1, gameKey: 'GZ', score: -5 });
    expect(w.updates[0].patch.GZ).toBe(0);
  });

  it('coerces non-numeric to 0', async () => {
    const w = makeFakeWriter();
    await submitScore({ writer: w, lobbyId: 'L', teamId: 1, gameKey: 'GZ', score: 'foo' });
    expect(w.updates[0].patch.GZ).toBe(0);
  });

  it('returns the persisted raw value', async () => {
    const w = makeFakeWriter();
    const out = await submitScore({ writer: w, lobbyId: 'L', teamId: 1, gameKey: 'GZ', score: 9 });
    expect(out).toBe(9);
  });
});
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- tests/score-submit.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the helper**

```js
// ps-offsite-2026/shared/score-submit.js
//
// Single write path for all score submissions (playable + manual).
// Caller passes an injected writer so this stays testable without Firebase.

export async function submitScore({ writer, lobbyId, teamId, gameKey, score }) {
  const n = Number(score);
  const raw = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  await writer.update(`lobbies/${lobbyId}/scores/${teamId}`, { [gameKey]: raw });
  await writer.push(`lobbies/${lobbyId}/history`, {
    ts: Date.now(), gameKey, teamId, score: raw,
  });
  return raw;
}

// Convenience: wrap Firebase ref/update/push into the writer shape submitScore expects.
// Pages that already have getDatabase set up call this once and pass the result.
export function firebaseWriter({ db, ref, update, push }) {
  return {
    async update(path, patch) { await update(ref(db, path), patch); },
    async push(path, value) {
      const node = await push(ref(db, path), value);
      return node?.key ?? null;
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/score-submit.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/score-submit.js tests/score-submit.test.js
git commit -m "feat(score): single submitScore helper with injectable writer"
```

---

## Task 4: Rewrite `score-panel.js` — drop code, new end-screen contract

**Files:**
- Modify: `ps-offsite-2026/shared/score-panel.js`
- Modify: `tests/score-panel.test.js`

- [ ] **Step 1: Update the existing test to the new contract**

Replace the entire contents of `tests/score-panel.test.js`:

```js
// tests/score-panel.test.js
import { describe, it, expect } from 'vitest';
import { renderEndScreen, saveRun, loadRuns } from '../ps-offsite-2026/shared/score-panel.js';

function makeContainer() {
  // Lightweight stand-in for an element — renderEndScreen only assigns innerHTML.
  return { innerHTML: '' };
}

describe('renderEndScreen', () => {
  it('shows the raw score, saved badge, and return-to-catalog link', () => {
    const el = makeContainer();
    renderEndScreen(el, {
      gameKey: 'DN', score: 73, saved: true, message: 'NICE',
      catalogHref: 'games.html?lobby=PS-AB12&team=3',
    });
    expect(el.innerHTML).toContain('NICE');
    expect(el.innerHTML).toContain('73');
    expect(el.innerHTML).toContain('SAVED');
    expect(el.innerHTML).toContain('games.html?lobby=PS-AB12&team=3');
  });

  it('shows SAVING when saved flag is null', () => {
    const el = makeContainer();
    renderEndScreen(el, { gameKey: 'DN', score: 10, saved: null, message: 'DONE', catalogHref: '#' });
    expect(el.innerHTML).toContain('SAVING');
  });

  it('shows FAILED with retry hint when saved=false', () => {
    const el = makeContainer();
    renderEndScreen(el, { gameKey: 'DN', score: 10, saved: false, message: 'DONE', catalogHref: '#' });
    expect(el.innerHTML).toContain('FAILED');
  });
});

// Note: saveRun / loadRuns / showDebugIfRequested rely on localStorage and document,
// which the default vitest node env does not provide. Coverage stays manual (devtools).
```

- [ ] **Step 2: Run the test to confirm it fails**

Run: `npm test -- tests/score-panel.test.js`
Expected: FAIL — `renderEndScreen` signature mismatch / `generateCode` import removed.

- [ ] **Step 3: Rewrite `score-panel.js`**

Replace the entire contents:

```js
// ps-offsite-2026/shared/score-panel.js
//
// End-screen renderer for playable games. Score is already saved to Firebase
// via shared/score-submit.js before renderEndScreen runs (or is mid-flight).

export function renderEndScreen(container, { score, saved, message, catalogHref }) {
  let badge;
  if (saved === true)        badge = '<span class="end-badge ok">SAVED ✓</span>';
  else if (saved === false)  badge = '<span class="end-badge bad">FAILED — TAP TO RETRY</span>';
  else                       badge = '<span class="end-badge">SAVING…</span>';

  container.innerHTML = `
    <div class="end-screen">
      <h1>${message}</h1>
      <div class="score">SCORE: ${score}</div>
      ${badge}
      <a class="end-link" href="${catalogHref}">RETURN TO CATALOG</a>
      <div class="hint">PRESS SPACE TO PLAY AGAIN</div>
    </div>
  `;
}

export function saveRun(game, score) {
  const key = `runs.${game}`;
  const list = JSON.parse(localStorage.getItem(key) ?? '[]');
  list.push({ score, at: Date.now() });
  if (list.length > 20) list.shift();
  localStorage.setItem(key, JSON.stringify(list));
}

export function loadRuns(game) {
  return JSON.parse(localStorage.getItem(`runs.${game}`) ?? '[]');
}

export function showDebugIfRequested(game) {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const runs = loadRuns(game);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow:auto;background:#000c;color:#0ff;padding:8px;font-size:11px;z-index:100';
  pre.textContent = runs.map(r => `${new Date(r.at).toLocaleTimeString()}  ${r.score}`).join('\n');
  document.body.appendChild(pre);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/score-panel.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/shared/score-panel.js tests/score-panel.test.js
git commit -m "refactor(score-panel): drop code generation, new auto-save end-screen"
```

---

## Task 5: Topbar — add Games slot, rename Dashboard → Hub

**Files:**
- Modify: `ps-offsite-2026/shared/topbar.js`

- [ ] **Step 1: Update `buildHeader` to include the Games link**

Replace the `buildHeader` function in `ps-offsite-2026/shared/topbar.js`:

```js
function buildHeader({ lobbyId, teamId }, activePage) {
  const pfx = prefix();
  const lobbyQ = `?lobby=${encodeURIComponent(lobbyId)}&team=${teamId}`;
  const hubHref      = `${pfx}index.html`;
  const gamesHref    = `${pfx}games.html${lobbyQ}`;
  const scoreHref    = `${pfx}scoreboard.html?lobby=${encodeURIComponent(lobbyId)}`;

  const header = document.createElement('header');
  header.className = 'ps-topbar';
  header.innerHTML = `
    <a class="ps-topbar-brand" href="${gamesHref}">PS Offsite</a>
    <nav class="ps-topbar-nav">
      <a data-nav="hub" href="${hubHref}">Hub</a>
      <a data-nav="games" href="${gamesHref}">Games</a>
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
```

Brand link now points to `games.html` (team's natural home). Hub remains accessible.

- [ ] **Step 2: Run the existing topbar tests / build**

Run: `npm test` (full suite — no topbar test exists; just confirm nothing else breaks).
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/shared/topbar.js
git commit -m "feat(topbar): add Games nav slot, rename Dashboard to Hub"
```

---

## Task 6: `games.html` — catalog page

**Files:**
- Create: `ps-offsite-2026/games.html`

This page is browser-only; we smoke-test manually after wiring later tasks. No vitest coverage here — the testable logic lives in `games-catalog.js` and `ranking.js`.

- [ ] **Step 1: Create the catalog page**

```html
<!-- ps-offsite-2026/games.html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PS Offsite 2026 — Games</title>
<link rel="stylesheet" href="shared/topbar.css">
<style>
  :root {
    --bg: #0a0e1a; --bg-2: #131a2e; --card: #1b2540;
    --text: #f5f7fb; --muted: #8b95b5;
    --accent: #00d4ff; --accent-2: #ff00aa; --good: #00e676;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(circle at 50% 0%, #1f2a4a 0%, var(--bg) 60%);
    color: var(--text); min-height: 100vh;
  }
  main { max-width: 1100px; margin: 0 auto; padding: 40px; }
  h1 {
    font-size: 36px; font-weight: 900; letter-spacing: -1px; margin-bottom: 8px;
    background: linear-gradient(90deg, var(--accent), var(--accent-2));
    -webkit-background-clip: text; background-clip: text; color: transparent;
  }
  .subtitle { color: var(--muted); font-size: 15px; margin-bottom: 32px; }
  .grid {
    display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 14px;
  }
  .tile {
    background: var(--card); border-radius: 14px; padding: 18px;
    border: 1px solid rgba(255,255,255,0.06);
    color: var(--text); text-decoration: none;
    display: flex; flex-direction: column; gap: 8px;
    transition: all 0.15s; position: relative; overflow: hidden;
    min-height: 130px;
  }
  .tile.play   { border-color: rgba(0,212,255,0.35); }
  .tile.manual { border-color: rgba(255,0,170,0.30); }
  .tile.soon   { opacity: 0.4; pointer-events: none; border-style: dashed; }
  .tile:not(.soon):hover {
    transform: translateY(-2px);
    box-shadow: 0 12px 30px rgba(0,0,0,0.35);
  }
  .tile-emoji { font-size: 28px; }
  .tile-num { font-size: 10px; color: var(--muted); font-weight: 700; letter-spacing: 1.5px; text-transform: uppercase; }
  .tile h3 { font-size: 17px; font-weight: 800; }
  .tile-tag {
    align-self: flex-start; margin-top: auto;
    font-size: 10px; font-weight: 700; padding: 3px 8px;
    border-radius: 999px; text-transform: uppercase; letter-spacing: 1px;
  }
  .tile.play   .tile-tag { background: rgba(0,212,255,0.12); color: var(--accent); }
  .tile.manual .tile-tag { background: rgba(255,0,170,0.12); color: var(--accent-2); }
  .tile.soon   .tile-tag { background: rgba(255,255,255,0.08); color: var(--muted); }
  .tile .check {
    position: absolute; top: 10px; right: 12px;
    color: var(--good); font-size: 18px; font-weight: 800;
    text-shadow: 0 0 10px rgba(0,230,118,0.6);
  }
  .tile .score-line {
    font-size: 11px; color: var(--muted);
  }
  .tile .score-line strong { color: var(--good); }
</style>
</head>
<body>
<main>
  <h1>Games</h1>
  <div class="subtitle" id="subtitle">Loading…</div>
  <div class="grid" id="grid"></div>
</main>

<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from './firebase-config.js';
import { resolveSession } from './shared/lobby.js';
import { mountTopbar } from './shared/topbar.js';
import { GAMES } from './shared/games-catalog.js';

if (!firebaseConfig?.databaseURL || firebaseConfig.databaseURL.includes('REPLACE_ME')) {
  document.body.innerHTML = '<div style="max-width:640px;margin:80px auto;padding:32px;background:#1b2540;border-radius:16px;color:#f5f7fb;font-family:system-ui">Firebase config missing. See SETUP.md.</div>';
  throw new Error('firebase config not filled in');
}

const session = resolveSession();
if (!session) {
  location.replace('index.html');
  throw new Error('no session');
}
mountTopbar({ activePage: 'games' });

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const grid = document.getElementById('grid');
const subtitle = document.getElementById('subtitle');

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function tileHref(key, g) {
  const q = `?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;
  if (g.kind === 'play')   return `${g.href}${q}`;
  if (g.kind === 'manual') return `games/manual.html?key=${key}&lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;
  return null;
}

function render(scoresForTeam) {
  const html = Object.entries(GAMES).map(([key, g]) => {
    const href = tileHref(key, g);
    const tag = g.kind === 'play' ? 'Playable' : g.kind === 'manual' ? 'Manual entry' : 'Coming soon';
    const score = scoresForTeam?.[key];
    const tick = score !== undefined ? '<div class="check" title="Submitted">✓</div>' : '';
    const scoreLine = score !== undefined
      ? `<div class="score-line">Raw: <strong>${esc(String(score))}</strong></div>`
      : '';
    const tag2 = `<span class="tile-tag">${tag}</span>`;
    const open = g.kind === 'soon' ? '<div' : '<a';
    const close = g.kind === 'soon' ? '</div>' : '</a>';
    const hrefAttr = href ? ` href="${href}"` : '';
    return `${open} class="tile ${g.kind}"${hrefAttr}>
      <div class="tile-emoji">${g.emoji}</div>
      <div class="tile-num">${key}</div>
      <h3>${esc(g.name)}</h3>
      ${scoreLine}
      ${tag2}
      ${tick}
    ${close}`;
  }).join('');
  grid.innerHTML = html;

  const submitted = scoresForTeam ? Object.keys(scoresForTeam).length : 0;
  const total = Object.values(GAMES).filter(g => g.kind !== 'soon').length;
  subtitle.textContent = `Lobby ${session.lobbyId} · Team ${session.teamId} · ${submitted}/${total} games submitted`;
}

onValue(ref(db, `lobbies/${session.lobbyId}/scores/${session.teamId}`), snap => {
  render(snap.exists() ? snap.val() : null);
});
</script>
</body>
</html>
```

- [ ] **Step 2: Smoke-check by running the dev server**

Run: `npm run dev`
Then open `http://localhost:5173/ps-offsite-2026/games.html?lobby=PS-XXXX&team=1` (with a real lobby ID).
Expected: redirects to `index.html` because no session in localStorage. From there: create lobby → join → land on `games.html` (after Task 8 changes the redirect; for now you can manually `setSession({...})` in devtools or paste a URL).

Skip if no lobby handy — Task 12 covers full end-to-end smoke.

- [ ] **Step 3: Add `games.html` to Vite rollup inputs**

Open `vite.config.js`. In `rollupOptions.input`, add:

```js
        games: resolve(__dirname, root, 'games.html'),
        manual: resolve(__dirname, root, 'games/manual.html'),
```

(Adding both now — `manual.html` is created in Task 7. Either order works since the build won't run until both files exist.)

- [ ] **Step 4: Commit**

```bash
git add ps-offsite-2026/games.html vite.config.js
git commit -m "feat(games): catalog page with live tick badges + vite input"
```

---

## Task 7: `games/manual.html` — manual score entry template

**Files:**
- Create: `ps-offsite-2026/games/manual.html`

- [ ] **Step 1: Create the manual-entry template**

```html
<!-- ps-offsite-2026/games/manual.html -->
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PS Offsite 2026 — Manual Game</title>
<link rel="stylesheet" href="../shared/topbar.css">
<style>
  :root {
    --bg: #0a0e1a; --bg-2: #131a2e; --card: #1b2540;
    --text: #f5f7fb; --muted: #8b95b5;
    --accent: #00d4ff; --accent-2: #ff00aa; --good: #00e676; --bad: #ff4d6d;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(circle at 50% 0%, #1f2a4a 0%, var(--bg) 60%);
    color: var(--text); min-height: 100vh;
  }
  main { max-width: 720px; margin: 0 auto; padding: 40px; }
  .head { display: flex; align-items: center; gap: 16px; margin-bottom: 24px; }
  .head .emoji { font-size: 48px; }
  h1 { font-size: 32px; font-weight: 900; letter-spacing: -1px; }
  .rules {
    background: var(--card); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 14px; padding: 20px; margin-bottom: 24px;
    line-height: 1.65; color: #d8def0; font-size: 14px;
  }
  .rules p { margin-bottom: 10px; }
  .rules ul { margin: 6px 0 6px 22px; }
  .panel {
    background: var(--card); border: 1px solid rgba(255,255,255,0.06);
    border-radius: 14px; padding: 22px;
  }
  .panel label { display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: var(--muted); margin-bottom: 8px; }
  .panel input[type=number] {
    background: var(--bg-2); color: var(--text);
    border: 1px solid rgba(255,255,255,0.1); border-radius: 10px;
    padding: 14px 16px; font-size: 22px; font-weight: 800; font-family: inherit;
    width: 100%; margin-bottom: 14px;
  }
  .panel button {
    background: linear-gradient(135deg, var(--accent), #0099cc);
    border: none; color: #001; font-weight: 800; font-size: 15px;
    padding: 12px 18px; border-radius: 10px; cursor: pointer; font-family: inherit;
  }
  .panel button:disabled { opacity: 0.5; cursor: default; }
  .panel .current { color: var(--muted); font-size: 13px; margin-bottom: 10px; }
  .panel .current strong { color: var(--good); }
  .banner {
    margin-top: 12px; padding: 10px 14px; border-radius: 10px;
    font-size: 13px; font-weight: 700;
  }
  .banner.ok  { background: rgba(0,230,118,0.12); color: var(--good); }
  .banner.bad { background: rgba(255,77,109,0.12); color: var(--bad); }
  .back-link { display: inline-block; margin-top: 14px; color: var(--accent); text-decoration: none; font-weight: 700; font-size: 13px; }
</style>
</head>
<body>
<main>
  <div id="container">Loading…</div>
</main>

<script type="module">
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, get, update, push } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { resolveSession } from '../shared/lobby.js';
import { mountTopbar } from '../shared/topbar.js';
import { getGame } from '../shared/games-catalog.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';

const session = resolveSession();
if (!session) {
  location.replace('../index.html');
  throw new Error('no session');
}
mountTopbar({ activePage: 'games' });

const params = new URLSearchParams(location.search);
const key = params.get('key');
const game = getGame(key);

const container = document.getElementById('container');
const catalogHref = `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;

if (!game || game.kind !== 'manual') {
  container.innerHTML = `
    <h1>Unknown game</h1>
    <p style="color:#8b95b5;margin-top:10px">No manual game registered for key <code>${key ?? '(none)'}</code>.</p>
    <a class="back-link" href="${catalogHref}">← Back to catalog</a>
  `;
  throw new Error('unknown manual game');
}

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const writer = firebaseWriter({ db, ref, update, push });

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function renderRules(text) {
  const blocks = String(text || '').split(/\n\s*\n/);
  return blocks.map(b => {
    const lines = b.split('\n');
    if (lines.every(l => l.startsWith('- '))) {
      return `<ul>${lines.map(l => `<li>${esc(l.slice(2))}</li>`).join('')}</ul>`;
    }
    return `<p>${esc(b.replace(/\n/g, ' '))}</p>`;
  }).join('');
}

async function render() {
  const snap = await get(ref(db, `lobbies/${session.lobbyId}/scores/${session.teamId}/${key}`));
  const current = snap.exists() ? snap.val() : null;

  container.innerHTML = `
    <div class="head">
      <div class="emoji">${game.emoji}</div>
      <h1>${esc(game.name)}</h1>
    </div>
    <div class="rules">${renderRules(game.rules)}</div>
    <div class="panel">
      ${current !== null ? `<div class="current">Currently submitted: <strong>${esc(String(current))}</strong> pts</div>` : ''}
      <label for="score">${current !== null ? 'Resubmit raw score' : 'Raw score'}</label>
      <input id="score" type="number" min="0" step="1" inputmode="numeric" value="${current !== null ? esc(String(current)) : ''}" />
      <button id="submitBtn">${current !== null ? 'Resubmit' : 'Submit score'}</button>
      <div id="banner"></div>
      <a class="back-link" href="${catalogHref}">← Back to catalog</a>
    </div>
  `;

  const input = document.getElementById('score');
  const btn = document.getElementById('submitBtn');
  const banner = document.getElementById('banner');

  btn.addEventListener('click', async () => {
    const raw = parseInt(input.value, 10);
    if (!Number.isFinite(raw) || raw < 0) {
      banner.className = 'banner bad';
      banner.textContent = 'Enter a non-negative integer.';
      return;
    }
    btn.disabled = true;
    banner.className = '';
    banner.textContent = '';
    try {
      const saved = await submitScore({
        writer, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: key, score: raw,
      });
      banner.className = 'banner ok';
      banner.innerHTML = `Saved <strong>${esc(String(saved))}</strong> pts. <a class="back-link" style="margin:0" href="${catalogHref}">Return to catalog →</a>`;
    } catch (e) {
      banner.className = 'banner bad';
      banner.textContent = 'Save failed: ' + (e.message || 'unknown error');
    } finally {
      btn.disabled = false;
    }
  });
}

render();
</script>
</body>
</html>
```

- [ ] **Step 2: Smoke-check (optional, full e2e in Task 12)**

`npm run dev` then with a valid session navigate to `games/manual.html?key=MX`. Verify rules render, input accepts 17, submit shows "Saved 17 pts".

- [ ] **Step 3: Commit**

```bash
git add ps-offsite-2026/games/manual.html
git commit -m "feat(games): manual.html template for non-playable games"
```

---

## Task 8: `index.html` cleanup — host hub becomes QR distribution

**Files:**
- Modify: `ps-offsite-2026/index.html`

- [ ] **Step 1: Remove the `.lobby-strip` block and the 4 game tiles from `view-hub`**

Find the `<section id="view-hub" hidden>` block (current L169-219). Replace its contents with:

```html
  <!-- ============== VIEW: hub ============== -->
  <section id="view-hub" hidden>
    <div class="host-banner">
      <h2>Host view</h2>
      <p>Share these QR codes with the teams. Players use the <strong>Games</strong> catalog from their phone.</p>
      <a class="open-catalog" id="openCatalogBtn" href="#">Open Games catalog →</a>
    </div>

    <div class="qr-section">
      <h2>QR codes</h2>
      <p>Paste your deploy URL and QR codes generate for each surface, scoped to this lobby and team.</p>
      <input class="base-url" id="baseUrl" type="url" placeholder="https://ps-offsite-2026.netlify.app/">
      <div class="qr-grid" id="qrGrid"></div>
    </div>
  </section>
```

- [ ] **Step 2: Add CSS for the host banner**

In the `<style>` block, after `.team-row .team-note { ... }` rule, add:

```css
  .host-banner {
    background: linear-gradient(135deg, #1b2540 0%, #2a1a3a 100%);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px; padding: 24px; margin-bottom: 32px;
  }
  .host-banner h2 { font-size: 22px; margin-bottom: 6px; }
  .host-banner p { color: var(--muted); font-size: 14px; margin-bottom: 14px; }
  .open-catalog {
    display: inline-block;
    background: linear-gradient(135deg, var(--accent), #0099cc);
    color: #001; font-weight: 800; font-size: 14px;
    padding: 10px 16px; border-radius: 10px; text-decoration: none;
  }
```

Also remove now-dead rules: `.tile` block-level rules added in Task description aside, the old hub-tile-specific selectors stay harmless if the markup is gone, but feel free to delete `.tile`, `.tile:hover`, `.tile.scoreboard`, `.tile-num`, `.tile-emoji`, `.tile h3`, `.tile p`, `.tile-tag`, `.tile.disabled`, `.tile-game`. They're not used anywhere else after this task.

- [ ] **Step 3: Update `renderHub` and `renderQRs` in the script**

Locate `function renderHub(session)` and replace with:

```js
function renderHub(session) {
  const q = `?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;
  $('openCatalogBtn').href = `games.html${q}`;
  // mount topbar (lobby strip removed; topbar covers lobby + team + leave)
  mountTopbar({ activePage: 'hub' });
  $('baseUrl').addEventListener('input', renderQRs);
  renderQRs();
}
```

Locate `function renderQRs()` and update the `games` list to include the catalog:

```js
  const games = [
    { name: 'Games catalog', file: 'games.html' },
    { name: 'Scoreboard', file: 'scoreboard.html' },
    { name: '1 · Gesture Lock', file: 'games/1-gesture-lock.html' },
    { name: '2 · Pantomime', file: 'games/2-pantomime.html' },
    { name: '3 · Pipeline Dash', file: 'dino/index.html' },
    { name: '4 · Insight Monitor', file: 'flappy/index.html' },
  ];
```

- [ ] **Step 4: Import `mountTopbar` in index.html and change post-join redirect**

Add to the top of the existing `<script type="module">`:

```js
import { mountTopbar } from './shared/topbar.js';
```

(Place alongside the existing `lobby.js` import.)

Then update the `doJoin` function. Replace the final lines:

```js
  setSession({ lobbyId, teamId, teamPwd: pwd });
  location.reload();
```

with:

```js
  setSession({ lobbyId, teamId, teamPwd: pwd });
  location.href = `games.html?lobby=${encodeURIComponent(lobbyId)}&team=${teamId}`;
```

- [ ] **Step 5: Add `ps-topbar-host` body class behaviour**

The `mountTopbar` helper already adds `ps-topbar-host` to body on non-canvas pages. Ensure the page padding accommodates the 56px topbar. In the `body` rule, change `padding: 40px;` to `padding: 40px 40px 40px 40px;` — actually leave padding alone; topbar.css's `body.ps-topbar-host` rule already shifts content. Verify by running the dev server in Step 6.

- [ ] **Step 6: Smoke-test the hub view**

Run: `npm run dev`. Open `http://localhost:5173/ps-offsite-2026/`. Create a lobby with 4 teams → continue → join Team 1 → confirm browser navigates to `games.html?lobby=...&team=1`.

Manually navigate back to `index.html` (with session in localStorage) → confirm hub renders with topbar, host banner, "Open Games catalog" button, QR section. No `.lobby-strip`, no game tiles, no scoreboard tile.

- [ ] **Step 7: Commit**

```bash
git add ps-offsite-2026/index.html
git commit -m "refactor(index): hub becomes host QR view; post-join lands on games"
```

---

## Task 9a: Gesture Lock — auto-submit raw score

**Files:**
- Modify: `ps-offsite-2026/games/1-gesture-lock.html`

- [ ] **Step 1: Locate the existing end-screen render call**

Open the file. Search for `renderEndScreen(` — find the call that currently passes `code`, `max`, `game`, `team`, `score`. Note the surrounding async game-over callback (likely an `endGame` or `finishRun` function).

- [ ] **Step 2: Wire `submitScore` before the render**

Add imports at the top of the page's `<script type="module">`:

```js
import { ref, update, push } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
```

(`getDatabase`/`initializeApp` should already be imported. If not, add them and initialise `db` once.)

Below `const db = getDatabase(app);` (or equivalent), add:

```js
const writer = firebaseWriter({ db, ref, update, push });
const catalogHref = `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;
```

Replace the existing `renderEndScreen(...)` call with:

```js
renderEndScreen(endEl, { score, saved: null, message, catalogHref });
try {
  await submitScore({
    writer, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: 'GZ', score,
  });
  renderEndScreen(endEl, { score, saved: true, message, catalogHref });
} catch (e) {
  console.error('submit failed', e);
  renderEndScreen(endEl, { score, saved: false, message, catalogHref });
}
```

(Container variable name may differ — keep the existing one.) The wrapping function must be `async`. If it isn't, add `async`.

- [ ] **Step 3: Run the suite**

Run: `npm test`
Expected: PASS (no test directly covers this page; just confirm no regression).

- [ ] **Step 4: Manual smoke**

Run: `npm run dev`. Play Gesture Lock to completion. Confirm end screen shows "SAVED ✓" badge, then return to catalog → tile shows ✓.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/games/1-gesture-lock.html
git commit -m "feat(gesture-lock): auto-submit raw score on game-end"
```

---

## Task 9b: Pantomime — auto-submit raw score

**Files:**
- Modify: `ps-offsite-2026/games/2-pantomime.html`

Mirror of Task 9a with `gameKey: 'PM'`.

- [ ] **Step 1: Add imports (same as 9a)**

```js
import { ref, update, push } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
```

- [ ] **Step 2: Initialise the writer and replace `renderEndScreen` call**

```js
const writer = firebaseWriter({ db, ref, update, push });
const catalogHref = `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;
```

Wrap the existing end-screen invocation:

```js
renderEndScreen(endEl, { score, saved: null, message, catalogHref });
try {
  await submitScore({
    writer, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: 'PM', score,
  });
  renderEndScreen(endEl, { score, saved: true, message, catalogHref });
} catch (e) {
  console.error('submit failed', e);
  renderEndScreen(endEl, { score, saved: false, message, catalogHref });
}
```

- [ ] **Step 3: Run tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Manual smoke**

Play Pantomime. Confirm "SAVED ✓" appears and the catalog tile shows ✓.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/games/2-pantomime.html
git commit -m "feat(pantomime): auto-submit raw score on game-end"
```

---

## Task 9c: Dino (Pipeline Dash) — auto-submit raw score

**Files:**
- Modify: `ps-offsite-2026/dino/main.js`
- (also touch `ps-offsite-2026/dino/index.html` if Firebase imports aren't already on the page)

- [ ] **Step 1: Verify Firebase imports**

Open `dino/index.html`. Confirm `firebase-app.js`, `firebase-database.js`, `firebase-config.js` are imported in `main.js` or the page. If `main.js` already calls Firebase, fine — otherwise add the SDK imports there.

- [ ] **Step 2: In `main.js`, import the submit helper**

At the top of `dino/main.js`:

```js
import { ref, update, push, getDatabase } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { firebaseConfig } from '../firebase-config.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
```

(Only add the ones that aren't already imported.)

- [ ] **Step 3: Initialise the writer once**

After the existing `resolveSession()` call, add:

```js
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const writer = firebaseWriter({ db, ref, update, push });
const catalogHref = `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;
```

- [ ] **Step 4: Replace `renderEndScreen` in the game-over branch**

Locate the existing `renderEndScreen(endEl, { game: 'DN', team, score, max, code, message })` call. Replace with:

```js
renderEndScreen(endEl, { score, saved: null, message, catalogHref });
submitScore({
  writer, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: 'DN', score,
}).then(() => {
  renderEndScreen(endEl, { score, saved: true, message, catalogHref });
}).catch(e => {
  console.error('submit failed', e);
  renderEndScreen(endEl, { score, saved: false, message, catalogHref });
});
```

(Wrap in `.then/.catch` instead of `async/await` if the surrounding game loop isn't async.)

- [ ] **Step 5: Manual smoke**

`npm run dev`, play Dino, confirm save badge + tile tick.

- [ ] **Step 6: Commit**

```bash
git add ps-offsite-2026/dino/main.js ps-offsite-2026/dino/index.html
git commit -m "feat(dino): auto-submit raw score on game-over"
```

---

## Task 9d: Flappy (Insight Monitor) — auto-submit raw score

**Files:**
- Modify: `ps-offsite-2026/flappy/main.js`
- (also touch `ps-offsite-2026/flappy/index.html` if imports needed)

Same shape as 9c but with `gameKey: 'FL'`.

- [ ] **Step 1: Imports**

```js
import { ref, update, push, getDatabase } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { firebaseConfig } from '../firebase-config.js';
import { submitScore, firebaseWriter } from '../shared/score-submit.js';
```

- [ ] **Step 2: Writer + catalog href**

```js
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);
const writer = firebaseWriter({ db, ref, update, push });
const catalogHref = `../games.html?lobby=${encodeURIComponent(session.lobbyId)}&team=${session.teamId}`;
```

- [ ] **Step 3: Replace `renderEndScreen` in game-over**

```js
renderEndScreen(endEl, { score, saved: null, message, catalogHref });
submitScore({
  writer, lobbyId: session.lobbyId, teamId: session.teamId, gameKey: 'FL', score,
}).then(() => {
  renderEndScreen(endEl, { score, saved: true, message, catalogHref });
}).catch(e => {
  console.error('submit failed', e);
  renderEndScreen(endEl, { score, saved: false, message, catalogHref });
});
```

- [ ] **Step 4: Manual smoke**

Play Flappy. Confirm SAVED badge + tile tick.

- [ ] **Step 5: Commit**

```bash
git add ps-offsite-2026/flappy/main.js ps-offsite-2026/flappy/index.html
git commit -m "feat(flappy): auto-submit raw score on game-over"
```

---

## Task 10: Scoreboard rewrite — rank-points render, drop code input

**Files:**
- Modify: `ps-offsite-2026/scoreboard.html`

- [ ] **Step 1: Replace the local `GAMES` const with an import**

Near the top of the page's `<script type="module">` (around L431), delete:

```js
const GAMES = { GZ: 'Gesture Lock', PM: 'Pantomime', DN: 'Pipeline Dash', FL: 'Insight Monitor' };
```

Add a new import alongside the existing module imports:

```js
import { GAMES, allEnteredKeys } from './shared/games-catalog.js';
import { rankPointsByTeam } from './shared/ranking.js';
import { submitScore, firebaseWriter } from './shared/score-submit.js';
```

Update every reference to `GAMES[g]` (a string before, an object now). Change such reads to `GAMES[g].name`. Example matches:
- `GAMES[parsed.game]` → `GAMES[parsed.game].name` (if any survive in remaining code)
- `GAMES[g]` inside the matrix render → `GAMES[g].name`

- [ ] **Step 2: Update `gameKeys` to use the catalog helper**

Find the two declarations `const gameKeys = Object.keys(GAMES);` (admin check + matrix render). Replace both with:

```js
const gameKeys = allEnteredKeys(); // GAMES order, minus 'soon' entries
```

- [ ] **Step 3: Compute team count and rank-points per game**

Before the existing matrix-render block (the one that produces `headCells` + `rows`), compute the rank-points map. Add:

```js
const teamCount = state.teams.length;
const rankByGame = {};
for (const g of gameKeys) {
  const raw = {};
  for (const t of state.teams) {
    const v = t.scores[g];
    if (typeof v === 'number') raw[t.id] = v;
  }
  rankByGame[g] = rankPointsByTeam({ teamCount, raw });
}
```

- [ ] **Step 4: Use rank-points in cell + total rendering**

Find the cell render loop (around L675–L690). The cell currently shows the raw score from `t.scores[g]`. Update to render both raw and rank points:

```js
const cells = gameKeys.map(g => {
  const raw = t.scores[g];
  const pts = rankByGame[g]?.[t.id];
  if (raw === undefined) {
    return `<td class="cell-game empty" data-team-id="${t.id}" data-game="${g}"></td>`;
  }
  return `<td class="cell-game" data-team-id="${t.id}" data-game="${g}" title="Raw ${raw}; ${pts ?? 0} rank pts">
    <div class="cell-raw">${raw}</div>
    <div class="cell-pts">${formatPts(pts)}</div>
  </td>`;
}).join('');
```

Add helper near the top of the script:

```js
function formatPts(p) {
  if (p === undefined || p === null) return '0';
  return Number.isInteger(p) ? String(p) : p.toFixed(1);
}
```

Find the existing total calculation (around L629 and L650 — two spots). Replace summing `t.scores[g]` with summing rank-points:

```js
const totals = state.teams.map(t => {
  let total = 0;
  for (const g of gameKeys) total += rankByGame[g]?.[t.id] ?? 0;
  return { ...t, total };
});
```

Use `totals` everywhere `state.teams` was previously decorated with `.total`. (The leaderboard + matrix both rely on this.)

Add minimal CSS for the new dual-line cell (anywhere in the existing `<style>`):

```css
.cell-game .cell-raw { font-size: 11px; color: var(--muted); }
.cell-game .cell-pts { font-size: 18px; font-weight: 800; color: var(--text); }
.cell-game.empty { background: rgba(255,255,255,0.02); }
```

- [ ] **Step 5: Remove the code-input UI**

Locate the existing "Submit code" form / input / button in the markup and the JS that wires `parseCode` + `onSubmitCode`. Delete:
- The `<input>` + `<button>` markup for code submission.
- The `parseCode(codeRaw)` function and its caller.
- The `update` + `push` calls that wrote the parsed code (now duplicated by `submitScore`).

Keep the history list (read-only, no input). Keep the reset/normalise admin buttons.

- [ ] **Step 6: Route cell-edit through `submitScore`**

Find the dbl-click cell-edit handler. After the new raw value is captured, replace the direct write with:

```js
const writer = firebaseWriter({ db, ref, update, push });
await submitScore({ writer, lobbyId, teamId, gameKey, score: newRaw });
```

(Imports for `ref`, `update`, `push` already exist on this page.) Remove any in-place duplicate `update(...)` calls in the same handler.

- [ ] **Step 7: Run the full test suite**

Run: `npm test`
Expected: PASS (no scoreboard test exists yet; ensure nothing else broke).

- [ ] **Step 8: Manual smoke**

`npm run dev`. With a 3+ team lobby, submit raw scores via games or via cell-edit. Confirm:
- Cell shows small raw + bold rank-pts.
- Tie scenario: two teams with identical raw → both show same rank-pts value (e.g. 2.5).
- Total column reflects the sum.
- No "Submit code" input is present.

- [ ] **Step 9: Commit**

```bash
git add ps-offsite-2026/scoreboard.html
git commit -m "refactor(scoreboard): rank-point render, drop code-typing UI"
```

---

## Task 11: BUILD_PLAN tick-off

**Files:**
- Modify: `BUILD_PLAN.md` lines 37–58

- [ ] **Step 1: Mark catalog-page items as done**

Replace `[]` with `[x]` for the following lines:

- Line 37: `games catalog page`
- Line 38: `introduce top bar menu`
- Line 39: `remove lobby row`
- Line 40: `games description is up-to-date` (placeholders OK — flag in commit message)
- Line 41: `tiles obsahují všechny hry`
- Line 42: `4 tiles playable`
- Line 43: `the rest can be displayed but contains only games rules and input for score submission`
- Line 44: `non-playable games currently contains lorem imsum description + rules` (now real-ish placeholders)
- Line 45: `pub-quiz is still open do not invest in it now`
- Line 46: `vidíš jestli je hra už hraná …`
- Line 47: `non playable games jen vysvětli pravidla a umožní zadat počet bodů`

- [ ] **Step 2: Commit**

```bash
git add BUILD_PLAN.md
git commit -m "chore(build-plan): tick games catalog work"
```

---

## Task 12: Full end-to-end manual smoke + final tidy

No code changes here; this is a checklist run before declaring done.

- [ ] **Step 1: Start dev server**

```bash
npm run dev
```

- [ ] **Step 2: Create + join**

- Open `http://localhost:5173/ps-offsite-2026/`.
- Create lobby with 4 teams. Note admin pwd + team passwords from credentials.
- Continue → join Team 1 with its password.
- Verify browser lands on `games.html?lobby=…&team=1`.

- [ ] **Step 3: Catalog tile interaction**

- See 11 tiles. Playable cyan, manual magenta, Pub Quiz dimmed.
- Tap Pub Quiz tile — nothing happens (no link).
- Tap "Math No-Brain" — manual page renders with rules + input.

- [ ] **Step 4: Manual score submission**

- Enter `17`, submit. Banner: "Saved 17 pts. Return to catalog".
- Back to catalog: MX tile shows ✓ + "Raw: 17".

- [ ] **Step 5: Playable score submission**

- Open Gesture Lock from catalog. Play to game-over.
- End screen: shows raw score + "SAVED ✓" + "RETURN TO CATALOG".
- Catalog: GZ tile shows ✓.

- [ ] **Step 6: Multi-team via separate tabs**

- Open a private window → join Team 2.
- Submit different scores for MX and GZ from Team 2.

- [ ] **Step 7: Scoreboard**

- Open `scoreboard.html?lobby=PS-XXXX` in a third tab.
- For MX: two teams with raw scores, two without. Top should have rank-pts = 4 (teamCount), second = 3, rest = 0.
- Total column reflects rank-pts sum.
- No code-input box anywhere.

- [ ] **Step 8: Tie test**

- From Team 2, dbl-click GZ cell and set raw equal to Team 1's GZ raw.
- Verify both rows now show 3.5 rank-pts (avg of 4 and 3) for that game.

- [ ] **Step 9: Reset + final commit**

If everything passes, run the full test suite once more:

```bash
npm test
```

Expected: PASS across `games-catalog.test.js`, `ranking.test.js`, `score-submit.test.js`, `score-panel.test.js`, plus the existing `lobby.test.js`, `audio.test.js`, `gesture-lock.test.js`, `pantomime-logic.test.js`, `stages.test.js`.

No additional commit needed unless smoke uncovered issues.

---

## Self-review checklist for the implementer

Before opening a PR:

- [ ] All 11 tiles render on `games.html`.
- [ ] Pub Quiz tile is visible but greyed and inert.
- [ ] Submitting any game updates the tile tick in real time (Firebase `onValue` subscription is live).
- [ ] Scoreboard cells show small raw + bold rank-pts.
- [ ] Total column = sum of rank-pts, not raw.
- [ ] No "Submit code" box anywhere.
- [ ] `index.html` hub has topbar, host banner, QR section only — no game tiles, no `.lobby-strip`.
- [ ] Post-join lands on `games.html` (verified by clearing session + re-joining).
- [ ] `npm test` is green.
