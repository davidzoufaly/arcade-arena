# 🐛 PS-Offsite Portal — Bug Hunt Report

**Date:** 2026-06-14 · **Branch:** `feat/individuals-vs-teams-mode`
**Method:** 12 parallel domain reviewers (one per subsystem) → every high/critical finding independently re-checked by an adversarial verifier whose job was to *refute* it. 29 agents total.
**Scope:** whole portal — 6 games, lobby, scoreboard, quiz admin, shared modules, tests, build/repo hygiene (~9,400 LOC).

---

## 📊 Headline numbers

| Metric | Count |
|---|---|
| Total findings | **114** |
| Confirmed critical | **2** |
| High (most downgraded on verify) | 15 reported → see table |
| Medium | 34 |
| Low | 63 |
| High/critical sent to adversarial verify | 17 |
| → confirmed real | **15** |
| → false positives (discarded) | **2** |

Two findings died under verification (kept below for honesty). Everything else in this report survived a skeptic.

---

## 🍺 Leaderboard — who wins the beer

Ranked by **confirmed findings** (total minus verified false positives). Quality gate applied: a finding only counts if it wasn't refuted.

| Rank | Reviewer (domain) | Confirmed | C | H | M | L | Notes |
|---|---|---|---|---|---|---|---|
| 🥇 **WINNER** | **repo-hygiene** | **13** | 0 | 3 | 6 | 4 | Zero false positives. Caught README fully out-of-sync + the open-DB-rules context. |
| 🥈 | tests | 12 | 0 | 3 | 6 | 4 | 1 FP. Mapped every untested glue module. |
| 🥈 | pantomime | 12 | 0 | 1 | 2 | 9 | Best archaeology — traced dead code to commit `13f5210`. |
| 4 | lobby-catalog | 11 | 0 | 3 | 3 | 6 | 1 FP. |
| 4 | vision-audio | 11 | 0 | 2 | 4 | 5 | |
| 4 | theme-nav-landing | 11 | 0 | 1 | 3 | 7 | Found the modal XSS. |
| 7 | quiz | 8 | 0 | 1 | 3 | 4 | |
| 7 | scoreboard-ranking | 8 | 0 | 0 | 0 | 8 | |
| 9 | dino | 7 | 0 | 0 | 2 | 5 | |
| 9 | flappy | 7 | 0 | 0 | 3 | 4 | |
| 11 | gesture-lock | 6 | 0 | 0 | 1 | 5 | |
| 12 | **auth-security** | 6 | **2** | 1 | 1 | 2 | 🏆 see below |

### 🥇 Beer: **repo-hygiene** — 13 confirmed findings, zero false positives.
### 🏆 Golden Bug Award: **auth-security**
Volume isn't everything. auth-security found the only two **critical** issues in the codebase and the single most dangerous defect of the whole hunt — a complete admin-auth bypass on top of world-readable plaintext passwords. If the beer were judged on *impact*, it would go here. Honorary second beer.

---

## 🔴 The headline issues (confirmed, ranked by real-world impact)

### 1. CRITICAL — Admin auth is client-side only, trivially bypassed
`shared/admin-gate.js:21-34` → `shared/lobby.js:88-90`
`requireAdmin()` trusts `session.role === 'admin'`, read straight from `localStorage` (key `psOffsite2026.lobby`), which the user fully controls. Any player can run:
```js
localStorage.setItem('psOffsite2026.lobby', JSON.stringify({lobbyId:'XXXX', role:'admin'}))
```
…reload, and become admin everywhere: scoreboard reset, quiz grading, game lock/unlock, timers, rules. The password prompt is never reached. No server-side enforcement exists.
**Fix:** Move the trust boundary into Firebase Security Rules (Firebase Auth + custom claim, or a Cloud Function that mints a token after a real password check). A static site's JS cannot enforce auth.

