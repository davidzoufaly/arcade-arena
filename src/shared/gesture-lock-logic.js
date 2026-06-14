import { MIN_N, FALLBACK_N } from './dino-logic.js';

export const GESTURE_POOL = [
  { id: 'Open_Palm',   emoji: '✋',  name: 'Open Palm' },
  { id: 'Closed_Fist', emoji: '✊',  name: 'Fist' },
  { id: 'Thumb_Up',    emoji: '👍', name: 'Thumbs Up' },
  { id: 'Thumb_Down',  emoji: '👎', name: 'Thumbs Down' },
  { id: 'Victory',     emoji: '✌️', name: 'Victory' },
  { id: 'Pointing_Up', emoji: '☝️', name: 'Point Up' },
];

/**
 * @deprecated Use `state.sequenceLen` (computed via `sequenceLengthForTeam`) for new code.
 * Kept exported because the existing test suite imports it directly and the
 * scoreAttempt back-compat default refers to it.
 */
export const SEQUENCE_LEN = 16;

// Individuals (solo) mode: no hand-count calibration to derive length from, so
// a solo guest always gets a fixed 12-gesture sequence (#39). Within
// [SEQUENCE_LEN_MIN, SEQUENCE_LEN_MAX].
export const SOLO_SEQUENCE_LEN = 12;

// Backstop bounds. Floor at 4 so a solo player gets the natural N*4 length
// (1 person → 4 gestures) instead of feeling trivially short. Ceiling at 28
// so a 7+ person team is not drowned inside the 5-minute attempt.
export const SEQUENCE_LEN_MIN = 4;
export const SEQUENCE_LEN_MAX = 28;

// Free seconds per gesture before the success-score timer penalty kicks in.
// Tuned to 0.625 so that the old hard-coded default of 16 gestures lands on
// exactly 10 s of grace — matching the previous baseline and keeping the
// existing scoreAttempt tests passing without modification.
export const TIME_GRACE_PER_GESTURE = 0.625;

// One hand per person → detected count IS the team size. Four gestures per
// person, bounded by [SEQUENCE_LEN_MIN, SEQUENCE_LEN_MAX].
export function sequenceLengthForTeam(teamN) {
  const T = Math.max(MIN_N, teamN ?? FALLBACK_N);
  return Math.max(SEQUENCE_LEN_MIN, Math.min(SEQUENCE_LEN_MAX, T * 4));
}

// Success score: full 100 inside the grace window, then 2 pt per second past.
// Floors at 40 — same floor as before.
export function successScore(timeSec, sequenceLen) {
  const grace = sequenceLen * TIME_GRACE_PER_GESTURE;
  const raw = 100 - 2 * Math.max(0, timeSec - grace);
  return Math.max(40, Math.min(100, Math.round(raw)));
}

// Fail score: completion percentage × 35, sequenceLen-aware.
export function failScore(completed, sequenceLen) {
  return Math.floor((completed / sequenceLen) * 35);
}

export function pickSequenceWithRepeats(pool, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}

export function scoreAttempt({ result, completed, timeSec, sequenceLen = SEQUENCE_LEN }) {
  if (result === 'success') return successScore(timeSec, sequenceLen);
  return failScore(completed, sequenceLen);
}

export function finalScore(attempts) {
  if (!attempts.length) return 0;
  const successes = attempts.filter(a => a.result === 'success');
  const pool = successes.length ? successes : attempts;
  return Math.max(0, ...pool.map(a => a.score));
}
