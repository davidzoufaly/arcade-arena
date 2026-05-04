import { describe, it, expect } from 'vitest';
import { generateCode } from '../shared/score-panel.js';

describe('generateCode', () => {
  it('produces a 4-character alphanumeric code', () => {
    const code = generateCode(15, 1700000000000);
    expect(code).toMatch(/^[A-Z0-9]{4}$/);
  });

  it('is deterministic for same inputs', () => {
    const a = generateCode(15, 1700000000000);
    const b = generateCode(15, 1700000000000);
    expect(a).toBe(b);
  });

  it('changes when score changes', () => {
    const a = generateCode(15, 1700000000000);
    const b = generateCode(16, 1700000000000);
    expect(a).not.toBe(b);
  });

  it('changes when timestamp changes', () => {
    const a = generateCode(15, 1700000000000);
    const b = generateCode(15, 1700000060000);
    expect(a).not.toBe(b);
  });
});
