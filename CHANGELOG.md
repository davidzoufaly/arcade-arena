# Changelog

## 2026-06-14

### New

- A lobby has two modes: teams, or individuals. Chosen at creation.
- In individuals mode each person plays solo. The cap is 12 players.
- A new admin page, games.html, manages the missions for the whole lobby.
- The host adds and removes missions. Hidden missions don't show in the lobby.
- The host locks and unlocks missions. Globally or for one team.
- The host sets time limits and rules per mission. Globally or per-team.
- The host creates custom missions. Name, emoji, rules, optional limit.
- Teams and players rename themselves by clicking their name in the topbar.
- The host renames teams from the scoreboard in edit mode.
- The scoreboard has a Celebrate winner button. Popover with the winner and confetti.

### Changed

- The scoreboard shows only added missions. Columns, ranking, and counters.
- Locking, limits, and rules moved from the scoreboard to games.html.
- The scoreboard shows mission lock state but doesn't edit it.
- The topbar gives the admin Games / Scoreboard / Quiz links.
- The topbar counts points from added missions only.
- The portal was rebranded to the generic Arcade Arena.
- Removed the Hidden Document challenge from the catalog.

### Missions

- Pantomime dropped duo poses. 8 solo poses remain: 2 easy, 3 medium, 3 hard.
- Pantomime added a green hold indicator around the camera border.
- Dino runs in waves. ~20s of play, then a 10s break to swap players.
- Dino has only 2–3 active players per wave. Only they calibrate.

### Technical

- The MediaPipe runtime and models are self-hosted, not from a CDN.
- Models are fetched by scripts/fetch-vision-assets.mjs on install / dev / build.
- The runtime is lazy-loaded only when a mission starts. It doesn't delay page load.

## Baseline (before 2026-06-14)

### Browser missions

- Airlock Override (Gesture Lock). Camera reads hands. The team repeats a gesture sequence from memory.
- Human Mimic Checkpoint (Pantomime). Camera reads the body. The team hits poses.
- Gravity Corridor (Dino Dash). Camera reads hands. The team jumps with a runner.
- Sonic Stabilizer (Flappy Voice). Microphone. The team lifts an object by shouting.
- Each mission scores 0 to 100. It writes itself to the scoreboard.

### Host-scored challenges

- Math No-Brain, Math Big-Brain, Cipher, Gandalf, Draw & Guess.
- Played off-screen. The host enters the points.

### Lobby and scoring

- The host creates a lobby. Enters the team count (2 to 20).
- They get a lobby ID, an admin password, and a password per team.
- A team joins via the ID and team password.
- Scores stream live through Firebase to a shared scoreboard.
- No manual submit codes. Everything goes through the lobby.

### Host panel

- scoreboard.html shows the ranking live. Good for a projector.
- The host enters points for host-scored challenges.
- Reset wipes all scores and lobby history.

### Pub Quiz

- The host runs the quiz in quiz-admin.html.
- The app holds only categories, question counts, and bonuses. Not questions and answers.
- The host reads questions aloud. Teams type answers in quiz.html.
- One category at a time. No going back.
- The host grades ✓ / ✗. +1 for correct, +1 for bonus.

### Technical

- Entirely in the browser. Built with Vite.
- One-time Firebase setup. See ps-offsite-2026/SETUP.md.
- A regular laptop from the last ~5 years and a current browser are enough.
