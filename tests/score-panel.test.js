import { describe, it, expect, vi, beforeEach } from 'vitest';
import { generateCode, getTeamFromURL } from '../ps-offsite-2026/shared/score-panel.js';

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

describe('getTeamFromURL', () => {
  beforeEach(() => {
    vi.stubGlobal('location', { search: '' });
  });

  it('returns 0 when ?team missing', () => {
    vi.stubGlobal('location', { search: '' });
    expect(getTeamFromURL()).toBe(0);
  });

  it('parses valid team in 1..99', () => {
    vi.stubGlobal('location', { search: '?team=7' });
    expect(getTeamFromURL()).toBe(7);
  });

  it('rejects out-of-range and non-numeric', () => {
    vi.stubGlobal('location', { search: '?team=0' });
    expect(getTeamFromURL()).toBe(0);
    vi.stubGlobal('location', { search: '?team=100' });
    expect(getTeamFromURL()).toBe(0);
    vi.stubGlobal('location', { search: '?team=abc' });
    expect(getTeamFromURL()).toBe(0);
  });
});