### 2. CRITICAL (verifier: high) — SETUP mandates fully open Firebase rules
`SETUP.md:24-33`
Setup instructs operators to deploy `{ ".read": true, ".write": true }`. Combined with the bundled `databaseURL` and plaintext passwords stored in the DB (`createLobby` writes `adminPwd` and each team `pwd` as plain strings, `lobby.js:117-125`), **anyone can read every admin/team password and overwrite all state** via direct REST calls — entirely bypassing the frontend. The 4-char lobby ID (~1M combos) is not a secret.
**Fix:** Deny read on `meta/adminPwd` and `teams/*/pwd`; require auth for writes to locks/timers/rules/scores. Never store plaintext passwords in a readable node. If kept disposable, at minimum state in SETUP.md that all passwords are world-readable.

### 3. HIGH (verifier: medium) — Stored XSS in shared modal
`shared/modal.js:8-14`
`openModal` interpolates `title` and `confirmLabel` into `innerHTML` unescaped. `games.html` passes **user-controlled custom game names** as the title (`'Rules — ' + eff.name`). `validateCustomGame` only checks non-empty + length≤40 — no sanitization. A game named `<img src=x onerror=…>` is stored and executes when the admin opens its Rules/Timer modal.
**Fix:** Escape `title`/`confirmLabel` (reuse `esc()`, or set via `textContent`). Treat only `bodyHtml` as trusted HTML.

### 4. HIGH (verifier: medium) — `loadVision()` caches a rejected promise forever
`shared/vision.js:13-23`
`visionPromise` is assigned once and never reset. If the ~9MB wasm/model import fails transiently (offline blip), the rejected promise is cached for the page lifetime — every "TAP TO RETRY" returns the same rejection. Only a full reload recovers.
**Fix:** `.catch(e => { visionPromise = undefined; throw e; })` so the next call retries. Cache only on success.

### 5. HIGH (verifier: medium) — Camera MediaStream leaks on init failure
`shared/vision.js:25-36`
`getUserMedia` turns the camera on, but if the subsequent `video.play()` rejects (autoplay policy), `createCamStream` throws **without** stopping the acquired tracks. The caller hasn't stored the stream yet, so it can't stop it — camera light stays on until unload.
**Fix:** `try/catch` after `getUserMedia`; on error `stream.getTracks().forEach(t => t.stop())` before re-throwing.

### 6. HIGH (verifier: medium) — `resetQuiz` shows fresh categories as already-graded
`quiz-admin.html:452-457`
`resetQuiz` clears only the local `pending` map. Module-level `gradedCats` Set and `gradeStatus` are never cleared, and `seedCategories()` re-mints the same `c1..c4` keys — so `isCategoryGraded()` returns true for the brand-new empty categories ("✓ Completed", green border, "Redo"). Admin-only, self-corrects on reload, but confusing during an event.
**Fix:** `gradedCats.clear()` + clear `gradeStatus` (and `submitting`) inside `resetQuiz`.

---

## 🧵 Cross-cutting themes (the patterns, not just instances)

These recurred across multiple reviewers — fix the pattern, not just the line.

1. **Client-side-only trust model** *(the big one)* — admin status, game gates, and DB access are all enforced in the browser with no server authority. `game-gate.js` even *fails open* on read error / missing `lobbyId`. Comments actively lie about it ("re-verifies via sessionStorage" — no sessionStorage exists anywhere). Documented as an accepted one-day-event tradeoff, but the in-code comments overstate protection.

