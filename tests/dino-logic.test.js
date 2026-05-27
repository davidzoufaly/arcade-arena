import { describe, it, expect } from 'vitest';
import {
  MAX_OBSTACLES,
  PALM_COUNT_WINDOW,
  palmCountToJumpStrength,
  scoreAttempt,
  finalScore,
} from '../ps-offsite-2026/shared/dino-logic.js';

describe('constants', () => {
  it('MAX_OBSTACLES is 16', () => expect(MAX_OBSTACLES).toBe(16));
  it('PALM_COUNT_WINDOW is 4', () => expect(PALM_COUNT_WINDOW).toBe(4));
});

describe('palmCountToJumpStrength', () => {
  it('0 palms → 0 (no jump)', () => expect(palmCountToJumpStrength(0)).toBe(0));
  it('negative → 0', () => expect(palmCountToJumpStrength(-3)).toBe(0));
  it('1 palm → 8', () => expect(palmCountToJumpStrength(1)).toBe(8));
  it('4 palms → 14', () => expect(palmCountToJumpStrength(4)).toBe(14));
  it('8 palms → 20 (clamped)', () => expect(palmCountToJumpStrength(8)).toBe(20));
  it('20 palms → 20 (clamped)', () => expect(palmCountToJumpStrength(20)).toBe(20));
});

describe('scoreAttempt', () => {
  it('0 completed → 0', () =>
    expect(scoreAttempt({ completed: 0, timeSec: 60, died: true })).toBe(0));
  it('max in 30s → 100 (base 100 + 5 bonus, capped)', () =>
    expect(scoreAttempt({ completed: 16, timeSec: 30, died: false })).toBe(100));
  it('max in 60s → 100 (bonus floored at 0)', () =>
    expect(scoreAttempt({ completed: 16, timeSec: 60, died: false })).toBe(100));
  it('max in 0s → 100 (base 100 + 20 bonus, capped)', () =>
    expect(scoreAttempt({ completed: 16, timeSec: 0, died: false })).toBe(100));
  it('half in 20s → 50 (no bonus without max)', () =>
    expect(scoreAttempt({ completed: 8, timeSec: 20, died: true })).toBe(50));
});

describe('finalScore', () => {
  it('empty → 0', () => expect(finalScore([])).toBe(0));
  it('all zero → 0', () =>
    expect(finalScore([{ score: 0 }, { score: 0 }, { score: 0 }])).toBe(0));
  it('picks max', () =>
    expect(finalScore([{ score: 30 }, { score: 75 }, { score: 20 }])).toBe(75));
});
