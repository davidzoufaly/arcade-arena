import { describe, it, expect } from 'vitest';
import {
  LM,
  SKEL_LINES,
  dist,
  angle,
  smoothScore,
} from '../src/shared/pantomime-logic.js';

describe('LM', () => {
  it('exposes MediaPipe pose landmark indices', () => {
    expect(LM.NOSE).toBe(0);
    expect(LM.L_SHOULDER).toBe(11);
    expect(LM.R_SHOULDER).toBe(12);
    expect(LM.L_WRIST).toBe(15);
    expect(LM.R_WRIST).toBe(16);
    expect(LM.L_HIP).toBe(23);
    expect(LM.R_HIP).toBe(24);
    expect(LM.L_ANKLE).toBe(27);
    expect(LM.R_ANKLE).toBe(28);
  });
});

describe('SKEL_LINES', () => {
  it('is an array of [from, to] string pairs', () => {
    expect(Array.isArray(SKEL_LINES)).toBe(true);
    expect(SKEL_LINES.length).toBeGreaterThan(10);
    for (const pair of SKEL_LINES) {
      expect(pair).toHaveLength(2);
      expect(typeof pair[0]).toBe('string');
      expect(typeof pair[1]).toBe('string');
    }
  });
});

describe('dist', () => {
  it('computes euclidean distance', () => {
    expect(dist({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });

  it('returns 0 for identical points', () => {
    expect(dist({ x: 1, y: 2 }, { x: 1, y: 2 })).toBe(0);
  });
});

describe('angle', () => {
  it('returns 180 for collinear points (straight line)', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 1, y: 0 };
    const c = { x: 2, y: 0 };
    expect(angle(a, b, c)).toBeCloseTo(180, 1);
  });

  it('returns 90 for right angle', () => {
    const a = { x: 0, y: 1 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 0 };
    expect(angle(a, b, c)).toBeCloseTo(90, 1);
  });

  it('returns 0 when a vector is zero-length', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 0, y: 0 };
    const c = { x: 1, y: 0 };
    expect(angle(a, b, c)).toBe(0);
  });
});

describe('smoothScore', () => {
  it('returns 1 when value within tolerance', () => {
    expect(smoothScore(10, 10, 1)).toBe(1);
    expect(smoothScore(10.5, 10, 1)).toBe(1);
  });

  it('returns 0 when value is 2*tol or more away', () => {
    expect(smoothScore(12, 10, 1)).toBe(0);
    expect(smoothScore(20, 10, 1)).toBe(0);
  });

  it('falls off linearly between tol and 2*tol', () => {
    expect(smoothScore(11.5, 10, 1)).toBeCloseTo(0.5, 2);
  });
});

import { POSE_POOL } from '../src/shared/pantomime-logic.js';

describe('POSE_POOL', () => {
  it('has 12 poses', () => {
    expect(POSE_POOL).toHaveLength(12);
  });

  it('each pose has required fields', () => {
    for (const p of POSE_POOL) {
      expect(p).toHaveProperty('id');
      expect(p).toHaveProperty('name');
      expect(p).toHaveProperty('emoji');
      expect(p).toHaveProperty('difficulty');
      expect(p).toHaveProperty('timeout');
      expect(p).toHaveProperty('desc');
      expect(p.ref || p.refs).toBeTruthy();
      expect(Array.isArray(p.checks)).toBe(true);
      expect(p.checks.length).toBeGreaterThan(0);
    }
  });

  it('every difficulty is easy/medium/hard', () => {
    for (const p of POSE_POOL) {
      expect(['easy', 'medium', 'hard']).toContain(p.difficulty);
    }
  });

  it('each check has name + fn', () => {
    for (const p of POSE_POOL) {
      for (const c of p.checks) {
        expect(typeof c.name).toBe('string');
        expect(typeof c.fn).toBe('function');
      }
    }
  });

  it('ref has all skeleton joints', () => {
    const required = ['nose', 'lSh', 'rSh', 'lEl', 'rEl', 'lWr', 'rWr', 'lHip', 'rHip', 'lKnee', 'rKnee', 'lAnkle', 'rAnkle'];
    for (const p of POSE_POOL) {
      for (const j of required) {
        expect(p.ref).toHaveProperty(j);
        expect(typeof p.ref[j].x).toBe('number');
        expect(typeof p.ref[j].y).toBe('number');
      }
    }
  });

  it('pool tier counts: 2 easy, 4 medium, 6 hard', () => {
    const tiers = POSE_POOL.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ easy: 2, medium: 4, hard: 6 });
  });
});

