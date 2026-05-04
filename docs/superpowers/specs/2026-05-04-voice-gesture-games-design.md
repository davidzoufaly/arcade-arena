# PS Offsite — Voice & Gesture Games Design

**Date:** 2026-05-04
**Status:** Approved (brainstorming)
**Audience:** Implementer (next: writing-plans skill)

## Goal

Two browser-based party games for a 10-station team-building offsite. Each station hosts one team of 5–6 players for 3–10 minutes. Both games feed scores (0–30 scale) into a shared cross-station leaderboard.

- **Game 1 — Voice Flappy: "Save the Customer"** — voice-controlled flappy-bird clone
- **Game 2 — Gesture Dino: "Wizard Quest"** — webcam-gesture-controlled chrome-dino clone

Both target laptop-only setup (built-in mic + cam). Co-op chaos: all 5–6 players input simultaneously.

## Story

- **Voice Flappy — "Save the Customer":** Customer's BI dashboard exploded. Insights scattered across data pipelines. Players fly insight orbs back home through corrupted ETL pipes by yelling.
- **Gesture Dino — "Wizard Quest":** Stale Data Storm sweeps the analytics desert. Players are the ETL Knight, sprinting toward the Live Dashboard Citadel, dodging bug-monsters via gestures.

## Architecture

Two standalone static-page games sharing a `shared/` utils folder. No backend. No bundler required for production.

```
ps-offsite/
├── flappy/
│   ├── index.html
│   ├── main.js
│   └── style.css
├── dino/
│   ├── index.html
│   ├── main.js
│   └── style.css
├── shared/
│   ├── neon.css         # theme tokens, glow, fonts
│   ├── audio.js         # mic init + amplitude / sustain analyzer
│   ├── vision.js        # MediaPipe Hands + Pose pipeline
│   ├── stages.js        # generic stage progression by score thresholds
│   ├── score-panel.js   # end screen, score display, verification code
│   ├── perms.js         # mic / cam permission flow
│   └── neon-fx.js       # canvas glow / trail helpers
├── docs/
├── package.json         # Vite for dev, optional
└── README.md
```

**Data flow per game:**

```
Sensor (mic / cam) → Detector module → Input event → Game state → Renderer (Canvas)
                                              ↓
                                       Score → localStorage + on-screen verification code
```

**Module boundaries:**

- `shared/audio.js` exposes `createAudioInput()` returning `{ amplitude(), sustainedFor(ms), stop() }`. Pure analyzer wrapper around Web Audio.
- `shared/vision.js` exposes `createHandTracker()` and `createPoseTracker()` returning `{ latest(), stop() }`. Pure async wrapper around MediaPipe Tasks.
- `shared/stages.js` exposes `createStageManager(thresholds, onChange)` — pure state machine over score deltas.
- `shared/score-panel.js` exposes `renderEndScreen({score, code})` and `generateCode(score)`.
- Game `main.js` wires modules, owns game-specific state, drives game loop.

**Why standalone pages, not a single SPA:** zero coupling between games, simpler debugging, simpler offline distribution (USB stick → open html).

**Why a shared folder rather than full duplication:** avoid copy-paste drift in audio / vision / stage logic that both games rely on.

**Deployment:** static files served via any static server (`python3 -m http.server`, `npx serve`, or copied to web root). `file://` blocks ES module imports — must serve.

## Game 1 — Voice Flappy: "Save the Customer"

### Mechanics

- Player = glowing orb (Insight) auto-scrolling right.
- Mic amplitude → vertical thrust. Loud lifts orb. Silence lets gravity drop it.
- Pipes (corrupted ETL) spawn from right, top + bottom, with a vertical gap. Pass through gap = +1 score.
- Hit pipe / floor / ceiling = death.

### Stages (auto-escalate by score)

| Stage | Score | Mechanic | Visual cue |
|---|---|---|---|
| 1 — Whisper | 0–4 | Any sound > threshold = flap. Wide gap, slow scroll. | "STAGE 1: WHISPER" banner |
| 2 — Loudness | 5–12 | Continuous: amplitude maps to thrust. Louder = faster up. Gap shrinks. | "STAGE 2: LOUDER" |
| 3 — Sustain | 13–22 | Hold loud > 1s for boost-flap to clear tall pipes. Brief silence drops. | Pipes with chain marks (long) |
| 4 — Chant | 23–30 | Continuous sustained group volume needed; silence = death corridor. | Closing-floor neon corridor |

### Scoring

- 1 pt per pipe passed.
- Cap at 30. Game continues past 30 (for bragging) but score frozen.
- Same scale as cross-station leaderboard (0–30).

### Crowd input handling

Mic captures combined sound. Amplitude is naturally a sum of all voices. Players self-organize: yell, chant, or split tactics.

