import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, get } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { createLobbyApi, ADMIN_PWD_PREFIX } from './lobby.js';
import { openModal } from './modal.js';

// The verified admin password is cached in sessionStorage (per lobby, this tab
// only) so the host isn't re-prompted on every navigation/reload. We cache the
// PLAINTEXT password, never its hash: the salted hash is world-readable in the
// DB, so a cached hash could be forged — whereas a cached plaintext still has to
// survive verification against that hash. sessionStorage clears on tab close,
// and clearSession() (Leave) wipes it immediately.
const ssKey = id => `${ADMIN_PWD_PREFIX}${id}`;
const readCachedPwd  = id => { try { return sessionStorage.getItem(ssKey(id)) || ''; } catch { return ''; } };
const writeCachedPwd = (id, pwd) => { try { sessionStorage.setItem(ssKey(id), pwd); } catch {} };
const clearCachedPwd = id => { try { sessionStorage.removeItem(ssKey(id)); } catch {} };

const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// Password prompt rendered with the shared modal (shared/modal.js + modal.css)
// instead of the native prompt()/alert(). Resolves to the entered string, or
// null if the host cancels (Cancel button, Esc, or backdrop click).
function askAdminPassword({ promptHtml, error }) {
  return new Promise(resolve => {
    let submitted = false;
    const body = `
      ${error ? `<p class="modal-error">${esc(error)}</p>` : ''}
      <p>${promptHtml}</p>
      <input id="cfgInput" type="password" autocomplete="off" autocapitalize="characters">`;
    const dialog = openModal({
      title: 'Admin access',
      bodyHtml: body,
      confirmLabel: 'Enter',
      onConfirm: () => { submitted = true; resolve(dialog.querySelector('#cfgInput').value); },
    });
    // Enter in the field confirms (native <dialog> has no implicit submit here).
    dialog.querySelector('#cfgInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); dialog.querySelector('#modalConfirm').click(); }
    });
    dialog.addEventListener('close', () => { if (!submitted) resolve(null); }, { once: true });
  });
}

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

  // Silent path: re-verify a password cached this tab session so the host skips
  // the prompt on navigation/reload. Re-checked against the DB hash every time,
  // so a forged cache value still can't unlock admin.
  const cached = readCachedPwd(lobbyId);
  if (cached) {
    if (await api.verifyAdminPwd(lobbyId, cached)) {
      verifiedLobbies.add(lobbyId);
      return true;
    }
    clearCachedPwd(lobbyId);                      // stale (e.g. lobby recreated)
  }

  const promptHtml = esc(promptText || `Admin password for lobby ${lobbyId}:`);
  let error = '';
  for (;;) {
    const entered = await askAdminPassword({ promptHtml, error });
    if (entered == null) return false;            // cancelled
    const pwd = entered.trim().toUpperCase();
    if (!pwd) { error = 'Enter a password.'; continue; }
    if (await api.verifyAdminPwd(lobbyId, pwd)) {
      verifiedLobbies.add(lobbyId);
      writeCachedPwd(lobbyId, pwd);               // remember for this tab session
      return true;
    }
    error = 'Wrong admin password.';             // re-prompt with inline error
  }
}
