import { describe, it, expect } from 'vitest';
import {
  GESTURE_POOL,
  SEQUENCE_LEN,
  pickSequenceWithRepeats,
  scoreAttempt,
  finalScore,
} from '../ps-offsite-2026/shared/gesture-lock-logic.js';

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
