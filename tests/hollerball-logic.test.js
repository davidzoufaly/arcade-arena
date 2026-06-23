import { describe, it, expect } from 'vitest';
import {
  GAIN,
  GRAVITY,
  FALL_V,
  RISE_CAP,
  METER_MAX,
  METER_MAX_SOLO,
  RAMP_S,
  SPEED_MIN, SPEED_MAX,
  SPAWN_FRAMES_MAX, SPAWN_FRAMES_MIN,
  GAP_MAX, GAP_MIN,
  ampToThrust,
  targetVelocity,
  nextVelocity,
  difficultyProgress,
  pipeSpeed,
  pipeSpawnFrames,
  pipeGap,
  scoreAttempt,
  finalScore,
} from '../src/shared/hollerball-logic.js';

describe('constants', () => {
  it('GAIN is 25', () => expect(GAIN).toBe(25));
  it('GRAVITY is 0.28', () => expect(GRAVITY).toBeCloseTo(0.28));
  it('RAMP_S is 60', () => expect(RAMP_S).toBe(60));
  it('solo meter max is lower than team (quieter voice = full rise)', () =>
    expect(METER_MAX_SOLO).toBeLessThan(METER_MAX));
});

describe('targetVelocity with solo meterMax', () => {
  // Same amplitude commands a stronger climb in solo than in team, because the
  // lower threshold fills the meter sooner.
  it('quiet voice climbs harder under the solo threshold', () =>
    expect(targetVelocity(0.12, 0, METER_MAX_SOLO))
      .toBeLessThan(targetVelocity(0.12, 0, METER_MAX)));
  it('reaching the solo threshold already commands full rise', () =>
    expect(targetVelocity(METER_MAX_SOLO, 0, METER_MAX_SOLO)).toBeCloseTo(-RISE_CAP));
});

describe('ampToThrust', () => {
  it('amp above floor → (amp-floor)*GAIN', () =>
    expect(ampToThrust(0.10, 0.05)).toBeCloseTo(1.25));
  it('amp below floor → 0', () =>
    expect(ampToThrust(0.05, 0.10)).toBe(0));
  it('zero amp & floor → 0', () =>
    expect(ampToThrust(0, 0)).toBe(0));
});

describe('targetVelocity (linear meter→speed map)', () => {
  it('at/below floor (empty bar) → +FALL_V (drop)', () =>
    expect(targetVelocity(0.05, 0.10)).toBeCloseTo(FALL_V));
  it('at/above METER_MAX (full bar) → -RISE_CAP (climb)', () =>
    expect(targetVelocity(1, 0)).toBe(-RISE_CAP));
  it('exactly METER_MAX → -RISE_CAP', () =>
    expect(targetVelocity(METER_MAX, 0)).toBeCloseTo(-RISE_CAP));
  it('half the meter range → midpoint speed (FALL_V-RISE_CAP)/2', () => {
    const floor = 0.04;
    const mid = floor + (METER_MAX - floor) / 2;
    expect(targetVelocity(mid, floor)).toBeCloseTo((FALL_V - RISE_CAP) / 2);
  });
  it('louder → more upward (monotonic)', () =>
    expect(targetVelocity(0.20, 0.04)).toBeLessThan(targetVelocity(0.10, 0.04)));

  // Loud-room guard (#7): when the calibrated floor lands at/above METER_MAX the
  // span would collapse and the orb could only ever fall (unwinnable). A clearly
  // louder-than-floor input must still produce a rising (negative) target.
  it('floor AT meterMax: loud input still rises (not pure descent)', () => {
    const floor = METER_MAX;                 // degenerate: span would be 0
    expect(targetVelocity(floor + 0.2, floor)).toBeLessThan(0);
  });
  it('floor ABOVE meterMax: loud input still rises', () => {
    const floor = METER_MAX + 0.1;           // span would be negative
    expect(targetVelocity(floor + 0.3, floor)).toBeLessThan(0);
  });
  it('floor AT meterMax: silence still falls (+FALL_V)', () => {
    expect(targetVelocity(METER_MAX, METER_MAX)).toBeCloseTo(FALL_V);
  });
});

