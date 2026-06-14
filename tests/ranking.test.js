import { describe, it, expect } from 'vitest';
import { rankPointsByTeam } from '../src/shared/ranking.js';

describe('rankPointsByTeam', () => {
  it('returns N points for top, 1 for bottom in N-team lobby', () => {
    const result = rankPointsByTeam({
      teamCount: 4,
      raw: { 1: 100, 2: 90, 3: 70, 4: 50 },
    });
    expect(result).toEqual({ 1: 4, 2: 3, 3: 2, 4: 1 });
  });

  it('handles ties with average rank (4-team, [100, 90, 90, 70])', () => {
    const result = rankPointsByTeam({
      teamCount: 4,
      raw: { 1: 100, 2: 90, 3: 90, 4: 70 },
    });
    expect(result).toEqual({ 1: 4, 2: 2.5, 3: 2.5, 4: 1 });
  });

  it('handles 3-way tie at top of 5-team', () => {
    const result = rankPointsByTeam({
      teamCount: 5,
      raw: { 1: 90, 2: 90, 3: 90, 4: 50, 5: 10 },
    });
    expect(result).toEqual({ 1: 4, 2: 4, 3: 4, 4: 2, 5: 1 });
  });

  it('assigns 0 to teams without a raw score', () => {
    const result = rankPointsByTeam({
      teamCount: 4,
      raw: { 1: 100, 2: 90 },
    });
    expect(result).toEqual({ 1: 4, 2: 3 });
  });

  it('returns empty object when no team submitted', () => {
    expect(rankPointsByTeam({ teamCount: 9, raw: {} })).toEqual({});
  });

  it('ignores non-numeric raw values', () => {
    const result = rankPointsByTeam({
      teamCount: 3,
      raw: { 1: 50, 2: null, 3: undefined },
    });
    expect(result).toEqual({ 1: 3 });
  });
});

describe('rankPointsByTeam — totals across games', () => {
  it('sums to expected total for a 3-game / 3-team example', () => {
    const teamCount = 3;
    const games = {
      GZ: { 1: 100, 2: 80, 3: 60 },
      DN: { 1: 50,  2: 50, 3: 10 },
      MX: { 1: 5,   3: 20 },
    };
    const perGame = Object.fromEntries(
      Object.entries(games).map(([k, raw]) => [k, rankPointsByTeam({ teamCount, raw })])
    );
    const totals = { 1: 0, 2: 0, 3: 0 };
    for (const k of Object.keys(perGame)) {
      for (const [t, pts] of Object.entries(perGame[k])) {
        totals[t] += pts;
      }
    }
    expect(totals[1]).toBeCloseTo(3 + 2.5 + 2);
    expect(totals[2]).toBeCloseTo(2 + 2.5);
    expect(totals[3]).toBeCloseTo(1 + 1 + 3);
  });
});
