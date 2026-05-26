// tests/games-catalog.test.js
import { describe, it, expect } from 'vitest';
import {
  GAMES, getGame, playableKeys, manualKeys, allEnteredKeys,
} from '../ps-offsite-2026/shared/games-catalog.js';

describe('GAMES catalog', () => {
  it('exposes all 11 games with required fields', () => {
    const keys = Object.keys(GAMES);
    expect(keys).toHaveLength(11);
    for (const k of keys) {
      expect(GAMES[k].name).toBeTruthy();
      expect(GAMES[k].emoji).toBeTruthy();
      expect(['play', 'manual', 'soon']).toContain(GAMES[k].kind);
    }
  });

  it('has exactly 4 playable games with href', () => {
    const ks = playableKeys();
    expect(ks.sort()).toEqual(['DN', 'FL', 'GZ', 'PM']);
    for (const k of ks) expect(GAMES[k].href).toBeTruthy();
  });

  it('has exactly 6 manual games with rules', () => {
    const ks = manualKeys();
    expect(ks).toHaveLength(6);
    for (const k of ks) expect(typeof GAMES[k].rules).toBe('string');
  });

  it('marks Pub Quiz as soon (no href, no rules)', () => {
    expect(GAMES.PQ.kind).toBe('soon');
  });

  it('allEnteredKeys excludes soon', () => {
    expect(allEnteredKeys()).not.toContain('PQ');
    expect(allEnteredKeys()).toHaveLength(10);
  });

  it('getGame returns null for unknown key', () => {
    expect(getGame('ZZ')).toBeNull();
    expect(getGame('GZ')).toBe(GAMES.GZ);
  });
});
