import { describe, it, expect } from 'vitest';
import { rms, smooth, SustainTracker } from '../shared/audio.js';

describe('rms', () => {
  it('returns 0 for zeros', () => {
    expect(rms(new Float32Array([0, 0, 0]))).toBe(0);
  });
  it('returns ~1 for full-scale square wave', () => {
    expect(rms(new Float32Array([1, -1, 1, -1]))).toBeCloseTo(1);
  });
});

describe('smooth', () => {
  it('averages over window', () => {
    const s = smooth(0.5);
    expect(s.next(0)).toBeCloseTo(0); // first sample
    expect(s.next(1)).toBeCloseTo(0.5); // (0+1)/2
  });
});

describe('SustainTracker', () => {
  it('reports sustained when amplitude stays above threshold for window ms', () => {
    const t = new SustainTracker({ threshold: 0.3, windowMs: 1000 });
    t.feed(0.5, 0);
    t.feed(0.5, 500);
    expect(t.isSustained()).toBe(false);
    t.feed(0.5, 1000);
    expect(t.isSustained()).toBe(true);
  });

  it('resets when amplitude drops below threshold', () => {
    const t = new SustainTracker({ threshold: 0.3, windowMs: 1000 });
    t.feed(0.5, 0);
    t.feed(0.1, 500); // drop below threshold, restart pending
    t.feed(0.5, 1000); // restart timer at 1000
    t.feed(0.5, 1900); // 900ms elapsed since restart
    expect(t.isSustained()).toBe(false);
    t.feed(0.5, 2000); // 1000ms elapsed → sustained
    expect(t.isSustained()).toBe(true);
  });
});
