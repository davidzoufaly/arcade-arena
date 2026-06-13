// Pure helpers for the per-lobby game model. NO imports from lobby.js/theme.js
// (those touch `document` at import and would break this module's unit test).
//
// Per-lobby Firebase node shape (lobbies/{id}/games/{key}):
//   built-in key:  { added: bool }                         // delta only
//   custom key:    { custom:true, name, emoji, rules, kind:'manual', order, added }
// Effective catalog merges the static built-in catalog with this node.

export const SAFE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// Default visibility when no explicit `added` flag is stored.
function defaultAdded(kind) {
  return kind === 'play';
}

// staticGames: the GAMES object from games-catalog.js. node: lobby games node or null.
// Returns an ordered array: built-ins (catalog order) then customs (by order, then key).
export function resolveCatalog(staticGames, node) {
  const n = node || {};
  const builtins = Object.entries(staticGames).map(([key, g]) => ({
    key,
    name: g.name,
    emoji: g.emoji,
    kind: g.kind,
    href: g.href,
    rules: g.rules,
    custom: false,
    added: typeof n[key]?.added === 'boolean' ? n[key].added : defaultAdded(g.kind),
  }));

  const customs = Object.entries(n)
    .filter(([key, v]) => v && v.custom && !staticGames[key])
    .map(([key, v]) => ({
      key,
      name: v.name,
      emoji: v.emoji,
      kind: 'manual',
      href: undefined,
      rules: v.rules ?? '',
      custom: true,
      order: typeof v.order === 'number' ? v.order : 0,
      added: typeof v.added === 'boolean' ? v.added : true,
    }))
    .sort((a, b) => (a.order - b.order) || (a.key < b.key ? -1 : 1));

  return [...builtins, ...customs];
}

export function addedKeys(effectiveCatalog) {
  return effectiveCatalog.filter(g => g.added).map(g => g.key);
}

// taken: a Set of keys already in use (built-ins + live custom + orphaned score/
// history keys). rng: () => [0,1); injected for tests.
export function nextCustomKey(taken, rng = Math.random) {
  for (let attempt = 0; attempt < 50; attempt++) {
    let s = '';
    for (let i = 0; i < 4; i++) {
      s += SAFE_ALPHABET[Math.floor(rng() * SAFE_ALPHABET.length)];
    }
    const key = `CU${s}`;
    if (!taken.has(key)) return key;
  }
  throw new Error('could not allocate a free custom game key');
}

export function makeCustomGame({ name, emoji, rules, order }) {
  return {
    custom: true,
    name: String(name).trim(),
    emoji: String(emoji),
    rules: rules ? String(rules) : '',
    kind: 'manual',
    order,
    added: true,
  };
}

export function validateCustomGame({ name, emoji, rules }) {
  const n = String(name ?? '').trim();
  if (!n) return { ok: false, error: 'Name is required.' };
  if (n.length > 40) return { ok: false, error: 'Name must be 40 characters or fewer.' };
  const e = String(emoji ?? '');
  if (!e.trim()) return { ok: false, error: 'Icon (emoji) is required.' };
  if (e.length > 8) return { ok: false, error: 'Icon must be a single emoji.' };
  if (rules != null && typeof rules !== 'string') return { ok: false, error: 'Rules must be text.' };
  return { ok: true };
}
