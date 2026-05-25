import { describe, it, expect, vi } from 'vitest';
import {
  generateLobbyId, generatePwd, isValidLobbyId, ALPHABET,
  getSession, setSession, clearSession, SESSION_KEY, LEGACY_TEAM_KEY,
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
