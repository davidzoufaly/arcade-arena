import { describe, it, expect } from 'vitest';
import { isPalmOpen, isFist, isVictorySign } from '../src/shared/vision.js';

// Minimal 21-landmark hand; only finger tips/pips drive these helpers.
// tipY/pipY are 4-element arrays for index, middle, ring, pinky.
function hand(tipY, pipY) {
  const h = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const tips = [8, 12, 16, 20], pips = [6, 10, 14, 18];
  tips.forEach((t, i) => { h[t] = { x: 0.5, y: tipY[i], z: 0 }; });
  pips.forEach((p, i) => { h[p] = { x: 0.5, y: pipY[i], z: 0 }; });
  return h;
}
const PALM = hand([0.1, 0.1, 0.1, 0.1], [0.2, 0.2, 0.2, 0.2]); // all tips above pips
const FIST = hand([0.3, 0.3, 0.3, 0.3], [0.2, 0.2, 0.2, 0.2]); // all tips below pips
const VICTORY = hand([0.1, 0.1, 0.3, 0.3], [0.2, 0.2, 0.2, 0.2]); // index+middle up, ring+pinky down
const POINT = hand([0.1, 0.3, 0.3, 0.3], [0.2, 0.2, 0.2, 0.2]); // index up only
const LEVEL = hand([0.2, 0.2, 0.2, 0.2], [0.2, 0.2, 0.2, 0.2]); // all tips level w/ pips

describe('fixtures sanity', () => {
  it('PALM reads as open palm', () => expect(isPalmOpen(PALM)).toBe(true));
  it('FIST reads as fist', () => expect(isFist(FIST)).toBe(true));
});

describe('isVictorySign (the ready pose ✌️)', () => {
  it('null → false', () => expect(isVictorySign(null)).toBe(false));
  it('open palm → false', () => expect(isVictorySign(PALM)).toBe(false));
  it('fist → false', () => expect(isVictorySign(FIST)).toBe(false));
  it('victory: index+middle up, ring+pinky down → true', () => expect(isVictorySign(VICTORY)).toBe(true));
  it('single finger point → false', () => expect(isVictorySign(POINT)).toBe(false));
  it('fingers level → false', () => expect(isVictorySign(LEVEL)).toBe(false));
});
