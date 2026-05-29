import { describe, it, expect } from 'vitest';
import {
  resolveOverride, hasOverride, resolveTimer, resolveRule,
} from '../ps-offsite-2026/shared/game-config.js';

describe('resolveOverride precedence', () => {
  it('cell overrides game; absent => undefined', () => {
    const node = { games: { SF: 10 }, cells: { SF: { 3: 20 } } };
    expect(resolveOverride(node, 'SF', 3)).toBe(20); // cell wins
    expect(resolveOverride(node, 'SF', 1)).toBe(10); // game wins (no cell)
    expect(resolveOverride(node, 'MX', 1)).toBeUndefined(); // none
  });
  it('optional-chaining safe on absent node / level (no throw)', () => {
    expect(resolveOverride(undefined, 'SF', 1)).toBeUndefined();
    expect(resolveOverride({}, 'SF', 1)).toBeUndefined();
    expect(resolveOverride({ games: {} }, 'SF', 1)).toBeUndefined();
    expect(resolveOverride({ cells: { SF: {} } }, 'SF', 1)).toBeUndefined();
  });
  it('missing teamId degrades to game level', () => {
    const node = { games: { SF: 10 }, cells: { SF: { 3: 20 } } };
    expect(resolveOverride(node, 'SF', undefined)).toBe(10);
  });
});

describe('hasOverride', () => {
  it('reflects presence at the requested level', () => {
    const node = { games: { SF: 10 }, cells: { SF: { 3: 20 } } };
    expect(hasOverride(node, 'SF', 3)).toBe(true);   // cell level
    expect(hasOverride(node, 'SF', 1)).toBe(true);   // degrades to game
    expect(hasOverride(node, 'SF')).toBe(true);      // game level
    expect(hasOverride(node, 'MX')).toBe(false);
    expect(hasOverride(undefined, 'SF', 3)).toBe(false);
  });
});

describe('resolveTimer normalization', () => {
  it('returns positive minutes, else undefined for junk/absent', () => {
    expect(resolveTimer({ games: { SF: 15 } }, 'SF')).toBe(15);
    expect(resolveTimer({ games: { SF: '15' } }, 'SF')).toBe(15); // string coerced
    expect(resolveTimer({ games: { SF: 0 } }, 'SF')).toBeUndefined();
    expect(resolveTimer({ games: { SF: -5 } }, 'SF')).toBeUndefined();
    expect(resolveTimer({ games: { SF: 'abc' } }, 'SF')).toBeUndefined();
    expect(resolveTimer(undefined, 'SF')).toBeUndefined();
  });
});

describe('resolveRule', () => {
  it('returns override, else fallback', () => {
    expect(resolveRule({ games: { SF: 'custom' } }, 'SF', 1, 'default')).toBe('custom');
    expect(resolveRule({ cells: { SF: { 3: 'hint' } } }, 'SF', 3, 'default')).toBe('hint');
    expect(resolveRule(undefined, 'SF', 1, 'default')).toBe('default');
  });
});
