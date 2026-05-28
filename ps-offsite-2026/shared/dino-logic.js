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
export const RAMP_S = 60;
export const SPEED_MIN = 4, SPEED_MAX = 12;            // scroll speed (px/frame)
export const SPAWN_FRAMES_MAX = 110, SPAWN_FRAMES_MIN = 48; // gap between spawns
export const HIGH_PROB_MAX = 0.45;                     // chance an obstacle is "high"

// 0 palms → no jump. 1..teamN palms → jump velocity scaled so that the team's
// own hand total equals peak jump (20). Base 6 keeps tiny-team jumps from
// feeling identical regardless of palm count.
//
// Uses `??` not `||` so that teamN === 0 stays 0 (then clamped up to MIN_N by
// Math.max), while teamN === null/undefined falls back to FALLBACK_N. This
// makes "teamN=0 → MIN_N" semantics correct, not collapsed into FALLBACK_N.
export function palmCountToJumpStrength(n, teamN) {
  if (n <= 0) return 0;
  const T = Math.max(MIN_N, teamN ?? FALLBACK_N);
  return Math.min(20, Math.round(6 + n * (14 / T)));
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
export function pickCalibratedHandCount(samples) {
  if (!samples.length) return FALLBACK_N;
  const counts = new Map();
  for (const s of samples) counts.set(s, (counts.get(s) || 0) + 1);
  let bestN = 0, bestFreq = -1;
  for (const [n, f] of counts) {
    if (f > bestFreq || (f === bestFreq && n > bestN)) { bestN = n; bestFreq = f; }
  }
  return Math.max(MIN_N, Math.min(TRACKER_CEILING, bestN || FALLBACK_N));
}

// Ramp fraction 0→1 over RAMP_S, clamped (negative → 0, past ramp → 1).
export function difficultyProgress(elapsedSec) {
  return Math.max(0, Math.min(1, elapsedSec / RAMP_S));
}
export function runSpeed(elapsedSec) {
  return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * difficultyProgress(elapsedSec);
}
export function spawnIntervalFrames(elapsedSec) {
  return SPAWN_FRAMES_MAX - (SPAWN_FRAMES_MAX - SPAWN_FRAMES_MIN) * difficultyProgress(elapsedSec);
}
export function highObstacleProb(elapsedSec) {
  return HIGH_PROB_MAX * difficultyProgress(elapsedSec);
}

// Endless: the score IS the number of obstacles cleared this attempt.
export function scoreAttempt({ completed }) {
  return Math.max(0, Math.round(completed));
}

export function finalScore(attempts) {
  if (!attempts.length) return 0;
  return Math.max(0, ...attempts.map(a => a.score));
}
