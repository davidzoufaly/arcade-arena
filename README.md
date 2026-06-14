# Arcade Arena

A mission-based competition for company offsites, running entirely in the browser. Camera missions, one voice mission, a few live in-room challenges, and a hosted pub quiz. A lobby can run in two modes: **teams**, or **individuals** (each player competes solo). Built for roughly 10 teams, but the count is configurable from 2 to 20. Scores stream live through Firebase to a shared scoreboard, so the projector shows a result the moment a team (or player) finishes.

The app lives under [`ps-offsite-2026/`](ps-offsite-2026/). There's a small build step (Vite) and a one-time Firebase setup — see [ps-offsite-2026/SETUP.md](ps-offsite-2026/SETUP.md).

---

## Missions

### Played in the browser (on the team's laptop)

| Mission | Input | What the team does | Technology |
|---|---|---|---|
| Airlock Override [Gesture Lock] | camera (hands) | First a 20s calibration: everyone raises one hand and the mission counts the team size. Then a random sequence flashes once (4 gestures per person, with repeats from six: open palm, fist, thumbs up, thumbs down, victory, index up). The team repeats it from memory. One wrong gesture fails the attempt; 10 seconds per gesture. 5 attempts, best one counts. | MediaPipe Gesture Recognizer |
| Human Mimic Checkpoint [Pantomime] | camera (full body) | Hit 8 progressively harder poses: 2 easy, 3 medium, 3 hard (no duo poses, you pose solo). Get every geometric check above 85%, then hold still for the required time (1.2 / 1.5 / 2 s by difficulty). Wobbling resets the hold. Points are half form, half how fast you lock in — a green line traces the camera border as the hold runs. 25 s per pose, players take turns (one poses, the rest direct), 2 attempts, best one counts. | MediaPipe Pose Landmarker (heavy) |
| Gravity Corridor [Dino Dash] | camera (hands) | A runner runs and the team controls it with open palms. Palms are counted, not fingers, so more open palms = higher jump. A fist ducks, victory keeps it steady. Only **2–3 players** are active per wave and the team rotates who plays: a 20s calibration counts raised hands and scales jump strength, then a ~20s wave of obstacles runs, then a 10s break to swap players. Endless, speeds up over time. 5 attempts, best one counts. | MediaPipe Hand Landmarker |
| Sonic Stabilizer [Flappy Voice] | microphone | The whole team shouts into the mic and lifts an object between gaps, louder = higher. Endless, speeds up. Score is the number of gates passed. 5 attempts, best one counts. | Web Audio (loudness from mic, no ML model) |

The four browser missions score 0 to 100 and write it to the shared scoreboard the moment the team joins a lobby.

### Host-scored challenges

A few challenges are played off-screen and the host enters the points: Analog Blackout [Math No-Brain], Systems Recalibration [Math Big-Brain], Transmission Decoder [Cipher], Oracle Breach [Gandalf], and Alien Glyph Activation [Draw & Guess]. Plus a live Pub Quiz. The host enters these points in scoreboard.html and grades the quiz in quiz-admin.html.

---

## Format

### Self-paced

Teams move between missions freely. Many teams can play at once; each laptop has its own mission page joined to the shared lobby and scores stream live to the scoreboard.

- Length: 30 to 45 minutes total.
- Scoreboard: a projector or big TV with scoreboard.html, plus the host's laptop at the bar or entrance.
- Backend: Firebase Realtime Database (see [ps-offsite-2026/SETUP.md](ps-offsite-2026/SETUP.md)).

### Lobby and scoring

There are no manual "submit codes" — scores flow through the lobby:

1. The host opens index.html, hits Create lobby, picks the mode (**Teams** by default, or **Individuals**) and enters the participant count (default 10, range 2 to 20). They get a lobby ID (e.g. PS-7Q2K), an admin password, and a password for each team / player.
2. A team (or player) opens the join link or index.html, enters the lobby ID, selects themselves, and confirms with the password. Then they land on games.html.
3. The four browser missions write scores 0 to 100 themselves. The host enters points for host-scored challenges and grades the pub quiz in scoreboard.html and quiz-admin.html.
4. scoreboard.html on the projector shows the ranking live.

### Mode: teams vs. individuals

The mode is chosen when creating the lobby and changes both what participants are called and how the camera missions play:

- **Teams** — multiple people per team; the scoreboard shows columns "Team 1, Team 2…". Missions assume multiple players: Dino calibrates the hand count and rotates 2–3 active players, Pantomime rotates posers.
- **Individuals** — each person competes solo; the scoreboard shows "Player 1, Player 2…". Missions are simplified: Dino skips hand calibration and swap breaks and uses one fixed jump strength (and a harder difficulty curve), Pantomime skips player rotation. The cap is 12 players.

A participant (team or individual) can rename themselves by clicking their name in the topbar.

---

## Host panel

The host runs the event from three admin pages, all requiring the admin password: **scoreboard.html** (scores + ranking), **games.html** (mission management), and **quiz-admin.html** (pub quiz). The topbar gives the admin Games / Scoreboard / Quiz links.

