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

// "Empty" => clear the override. Strings are checked by trim only (so rules text
// like "0" stays a valid value); numbers by finite-and-positive (so a 0/NaN
// minutes clears). The clock modal pre-coerces its input with Number().
function isEmpty(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (typeof value === 'number') return !Number.isFinite(value) || value <= 0;
  return false;
}

// SET (non-empty): write the game value AND cascade-clear that game's cells
// (a fresh game-level value should not leave shadowed per-team overrides behind,
// mirroring setGame in game-lock.js).
// CLEAR (empty): delete ONLY the game key; LEAVE cells intact (nothing shadows
// them once the game value is gone, so they stay meaningful).
export function setGameOverride(node, gameKey, value) {
  if (isEmpty(value)) {
    if (node.games) delete node.games[gameKey];
  } else {
    node.games ??= {};
    node.games[gameKey] = value;
    if (node.cells) delete node.cells[gameKey];
  }
  return node;
}

export function setCellOverride(node, gameKey, teamId, value) {
  if (isEmpty(value)) {
    if (node.cells?.[gameKey]) delete node.cells[gameKey][teamId];
  } else {
    node.cells ??= {};
    node.cells[gameKey] ??= {};
    node.cells[gameKey][teamId] = value;
  }
  return node;
}

// Timer arithmetic (pure). Callers guarantee a positive `minutes`.
export function deadlineFor(startTs, minutes) {
  return startTs + minutes * 60000;
}

export function remainingMs(startTs, minutes, now) {
  return Math.max(0, deadlineFor(startTs, minutes) - now);
}

export function isExpired(startTs, minutes, now) {
  return now >= deadlineFor(startTs, minutes);
}

// Remaining ms -> "M:SS" (ceil so the last partial second still reads >= 0:01;
// exactly 0 reads 0:00). Clamps negatives.
export function formatMMSS(ms) {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
