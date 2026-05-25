# PS Offsite 2026 — Computer Vision Game

A two-station computer-vision team game for **10 teams × 4 people**. Pure browser, no installs, no Python, no backend. Each station is a self-contained HTML page accessed via a QR code; scores are entered manually into a central scoreboard.

---

## Stations

| # | Station | What the team does | Tech | Time |
|---|---|---|---|---|
| 1 | **Gesture Lock** | Unlock the vault with a 6-gesture random sequence drawn from a pool of 7 (open palm, fist, thumbs up/down, victory, point, ASL "I love you"). 35 s hard limit, every wrong gesture resets the sequence. | MediaPipe Hand Gesture Recognizer | 5–8 min |
| 2 | **CV Pantomime** | Match 12 escalating poses (T-pose → Tree → Karate Kick → Arabesque) to a ghost skeleton overlay. Each pose has multiple geometric checks. Stability check — wobbling resets the hold. Tight per-pose timeouts. | MediaPipe Pose Landmarker | 12–15 min |

Both stations award **0–100 points** and emit a 6-character "submit code" (e.g. `GZ-7-85`) that the team takes to the central scoreboard.

---

## Where are the AI models?

**They are not in this repository.** This is intentional — both models are loaded from public CDNs at runtime. The repo only contains the HTML / JavaScript that wires them up.

Two CDN providers do the heavy lifting:

1. **jsDelivr** delivers the MediaPipe runtime library (`@mediapipe/tasks-vision`) — this is the JavaScript bridge to WebAssembly.
2. **Google Cloud Storage** (`storage.googleapis.com/mediapipe-models/...`) delivers the actual neural-network weights — `.task` files that the MediaPipe runtime loads.

Exact URLs used:

| Asset | URL |
|---|---|
| MediaPipe runtime (vision_bundle.mjs) | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs` |
| MediaPipe WASM | `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm` |
| Hand Gesture Recognizer model | `https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task` (~8 MB) |
| Pose Landmarker (lite) model | `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task` (~6 MB) |

**Why CDN instead of bundling the model files?**

- Model weights (~14 MB total) would bloat the repo every time Google ships a fresh version.
- The browser caches them after the first load — opening any station a second time skips the download.
- Google's CDN is faster and more reliable than GitHub Pages or Netlify Drop for binary blobs.

**If you want a fully offline / self-hosted version**, download the two `.task` files and the `vision_bundle.mjs` + `wasm/` directory from the URLs above into the repo (e.g. into a `vendor/` folder), then change the import URLs in `stations/1-gesture-lock.html` and `stations/2-pantomime.html` accordingly. The whole bundle weighs ~16 MB.

### Hardware requirements per team laptop

- Any laptop made in the last ~5 years. **Integrated graphics are fine** — no dedicated GPU needed.
- Browser: **Chrome / Edge / Safari / Firefox**, current version.
- 4 GB RAM minimum.
- Built-in or USB webcam.
- Stable internet only for the **first** load (~15 MB total per laptop). After that, the models are cached and stations work even if WiFi dies.

Real-world frame rate on a typical 2020+ ThinkPad / MacBook Air with integrated GPU: gestures ~30 fps, pose ~25–30 fps. Memory per browser tab: ~200–400 MB.

---

## Format

### Self-paced

Teams move freely between the two stations. After each one they get a "submit code" they take to the central scoreboard.

- **Duration:** 30–45 min total
- **Stations:** 2, one instance each
- **Capacity:** 1 team at a time
- **Scoreboard:** projector / large TV + laptop near the bar / entrance

### Submit codes

After each station the team sees a 6-character code on the screen, e.g. `GZ-7-85`:

- **GZ** = station (GZ Gesture Lock, PM Pantomime)
- **7** = team number (1–10)
- **85** = score 0–100

Team brings the code to the scoreboard, organizer types it in, scoreboard parses and updates the leaderboard.

---

## Running locally

Stations need camera access, which Chrome blocks on `file://`. Run a local server:

```bash
git clone git@github.com:janpansky/ps-offsite-2026.git
cd ps-offsite-2026
python3 -m http.server 8765 --bind 127.0.0.1
```

Then open **http://localhost:8765/index.html**.

For mobile / tablet testing on the same WiFi, deploy to **Netlify Drop** (drag & drop the folder onto netlify.com/drop) — `getUserMedia` requires HTTPS for non-localhost URLs. **GitHub Pages** also works (Settings → Pages → branch `main`, root) and gives you `https://janpansky.github.io/ps-offsite-2026/` for free.

---

## Files

```
ps-offsite-2026/
├── README.md                       ← you are here
├── index.html                      ← navigation hub + QR generator
├── scoreboard.html                 ← central scoreboard for the host laptop
└── stations/
    ├── 1-gesture-lock.html
    └── 2-pantomime.html
```

Open `index.html` for navigation. Open `scoreboard.html` on the host laptop. Stations open via QR codes on team laptops.

---

## License

MIT. Built for an internal off-site, but feel free to fork and adapt.