### Failure / restart

- Death → 3s end screen: `"CUSTOMER RESCUED: N/30 · CODE 7B3K"` + "PRESS SPACE TO RESTART".
- Restart resets stage to 1 and regenerates code on next end screen.

### Visuals

- Background: scrolling neon grid floor (synthwave horizon) + binary-rain in distance.
- Orb: yellow filled circle + glow.
- Pipes: magenta filled rect + outer glow stroke.
- All Canvas, no sprites.

## Game 2 — Gesture Dino: "Wizard Quest"

### Mechanics

- Player = neon stick-knight (drawn shapes: glowing diamond head, line body, sword-trail), auto-running right.
- Webcam → MediaPipe Hands (S1–S2) / Pose (S3–S4) → jump / duck input.
- Obstacles spawn from right: low (jump over) and high (duck under).
- Survive 100m segment = +1 pt. Hit obstacle = death.

### Stages (auto-escalate by score)

| Stage | Score | Trigger | Detection | UX prompt |
|---|---|---|---|---|
| 1 — Finger | 0–7 | Index finger up = jump. Low obstacles only. | MediaPipe Hands: landmark 8 above 6. | "POINT FINGER UP TO JUMP" |
| 2 — Hand | 8–15 | Open palm up = jump. Closed fist low = duck. High obstacles appear. | Hands: palm openness + wrist Y. | "PALM = JUMP / FIST DOWN = DUCK" |
| 3 — Arm | 16–22 | Arm overhead = jump. Arm down/across = duck. Wider arc. | Hands wrist + elbow heuristic, or Pose keypoints. | "ARM OVERHEAD = JUMP" |
| 4 — Body | 23–30 | Real jump (shoulder Y delta) = jump. Squat (hips lower) = duck. ONE designated jumper steps back ~1.5 m, others lean aside. | MediaPipe Pose, full body, picks largest body in frame. | "JUMPER TO CENTER · CROUCH + JUMP" |

### Scoring

- 1 pt per 100 m segment cleared.
- Cap at 30 (= 3000 m). Same scale as leaderboard.

### Crowd input handling

- Stages 1–3: any visible hand triggers (multiple hands fine; first match wins per frame).
- Stage 4: pose detection picks largest body in frame. UX banner: "CLEAR FRAME — JUMPER STEP BACK".

### Calibration screen (5s pre-play)

- Show webcam feed with skeleton overlay.
- "Wave hand to confirm." Auto-advance on first detection.

### Failure / restart

- Death → "KNIGHT FALLEN AT N m · SCORE: N/30 · CODE 7B3K · PRESS SPACE TO RESTART".
- Restart resets stage to 1.

### Visuals

- Background: neon dunes, magenta sun, glitchy data spires.
- Knight: stroked polygon shapes + sword-trail.
- Low obstacles: jagged crawling glitches.
- High obstacles: floating error popups (rectangular shapes with `[ ! ]` glyph).
- All Canvas, no sprites.

## Visual Style — Neon Arcade

### Palette

- BG `#0a0a1a` deep blue-black
- Grid floor `#00ffff` cyan, 0.3 opacity
- Player primary `#ffff00` yellow + 16 px yellow glow
- Hazard `#ff00ff` magenta + glow
- Title text `#ff00ff`
- Score text `#00ffff`
- Brand accent `#ff5a3c` orange (for "Customer" / "Insight" highlights)

### Typography

- Titles: `'Press Start 2P'` (Google Fonts CDN), fallback `'Courier New'`. All caps. Letter-spacing.
- Score: `'Courier New'`, monospace, glow text-shadow.

### FX

- Glow: `ctx.shadowBlur` or double-stroke (blurred + sharp).
- Trails: redraw last frame at 0.85 alpha black overlay (motion-blur).
- Scanlines: full-screen `repeating-linear-gradient` overlay, 2% opacity.
- Death: 5-frame screen-shake.
- Stage transition: full-screen flash + banner slide-in.

### Sound (optional, ship if time)

- Synth chiptune bg loop (Tone.js generated, no asset).
- Bleep on score, low bleep on death.

No sprite images. All visuals = Canvas primitives + CSS. `shared/neon.css` defines tokens.

## Station UX

### Screen flow per game

1. **Title screen** — game name, story 1-liner, "PRESS SPACE TO START". Auto-loops attract mode after 30 s idle.
2. **Permissions** — browser prompts mic (flappy) or cam (dino). Denial → blocking modal with reload instructions.
3. **Calibration** (3–5 s) —
   - Flappy: "say something" detects baseline noise floor.
   - Dino: skeleton overlay, "wave to start". Auto-advances on first input.
4. **Gameplay** — HUD: score top-left (large), stage banner top-center, 4-dot stage tracker bottom-center.
5. **End screen** — `SCORE: N/30 · CUSTOMERS RESCUED · CODE 7B3K · PRESS SPACE TO PLAY AGAIN`.

