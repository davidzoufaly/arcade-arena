export const MAX_OBSTACLES = 16;
export const ATTEMPT_CAP_S = 60;
export const PALM_COUNT_WINDOW = 4;

// 0 palms → no jump. 1..8 palms → jump velocity 8..20 (clamped).
export function palmCountToJumpStrength(n) {
  if (n <= 0) return 0;
  return Math.min(20, 6 + n * 2);
}

// completed = obstacles cleared this attempt; timeSec = attempt duration.
// Base scales linearly to 100 at MAX_OBSTACLES. Time bonus only when maxed out.
export function scoreAttempt({ completed, timeSec }) {
  const base = Math.round(completed * (100 / MAX_OBSTACLES));
  let bonus = 0;
  if (completed >= MAX_OBSTACLES) bonus = Math.max(0, Math.round(20 - timeSec / 2));
  return Math.min(100, base + bonus);
}

export function finalScore(attempts) {
  if (!attempts.length) return 0;
  return Math.max(0, ...attempts.map(a => a.score));
}
