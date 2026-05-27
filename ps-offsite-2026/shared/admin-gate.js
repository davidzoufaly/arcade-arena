import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { createLobbyApi, getSession, isAdminSession } from './lobby.js';

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

export async function requireAdmin(lobbyId, { promptText } = {}) {
  if (!lobbyId) return false;
  const session = getSession();
  if (isAdminSession(session) && session.lobbyId === lobbyId) return true;
  // No caching: prompt on every restart so the admin password is never
  // persisted on a team's device, where it could be read and reused.
  const api = getApi();
  const entered = prompt(promptText || `Admin password for lobby ${lobbyId}:`);
  if (!entered) return false;
  const pwd = entered.trim().toUpperCase();
  const ok = await api.verifyAdminPwd(lobbyId, pwd);
  if (!ok) { alert('Wrong admin password.'); return false; }
  return true;
}