### Score export

- Verification code = `hash(score + timestamp)` shortened to 4 alphanumeric chars.
- End screen shows `Score N · Code XXXX`.
- Organizer types both into central leaderboard. Code prevents fake scores.
- All runs auto-saved to `localStorage`; debug history at `?debug=1`.

### Team identity

Skipped in-game. Organizer manages team names centrally. Game shows score + code only.

### Hardware

- Laptop only. Built-in mic, built-in cam.
- Laptop on table, chest height (so cam sees standing crowd).
- One person operates SPACE for restart.

### Error / failure UX

- Mic / cam denial → blocking modal with reload instructions.
- Mic silent > 10 s mid-game → "CHECK MIC?" toast.
- Pose not detected > 5 s → "STAND BACK / CHECK LIGHT" toast.

## Tech Stack

### Runtime (browser, Chrome 110+)

- Vanilla JS (ES modules, no framework).
- Canvas 2D for drawing.
- Web Audio API: `AudioContext` → `MediaStreamSource` → `AnalyserNode` (FFT 2048, time-domain RMS for amplitude, smoothed via short moving average; sustain trigger fires when smoothed amplitude stays above threshold for ≥ 1 s).
- MediaPipe Tasks Vision (`@mediapipe/tasks-vision` via CDN):
  - `HandLandmarker` (S1–S3), 21 keypoints, GPU delegate
  - `PoseLandmarker` (S4), 33 keypoints, lite model
- WebRTC `getUserMedia({audio:true})` / `({video:true})`.

### Dev

- Vite (`npm create vite@latest`) — dev server only, hot reload.
- No transpile, no bundler for prod. Native ES modules.

### Production deps

- MediaPipe via CDN: `import { HandLandmarker } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.mjs"`. Cached after first load.
- Google Fonts via `<link>`. Self-host fallback recommended for offline event.

### Performance budget

- 60 FPS gameplay on M1 / 2018+ Intel laptop.
- MediaPipe Hands ~15 ms / frame CPU, < 5 ms GPU.
- MediaPipe Pose ~30 ms / frame CPU. Run detection at 30 fps, interpolate input to 60 fps via `requestAnimationFrame`.
- Pre-warm models on title screen with one dummy inference to avoid first-frame hitch.

### Offline readiness

- Bundle MediaPipe + fonts locally if venue wifi unreliable. Test before event.

### Browser support

- Chrome / Edge primary.
- Safari and Firefox should work; test mic constraints.
- README documents Chrome as recommended.

### Target file size

- Each game folder < 5 MB once models cached.
- First load ~10–20 MB (one-time).

## Testing

### Unit tests (Vitest, in `shared/`)

- `audio.js` — amplitude buckets / sustain detector against canned signal arrays.
- `stages.js` — score → stage transitions.
- `score-panel.js` — code generation determinism.
- Pure logic only. No DOM, no audio context.

### Integration / manual

- Per-stage smoke checklist in `README.md` with explicit pass criteria, e.g. "S2: maintain shout = orb climbs steadily; silence = drops within 1s".
- Crowd rehearsal with 5–6 real humans before event. Critical for Stage 4 framing.

### No e2e automation

Mic + cam simulation is not worth the cost for a one-day event.

## Delivery checklist (pre-event)

- [ ] Both games run from USB stick on target laptop
- [ ] MediaPipe models pre-cached (first run online, then offline)
- [ ] Camera FOV verified at station setup with 5–6 players
- [ ] Mic level tested with ambient venue noise
- [ ] Score code copy-test with organizer's leaderboard sheet
- [ ] Backup laptop / restart procedure documented

## Out of scope (YAGNI)

- Multiplayer over network
- Cloud leaderboard / backend
- Mobile / touch support
- Sound effects beyond minimal beeps (add later if time allows)
- Localization (English only)
- Team-name input in-game (organizer handles centrally)

## Risks

- **Pose detection in crowded frame (Stage 4)** — biggest unknown.
  - *Mitigation:* clear "step back" UX prompt, tested in rehearsal, fallback to Stage-3 hand-based detection if pose flaky.
- **Mic cross-talk between stations** — 10 stations, voices leak.
  - *Mitigation:* place flappy station far from loud stations, or use small lavalier USB mic if available.
- **Venue wifi missing or slow** — MediaPipe / fonts CDN unreachable.
  - *Mitigation:* bundle locally, test offline before event.

## Open questions (resolve in plan / implementation)

- Exact stage thresholds may need tuning after first crowd rehearsal.
- Mic baseline noise floor calibration: dynamic per-room or fixed?
- Whether to ship Tone.js-generated bg sound on day-one or defer.
