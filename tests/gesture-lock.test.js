import { describe, it, expect } from 'vitest';
import {
  GESTURE_POOL,
  SEQUENCE_LEN,
  SEQUENCE_LEN_MIN,
  SEQUENCE_LEN_MAX,
  TIME_GRACE_PER_GESTURE,
  pickSequenceWithRepeats,
  sequenceLengthForTeam,
  successScore,
  failScore,
  scoreAttempt,
  finalScore,
} from '../src/shared/gesture-lock-logic.js';

describe('SEQUENCE_LEN', () => {
  it('is 16', () => {
    expect(SEQUENCE_LEN).toBe(16);
  });
});

describe('GESTURE_POOL', () => {
  it('has exactly 6 gestures', () => {
    expect(GESTURE_POOL).toHaveLength(6);
  });

  it('contains expected MediaPipe gesture ids', () => {
    const ids = GESTURE_POOL.map(g => g.id).sort();
    expect(ids).toEqual([
      'Closed_Fist', 'Open_Palm', 'Pointing_Up',
      'Thumb_Down', 'Thumb_Up', 'Victory',
    ]);
  });

  it('each gesture has id, emoji, name', () => {
    for (const g of GESTURE_POOL) {
      expect(g).toHaveProperty('id');
      expect(g).toHaveProperty('emoji');
      expect(g).toHaveProperty('name');
    }
  });
});

describe('pickSequenceWithRepeats', () => {
  it('returns array of requested length', () => {
    const seq = pickSequenceWithRepeats(GESTURE_POOL, 8);
    expect(seq).toHaveLength(8);
  });

  it('every element comes from the pool', () => {
    const seq = pickSequenceWithRepeats(GESTURE_POOL, 8);
    const ids = new Set(GESTURE_POOL.map(g => g.id));
    for (const g of seq) {
      expect(ids.has(g.id)).toBe(true);
    }
  });

  it('permits repeats — across 200 runs of length 8 from pool of 6, at least one run has a repeat', () => {
    let sawRepeat = false;
    for (let i = 0; i < 200; i++) {
      const seq = pickSequenceWithRepeats(GESTURE_POOL, 8);
      const ids = seq.map(g => g.id);
      if (new Set(ids).size < ids.length) { sawRepeat = true; break; }
    }
    expect(sawRepeat).toBe(true);
  });

  it('handles length 0', () => {
    expect(pickSequenceWithRepeats(GESTURE_POOL, 0)).toEqual([]);
  });
});

describe('scoreAttempt', () => {
  it('success at 10s grace edge → 100', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 10 })).toBe(100);
  });

  it('success under grace (5s) → 100', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 5 })).toBe(100);
  });

  it('success at 20s → 80', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 20 })).toBe(80);
  });

  it('success at 30s → 60', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 30 })).toBe(60);
  });

  it('success at 45s → clamped to floor 40', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 45 })).toBe(40);
  });

  it('success never exceeds 100', () => {
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 0 })).toBe(100);
  });

  it('fail with 0 completed → 0', () => {
    expect(scoreAttempt({ result: 'fail', completed: 0, timeSec: 10 })).toBe(0);
  });

  it('fail with 8 completed → 17 (floor of 8/16*35)', () => {
    expect(scoreAttempt({ result: 'fail', completed: 8, timeSec: 12 })).toBe(17);
  });

  it('timeout with 14 completed → 30 (floor of 14/16*35)', () => {
    expect(scoreAttempt({ result: 'timeout', completed: 14, timeSec: 45 })).toBe(30);
  });

  it('partial never reaches success floor — 15/16 fail still caps below 40', () => {
    expect(scoreAttempt({ result: 'fail', completed: 15, timeSec: 30 })).toBe(32);
  });
});

describe('sequence-length constants', () => {
  it('SEQUENCE_LEN_MIN is 4', () => expect(SEQUENCE_LEN_MIN).toBe(4));
  it('SEQUENCE_LEN_MAX is 28', () => expect(SEQUENCE_LEN_MAX).toBe(28));
  it('TIME_GRACE_PER_GESTURE is 0.625', () => expect(TIME_GRACE_PER_GESTURE).toBe(0.625));
  it('SEQUENCE_LEN (back-compat) is still 16', () => expect(SEQUENCE_LEN).toBe(16));
});

