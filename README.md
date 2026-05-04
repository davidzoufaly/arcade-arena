# PS Offsite Voice & Gesture Games

Two browser-based party games for the offsite. Voice-controlled flappy ("Save the Customer") + gesture-controlled dino ("Wizard Quest"). Co-op for 5-6 players around one laptop. Scores 0-30 each, fed into the cross-station leaderboard.

See [design spec](docs/superpowers/specs/2026-05-04-voice-gesture-games-design.md).

## Run

    npm install
    npm run dev

Open `http://localhost:5173/flappy/` or `http://localhost:5173/dino/`.

For production: serve the repo root with any static server. No build step needed.

    python3 -m http.server 5173
    # or
    npx serve

Each game is reachable at `<host>/flappy/` and `<host>/dino/`.

## Run tests

    npm test

## Per-game manual smoke test

### Flappy ("Save the Customer")

- [ ] SPACE on title → mic prompt → calibration banner "SAY SOMETHING"
- [ ] First sound → game starts, orb falls under gravity
- [ ] Yelling lifts orb (S1: discrete impulse)
- [ ] Pass 5 pipes → "STAGE 2: LOUDER", gap shrinks, continuous control
- [ ] Pass to score 13 → "STAGE 3: SUSTAIN", sustained loudness boosts
- [ ] Pass to score 23 → "STAGE 4: CHANT", silence punishes
- [ ] Crash → end overlay shows score + 4-char code
- [ ] SPACE on end screen → restart back to S1
- [ ] 10s silence mid-game → "CHECK MIC?" toast

### Dino ("Wizard Quest")

- [ ] SPACE on title → cam prompt → cam preview top-right
- [ ] "WAVE A HAND" calibration banner → wave → game starts
- [ ] S1: raise fingers → knight jumps; more fingers = higher jump (1 finger small hop, palm open = big jump, two palms = max jump)
- [ ] Score 8 → "STAGE 2: HAND", palm = jump, fist = duck, high obstacles
- [ ] Score 16 → "STAGE 3: ARM", arm overhead = jump
- [ ] Score 23 → "STAGE 4: BODY", "JUMPER TO CENTER" banner; jumper steps back, real jump/squat works
- [ ] Crash → end overlay with meters + code
- [ ] SPACE → restart to S1
- [ ] At S4, no body in frame → "STAND BACK / CHECK LIGHT" toast

## Crowd rehearsal (do this before the offsite)

- 5-6 players around laptop. Run flappy through all 4 stages. Run dino through all 4 stages. Note which stages need tuning. Adjust thresholds in `flappy/main.js` (`STAGE_CFG`) and `dino/main.js` (`STAGE_CFG`).

## Delivery checklist (pre-event)

- [ ] Both games run from USB stick on target laptop (`python3 -m http.server` from repo root)
- [ ] MediaPipe models pre-cached: load each game once with internet, then test offline
- [ ] Camera FOV verified at station setup with 5–6 players
- [ ] Mic level tested with ambient venue noise
- [ ] Score-code copy-test with organizer's leaderboard sheet
- [ ] Backup laptop / restart procedure documented

## Architecture

See `docs/superpowers/specs/2026-05-04-voice-gesture-games-design.md`. Each game is a standalone static page; both share `shared/` utilities.

## Tech

Vanilla JS + Canvas 2D + Web Audio + MediaPipe Tasks Vision. No framework, no bundler in production. Vite + Vitest for dev only.
