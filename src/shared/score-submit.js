// Single write path for all score submissions (playable + manual).
// Caller passes an injected writer so this stays testable without Firebase.

export async function submitScore({ writer, lobbyId, teamId, gameKey, score }) {
  const n = Number(score);
  const raw = Math.max(0, Math.round(Number.isFinite(n) ? n : 0));
  await writer.update(`lobbies/${lobbyId}/scores/${teamId}`, { [gameKey]: raw });
  await writer.push(`lobbies/${lobbyId}/history`, {
    ts: Date.now(), gameKey, teamId, score: raw,
  });
  return raw;
}

// Convenience: wrap Firebase ref/update/push into the writer shape submitScore expects.
// Pages that already have getDatabase set up call this once and pass the result.
export function firebaseWriter({ db, ref, update, push }) {
  return {
    async update(path, patch) { await update(ref(db, path), patch); },
    async push(path, value) {
      const node = await push(ref(db, path), value);
      return node?.key ?? null;
    },
  };
}
