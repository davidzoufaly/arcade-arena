export const WARMUP_S = 10;

// Whole seconds of warmup left, for the countdown banner. Clamped to
// [0, WARMUP_S]. 0s elapsed → 10, 9.9s → 1, ≥10s → 0 (triggers transition to
// live play). The min() guards a (non-physical) negative elapsed from ever
// showing more than WARMUP_S.
export const warmupSecondsLeft = (elapsedSec) =>
  Math.max(0, Math.min(WARMUP_S, Math.ceil(WARMUP_S - elapsedSec)));
