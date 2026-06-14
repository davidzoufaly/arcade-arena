import { describe, it, expect } from 'vitest';
import { WARMUP_S, warmupSecondsLeft } from '../src/shared/warmup-logic.js';

describe('WARMUP_S', () => {
  it('is 10', () => expect(WARMUP_S).toBe(10));
});

describe('warmupSecondsLeft', () => {
  it('0s elapsed → 10', () => expect(warmupSecondsLeft(0)).toBe(10));
  it('9.1s → 1', () => expect(warmupSecondsLeft(9.1)).toBe(1));
  it('9.9s → 1', () => expect(warmupSecondsLeft(9.9)).toBe(1));
  it('9.999s → 1 (boundary, still warming)', () => expect(warmupSecondsLeft(9.999)).toBe(1));
  it('10s → 0 (transition)', () => expect(warmupSecondsLeft(10)).toBe(0));
  it('10.000001s → 0 (boundary, just past)', () => expect(warmupSecondsLeft(10.000001)).toBe(0));
  it('11s → 0 (floored, never negative)', () => expect(warmupSecondsLeft(11)).toBe(0));
  it('negative elapsed → 10 (clamped, never exceeds WARMUP_S)', () => expect(warmupSecondsLeft(-1)).toBe(10));
});
