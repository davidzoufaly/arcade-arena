// src/shared/game-lock.js
// Pure lock-state resolution + cascade-clear write helpers. No Firebase imports.
//
// Stored shape (Firebase node lobbies/{lobbyId}/locks):
//   { all: "locked"|"unlocked",
//     games: { [gameKey]: "locked"|"unlocked" },
//     cells: { [gameKey]: { [teamId]: "locked"|"unlocked" } } }
// Absent node / level => "unlocked" (default). Precedence: cell > game > all.

export const LOCKED = 'locked';
export const UNLOCKED = 'unlocked';

// Optional chaining is REQUIRED: `??` only guards null/undefined VALUES, not
// missing intermediate objects, so `cells[k][t]` would throw on the common
// (absent-node) case. teamId undefined => cell branch is undefined => degrades.
export function resolveLock(locks, gameKey, teamId) {
  return locks?.cells?.[gameKey]?.[teamId]
    ?? locks?.games?.[gameKey]
    ?? locks?.all
    ?? UNLOCKED;
}

export function resolveGameLock(locks, gameKey) {
  return locks?.games?.[gameKey] ?? locks?.all ?? UNLOCKED;
}

export function resolveAllLock(locks) {
  return locks?.all ?? UNLOCKED;
}

export function isUnlocked(locks, gameKey, teamId) {
  return resolveLock(locks, gameKey, teamId) === UNLOCKED;
}

function flip(value) {
  return value === UNLOCKED ? LOCKED : UNLOCKED;
}

// Cascade-clear writes: a lower-level write wipes more-specific overrides below.
// All mutate `draft` in place and return it. They lazily create nested objects
// because the draft is cloned from a possibly-absent node.
export function setAll(draft, value) {
  draft.all = value;
  draft.games = {};
  draft.cells = {};
  return draft;
}

export function setGame(draft, gameKey, value) {
  draft.games ??= {};
  draft.games[gameKey] = value;
  if (draft.cells) delete draft.cells[gameKey];
  return draft;
}

export function setCell(draft, gameKey, teamId, value) {
  draft.cells ??= {};
  draft.cells[gameKey] ??= {};
  draft.cells[gameKey][teamId] = value;
  return draft;
}

// Toggles flip the current RESOLVED state at their level, then cascade-write.
export function toggleAll(draft) {
  return setAll(draft, flip(resolveAllLock(draft)));
}

export function toggleGame(draft, gameKey) {
  return setGame(draft, gameKey, flip(resolveGameLock(draft, gameKey)));
}

export function toggleCell(draft, gameKey, teamId) {
  return setCell(draft, gameKey, teamId, flip(resolveLock(draft, gameKey, teamId)));
}
