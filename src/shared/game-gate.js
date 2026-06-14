// src/shared/game-gate.js
// Firebase glue around game-lock.js: read the lock node for one (game, team)
// and render a full-page "locked" screen. Caller injects ref/get/db so this
// stays dependency-light and matches the per-page Firebase setup.
import { resolveLock, LOCKED } from './game-lock.js';

// Returns true if the game is locked for this participant.
// Fail-CLOSED on read error: if we cannot read the lock state we treat the game
// as locked, so a forced/transient read failure can't be used to bypass a lock
// the host set. (When there is no lobby context at all we return false — there
// is no host and nothing to lock.)
export async function isGameLockedFor({ db, ref, get, lobbyId, teamId, gameKey }) {
  if (!lobbyId) return false;
  try {
    const snap = await get(ref(db, `lobbies/${lobbyId}/locks`));
    const locks = snap.exists() ? snap.val() : null;
    return resolveLock(locks, gameKey, teamId) === LOCKED;
  } catch (e) {
    console.error('lock check failed — failing closed (locked)', e);
    return true;
  }
}

export function renderLockedScreen(catalogHref) {
  document.body.innerHTML = `
    <div style="max-width:560px;margin:80px auto;padding:32px;background:var(--card);border-radius:16px;border:1px solid var(--border,rgba(255,255,255,0.1));color:var(--text);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;line-height:1.6;text-align:center">
      <div style="font-size: 48px;margin-bottom:12px">🔒</div>
      <h1 style="font-size: 24px;margin-bottom:12px">Game locked</h1>
      <p style="color:var(--muted);margin-bottom:20px">This game isn't open right now. The host decides when it unlocks — check the games list.</p>
      <a href="${catalogHref}" style="color:var(--accent);font-weight:700;text-decoration:none">← Back to games</a>
    </div>`;
}
