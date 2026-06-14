import { describe, it, expect } from 'vitest';
import {
  resolveLock, resolveGameLock, resolveAllLock, isUnlocked,
  setAll, setGame, setCell, toggleAll, toggleGame, toggleCell,
  LOCKED, UNLOCKED,
} from '../src/shared/game-lock.js';

describe('resolveLock precedence', () => {
  it('cell overrides game overrides all', () => {
    const locks = {
      all: UNLOCKED,
      games: { GZ: LOCKED },
      cells: { GZ: { 3: UNLOCKED } },
    };
    expect(resolveLock(locks, 'GZ', 3)).toBe(UNLOCKED); // cell wins
    expect(resolveLock(locks, 'GZ', 1)).toBe(LOCKED);   // game wins (no cell)
    expect(resolveLock(locks, 'PM', 1)).toBe(UNLOCKED); // all wins (no game/cell)
  });
});

describe('resolveLock defaults to unlocked on absent node / level', () => {
  it('returns UNLOCKED for undefined locks', () => {
    expect(resolveLock(undefined, 'GZ', 1)).toBe(UNLOCKED);
  });
  it('returns UNLOCKED for empty object', () => {
    expect(resolveLock({}, 'GZ', 1)).toBe(UNLOCKED);
  });
  it('returns UNLOCKED when games map present but key absent', () => {
    expect(resolveLock({ games: {} }, 'GZ', 1)).toBe(UNLOCKED);
  });
  it('returns UNLOCKED when cells map present but game/team absent', () => {
    expect(resolveLock({ cells: { GZ: {} } }, 'GZ', 1)).toBe(UNLOCKED);
  });
});

describe('missing teamId degrades to game/all level', () => {
  it('ignores cell overrides when teamId is undefined', () => {
    const locks = { all: UNLOCKED, cells: { GZ: { 3: LOCKED } } };
    expect(resolveLock(locks, 'GZ', undefined)).toBe(UNLOCKED); // no crash, no phantom match
  });
});

describe('resolveGameLock / resolveAllLock', () => {
  it('resolveGameLock ignores cells', () => {
    const locks = { all: LOCKED, games: { GZ: UNLOCKED }, cells: { GZ: { 1: LOCKED } } };
    expect(resolveGameLock(locks, 'GZ')).toBe(UNLOCKED);
    expect(resolveGameLock(locks, 'PM')).toBe(LOCKED); // falls to all
  });
  it('resolveAllLock defaults to unlocked', () => {
    expect(resolveAllLock(undefined)).toBe(UNLOCKED);
    expect(resolveAllLock({ all: LOCKED })).toBe(LOCKED);
  });
});

describe('isUnlocked', () => {
  it('is true only when resolved state is unlocked', () => {
    expect(isUnlocked({ all: UNLOCKED }, 'GZ', 1)).toBe(true);
    expect(isUnlocked({}, 'GZ', 1)).toBe(true); // absent => unlocked default
    expect(isUnlocked({ all: LOCKED }, 'GZ', 1)).toBe(false);
  });
});

describe('cascade-clear writes against a draft cloned from an absent node', () => {
  it('setAll sets baseline and clears games + cells', () => {
    const draft = { all: LOCKED, games: { GZ: UNLOCKED }, cells: { GZ: { 1: UNLOCKED } } };
    setAll(draft, UNLOCKED);
    expect(draft).toEqual({ all: UNLOCKED, games: {}, cells: {} });
  });
  it('setGame on empty draft lazily creates games and clears that game cells', () => {
    const draft = {};
    setGame(draft, 'GZ', UNLOCKED);
    expect(draft.games).toEqual({ GZ: UNLOCKED });
    const draft2 = { cells: { GZ: { 1: LOCKED }, PM: { 2: LOCKED } } };
    setGame(draft2, 'GZ', LOCKED);
    expect(draft2.games).toEqual({ GZ: LOCKED });
    expect(draft2.cells).toEqual({ PM: { 2: LOCKED } }); // only GZ cells cleared
  });
  it('setCell on empty draft lazily creates nested maps', () => {
    const draft = {};
    setCell(draft, 'GZ', 3, UNLOCKED);
    expect(draft.cells).toEqual({ GZ: { 3: UNLOCKED } });
  });
});

describe('toggles flip resolved state at their level', () => {
  it('toggleAll flips baseline and clears specifics', () => {
    const draft = { games: { GZ: UNLOCKED } };
    toggleAll(draft); // resolved all = unlocked (absent default) -> locked
    expect(draft).toEqual({ all: LOCKED, games: {}, cells: {} });
  });
  it('toggleGame flips game-resolved state', () => {
    const draft = { all: UNLOCKED };
    toggleGame(draft, 'GZ'); // resolved game = unlocked (from all) -> locked
    expect(draft.games.GZ).toBe(LOCKED);
  });
  it('toggleCell flips cell-resolved state', () => {
    const draft = { all: LOCKED };
    toggleCell(draft, 'GZ', 3); // resolved cell = locked -> unlocked
    expect(draft.cells.GZ[3]).toBe(UNLOCKED);
  });
});
