import { describe, it, expect, vi } from 'vitest';
import { createStageManager } from '../ps-offsite-2026/shared/stages.js';

describe('createStageManager', () => {
  it('starts at stage 1', () => {
    const sm = createStageManager([5, 13, 23], () => {});
    expect(sm.currentStage()).toBe(1);
  });

  it('advances when score crosses threshold', () => {
    const onChange = vi.fn();
    const sm = createStageManager([5, 13, 23], onChange);
    sm.update(4);
    expect(sm.currentStage()).toBe(1);
    sm.update(5);
    expect(sm.currentStage()).toBe(2);
    expect(onChange).toHaveBeenCalledWith(2);
  });

  it('skips multiple stages if score jumps', () => {
    const onChange = vi.fn();
    const sm = createStageManager([5, 13, 23], onChange);
    sm.update(20);
    expect(sm.currentStage()).toBe(3);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('caps at last stage', () => {
    const sm = createStageManager([5, 13, 23], () => {});
    sm.update(100);
    expect(sm.currentStage()).toBe(4);
  });

  it('does not fire onChange if stage unchanged', () => {
    const onChange = vi.fn();
    const sm = createStageManager([5, 13, 23], onChange);
    sm.update(2);
    sm.update(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reset returns to stage 1', () => {
    const sm = createStageManager([5, 13, 23], () => {});
    sm.update(20);
    sm.reset();
    expect(sm.currentStage()).toBe(1);
  });
});
