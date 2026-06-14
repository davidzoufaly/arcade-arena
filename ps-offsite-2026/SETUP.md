# Firebase setup (shared scoreboard)

The scoreboard persists state to **Firebase Realtime Database** so multiple laptops/teams can submit and the projector view updates live. Without config it refuses to load.

One-time setup, ~5 min.

## 1. Create a Firebase project

1. Open https://console.firebase.google.com and sign in.
2. **Add project** → name it `ps-offsite-2026` (or anything). Disable Google Analytics (not needed).
3. Wait for it to provision, click **Continue**.

## 2. Add a Web app

1. On the project overview, click the **`</>`** (web) icon to register a Web app.
2. Nickname: `scoreboard`. **Do not** check "Firebase Hosting". Click **Register**.
3. You'll see a `firebaseConfig = { ... }` snippet. **Keep this tab open**, you'll copy it in step 4.

## 3. Enable Realtime Database

1. Left sidebar → **Build → Realtime Database** → **Create Database**.
2. Location: pick closest region (e.g. `europe-west1` for EU offsites).
3. Security rules: choose **Start in test mode** (read/write open for 30 days).
4. After creation, click **Rules** tab and replace with:
   ```json
   {
     "rules": {
       ".read": true,
       ".write": true
     }
   }
   ```
   Click **Publish**. (Open access is acceptable for a one-day offsite where the URL is not public. Lock it down later if reused.)

## 4. Paste config into the repo

1. Copy `firebase-config.example.js` to `firebase-config.js` (in `ps-offsite-2026/`):
   ```bash
   cp ps-offsite-2026/firebase-config.example.js ps-offsite-2026/firebase-config.js
   ```
2. Paste the values from the Console snippet into the new file. `databaseURL` is the one ending in `.firebaseio.com` (or `.europe-west1.firebasedatabase.app`) — if missing from the snippet, copy it from the Realtime Database tab in the Console.

`firebase-config.js` is **gitignored**; never commit your real config.

## 5. Run / deploy

- Local: `npm run dev` then open http://localhost:5173/scoreboard.html
- CDN: build with `npm run build` (outputs to `dist/`) and drag-drop to Netlify / Vercel / Cloudflare Pages. The bundled `firebase-config.js` ships with it.

## Vision assets (camera games)

The camera games (gesture-lock, pantomime, dino) use the **mediapipe** runtime + ML models. These are self-hosted, not loaded from a CDN. The ~60MB of binaries live under `ps-offsite-2026/public/mediapipe/` and are **gitignored** — `scripts/fetch-vision-assets.mjs` copies the wasm from `node_modules` and downloads the `.task` models.

It runs automatically on `postinstall`, `predev`, and `prebuild`, so a fresh clone (and Netlify) gets them with no extra step. The runtime bundle is lazy-loaded only when a game starts. To re-fetch manually: `npm run vision:assets` (deletes nothing; skips files already present).

## Resetting state between events

The scoreboard's **Reset** button wipes the shared state for everyone. If you'd rather start a new event with a clean DB without touching anything else, in Firebase Console → Realtime Database → Data → click the root node `(null)` menu → **Delete** — the scoreboard will reseed 10 empty teams on next load.
