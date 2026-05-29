// ps-offsite-2026/shared/game-config.js
// Pure per-game / per-team config-override resolution + write helpers for
// timers and rules, plus timer arithmetic. No Firebase imports (testable).
// Mirrors shared/game-lock.js.
//
// Stored shape (Firebase nodes lobbies/{id}/timers and lobbies/{id}/rules):
//   { games: { [gameKey]: value },
//     cells: { [gameKey]: { [teamId]: value } } }
// Precedence: cell > game. Absent => undefined (no override). No "all" level.

// Raw override read. Optional chaining REQUIRED: `??` only guards null/undefined
// VALUES, not missing intermediate objects, so `cells[k][t]` would throw on the
// common absent-node case. teamId undefined => cell branch undefined => degrades.
export function resolveOverride(node, gameKey, teamId) {
  return node?.cells?.[gameKey]?.[teamId] ?? node?.games?.[gameKey];
}

// True iff an override exists at the requested level (cell if teamId given, else
// game). Needed because resolveRule returns the fallback for an absent override,
// so the UI cannot otherwise distinguish "set" from "unset" for tinting.
export function hasOverride(node, gameKey, teamId) {
  return resolveOverride(node, gameKey, teamId) !== undefined;
}

// Minutes (positive number) or undefined. Normalizes junk (0, negative, NaN,
// non-numeric string) to undefined so corrupted DB data can never produce a
// NaN/0 deadline.
export function resolveTimer(timers, gameKey, teamId) {
  const v = Number(resolveOverride(timers, gameKey, teamId));
  return Number.isFinite(v) && v > 0 ? v : undefined;
}

export function resolveRule(rules, gameKey, teamId, fallback) {
  return resolveOverride(rules, gameKey, teamId) ?? fallback;
}
