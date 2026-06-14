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
3. Security rules: choose **Start in locked mode** (we replace the rules next).
4. After creation, click **Rules** tab and replace with:
   ```json
   {
     "rules": {
       ".read": false,
       ".write": false,
       "lobbies": {
         "$lobbyId": {
           ".read": true,
           ".write": true,
           "scores": {
             "$teamId": {
               "$gameKey": {
                 ".validate": "newData.isNumber() && newData.val() >= 0"
               }
             }
           }
         }
       }
     }
   }
   ```
   Click **Publish**. See **Security model** below for what these rules do and don't protect.

## 4. Paste config into the repo

1. Copy `firebase-config.example.js` to `firebase-config.js` (in `ps-offsite-2026/`):
   ```bash
   cp ps-offsite-2026/firebase-config.example.js ps-offsite-2026/firebase-config.js
   ```
2. Paste the values from the Console snippet into the new file. `databaseURL` is the one ending in `.firebaseio.com` (or `.europe-west1.firebasedatabase.app`) — if missing from the snippet, copy it from the Realtime Database tab in the Console.

`firebase-config.js` is **gitignored**; never commit your real config. (The Firebase Web `apiKey` is a public client identifier, not a secret — but keeping the file out of git avoids confusion.)

Admin and participant passwords are **never written to the database in plaintext** — only a salted SHA-256 hash is stored (`shared/lobby.js`), and the password itself is shown once to the host on the create screen.

## 5. Run / deploy

- Local: `npm run dev` then open http://localhost:5173/scoreboard.html
- CDN: build with `npm run build` (outputs to `dist/`) and drag-drop to Netlify / Vercel / Cloudflare Pages. The bundled `firebase-config.js` ships with it.

## Vision assets (camera games)

The camera games (gesture-lock, pantomime, dino) use the **mediapipe** runtime + ML models. These are self-hosted, not loaded from a CDN. The ~60MB of binaries live under `ps-offsite-2026/public/mediapipe/` and are **gitignored** — `scripts/fetch-vision-assets.mjs` copies the wasm from `node_modules` and downloads the `.task` models.

It runs automatically on `postinstall`, `predev`, and `prebuild`, so a fresh clone (and Netlify) gets them with no extra step. The runtime bundle is lazy-loaded only when a game starts. To re-fetch manually: `npm run vision:assets` (deletes nothing; skips files already present).

## Resetting state between events

The scoreboard's **Reset** button (admin) wipes scores + history for the current lobby. To start completely fresh, just **create a new lobby** from `index.html` — it seeds the participants and a new lobby id, leaving old lobbies orphaned.

> Deleting the database root in the Firebase Console does **not** reseed anything — there is no auto-seed code. Lobbies only exist after a host creates them. Deleting the root simply orphans every existing lobby id.

## Security model

This is a **disposable, single-event** setup, not a hardened multi-tenant app. Be clear-eyed about what the rules above do:

- **What they protect:** the database root is not readable or writable (no enumerating or wiping all lobbies at once); writes are confined to a `lobbies/{id}` subtree; and `scores` must be non-negative numbers (blocks junk/score-injection via direct REST writes). Passwords are stored only as salted hashes, so a DB read does not hand out plaintext passwords.
- **What they do NOT protect:** there is **no server-side authentication** (by design — this is a static site with no backend). Anyone who knows a lobby id can still read that lobby and write valid-shaped data to it. Admin/participant gating happens in the browser: the app verifies the password against the stored hash and only then unlocks admin actions, but a determined attacker with the lobby id and DB access could bypass the UI. The 4-character lobby id (~1M combinations) is **not** a secret, and the hashed passwords (a word + 3 digits) are brute-forceable offline by anyone with read access.

For a one-day offsite where the lobby id is shared only with attendees, this is an acceptable trade-off. **Do not** reuse this database for anything sensitive. If you ever need real protection, add Firebase Authentication (even anonymous + a custom claim minted by a Cloud Function after a password check) and rewrite the rules to gate writes on `auth`.
