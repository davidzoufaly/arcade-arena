export const PALM_COUNT_WINDOW = 4;

// Smooths the per-frame palm count over PALM_COUNT_WINDOW frames so a single
// MediaPipe false-positive does not flicker the HUD or trigger a jump.
// Median (not max) rejects 1-frame spikes; real palms still register after
// majority frames. For even-length windows the two middle values average
// and round half-up — leaning slightly toward "registered" on ties so input
// stays responsive.
export function effectivePalmCount(samples) {
  if (!samples || samples.length === 0) return 0;
  const sorted = [...samples].sort((a, b) => a - b);
  const n = sorted.length;
  if (n % 2 === 1) return sorted[(n - 1) >> 1];
  return Math.round((sorted[n / 2 - 1] + sorted[n / 2]) / 2);
}

// Hand-count calibration tuning. See
// docs/superpowers/specs/2026-05-28-dino-hand-calibration-design.md
export const TRACKER_CEILING  = 20;  // hard upper bound; MediaPipe-safe max
export const TRACKER_BUFFER   = 2;   // extra slots over detected N (stragglers)
export const CALIB_TOTAL_S    = 20;  // total calibration phase duration
export const CALIB_GRACE_S    = 3;   // skip the first N seconds (team raising hands)
export const FALLBACK_N       = 4;   // if calibration sees no hands at all
export const MIN_N            = 1;   // lower bound on team size

// Endless difficulty: knobs ramp linearly over the first RAMP_S seconds of live
// play, then plateau at peak — hard but steady, so the score keeps climbing as
// long as the team survives. All four numbers are safe to tune.
export const RAMP_S = 70;
export const SPEED_MIN = 4, SPEED_MAX = 10.2;          // scroll speed (px/frame)
export const SPAWN_FRAMES_MAX = 110, SPAWN_FRAMES_MIN = 56; // gap between spawns
export const HIGH_PROB_MAX = 0.38;                     // chance an obstacle is "high"
export const HIGH_PROB_MIN = 0.20;                     // base high-obstacle chance from t=0

// Solo (individuals mode) difficulty — moderately tighter than the team curve
// (#42). Ramps to peak faster and pushes the peaks past the team ceilings so a
// single player gets a real challenge without the team rotate breaks.
export const RAMP_S_SOLO = 50;
export const SPEED_MAX_SOLO = 11.6;
export const SPAWN_FRAMES_MIN_SOLO = 46;
export const HIGH_PROB_MAX_SOLO = 0.46;

// Peak jump velocity — the ceiling a full team's palm count maps to, and the
// upper bound of the jump meter. Single source of truth so the HUD divisor in
// 3-dino.js and the clamp below can't drift apart.
export const PEAK_JUMP_STRENGTH = 22;

// Solo jump: a single open palm = one jump (#42), with a fixed velocity that
// does NOT scale with detected hand count. Sits between the team per-hand
// values so a one-hand jump clears obstacles but is not as floaty as peak 22.
export const SOLO_JUMP_STRENGTH = 16;

// Wave structure: alternating active-play segments and auto-run rotate breaks.
export const SEGMENT_PLAY_S = 20;  // active obstacle play per wave
export const ROTATE_BREAK_S = 10;  // auto-run break to swap players

// Whole seconds left in the current play segment / rotate break, for the
// on-canvas countdown. Clamped to [0, duration] — mirrors warmupSecondsLeft.
export const segmentSecondsLeft = (elapsedSec) =>
  Math.max(0, Math.min(SEGMENT_PLAY_S, Math.ceil(SEGMENT_PLAY_S - elapsedSec)));
export const rotateSecondsLeft = (elapsedSec) =>
  Math.max(0, Math.min(ROTATE_BREAK_S, Math.ceil(ROTATE_BREAK_S - elapsedSec)));