describe('nextVelocity', () => {
  it('eases toward target, no instant jump (momentum gone but smoothed)', () => {
    const v = nextVelocity(0, 1, 0, 1);   // target -RISE_CAP, from rest
    expect(v).toBeLessThan(0);
    expect(v).toBeGreaterThan(-RISE_CAP); // partial step, not teleport
  });
  it('converges to fall target when silent', () => {
    let v = -RISE_CAP;                     // start rising fast
    for (let i = 0; i < 60; i++) v = nextVelocity(v, 0, 0.1, 1);
    expect(v).toBeCloseTo(FALL_V);         // realtime: stops coasting up, settles to fall
  });
  it('never exceeds fall speed or rise cap', () => {
    expect(nextVelocity(FALL_V, 0, 0.1, 1)).toBeLessThanOrEqual(FALL_V);
    expect(nextVelocity(-RISE_CAP, 1, 0, 1)).toBeGreaterThanOrEqual(-RISE_CAP);
  });
});

describe('difficultyProgress (endless ramp)', () => {
  it('0s → 0', () => expect(difficultyProgress(0)).toBe(0));
  it('negative → 0 (clamped)', () => expect(difficultyProgress(-5)).toBe(0));
  it('half ramp → 0.5', () => expect(difficultyProgress(RAMP_S / 2)).toBeCloseTo(0.5));
  it('full ramp → 1', () => expect(difficultyProgress(RAMP_S)).toBe(1));
  it('past ramp → 1 (plateau)', () => expect(difficultyProgress(RAMP_S * 3)).toBe(1));
});

describe('pipeSpeed', () => {
  it('start → SPEED_MIN', () => expect(pipeSpeed(0)).toBe(SPEED_MIN));
  it('peak → SPEED_MAX', () => expect(pipeSpeed(RAMP_S)).toBe(SPEED_MAX));
  it('past ramp → SPEED_MAX (plateau)', () => expect(pipeSpeed(RAMP_S * 2)).toBe(SPEED_MAX));
});

describe('pipeSpawnFrames', () => {
  it('start → SPAWN_FRAMES_MAX (sparse)', () => expect(pipeSpawnFrames(0)).toBe(SPAWN_FRAMES_MAX));
  it('peak → SPAWN_FRAMES_MIN (dense)', () => expect(pipeSpawnFrames(RAMP_S)).toBe(SPAWN_FRAMES_MIN));
  it('past ramp → SPAWN_FRAMES_MIN (plateau)', () =>
    expect(pipeSpawnFrames(RAMP_S * 2)).toBe(SPAWN_FRAMES_MIN));
});

describe('pipeGap', () => {
  it('start → GAP_MAX (wide, easy)', () => expect(pipeGap(0)).toBe(GAP_MAX));
  it('peak → GAP_MIN (narrow, hard)', () => expect(pipeGap(RAMP_S)).toBe(GAP_MIN));
  it('past ramp → GAP_MIN (plateau)', () => expect(pipeGap(RAMP_S * 2)).toBe(GAP_MIN));
  it('narrows monotonically', () => expect(pipeGap(10)).toBeGreaterThan(pipeGap(30)));
});

describe('scoreAttempt (endless: score = gates cleared)', () => {
  it('0 cleared → 0', () => expect(scoreAttempt({ completed: 0 })).toBe(0));
  it('37 cleared → 37 (uncapped)', () => expect(scoreAttempt({ completed: 37 })).toBe(37));
  it('rounds fractional', () => expect(scoreAttempt({ completed: 12.6 })).toBe(13));
  it('negative → 0', () => expect(scoreAttempt({ completed: -4 })).toBe(0));
});

describe('finalScore', () => {
  it('empty → 0', () => expect(finalScore([])).toBe(0));
  it('picks max', () =>
    expect(finalScore([{ score: 40 }, { score: 80 }, { score: 20 }])).toBe(80));
});
