// ps-offsite-2026/shared/lobby.js
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_ID_RE = /^PS-[A-HJ-NP-Z2-9]{4}$/;

function pick(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function generateLobbyId() {
  return `PS-${pick(4)}`;
}

export function generatePwd(len = 6) {
  return pick(len);
}

export function isValidLobbyId(s) {
  return typeof s === 'string' && LOBBY_ID_RE.test(s);
}

export const SESSION_KEY = 'psOffsite2026.lobby';
export const LEGACY_TEAM_KEY = 'psOffsite2026.team';

// Drop stale key from the old (pre-lobby) version. Runs once per module load.
try {
  if (typeof localStorage !== 'undefined') localStorage.removeItem(LEGACY_TEAM_KEY);
} catch {}

export function getSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.lobbyId === 'string' &&
      Number.isInteger(parsed.teamId) &&
      typeof parsed.teamPwd === 'string'
    ) {
      return parsed;
    }
    localStorage.removeItem(SESSION_KEY);
    return null;
  } catch {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    return null;
  }
}

export function setSession(s) {
  try { localStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch {}
}

export function clearSession() {
  try { localStorage.removeItem(SESSION_KEY); } catch {}
}

const MAX_CREATE_RETRIES = 5;

export function createLobbyApi({ get, set }) {
  async function createLobby(teamCount) {
    if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > 20) {
      throw new Error('team count must be 2..20');
    }
    let lobbyId = null;
    for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
      const candidate = generateLobbyId();
      const existing = await get(`lobbies/${candidate}`);
      if (!existing) { lobbyId = candidate; break; }
    }
    if (!lobbyId) throw new Error('lobby id collision after 5 attempts');

    const adminPwd = generatePwd(6);
    const teams = [];
    const teamsObj = {};
    for (let i = 1; i <= teamCount; i++) {
      const pwd = generatePwd(6);
      teams.push({ id: i, name: `Team ${i}`, pwd });
      teamsObj[i] = { id: i, name: `Team ${i}`, pwd };
    }
    await set(`lobbies/${lobbyId}`, {
      meta: { createdAt: Date.now(), teamCount, adminPwd },
      teams: teamsObj,
    });
    return { lobbyId, adminPwd, teams };
  }

  return { createLobby };
}