// 0 palms → no jump. 1..teamN palms → jump velocity scaled so that the team's
// own hand total equals peak jump (PEAK_JUMP_STRENGTH). Base 7 keeps tiny-team
// jumps from feeling identical regardless of palm count. Velocity ~7% higher
// than before → ~15% more clearance height (height ∝ v²/2g), matching the eased
// difficulty.
//
// Uses `??` not `||` so that teamN === 0 stays 0 (then clamped up to MIN_N by
// Math.max), while teamN === null/undefined falls back to FALLBACK_N. This
// makes "teamN=0 → MIN_N" semantics correct, not collapsed into FALLBACK_N.
export function palmCountToJumpStrength(n, teamN) {
  if (n <= 0) return 0;
  const T = Math.max(MIN_N, teamN ?? FALLBACK_N);
  return Math.min(PEAK_JUMP_STRENGTH, Math.round(7 + n * (15 / T)));
}

// Mode of the sample array. Ties resolve to the higher count
// (favor "everyone is in" over a transient drop).
//
// "No signal" cases all collapse to FALLBACK_N:
// - Empty samples (calibration never sampled, e.g., grace window swallowed it all).
// - All zeros (MediaPipe never detected any hands).
// - Zero-dominant traces (mode is 0, even with a few stray 1s).
// In all three, `bestN || FALLBACK_N` short-circuits the falsy 0 to FALLBACK.
// The final clamp to [MIN_N, TRACKER_CEILING] only matters for valid signals.
// `tailFrac` (0<f<=1) restricts the vote to the last fraction of the window,
// so a team that ramps up late (e.g. 2 hands, then everyone raises to 10)
// locks on the SETTLED count, not the early-frame majority. Default 1 = whole
// window (dino's behavior, unchanged). At least 1 sample is always kept.
export function pickCalibratedHandCount(samples, tailFrac = 1) {
  if (!samples.length) return FALLBACK_N;
  const keep = Math.max(1, Math.ceil(samples.length * Math.max(0, Math.min(1, tailFrac))));
  const window = samples.slice(-keep);
  const counts = new Map();
  for (const s of window) counts.set(s, (counts.get(s) || 0) + 1);
  let bestN = 0, bestFreq = -1;
  for (const [n, f] of counts) {
    if (f > bestFreq || (f === bestFreq && n > bestN)) { bestN = n; bestFreq = f; }
  }
  return Math.max(MIN_N, Math.min(TRACKER_CEILING, bestN || FALLBACK_N));
}

// Ramp fraction 0→1 over RAMP_S (or the shorter solo ramp when hard), clamped
// (negative → 0, past ramp → 1).
export function difficultyProgress(elapsedSec, hard = false) {
  return Math.max(0, Math.min(1, elapsedSec / (hard ? RAMP_S_SOLO : RAMP_S)));
}
export function runSpeed(elapsedSec, hard = false) {
  const peak = hard ? SPEED_MAX_SOLO : SPEED_MAX;
  return SPEED_MIN + (peak - SPEED_MIN) * difficultyProgress(elapsedSec, hard);
}
export function spawnIntervalFrames(elapsedSec, hard = false) {
  const min = hard ? SPAWN_FRAMES_MIN_SOLO : SPAWN_FRAMES_MIN;
  return SPAWN_FRAMES_MAX - (SPAWN_FRAMES_MAX - min) * difficultyProgress(elapsedSec, hard);
}
export function highObstacleProb(elapsedSec, hard = false) {
  const max = hard ? HIGH_PROB_MAX_SOLO : HIGH_PROB_MAX;
  return HIGH_PROB_MIN + (max - HIGH_PROB_MIN) * difficultyProgress(elapsedSec, hard);
}

// Endless: the score IS the number of obstacles cleared this attempt.
export function scoreAttempt({ completed }) {
  return Math.max(0, Math.round(completed));
}

export function finalScore(attempts) {
  if (!attempts.length) return 0;
  return Math.max(0, ...attempts.map(a => a.score));
}
