import { describe, it, expect } from 'vitest';
import { GAMES } from '../ps-offsite-2026/shared/games-catalog.js';
import {
  resolveCatalog, addedKeys, nextCustomKey, makeCustomGame, validateCustomGame,
  SAFE_ALPHABET,
} from '../ps-offsite-2026/shared/lobby-games.js';

describe('resolveCatalog', () => {
  it('with no lobby node: playable added, manual/quiz not added', () => {
    const eff = resolveCatalog(GAMES, null);
    const byKey = Object.fromEntries(eff.map(g => [g.key, g]));
    expect(byKey.GZ.added).toBe(true);   // play
    expect(byKey.FL.added).toBe(true);   // play
    expect(byKey.GD.added).toBe(false);  // manual
    expect(byKey.PQ.added).toBe(false);  // quiz
  });

  it('explicit added flag overrides the default', () => {
    const eff = resolveCatalog(GAMES, { GD: { added: true }, GZ: { added: false } });
    const byKey = Object.fromEntries(eff.map(g => [g.key, g]));
    expect(byKey.GD.added).toBe(true);
    expect(byKey.GZ.added).toBe(false);
  });

  it('built-ins keep static name/emoji/kind/href', () => {
    const eff = resolveCatalog(GAMES, null);
    const gz = eff.find(g => g.key === 'GZ');
    expect(gz.name).toBe(GAMES.GZ.name);
    expect(gz.emoji).toBe(GAMES.GZ.emoji);
    expect(gz.kind).toBe('play');
    expect(gz.href).toBe(GAMES.GZ.href);
    expect(gz.custom).toBe(false);
  });

  it('includes custom games as host-scored manual, ordered after built-ins by order', () => {
    const node = {
      CUAAAA: { custom: true, name: 'Tug of War', emoji: '🪢', rules: 'pull', kind: 'manual', order: 2, added: true },
      CUBBBB: { custom: true, name: 'Karaoke', emoji: '🎤', rules: 'sing', kind: 'manual', order: 1, added: true },
    };
    const eff = resolveCatalog(GAMES, node);
    const builtinCount = Object.keys(GAMES).length;
    expect(eff.slice(0, builtinCount).every(g => !g.custom)).toBe(true);
    const customs = eff.slice(builtinCount);
    expect(customs.map(g => g.key)).toEqual(['CUBBBB', 'CUAAAA']); // by order 1,2
    expect(customs[0]).toMatchObject({ name: 'Karaoke', emoji: '🎤', kind: 'manual', custom: true, added: true });
  });

  it('custom game added defaults to true when flag absent', () => {
    const eff = resolveCatalog(GAMES, { CUZZZZ: { custom: true, name: 'X', emoji: '❓', rules: '', kind: 'manual', order: 1 } });
    expect(eff.find(g => g.key === 'CUZZZZ').added).toBe(true);
  });
});

describe('addedKeys', () => {
  it('returns only added keys preserving order', () => {
    const eff = resolveCatalog(GAMES, { GD: { added: true } });
    const keys = addedKeys(eff);
    expect(keys).toContain('GZ');
    expect(keys).toContain('GD');
    expect(keys).not.toContain('PQ');
    expect(keys.indexOf('GZ')).toBeLessThan(keys.indexOf('GD'));
  });
});

describe('nextCustomKey', () => {
  it('produces CU + 4 safe-alphabet chars', () => {
    let calls = 0;
    const rng = () => (calls++ % SAFE_ALPHABET.length) / SAFE_ALPHABET.length;
    const key = nextCustomKey(new Set(), rng);
    expect(key).toMatch(/^CU[A-HJ-NP-Z2-9]{4}$/);
  });

  it('never returns a taken key (built-in, live custom, or orphaned score/history key)', () => {
    const taken = new Set(['GZ', 'CUAAAA']);
    // rng forces "AAAA" first (taken as CUAAAA), then "AAAB"
    const seq = ['A', 'A', 'A', 'A', 'A', 'A', 'A', 'B'];
    let i = 0;
    const rng = () => SAFE_ALPHABET.indexOf(seq[i++]) / SAFE_ALPHABET.length;
    const key = nextCustomKey(taken, rng);
    expect(taken.has(key)).toBe(false);
    expect(key).toBe('CUAAAB');
  });
});

describe('makeCustomGame', () => {
  it('builds a host-scored, added custom node object', () => {
    const g = makeCustomGame({ name: ' Quiz Night ', emoji: '🎤', rules: 'sing', order: 3 });
    expect(g).toEqual({ custom: true, name: 'Quiz Night', emoji: '🎤', rules: 'sing', kind: 'manual', order: 3, added: true });
  });
});

describe('validateCustomGame', () => {
  it('accepts a valid game', () => {
    expect(validateCustomGame({ name: 'Karaoke', emoji: '🎤', rules: 'sing' })).toEqual({ ok: true });
  });
  it('rejects empty name', () => {
    expect(validateCustomGame({ name: '   ', emoji: '🎤', rules: '' }).ok).toBe(false);
  });
  it('rejects too-long name', () => {
    expect(validateCustomGame({ name: 'x'.repeat(41), emoji: '🎤', rules: '' }).ok).toBe(false);
  });
  it('rejects empty emoji', () => {
    expect(validateCustomGame({ name: 'X', emoji: '', rules: '' }).ok).toBe(false);
  });
  it('rejects more than one emoji', () => {
    expect(validateCustomGame({ name: 'X', emoji: '🎤🎤', rules: '' }).ok).toBe(false);
  });
  it('accepts a complex single emoji (flag)', () => {
    expect(validateCustomGame({ name: 'X', emoji: '🇨🇿', rules: '' }).ok).toBe(true);
  });
});
