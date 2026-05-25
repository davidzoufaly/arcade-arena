import { describe, it, expect } from 'vitest';
import { generateLobbyId, generatePwd, isValidLobbyId, ALPHABET } from '../ps-offsite-2026/shared/lobby.js';

describe('ALPHABET', () => {
  it('excludes ambiguous chars 0 O 1 I', () => {
    expect(ALPHABET).not.toMatch(/[01OI]/);
  });
  it('is 32 chars (uppercase A-Z minus I,O + digits 2-9)', () => {
    expect(ALPHABET.length).toBe(32);
  });
});

describe('generateLobbyId', () => {
  it('matches /^PS-[A-Z2-9]{4}$/ with no ambiguous chars', () => {
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
  it('honors explicit length', () => {
    expect(generatePwd(10)).toHaveLength(10);
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
