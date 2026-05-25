import { describe, it, expect } from 'vitest';
import {
  GESTURE_POOL,
  pickSequenceWithRepeats,
  scoreAttempt,
} from '../ps-offsite-2026/shared/gesture-lock-logic.js';

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

  it('fail with 4 completed → 17 (floor of 4/8*35)', () => {
    expect(scoreAttempt({ result: 'fail', completed: 4, timeSec: 12 })).toBe(17);
  });

  it('timeout with 7 completed → 30 (floor of 7/8*35)', () => {
    expect(scoreAttempt({ result: 'timeout', completed: 7, timeSec: 45 })).toBe(30);
  });

  it('partial never reaches success floor — 8/8 fail (impossible state) still caps at 35', () => {
    expect(scoreAttempt({ result: 'fail', completed: 8, timeSec: 30 })).toBe(35);
  });
});
