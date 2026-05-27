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
    if (parsed && typeof parsed.lobbyId === 'string') {
      if (parsed.role === 'admin' && typeof parsed.adminPwd === 'string') {
        return parsed;
      }
      if (Number.isInteger(parsed.teamId) && typeof parsed.teamPwd === 'string') {
        return parsed;
      }
    }
    localStorage.removeItem(SESSION_KEY);
    return null;
  } catch {
    try { localStorage.removeItem(SESSION_KEY); } catch {}
    return null;
  }
}

export function isAdminSession(s) {
  return !!s && s.role === 'admin';
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
    if (!lobbyId) throw new Error(`lobby id collision after ${MAX_CREATE_RETRIES} attempts`);

    const adminPwd = generatePwd();
    const teams = Array.from({ length: teamCount }, (_, i) => ({
      id: i + 1,
      name: `Team ${i + 1}`,
      pwd: generatePwd(),
    }));
    const teamsObj = Object.fromEntries(teams.map(t => [t.id, t]));
    await set(`lobbies/${lobbyId}`, {
      meta: { createdAt: Date.now(), teamCount, adminPwd },
      teams: teamsObj,
    });
    return { lobbyId, adminPwd, teams };
  }

  async function loadLobbyTeams(lobbyId) {
    const teamsObj = await get(`lobbies/${lobbyId}/teams`);
    if (!teamsObj) {
      const err = new Error('lobby not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    return Object.values(teamsObj)
      .filter(Boolean)
      .map(t => ({ id: t.id, name: t.name }))
      .sort((a, b) => a.id - b.id);
  }

  async function verifyTeamPwd(lobbyId, teamId, pwd) {
    const stored = await get(`lobbies/${lobbyId}/teams/${teamId}/pwd`);
    return typeof stored === 'string' && stored === pwd;
  }

  async function verifyAdminPwd(lobbyId, pwd) {
    const stored = await get(`lobbies/${lobbyId}/meta/adminPwd`);
    return typeof stored === 'string' && stored === pwd;
  }

  return { createLobby, loadLobbyTeams, verifyTeamPwd, verifyAdminPwd };
}

export function resolveSession() {
  const params = new URLSearchParams(location.search);
  const urlLobby = params.get('lobby');
  const urlTeam = params.get('team');
  if (urlLobby && urlTeam && isValidLobbyId(urlLobby)) {
    const teamId = parseInt(urlTeam, 10);
    if (Number.isInteger(teamId) && teamId > 0) {
      return { lobbyId: urlLobby, teamId };
    }
  }
  const s = getSession();
  if (!s) return null;
  if (isAdminSession(s)) return { lobbyId: s.lobbyId, role: 'admin' };
  return { lobbyId: s.lobbyId, teamId: s.teamId };
}
