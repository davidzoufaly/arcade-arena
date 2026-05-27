import { describe, it, expect } from 'vitest';
import {
  MAX_PIPES,
  GAIN,
  GRAVITY,
  ampToThrust,
  scoreAttempt,
  finalScore,
} from '../ps-offsite-2026/shared/flappy-logic.js';

describe('constants', () => {
  it('MAX_PIPES is 20', () => expect(MAX_PIPES).toBe(20));
  it('GAIN is 25', () => expect(GAIN).toBe(25));
  it('GRAVITY is 0.28', () => expect(GRAVITY).toBeCloseTo(0.28));
});

describe('ampToThrust', () => {
  it('amp above floor → (amp-floor)*GAIN', () =>
    expect(ampToThrust(0.10, 0.05)).toBeCloseTo(1.25));
  it('amp below floor → 0', () =>
    expect(ampToThrust(0.05, 0.10)).toBe(0));
  it('zero amp & floor → 0', () =>
    expect(ampToThrust(0, 0)).toBe(0));
});

describe('scoreAttempt', () => {
  it('0 completed → 0', () =>
    expect(scoreAttempt({ completed: 0, timeSec: 5, died: true })).toBe(0));
  it('max in 30s → 100 (base 100 + 5 bonus, capped)', () =>
    expect(scoreAttempt({ completed: 20, timeSec: 30, died: false })).toBe(100));
  it('max in 60s → 100 (bonus floored)', () =>
    expect(scoreAttempt({ completed: 20, timeSec: 60, died: false })).toBe(100));
  it('half in 15s → 50', () =>
    expect(scoreAttempt({ completed: 10, timeSec: 15, died: true })).toBe(50));
});

describe('finalScore', () => {
  it('empty → 0', () => expect(finalScore([])).toBe(0));
  it('picks max', () =>
    expect(finalScore([{ score: 40 }, { score: 80 }, { score: 20 }])).toBe(80));
});
