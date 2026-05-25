import { describe, it, expect } from 'vitest';
import { generateCode } from '../ps-offsite-2026/shared/score-panel.js';

describe('generateCode', () => {
  it('formats as STATION-TEAM-SCORE with score normalized to 0..100', () => {
    expect(generateCode({ station: 'DN', team: 7, score: 8, max: 16 })).toBe('DN-7-50');
    expect(generateCode({ station: 'FL', team: 3, score: 31, max: 31 })).toBe('FL-3-100');
    expect(generateCode({ station: 'FL', team: 10, score: 0, max: 31 })).toBe('FL-10-0');
  });

  it('rounds half-up', () => {
    // 5/16 = 31.25 -> 31
    expect(generateCode({ station: 'DN', team: 1, score: 5, max: 16 })).toBe('DN-1-31');
    // 6/16 = 37.5 -> 38
    expect(generateCode({ station: 'DN', team: 1, score: 6, max: 16 })).toBe('DN-1-38');
  });

  it('clamps over- and under-flow to 0..100', () => {
    expect(generateCode({ station: 'DN', team: 1, score: 999, max: 16 })).toBe('DN-1-100');
    expect(generateCode({ station: 'DN', team: 1, score: -5, max: 16 })).toBe('DN-1-0');
  });
});

