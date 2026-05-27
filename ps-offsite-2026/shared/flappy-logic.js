export const MAX_PIPES = 20;
export const ATTEMPT_CAP_S = 60;
export const GAIN = 25;
export const GRAVITY = 0.28;

// Voice amplitude above the calibrated noise floor → upward thrust.
export function ampToThrust(amp, floor) {
  return Math.max(0, amp - floor) * GAIN;
}

export function scoreAttempt({ completed, timeSec }) {
  const base = Math.round(completed * (100 / MAX_PIPES));
  let bonus = 0;
  if (completed >= MAX_PIPES) bonus = Math.max(0, Math.round(15 - timeSec / 3));
  return Math.min(100, base + bonus);
}

export function finalScore(attempts) {
  if (!attempts.length) return 0;
  return Math.max(0, ...attempts.map(a => a.score));
}