import { samplePoses } from '../src/shared/pantomime-logic.js';

describe('samplePoses', () => {
  it('default mix returns 8 solo poses (2 easy + 3 medium + 3 hard)', () => {
    const sample = samplePoses(POSE_POOL);
    expect(sample).toHaveLength(8);
    const tiers = sample.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ easy: 2, medium: 3, hard: 3 });
  });

  it('every pose is solo (single person)', () => {
    for (const p of samplePoses(POSE_POOL)) {
      expect(p.people ?? 1).toBe(1);
    }
  });

  it('tiers appear in escalating order (easy → medium → hard)', () => {
    const rank = { easy: 0, medium: 1, hard: 2 };
    const sample = samplePoses(POSE_POOL);
    for (let i = 1; i < sample.length; i++) {
      expect(rank[sample[i].difficulty]).toBeGreaterThanOrEqual(rank[sample[i - 1].difficulty]);
    }
  });

  it('custom mix returns matching counts', () => {
    const sample = samplePoses(POSE_POOL, { easy: 1, medium: 2, hard: 1 });
    expect(sample).toHaveLength(4);
  });

  it('no duplicates within a tier', () => {
    const sample = samplePoses(POSE_POOL);
    const ids = sample.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every sampled pose comes from the pool', () => {
    const sample = samplePoses(POSE_POOL);
    const poolIds = new Set(POSE_POOL.map(p => p.id));
    for (const p of sample) {
      expect(poolIds.has(p.id)).toBe(true);
    }
  });

  it('different medium selections across calls (probabilistic — 20 runs)', () => {
    const firstMedium = samplePoses(POSE_POOL).filter(p => p.difficulty === 'medium').map(p => p.id).sort().join(',');
    let sawDifferent = false;
    for (let i = 0; i < 20; i++) {
      const m = samplePoses(POSE_POOL).filter(p => p.difficulty === 'medium').map(p => p.id).sort().join(',');
      if (m !== firstMedium) { sawDifferent = true; break; }
    }
    expect(sawDifferent).toBe(true);
  });

  it('throws if tier under-resourced', () => {
    expect(() => samplePoses(POSE_POOL, { easy: 5, medium: 1, hard: 1 })).toThrow(/not enough easy poses/);
  });
});

import { scorePose, finalScore } from '../src/shared/pantomime-logic.js';

describe('scorePose', () => {
  it('returns 0 when not locked', () => {
    expect(scorePose({ sim: 0.95, locked: false, elapsed: 1, timeout: 25 })).toBe(0);
  });

  it('blends form quality (50) with speed bonus (50)', () => {
    // perfect form, locked instantly (no time elapsed) -> full 100
    expect(scorePose({ sim: 1, locked: true, elapsed: 0, timeout: 25 })).toBe(100);
    // perfect form, locked at the buzzer -> speed bonus gone, quality only
    expect(scorePose({ sim: 1, locked: true, elapsed: 25, timeout: 25 })).toBe(50);
    // perfect form, half the time left -> 50 + 25
    expect(scorePose({ sim: 1, locked: true, elapsed: 12.5, timeout: 25 })).toBe(75);
  });

  it('scales quality component by sim', () => {
    // sim 0.85, locked instantly -> 0.85*50 + 50 = 92.5 -> 93
    expect(scorePose({ sim: 0.85, locked: true, elapsed: 0, timeout: 25 })).toBe(93);
  });

  it('clamps quality and speed into range', () => {
    expect(scorePose({ sim: 1.5, locked: true, elapsed: 0, timeout: 25 })).toBe(100);
    expect(scorePose({ sim: -0.2, locked: true, elapsed: 30, timeout: 25 })).toBe(0);
  });

  it('falls back to quality-only when timeout is missing', () => {
    expect(scorePose({ sim: 0.9, locked: true })).toBe(45);
  });
});

describe('finalScore', () => {
  it('returns 0 for empty array', () => {
    expect(finalScore([])).toBe(0);
  });

  it('rounds the average', () => {
    expect(finalScore([80, 90, 100, 70, 60, 50, 40])).toBe(70);
  });

  it('handles all zeros', () => {
    expect(finalScore([0, 0, 0, 0, 0, 0, 0])).toBe(0);
  });

  it('handles partial run (skipped poses included as 0)', () => {
    expect(finalScore([100, 100, 0, 0, 0, 0, 0])).toBe(29);
  });
});
