import { describe, it, expect } from 'vitest';
import {
  LM,
  SKEL_LINES,
  dist,
  angle,
  smoothScore,
} from '../ps-offsite-2026/shared/pantomime-logic.js';

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

import { POSE_POOL } from '../ps-offsite-2026/shared/pantomime-logic.js';

describe('POSE_POOL', () => {
  it('has 14 poses', () => {
    expect(POSE_POOL).toHaveLength(14);
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

  it('every difficulty is easy/medium/hard/duo', () => {
    for (const p of POSE_POOL) {
      expect(['easy', 'medium', 'hard', 'duo']).toContain(p.difficulty);
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
      if (!p.ref) continue; // duo poses use `refs`, checked separately
      for (const j of required) {
        expect(p.ref).toHaveProperty(j);
        expect(typeof p.ref[j].x).toBe('number');
        expect(typeof p.ref[j].y).toBe('number');
      }
    }
  });

  it('pool tier counts: 2 easy, 4 medium, 6 hard, 2 duo', () => {
    const tiers = POSE_POOL.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ easy: 2, medium: 4, hard: 6, duo: 2 });
  });
});

import { samplePoses } from '../ps-offsite-2026/shared/pantomime-logic.js';

describe('samplePoses', () => {
  it('default mix returns 8 poses (2 easy + 2 medium + 2 hard + 2 duo)', () => {
    const sample = samplePoses(POSE_POOL);
    expect(sample).toHaveLength(8);
    const tiers = sample.reduce((acc, p) => {
      acc[p.difficulty] = (acc[p.difficulty] || 0) + 1;
      return acc;
    }, {});
    expect(tiers).toEqual({ easy: 2, medium: 2, hard: 2, duo: 2 });
  });

  it('the two duo poses are always last', () => {
    for (let i = 0; i < 10; i++) {
      const sample = samplePoses(POSE_POOL);
      expect(sample[6].people).toBe(2);
      expect(sample[7].people).toBe(2);
      // all earlier poses are solo
      for (let k = 0; k < 6; k++) expect(sample[k].people ?? 1).toBe(1);
    }
  });

  it('throws if duo tier under-resourced', () => {
    expect(() => samplePoses(POSE_POOL, { easy: 1, medium: 1, hard: 1, duo: 5 }))
      .toThrow(/not enough duo poses/);
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

import { scorePose, finalScore } from '../ps-offsite-2026/shared/pantomime-logic.js';

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

// ---- Duo poses ----
function mkBody(parts) {
  const lm = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 1 }));
  for (const [k, v] of Object.entries(parts)) lm[LM[k]] = { x: v.x, y: v.y, visibility: 1 };
  return lm;
}
const getPose = (id) => POSE_POOL.find(p => p.id === id);

describe('duo poses presence', () => {
  it('POSE_POOL has the two duo poses, tagged people:2 and difficulty duo', () => {
    for (const id of ['arch', 'twins']) {
      const p = getPose(id);
      expect(p).toBeDefined();
      expect(p.people).toBe(2);
      expect(p.difficulty).toBe('duo');
      expect(Array.isArray(p.refs)).toBe(true);
      expect(p.refs).toHaveLength(2);
      expect(p.timeout).toBe(25);
      expect(p.checks.length).toBeGreaterThan(0);
    }
  });

  it('duo refs contain all skeleton joints', () => {
    const required = ['nose','lSh','rSh','lEl','rEl','lWr','rWr','lHip','rHip','lKnee','rKnee','lAnkle','rAnkle'];
    for (const id of ['arch', 'twins']) {
      for (const ref of getPose(id).refs) {
        for (const j of required) {
          expect(typeof ref[j].x).toBe('number');
          expect(typeof ref[j].y).toBe('number');
        }
      }
    }
  });
});

describe('Human Arch checks', () => {
  const arch = () => getPose('arch');
  // Left person (smaller hip x) and right person, both arms overhead,
  // inner wrists meeting in the middle (~x 0.5), arms straight.
  const good = () => {
    const left = mkBody({
      NOSE:{x:0.25,y:0.15}, L_SHOULDER:{x:0.20,y:0.30}, R_SHOULDER:{x:0.30,y:0.30},
      L_ELBOW:{x:0.16,y:0.15}, R_ELBOW:{x:0.40,y:0.13}, L_WRIST:{x:0.12,y:0.02}, R_WRIST:{x:0.48,y:0.02},
      L_HIP:{x:0.22,y:0.60}, R_HIP:{x:0.28,y:0.60},
    });
    const right = mkBody({
      NOSE:{x:0.75,y:0.15}, L_SHOULDER:{x:0.70,y:0.30}, R_SHOULDER:{x:0.80,y:0.30},
      L_ELBOW:{x:0.60,y:0.13}, R_ELBOW:{x:0.84,y:0.15}, L_WRIST:{x:0.52,y:0.02}, R_WRIST:{x:0.88,y:0.02},
      L_HIP:{x:0.72,y:0.60}, R_HIP:{x:0.78,y:0.60},
    });
    return [left, right];
  };

  it('scores high (mean > 0.85) for a correct arch', () => {
    const [a, b] = good();
    const vals = arch().checks.map(c => c.fn(a, b));
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    expect(mean).toBeGreaterThan(0.85);
  });

  it('apex check is low when inner hands are far apart', () => {
    const [a, b] = good();
    // pull both inner wrists outward so they no longer meet
    a[LM.R_WRIST] = { x: 0.05, y: 0.02, visibility: 1 };
    b[LM.L_WRIST] = { x: 0.95, y: 0.02, visibility: 1 };
    const apex = arch().checks.find(c => c.name.includes('apex')).fn(a, b);
    expect(apex).toBeLessThan(0.3);
  });

  it('arms-overhead check is low when arms are down', () => {
    const [a, b] = good();
    a[LM.L_WRIST] = { x: 0.20, y: 0.55, visibility: 1 };
    a[LM.R_WRIST] = { x: 0.30, y: 0.55, visibility: 1 };
    const leftArms = arch().checks[0].fn(a, b); // "Left person arms overhead"
    expect(leftArms).toBeLessThan(0.3);
  });

  it('arms-overhead check is low when the right person\'s arms are down', () => {
    const [a, b] = good();
    b[LM.L_WRIST] = { x: 0.70, y: 0.55, visibility: 1 };
    b[LM.R_WRIST] = { x: 0.80, y: 0.55, visibility: 1 };
    const rightArms = getPose('arch').checks[1].fn(a, b); // "Right person arms overhead"
    expect(rightArms).toBeLessThan(0.3);
  });
});

describe('Mirror Twins checks', () => {
  const twins = () => getPose('twins');
  // Both: one arm up (above nose), one arm out at shoulder height, RAISED on
  // opposite sides (mirror). Left person raises their +x arm, right person raises
  // their -x arm.
  const good = () => {
    const left = mkBody({
      NOSE:{x:0.25,y:0.16}, L_SHOULDER:{x:0.20,y:0.30}, R_SHOULDER:{x:0.30,y:0.30},
      L_WRIST:{x:0.08,y:0.30}, R_WRIST:{x:0.34,y:0.02},   // right (+x) arm up, left arm out
      L_HIP:{x:0.22,y:0.60}, R_HIP:{x:0.28,y:0.60},
    });
    const right = mkBody({
      NOSE:{x:0.75,y:0.16}, L_SHOULDER:{x:0.70,y:0.30}, R_SHOULDER:{x:0.80,y:0.30},
      L_WRIST:{x:0.66,y:0.02}, R_WRIST:{x:0.92,y:0.30},   // left (-x) arm up, right arm out
      L_HIP:{x:0.72,y:0.60}, R_HIP:{x:0.78,y:0.60},
    });
    return [left, right];
  };

  it('scores high (mean > 0.85) when both make the shape, mirrored', () => {
    const [a, b] = good();
    const vals = twins().checks.map(c => c.fn(a, b));
    const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
    expect(mean).toBeGreaterThan(0.85);
  });

  it('mirror check is 0 when both raise the same side', () => {
    const [a, b] = good();
    // make right person raise the SAME (+x) arm as left -> not mirrored
    b[LM.L_WRIST] = { x: 0.66, y: 0.30, visibility: 1 }; // left arm now out
    b[LM.R_WRIST] = { x: 0.92, y: 0.02, visibility: 1 }; // right (+x) arm now up
    const mirror = twins().checks.find(c => c.name.toLowerCase().includes('mirror')).fn(a, b);
    expect(mirror).toBe(0);
  });

  it('left-person shape check scores low when both arms are down', () => {
    const [a, b] = good();
    // Both wrists at hip level, near body center — no arm is up or extended out
    a[LM.L_WRIST] = { x: 0.22, y: 0.55, visibility: 1 };
    a[LM.R_WRIST] = { x: 0.28, y: 0.55, visibility: 1 };
    const shapeLeft = twins().checks[0].fn(a, b); // "Left person: one arm up, one out"
    expect(shapeLeft).toBeLessThan(0.4);
  });

  it('right-person shape check scores low when both arms are down', () => {
    const [a, b] = good();
    b[LM.L_WRIST] = { x: 0.72, y: 0.55, visibility: 1 };
    b[LM.R_WRIST] = { x: 0.78, y: 0.55, visibility: 1 };
    const shapeRight = getPose('twins').checks[1].fn(a, b); // "Right person: one arm up, one out"
    expect(shapeRight).toBeLessThan(0.4);
  });
});