2. **Individuals-vs-teams mode is half-wired** *(this branch's whole point)* — mode is written at lobby creation and read by the scoreboard, but leaks "team" everywhere else: `games.html` admin "Manage games" + join flow in `index.html` ("Pick your team" / "Team password"), `game-gate.js` locked screen ("your team"), quiz-admin grading ("team(s)"), topbar placeholder flash ("Team N"), scoreboard first synchronous render. The helpers `participantNoun()` / `isIndividualsMode()` exist in `lobby.js` but are **unused** — the logic is re-implemented inline in 3+ places.

3. **Dead code from removed features & template copy-paste** — pantomime's entire duo/2-player path (removed in `13f5210`, UI left behind), dino's dead CSS copied from gesture-lock, flappy's `g.worldX`/`died`/`msg`, `vision.js` unused exports (games call MediaPipe directly), gesture-lock's `FALLBACK_N` import, lobby `g.icon` path, scoreboard `pendingScores`, quiz `bonusIndices`.

4. **`theme.css` never loaded on dino + flappy** → `var(--border)` and `var(--btn-on-accent)` are undefined → borders don't render, button text falls back to low-contrast white-on-light-green.

5. **Webcam/vision lifecycle gaps** — cached rejected promise (#4), stream leak (#5), no `try/catch` in RAF detection loops (a throw silently kills detection), `audio.js` never resumes a suspended `AudioContext`, flappy has no mic-disconnect handler (dino has camera-disconnect).

6. **`visibilitychange` handling diverges per game, each variant buggy** — gesture-lock: global listener never removed; pantomime: adjusts pose timer but not hold timer (pose-lock shortcut); dino/flappy: correct per-phase pattern. Pick one pattern, share it.

7. **Stale docs** — README still uses defunct themed names ("Airlock Override", "Gravity Corridor"…) and lists removed games (Math No-Brain/Big-Brain, Cipher); SETUP claims a "reseed 10 empty teams" that doesn't exist; "12-player cap for individuals" is documented in 3 places but enforced nowhere (code allows 2–20 both modes).

8. **No DOM test environment** — `vitest.config.js` defaults to node, so every `document`/`window` module (game-gate, admin-gate, modal, perms, theme, topbar) is structurally untested — exactly where the mode-copy bugs live.

---

## ✅ What's genuinely good (wholesome section)

- **Pure-logic layer is excellent.** 366 passing tests; dino (89 tests), gesture-lock (54), quiz (25) thoroughly cover difficulty curves, calibration, clamps, scoring. Reviewers found *zero* real defects in the pure logic modules.
- **Ranking math is sound** — rank points are 0.5 multiples so float sums stay exact; tie-break (`a.id - b.id`) is stable; team IDs are numbers end-to-end (no key-coercion bugs).
- **Score submission** correctly clamps NaN/Infinity/negatives.
- **Secrets hygiene is correct** — real `firebase-config.js`, `dist/`, `node_modules/`, and the 60MB mediapipe binaries are all gitignored; the Firebase key never hit git history (and it's a public client key anyway).
- **Custom-game input** is grapheme-validated for emoji; lobby HTML is escaped on the catalog side.
- Flappy pipe geometry is correct — gaps always fit the orb, no tunneling at peak speed.

---

## ❌ False positives (discarded on verification — full disclosure)

1. **lobby-catalog**: "Player games grid is not mode-aware." → Refuted. The player grid renders game tiles, which carry no team/participant labels; nothing mode-dependent to show.
2. **tests**: "Mode helpers have *zero* coverage." → Refuted/downgraded. Some coverage exists; the accurate claim is that the *mode-aware copy paths* (not the helpers themselves) are thin — covered by the other tests findings.

---

## 🔧 Suggested fix priority

**Before any public/shared deploy:**
1. Security model (#1, #2) — Firebase rules + auth, stop trusting localStorage role, stop storing plaintext passwords.
2. Modal XSS (#3).

**Before the offsite (UX-breaking):**
3. Finish individuals-vs-teams wiring (theme #2) — route all "team" copy through `participantNoun()`; start there since it's the branch goal.
4. Vision lifecycle (#4, #5) — retry actually works, camera releases.
5. `theme.css` link on dino + flappy (theme #4).
6. `resetQuiz` state clear (#6).

**Cleanup / debt (post-event):**
7. Delete dead code (theme #3), unify `visibilitychange` (theme #6), fix stale docs (theme #7), add jsdom test env (theme #8).

---

*Full structured findings (all 114, with evidence quotes and verifier reasoning) are in the workflow transcript. Severities shown are post-verification where a verifier adjusted them.*
