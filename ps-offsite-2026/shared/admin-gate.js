import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { createLobbyApi } from './lobby.js';

let cachedApi = null;
function getApi() {
  if (cachedApi) return cachedApi;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const db = getDatabase(app);
  cachedApi = createLobbyApi({
    get: async (path) => {
      const snap = await get(ref(db, path));
      return snap.exists() ? snap.val() : null;
    },
    set: async () => {},
  });
  return cachedApi;
}

// Lobbies whose admin password has been verified during THIS page load. This is
// an in-memory cache only — it is intentionally not persisted, so it cannot be
// forged from devtools the way a localStorage role flag can. It is cleared by a
// page reload/navigation.
const verifiedLobbies = new Set();

// Gate a privileged admin action. We do NOT trust the stored `role:'admin'`
// session flag here — it is user-writable localStorage and reveals UI only.
// Instead we verify the admin password against its salted hash in the DB, then
// remember success in-memory for the rest of this page load so the host isn't
// re-prompted on every click. Forging the localStorage role no longer unlocks
// admin writes; an attacker needs the actual password.
export async function requireAdmin(lobbyId, { promptText } = {}) {
  if (!lobbyId) return false;
  if (verifiedLobbies.has(lobbyId)) return true;
  const api = getApi();
  const entered = prompt(promptText || `Admin password for lobby ${lobbyId}:`);
  if (!entered) return false;
  const pwd = entered.trim().toUpperCase();
  const ok = await api.verifyAdminPwd(lobbyId, pwd);
  if (!ok) { alert('Wrong admin password.'); return false; }
  verifiedLobbies.add(lobbyId);
  return true;
}
