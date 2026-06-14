// ps-offsite-2026/shared/lobby.js
import './theme.css';      // global theming — loaded on every page via lobby.js
import './theme.js';       // mounts light/dark switcher
import { seedCategories } from './quiz.js';
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_ID_RE = /^[A-HJ-NP-Z2-9]{4}$/;

function pick(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function generateLobbyId() {
  return pick(4);
}

// Easy, unambiguous English words for memorable passwords (word + 3 digits).
export const PWD_WORDS = [
  'TIGER', 'EAGLE', 'MANGO', 'LEMON', 'PANDA', 'ROBOT', 'PIZZA', 'COMET',
  'ZEBRA', 'OTTER', 'LASER', 'MELON', 'RIVER', 'CLOUD', 'STORM', 'PLANT',
  'TURBO', 'MAGIC', 'NINJA', 'PILOT', 'SHARK', 'FLAME', 'PEARL', 'BISON',
  'JELLY', 'KOALA', 'LLAMA', 'RAVEN', 'TOAST', 'WAGON',
];

// Memorable password: an easy word followed by three digits, e.g. "TIGER042".
// Join input is upper-cased before compare, so the word is upper-case to match.
export function generatePwd() {
  const word = PWD_WORDS[Math.floor(Math.random() * PWD_WORDS.length)];
  let digits = '';
  for (let i = 0; i < 3; i++) digits += Math.floor(Math.random() * 10);
  return word + digits;
}

export function isValidLobbyId(s) {
  return typeof s === 'string' && LOBBY_ID_RE.test(s);
}

export const SESSION_KEY = 'psOffsite2026.lobby';
export const LEGACY_TEAM_KEY = 'psOffsite2026.team';

// Lobby mode: 'teams' (default — N teams of players) or 'individuals'
// (N solo players). Mode lives at lobbies/{id}/meta/mode and drives both the
// participant label ("Team N" vs "Player N") and per-game solo behavior.
export const MODE_TEAMS = 'teams';
export const MODE_INDIVIDUALS = 'individuals';

export function isIndividualsMode(mode) {
  return mode === MODE_INDIVIDUALS;
}

// Singular participant noun for a mode — "Player" for individuals, "Team"
// otherwise. Used for default names, column headers, and game copy.
export function participantNoun(mode) {
  return isIndividualsMode(mode) ? 'Player' : 'Team';
}

// Participant count caps. Teams mode allows up to 20; individuals mode caps at
// 12 (one solo player each — documented in README/CHANGELOG and enforced here
// and in the create form).
export const MAX_TEAMS = 20;
export const MAX_INDIVIDUALS = 12;
export function maxParticipants(mode) {
  return isIndividualsMode(mode) ? MAX_INDIVIDUALS : MAX_TEAMS;
}

// Hash a password for storage and verification. This is a *fun-portal* hardening
// measure, NOT real auth: the Realtime Database is world-readable, so we never
// write plaintext passwords into it. Salting with the lobby id + a per-slot
// scope ('admin' or the team id) means the same memorable word+digits password
// produces a different hash in every lobby/slot, defeating trivial precomputed
// lookups. The password space is still small (word + 3 digits), so a motivated
// attacker with DB read access can brute-force a hash offline — see SETUP.md for
// the full threat model. Uses Web Crypto (browser + Node >=18).
export async function hashPwd(lobbyId, scope, pwd) {
  const data = new TextEncoder().encode(`psoffsite2026:${lobbyId}:${scope}:${pwd}`);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}

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
      // NOTE: this stored object is fully user-controlled (it's plain
      // localStorage). The `role:'admin'` flag therefore only decides which UI
      // affordances are shown — it grants NO trust on its own. Every privileged
      // action is re-verified against the hashed admin password by requireAdmin
      // (admin-gate.js), so forging this flag does not unlock admin writes.
      if (parsed.role === 'admin') {
        return parsed;
      }
      // Team sessions carry no password either — pwd verified once at join time.
      if (Number.isInteger(parsed.teamId)) {
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
  async function createLobby(teamCount, mode = MODE_TEAMS) {
    const resolvedMode = isIndividualsMode(mode) ? MODE_INDIVIDUALS : MODE_TEAMS;
    const noun = participantNoun(resolvedMode);
    const max = maxParticipants(resolvedMode);
    if (!Number.isInteger(teamCount) || teamCount < 2 || teamCount > max) {
      throw new Error(`${noun.toLowerCase()} count must be 2..${max}`);
    }
    let lobbyId = null;
    for (let attempt = 0; attempt < MAX_CREATE_RETRIES; attempt++) {
      const candidate = generateLobbyId();
      const existing = await get(`lobbies/${candidate}`);
      if (!existing) { lobbyId = candidate; break; }
    }
    if (!lobbyId) throw new Error(`lobby id collision after ${MAX_CREATE_RETRIES} attempts`);

    // Plaintext passwords are generated for display to the host (returned below)
    // but only their salted hashes are written to the world-readable DB.
    const adminPwd = generatePwd();
    const teams = Array.from({ length: teamCount }, (_, i) => ({
      id: i + 1,
      name: `${noun} ${i + 1}`,
      pwd: generatePwd(),
    }));
    const teamsObj = {};
    for (const t of teams) {
      teamsObj[t.id] = { id: t.id, name: t.name, pwdHash: await hashPwd(lobbyId, t.id, t.pwd) };
    }
    await set(`lobbies/${lobbyId}`, {
      meta: {
        createdAt: Date.now(),
        teamCount,
        mode: resolvedMode,
        adminPwdHash: await hashPwd(lobbyId, 'admin', adminPwd),
      },
      teams: teamsObj,
      quiz: { categories: seedCategories() },
    });
    return { lobbyId, adminPwd, teams, mode: resolvedMode };
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
    const stored = await get(`lobbies/${lobbyId}/teams/${teamId}/pwdHash`);
    if (typeof stored !== 'string') return false;
    return stored === await hashPwd(lobbyId, teamId, pwd);
  }

  async function verifyAdminPwd(lobbyId, pwd) {
    const stored = await get(`lobbies/${lobbyId}/meta/adminPwdHash`);
    if (typeof stored !== 'string') return false;
    return stored === await hashPwd(lobbyId, 'admin', pwd);
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
