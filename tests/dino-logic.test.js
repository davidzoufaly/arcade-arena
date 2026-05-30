import { describe, it, expect } from 'vitest';
import {
  PALM_COUNT_WINDOW,
  TRACKER_CEILING,
  TRACKER_BUFFER,
  CALIB_TOTAL_S,
  CALIB_GRACE_S,
  FALLBACK_N,
  MIN_N,
  RAMP_S,
  SPEED_MIN, SPEED_MAX,
  SPAWN_FRAMES_MAX, SPAWN_FRAMES_MIN,
  HIGH_PROB_MAX,
  palmCountToJumpStrength,
  pickCalibratedHandCount,
  effectivePalmCount,
  difficultyProgress,
  runSpeed,
  spawnIntervalFrames,
  highObstacleProb,
  scoreAttempt,
  finalScore,
} from '../ps-offsite-2026/shared/dino-logic.js';

describe('constants', () => {
  it('PALM_COUNT_WINDOW is 4', () => expect(PALM_COUNT_WINDOW).toBe(4));
  it('TRACKER_CEILING is 20', () => expect(TRACKER_CEILING).toBe(20));
  it('TRACKER_BUFFER is 2', () => expect(TRACKER_BUFFER).toBe(2));
  it('CALIB_TOTAL_S is 20', () => expect(CALIB_TOTAL_S).toBe(20));
  it('CALIB_GRACE_S is 3', () => expect(CALIB_GRACE_S).toBe(3));
  it('FALLBACK_N is 4', () => expect(FALLBACK_N).toBe(4));
  it('MIN_N is 1', () => expect(MIN_N).toBe(1));
  it('RAMP_S is 70', () => expect(RAMP_S).toBe(70));
});

describe('palmCountToJumpStrength', () => {
  it('0 palms → 0',            () => expect(palmCountToJumpStrength(0, 4)).toBe(0));
  it('negative palms → 0',     () => expect(palmCountToJumpStrength(-3, 4)).toBe(0));
  it('teamN=2, 1 palm → 15',   () => expect(palmCountToJumpStrength(1, 2)).toBe(15));
  it('teamN=2, 2 palms → 22',  () => expect(palmCountToJumpStrength(2, 2)).toBe(22));
  it('teamN=7, 4 palms → 16',  () => expect(palmCountToJumpStrength(4, 7)).toBe(16));
  it('teamN=7, 7 palms → 22',  () => expect(palmCountToJumpStrength(7, 7)).toBe(22));
  it('teamN=14, 14 palms → 22',           () => expect(palmCountToJumpStrength(14, 14)).toBe(22));
  it('teamN=14, 20 palms → 22 (clamped)', () => expect(palmCountToJumpStrength(20, 14)).toBe(22));
  it('teamN nullish → uses FALLBACK_N (4)', () => expect(palmCountToJumpStrength(4, null)).toBe(palmCountToJumpStrength(4, 4)));
  it('teamN undefined → uses FALLBACK_N',   () => expect(palmCountToJumpStrength(4, undefined)).toBe(palmCountToJumpStrength(4, 4)));
  // teamN=0 means "no team detected, but value was supplied" — clamped up to
  // MIN_N (1). One palm against teamN=0 = peak jump 22.
  it('teamN=0 → clamped to MIN_N',          () => expect(palmCountToJumpStrength(1, 0)).toBe(22));
  it('teamN=0, 2 palms → still clamped to 22', () => expect(palmCountToJumpStrength(2, 0)).toBe(22));
});

describe('pickCalibratedHandCount', () => {
  it('empty → FALLBACK_N',              () => expect(pickCalibratedHandCount([])).toBe(4));
  it('all zeros → FALLBACK_N',          () => expect(pickCalibratedHandCount([0,0,0])).toBe(4));
  it('clear mode',                       () => expect(pickCalibratedHandCount([4,4,4,5,4])).toBe(4));
  it('tie resolves to higher',           () => expect(pickCalibratedHandCount([6,6,7,7])).toBe(7));
  it('clamps above ceiling',             () => expect(pickCalibratedHandCount([25,25,25])).toBe(20));
  it('zero-dominant → FALLBACK_N',       () => expect(pickCalibratedHandCount([0,0,1])).toBe(4));
  it('ignores transient spike (noise)',  () => expect(pickCalibratedHandCount([10,10,10,10,15,10])).toBe(10));
  it('ignores drop-out (noise)',          () => expect(pickCalibratedHandCount([8,8,7,8,8,7,8,8,8,7])).toBe(8));
  it('uniform low signal',                () => expect(pickCalibratedHandCount([1,1,1])).toBe(1));
});

describe('effectivePalmCount (per-frame smoother — rejects flicker)', () => {
  it('empty → 0',                            () => expect(effectivePalmCount([])).toBe(0));
  it('undefined → 0',                        () => expect(effectivePalmCount(undefined)).toBe(0));
  it('all zeros → 0',                        () => expect(effectivePalmCount([0,0,0,0])).toBe(0));
  it('single-frame phantom rejected',        () => expect(effectivePalmCount([0,0,0,1])).toBe(0));
  it('two-frame phantom still rejected',     () => expect(effectivePalmCount([0,0,1,1])).toBe(1));
  it('three-frame raise registers',          () => expect(effectivePalmCount([0,1,1,1])).toBe(1));
  it('stable 4-frame raise',                 () => expect(effectivePalmCount([1,1,1,1])).toBe(1));
  it('higher-value phantom rejected',        () => expect(effectivePalmCount([0,0,0,2])).toBe(0));
  it('drop-out from stable raise still 1',   () => expect(effectivePalmCount([1,1,0,1])).toBe(1));
  it('rising team count [1,2,3,4] → 3 (round 2.5 up)', () =>
    expect(effectivePalmCount([1,2,3,4])).toBe(3));
  it('uniform team of 5 stays 5',            () => expect(effectivePalmCount([5,5,5,5])).toBe(5));
  it('odd-length window picks middle',       () => expect(effectivePalmCount([0,1,2])).toBe(1));
  it('single-element window returns it',     () => expect(effectivePalmCount([7])).toBe(7));
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
