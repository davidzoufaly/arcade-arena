export const PALM_COUNT_WINDOW = 4;

// Endless difficulty: knobs ramp linearly over the first RAMP_S seconds of live
// play, then plateau at peak — hard but steady, so the score keeps climbing as
// long as the team survives. All four numbers are safe to tune.
export const RAMP_S = 60;
export const SPEED_MIN = 4, SPEED_MAX = 12;            // scroll speed (px/frame)
export const SPAWN_FRAMES_MAX = 110, SPAWN_FRAMES_MIN = 48; // gap between spawns
export const HIGH_PROB_MAX = 0.45;                     // chance an obstacle is "high"

// 0 palms → no jump. 1..8 palms → jump velocity 8..20 (clamped).
export function palmCountToJumpStrength(n) {
  if (n <= 0) return 0;
  return Math.min(20, 6 + n * 2);
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
