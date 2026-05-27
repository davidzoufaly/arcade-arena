export const GAIN = 25;
export const GRAVITY = 0.28;

// Voice amplitude above the calibrated noise floor → upward lift.
export function ampToThrust(amp, floor) {
  return Math.max(0, amp - floor) * GAIN;
}

// --- Responsive (target-velocity) flight model ---------------------------
// Voice level maps directly to vertical speed instead of acceleration, so
// control feels real-time: louder → rise now, silence → fall now. No coasting.
export const METER_MAX = 0.30; // amplitude that fills the volume bar / commands full rise
export const FALL_V = 7;       // downward speed at/below the noise floor (empty bar)
export const RISE_CAP = 12;    // upward speed at/above METER_MAX (full bar)
export const RESPONSE = 0.4;   // how fast vy chases its target (0..1 per frame); higher = snappier, less float

// Vertical speed the orb wants *right now*, mapped linearly across the visible
// meter range [floor .. METER_MAX]: empty bar → +FALL_V (drop), full bar →
// -RISE_CAP (climb), half → hover. The orb tracks exactly what the bar shows.
export function targetVelocity(amp, floor, meterMax = METER_MAX) {
  const span = meterMax - floor;
  const t = span > 0 ? Math.min(1, Math.max(0, (amp - floor) / span)) : 0;
  return FALL_V - t * (FALL_V + RISE_CAP);
}

// One frame of flight: ease current vy toward its target. dt is in 60fps frames.
export function nextVelocity(vy, amp, floor, dt, meterMax = METER_MAX) {
  const target = targetVelocity(amp, floor, meterMax);
  const k = Math.min(1, RESPONSE * dt);
  const v = vy + (target - vy) * k;
  return Math.max(-RISE_CAP, Math.min(FALL_V, v));
}

// --- Endless difficulty (mirrors dino): ramp 0→1 over RAMP_S, then plateau ---
// Pipes get faster, spawn closer together, and the gap narrows as the run goes
// on — hard but steady, so the score keeps climbing as long as the team flies.
export const RAMP_S = 60;
export const SPEED_MIN = 3, SPEED_MAX = 6.5;                 // pipe scroll speed (px/frame)
export const SPAWN_FRAMES_MAX = 160, SPAWN_FRAMES_MIN = 95;  // frames between spawns
export const GAP_MAX = 240, GAP_MIN = 175;                   // vertical gap height

export function difficultyProgress(elapsedSec) {
  return Math.max(0, Math.min(1, elapsedSec / RAMP_S));
}
export function pipeSpeed(elapsedSec) {
  return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * difficultyProgress(elapsedSec);
}
export function pipeSpawnFrames(elapsedSec) {
  return SPAWN_FRAMES_MAX - (SPAWN_FRAMES_MAX - SPAWN_FRAMES_MIN) * difficultyProgress(elapsedSec);
}
export function pipeGap(elapsedSec) {
  return GAP_MAX - (GAP_MAX - GAP_MIN) * difficultyProgress(elapsedSec);
}

// Endless: the score IS the number of gates cleared this attempt.
export function scoreAttempt({ completed }) {
  return Math.max(0, Math.round(completed));
}

export function finalScore(attempts) {
  if (!attempts.length) return 0;
  return Math.max(0, ...attempts.map(a => a.score));
}