describe('sequenceLengthForTeam', () => {
  it('teamN nullish → FALLBACK_N (4) → 16 (natural, no clamp)', () => {
    expect(sequenceLengthForTeam(null)).toBe(16);
    expect(sequenceLengthForTeam(undefined)).toBe(16);
  });
  it('teamN=0 → clamped MIN_N (1) → 4 → MIN (4)', () => expect(sequenceLengthForTeam(0)).toBe(4));
  it('teamN=1 (solo) → 4',                () => expect(sequenceLengthForTeam(1)).toBe(4));
  it('teamN=2 → 8 (natural N*4)',         () => expect(sequenceLengthForTeam(2)).toBe(8));
  it('teamN=3 → 12',                       () => expect(sequenceLengthForTeam(3)).toBe(12));
  it('teamN=4 → 16',                       () => expect(sequenceLengthForTeam(4)).toBe(16));
  it('teamN=5 → 20', () => expect(sequenceLengthForTeam(5)).toBe(20));
  it('teamN=7 → 28 (max, no clamp)', () => expect(sequenceLengthForTeam(7)).toBe(28));
  it('teamN=8 → 32 → clamped to MAX (28)', () => expect(sequenceLengthForTeam(8)).toBe(28));
  it('teamN=14 → 56 → clamped to MAX (28)', () => expect(sequenceLengthForTeam(14)).toBe(28));
  it('teamN=20 → 80 → clamped to MAX (28)', () => expect(sequenceLengthForTeam(20)).toBe(28));
});

describe('successScore', () => {
  it('inside grace at len=16 → 100',                 () => expect(successScore(0, 16)).toBe(100));
  it('at grace edge (10 s for len=16) → 100',         () => expect(successScore(10.0, 16)).toBe(100));
  it('5 s past grace at len=16 → 90',                 () => expect(successScore(15.0, 16)).toBe(90));
  it('30 s past grace at len=16 → floored to 40',     () => expect(successScore(40.0, 16)).toBe(40));
  it('len=8 floors earlier (grace 5 s) at 35 s',      () => expect(successScore(35.0, 8)).toBe(40));
  it('len=28 floors later (grace 17.5 s) at 47.5 s',  () => expect(successScore(47.5, 28)).toBe(40));
  it('len=8 inside grace at 4 s → 100',               () => expect(successScore(4.0, 8)).toBe(100));
  it('len=8 at 7 s (2 s past grace) → 96',            () => expect(successScore(7.0, 8)).toBe(96));
});

describe('failScore', () => {
  it('len=16, completed=8 → 17 (floor of 50% × 35)', () => expect(failScore(8, 16)).toBe(17));
  it('len=28, completed=8 → 10 (floor of 28.6% × 35)', () => expect(failScore(8, 28)).toBe(10));
  it('len=16, completed=0 → 0',                       () => expect(failScore(0, 16)).toBe(0));
  it('len=8, completed=8 → 35 (100% × 35)',           () => expect(failScore(8, 8)).toBe(35));
});

describe('scoreAttempt with explicit sequenceLen', () => {
  it('success at sequenceLen=8 grace edge (5 s) → 100', () =>
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 5, sequenceLen: 8 })).toBe(100));
  it('success at sequenceLen=8, 3 s past grace → 94', () =>
    expect(scoreAttempt({ result: 'success', completed: 8, timeSec: 8, sequenceLen: 8 })).toBe(94));
  it('success at sequenceLen=28 grace edge (17.5 s) → 100', () =>
    expect(scoreAttempt({ result: 'success', completed: 28, timeSec: 17.5, sequenceLen: 28 })).toBe(100));
  it('fail at sequenceLen=28, completed=14 → 17', () =>
    expect(scoreAttempt({ result: 'fail', completed: 14, timeSec: 30, sequenceLen: 28 })).toBe(17));
});

describe('finalScore', () => {
  it('returns 0 for empty attempts', () => {
    expect(finalScore([])).toBe(0);
  });

  it('returns the only success score when one success + two fails', () => {
    const attempts = [
      { result: 'fail', completed: 3, score: 13 },
      { result: 'success', completed: 8, score: 60 },
      { result: 'fail', completed: 5, score: 21 },
    ];
    expect(finalScore(attempts)).toBe(60);
  });

  it('picks max across multiple successes', () => {
    const attempts = [
      { result: 'success', completed: 8, score: 50 },
      { result: 'success', completed: 8, score: 80 },
      { result: 'fail', completed: 6, score: 26 },
    ];
    expect(finalScore(attempts)).toBe(80);
  });

  it('picks max partial when no successes', () => {
    const attempts = [
      { result: 'fail', completed: 2, score: 8 },
      { result: 'timeout', completed: 5, score: 21 },
      { result: 'fail', completed: 4, score: 17 },
    ];
    expect(finalScore(attempts)).toBe(21);
  });

  it('any success beats any partial', () => {
    const attempts = [
      { result: 'fail', completed: 7, score: 30 },
      { result: 'success', completed: 8, score: 40 },
    ];
    expect(finalScore(attempts)).toBe(40);
  });
});
