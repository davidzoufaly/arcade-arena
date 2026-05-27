import { describe, it, expect } from 'vitest';
import {
  PALM_COUNT_WINDOW,
  RAMP_S,
  SPEED_MIN, SPEED_MAX,
  SPAWN_FRAMES_MAX, SPAWN_FRAMES_MIN,
  HIGH_PROB_MAX,
  palmCountToJumpStrength,
  difficultyProgress,
  runSpeed,
  spawnIntervalFrames,
  highObstacleProb,
  scoreAttempt,
  finalScore,
} from '../ps-offsite-2026/shared/dino-logic.js';

describe('constants', () => {
  it('PALM_COUNT_WINDOW is 4', () => expect(PALM_COUNT_WINDOW).toBe(4));
  it('RAMP_S is 60', () => expect(RAMP_S).toBe(60));
});

describe('palmCountToJumpStrength', () => {
  it('0 palms → 0 (no jump)', () => expect(palmCountToJumpStrength(0)).toBe(0));
  it('negative → 0', () => expect(palmCountToJumpStrength(-3)).toBe(0));
  it('1 palm → 8', () => expect(palmCountToJumpStrength(1)).toBe(8));
  it('4 palms → 14', () => expect(palmCountToJumpStrength(4)).toBe(14));
  it('8 palms → 20 (clamped)', () => expect(palmCountToJumpStrength(8)).toBe(20));
  it('20 palms → 20 (clamped)', () => expect(palmCountToJumpStrength(20)).toBe(20));
});

describe('difficultyProgress', () => {
  it('0s → 0', () => expect(difficultyProgress(0)).toBe(0));
  it('negative → 0 (clamped)', () => expect(difficultyProgress(-5)).toBe(0));
  it('half ramp → 0.5', () => expect(difficultyProgress(RAMP_S / 2)).toBeCloseTo(0.5));
  it('full ramp → 1', () => expect(difficultyProgress(RAMP_S)).toBe(1));
  it('past ramp → 1 (plateau)', () => expect(difficultyProgress(RAMP_S * 3)).toBe(1));
});

describe('runSpeed', () => {
  it('start → SPEED_MIN', () => expect(runSpeed(0)).toBe(SPEED_MIN));
  it('peak → SPEED_MAX', () => expect(runSpeed(RAMP_S)).toBe(SPEED_MAX));
  it('half ramp → midpoint', () =>
    expect(runSpeed(RAMP_S / 2)).toBeCloseTo((SPEED_MIN + SPEED_MAX) / 2));
  it('past ramp → SPEED_MAX (plateau)', () => expect(runSpeed(RAMP_S * 2)).toBe(SPEED_MAX));
});

describe('spawnIntervalFrames', () => {
  it('start → SPAWN_FRAMES_MAX (sparse)', () => expect(spawnIntervalFrames(0)).toBe(SPAWN_FRAMES_MAX));
  it('peak → SPAWN_FRAMES_MIN (dense)', () => expect(spawnIntervalFrames(RAMP_S)).toBe(SPAWN_FRAMES_MIN));
  it('half ramp → midpoint', () =>
    expect(spawnIntervalFrames(RAMP_S / 2)).toBeCloseTo((SPAWN_FRAMES_MAX + SPAWN_FRAMES_MIN) / 2));
  it('past ramp → SPAWN_FRAMES_MIN (plateau)', () =>
    expect(spawnIntervalFrames(RAMP_S * 2)).toBe(SPAWN_FRAMES_MIN));
});

describe('highObstacleProb', () => {
  it('start → 0 (all low, easy)', () => expect(highObstacleProb(0)).toBe(0));
  it('peak → HIGH_PROB_MAX', () => expect(highObstacleProb(RAMP_S)).toBeCloseTo(HIGH_PROB_MAX));
  it('half ramp → half of max', () =>
    expect(highObstacleProb(RAMP_S / 2)).toBeCloseTo(HIGH_PROB_MAX / 2));
  it('past ramp → HIGH_PROB_MAX (plateau)', () =>
    expect(highObstacleProb(RAMP_S * 2)).toBeCloseTo(HIGH_PROB_MAX));
});

describe('scoreAttempt (endless: score = obstacles passed)', () => {
  it('0 obstacles → 0', () => expect(scoreAttempt({ completed: 0 })).toBe(0));
  it('7 obstacles → 7', () => expect(scoreAttempt({ completed: 7 })).toBe(7));
  it('42 obstacles → 42 (unbounded, no 100 cap)', () => expect(scoreAttempt({ completed: 42 })).toBe(42));
  it('negative guard → 0', () => expect(scoreAttempt({ completed: -3 })).toBe(0));
});

describe('finalScore', () => {
  it('empty → 0', () => expect(finalScore([])).toBe(0));
  it('all zero → 0', () =>
    expect(finalScore([{ score: 0 }, { score: 0 }, { score: 0 }])).toBe(0));
  it('picks best attempt', () =>
    expect(finalScore([{ score: 7 }, { score: 23 }, { score: 15 }])).toBe(23));
});
