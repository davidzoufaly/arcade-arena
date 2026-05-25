import { describe, it, expect, vi } from 'vitest';
import {
  generateLobbyId, generatePwd, isValidLobbyId, ALPHABET,
  getSession, setSession, clearSession, SESSION_KEY, LEGACY_TEAM_KEY,
  createLobbyApi,
} from '../ps-offsite-2026/shared/lobby.js';

describe('ALPHABET', () => {
  it('excludes ambiguous chars 0 O 1 I', () => {
    expect(ALPHABET).not.toMatch(/[01OI]/);
  });
  it('is 32 chars (uppercase A-Z minus I,O + digits 2-9)', () => {
    expect(ALPHABET.length).toBe(32);
  });
});

describe('generateLobbyId', () => {
  it('uses the safe alphabet (no 0/O/1/I)', () => {
    for (let i = 0; i < 200; i++) {
      const id = generateLobbyId();
      expect(id).toMatch(/^PS-[A-HJ-NP-Z2-9]{4}$/);
    }
  });
});

describe('generatePwd', () => {
  it('defaults to length 6 using ALPHABET', () => {
    const pwd = generatePwd();
    expect(pwd).toHaveLength(6);
    for (const c of pwd) expect(ALPHABET).toContain(c);
  });
  it('honors explicit length and stays within ALPHABET', () => {
    const pwd = generatePwd(10);
    expect(pwd).toHaveLength(10);
    for (const c of pwd) expect(ALPHABET).toContain(c);
  });
});

describe('isValidLobbyId', () => {
  it('accepts PS-7K2X', () => {
    expect(isValidLobbyId('PS-7K2X')).toBe(true);
  });
  it('rejects lowercase', () => {
    expect(isValidLobbyId('ps-7k2x')).toBe(false);
  });
  it('rejects ambiguous chars', () => {
    expect(isValidLobbyId('PS-0K2X')).toBe(false);
    expect(isValidLobbyId('PS-OK2X')).toBe(false);
    expect(isValidLobbyId('PS-1K2X')).toBe(false);
    expect(isValidLobbyId('PS-IK2X')).toBe(false);
  });
  it('rejects wrong length', () => {
    expect(isValidLobbyId('PS-7K2')).toBe(false);
    expect(isValidLobbyId('PS-7K2XY')).toBe(false);
  });
  it('rejects missing prefix', () => {
    expect(isValidLobbyId('7K2X')).toBe(false);
  });
});

function mockLocalStorage() {
  const store = new Map();
  globalThis.localStorage = {
    getItem: k => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: k => store.delete(k),
    clear: () => store.clear(),
    _store: store,
  };
}

describe('session helpers', () => {
  it('round-trips a session', () => {
    mockLocalStorage();
    setSession({ lobbyId: 'PS-7K2X', teamId: 3, teamPwd: 'ABCDEF' });
    expect(getSession()).toEqual({ lobbyId: 'PS-7K2X', teamId: 3, teamPwd: 'ABCDEF' });
  });
  it('returns null when nothing stored', () => {
    mockLocalStorage();
    expect(getSession()).toBeNull();
  });
  it('returns null and clears on corrupt JSON', () => {
    mockLocalStorage();
    globalThis.localStorage.setItem(SESSION_KEY, '{not json');
    expect(getSession()).toBeNull();
    expect(globalThis.localStorage.getItem(SESSION_KEY)).toBeNull();
  });
  it('clearSession removes the key', () => {
    mockLocalStorage();
    setSession({ lobbyId: 'PS-7K2X', teamId: 1, teamPwd: 'X' });
    clearSession();
    expect(getSession()).toBeNull();
  });
  it('drops legacy team key on first import side-effect', async () => {
    mockLocalStorage();
    globalThis.localStorage.setItem(LEGACY_TEAM_KEY, '7');
    // Reset module cache so the side-effect re-runs on next import
    vi.resetModules();
    await import('../ps-offsite-2026/shared/lobby.js');
    expect(globalThis.localStorage.getItem(LEGACY_TEAM_KEY)).toBeNull();
  });
});

function fakeAdapter(initialData = {}) {
  let data = JSON.parse(JSON.stringify(initialData));
  const writes = [];
  return {
    data: () => data,
    writes: () => writes,
    get: async (path) => {
      const parts = path.split('/').filter(Boolean);
      let cur = data;
      for (const p of parts) {
        if (cur == null) return null;
        cur = cur[p];
      }
      return cur ?? null;
    },
    set: async (path, value) => {
      writes.push({ path, value });
      const parts = path.split('/').filter(Boolean);
      if (parts.length === 0) { data = value; return; }
      let cur = data;
      for (let i = 0; i < parts.length - 1; i++) {
        if (cur[parts[i]] == null) cur[parts[i]] = {};
        cur = cur[parts[i]];
      }
      cur[parts[parts.length - 1]] = value;
    },
  };
}

describe('createLobbyApi.createLobby', () => {
  it('writes a fresh lobby with teamCount teams', async () => {
    const a = fakeAdapter();
    const api = createLobbyApi(a);
    const result = await api.createLobby(4);

    expect(result.lobbyId).toMatch(/^PS-[A-HJ-NP-Z2-9]{4}$/);
    expect(result.adminPwd).toHaveLength(6);
    expect(result.teams).toHaveLength(4);
    expect(result.teams.map(t => t.id)).toEqual([1, 2, 3, 4]);
    for (const t of result.teams) {
      expect(t.name).toBe(`Team ${t.id}`);
      expect(t.pwd).toHaveLength(6);
    }

    const stored = a.data().lobbies[result.lobbyId];
    expect(stored.meta.teamCount).toBe(4);
    expect(stored.meta.adminPwd).toBe(result.adminPwd);
    expect(stored.teams[1].pwd).toBe(result.teams[0].pwd);
  });

  it('retries on collision up to 5 times', async () => {
    const a = fakeAdapter();
    // Pre-seed 4 collisions; 5th attempt should succeed.
    let calls = 0;
    const origGet = a.get;
    a.get = async (path) => {
      if (path.startsWith('lobbies/PS-') && calls < 4) {
        calls++;
        return { meta: { teamCount: 1, adminPwd: 'X', createdAt: 0 } };
      }
      return origGet(path);
    };
    const api = createLobbyApi(a);
    const result = await api.createLobby(2);
    expect(result.lobbyId).toBeTruthy();
    expect(calls).toBe(4);
  });

  it('throws after 5 collisions', async () => {
    const a = fakeAdapter();
    a.get = async () => ({ meta: { teamCount: 1, adminPwd: 'X', createdAt: 0 } });
    const api = createLobbyApi(a);
    await expect(api.createLobby(2)).rejects.toThrow(/collision/i);
  });

  it('rejects teamCount out of range', async () => {
    const api = createLobbyApi(fakeAdapter());
    await expect(api.createLobby(1)).rejects.toThrow(/team count/i);
    await expect(api.createLobby(21)).rejects.toThrow(/team count/i);
  });
});