### Scoreboard (scoreboard.html)

Outside edit mode it's a live ranking. The **Edit** button switches to edit mode (**Save** / **Cancel** / **Reset**); changes are buffered and only written with **Save**, **Cancel** discards them. In edit mode the host:

- **Enters points** for host-scored challenges — click a team's cell, whole number from 0. The four browser missions write their own scores; the host doesn't touch those.
- **Renames teams / players** — inline name fields (max 24 chars).

Columns and ranking **follow the added missions** — only missions enabled in games.html show up, removed ones drop out. A mission's column header carries a **read-only lock indicator** (🔒 / 🔓); the actual locking is done in games.html. Outside edit mode there's a **Celebrate winner** button — a popover with the winner and full-screen confetti.

### Mission management (games.html, admin)

The admin view of games.html is the mission control panel for the lobby:

- **Add / remove missions** — 👁 / 🚫 enables or hides a mission in the team lobby. The scoreboard and topbar only count added missions.
- **🔒 / 🔓 Lock** — locks/unlocks a mission. A locked mission is greyed out in games.html; on entry the team sees "Mission locked".
- **📋 Rules** — the rules text the team sees on the mission. Empty = default text from the catalog.
- **⏱ Time limit** — a limit in minutes for host-scored and custom missions (empty/0 = no limit). The team sees it in games.html and gets a warning before entering.
- **⋯ Per-team** — expands sub-rows to set lock / limit / rules for a single team separately.
- **Custom missions** — create a new mission (name max 40 chars, emoji, rules, optional limit). Each gets a `CUSTOMxxxx` key and a 🗑 delete button.

Lock precedence: per-team > mission > default (locked).

### Reset

**Reset** on the scoreboard (red, with confirmation) wipes all scores and lobby history. Participants stay, but the action is irreversible and affects everyone in the lobby.

### Tips for the camera games (environment)

The camera games live and die by how well the model can see the player. Before starting one, check the background and lighting:

- **Pantomime** (pose recognition) — needs **contrast of the whole body against the background**. Place the laptop so there's a clean, uniform surface (a wall) behind the player — not a crowd, a backlit window, or a busy scene. The player should wear a color distinct from the wall and fit fully in frame (head to ankles).
- **Gesture Lock** (hand recognition) — needs **contrast of the hand against the background**. The player should get close to the camera, hold the hand in front of a uniform background (not in front of their own face or patterned clothing), and in good light. Backlight from a window behind the player ruins hand detection.

In general: more light from the front, calm single-color background, no backlight.

---

## Pub Quiz setup

The host runs the Pub Quiz. The app holds neither questions nor correct answers, only category names, how many questions each has, and which are bonus. The host reads questions aloud and grades answers manually.

A new lobby starts with 4 categories of 8 questions each (Category 1 to 4). The host builds the quiz in quiz-admin.html, requires the admin password:

1. **Editing categories.** Rename, add (+ Add category) or remove categories, change the question count (− / +), and mark any question as bonus with the Q1 to Qn toggles. Edits are buffered, published only with Save.
2. **Flow.** The host reads questions aloud. In quiz.html the team writes one answer for a question in the current category and submits it. That locks the category (answers can no longer change) and reveals the next. Always just one category, no going back.
3. **Grading.** When teams are done, the host toggles ✓ or ✗ for each answer in the Grading panel, a second one for bonus, and submits each category.

Scoring: +1 for each correct question and +1 extra when the bonus is also correct. The total goes into the team's row on the scoreboard.

---

## AI models

The camera missions run on MediaPipe: Gesture Recognizer (Airlock Override), Pose Landmarker heavy (Human Mimic Checkpoint), and Hand Landmarker (Gravity Corridor). The runtime and models are **self-hosted**, not from a CDN — `@mediapipe/tasks-vision` comes from npm, and the wasm + `.task` models (~60 MB) live under `ps-offsite-2026/public/mediapipe/` (gitignored, fetched by `scripts/fetch-vision-assets.mjs` on postinstall/predev/prebuild). The runtime is lazy-loaded only when a mission starts. Details in [ps-offsite-2026/SETUP.md](ps-offsite-2026/SETUP.md). Sonic Stabilizer needs no model; it reads loudness from the mic via Web Audio.

### What a team's laptop needs

- Any laptop from roughly the last 5 years. Integrated graphics are enough, no dedicated GPU needed.
- A current Chrome, Edge, Safari, or Firefox.
- At least 4 GB RAM.
- A built-in or USB camera (camera missions) and a working mic (Sonic Stabilizer).
- Internet only for the first load of each mission. After that the model is cached and the mission runs even without wifi.

Airlock Override and Gravity Corridor run smoothly on integrated graphics. Human Mimic Checkpoint uses the heavy pose model, so expect noticeably lower FPS there. It's enough to hold poses, but it's the heaviest mission. Memory per browser tab comes to 200 to 400 MB, more for the heavy model.
