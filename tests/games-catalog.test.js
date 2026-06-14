// tests/games-catalog.test.js
import { describe, it, expect } from 'vitest';
import {
  GAMES, getGame, playableKeys, manualKeys, quizKeys, allEnteredKeys,
} from '../ps-offsite-2026/shared/games-catalog.js';

describe('GAMES catalog', () => {
  it('exposes all 8 games with required fields', () => {
    const keys = Object.keys(GAMES);
    expect(keys).toHaveLength(8);
    for (const k of keys) {
      expect(GAMES[k].name).toBeTruthy();
      expect(GAMES[k].emoji).toBeTruthy();
      expect(['play', 'manual', 'quiz']).toContain(GAMES[k].kind);
    }
  });

  it('has exactly 4 playable games with href', () => {
    const ks = playableKeys();
    expect(ks.sort()).toEqual(['DN', 'FL', 'GZ', 'PM']);
    for (const k of ks) expect(GAMES[k].href).toBeTruthy();
  });

  it('has exactly 3 manual games with rules', () => {
    const ks = manualKeys();
    expect(ks.sort()).toEqual(['DG', 'GD', 'HD']);
    for (const k of ks) expect(typeof GAMES[k].rules).toBe('string');
  });

  it('marks Pub Quiz as the sole quiz game with rules', () => {
    expect(quizKeys()).toEqual(['PQ']);
    expect(GAMES.PQ.kind).toBe('quiz');
    expect(typeof GAMES.PQ.rules).toBe('string');
  });

  it('allEnteredKeys now includes PQ (no soon games remain)', () => {
    expect(allEnteredKeys()).toContain('PQ');
    expect(allEnteredKeys()).toHaveLength(8);
  });

  it('getGame returns null for unknown key', () => {
    expect(getGame('ZZ')).toBeNull();
    expect(getGame('GZ')).toBe(GAMES.GZ);
  });
});
