import { describe, it, expect, vi } from 'vitest';
import { submitScore } from '../ps-offsite-2026/shared/score-submit.js';

function makeFakeWriter() {
  return {
    updates: [],
    pushes: [],
    async update(path, patch) { this.updates.push({ path, patch }); },
    async push(path, value)   { this.pushes.push({ path, value }); return 'fake-key'; },
  };
}

describe('submitScore', () => {
  it('writes raw integer to scores/{teamId}/{gameKey}', async () => {
    const w = makeFakeWriter();
    await submitScore({ writer: w, lobbyId: 'PS-AB12', teamId: 3, gameKey: 'DN', score: 47 });
    expect(w.updates).toEqual([
      { path: 'lobbies/PS-AB12/scores/3', patch: { DN: 47 } },
    ]);
  });

  it('pushes a history entry with ts/gameKey/teamId/score', async () => {
    const w = makeFakeWriter();
    const before = Date.now();
    await submitScore({ writer: w, lobbyId: 'PS-AB12', teamId: 3, gameKey: 'DN', score: 47 });
    expect(w.pushes).toHaveLength(1);
    expect(w.pushes[0].path).toBe('lobbies/PS-AB12/history');
    expect(w.pushes[0].value.gameKey).toBe('DN');
    expect(w.pushes[0].value.teamId).toBe(3);
    expect(w.pushes[0].value.score).toBe(47);
    expect(w.pushes[0].value.ts).toBeGreaterThanOrEqual(before);
  });

  it('rounds to nearest integer', async () => {
    const w = makeFakeWriter();
    await submitScore({ writer: w, lobbyId: 'L', teamId: 1, gameKey: 'GZ', score: 12.7 });
    expect(w.updates[0].patch.GZ).toBe(13);
  });

  it('clamps negatives to 0', async () => {
    const w = makeFakeWriter();
    await submitScore({ writer: w, lobbyId: 'L', teamId: 1, gameKey: 'GZ', score: -5 });
    expect(w.updates[0].patch.GZ).toBe(0);
  });

  it('coerces non-numeric to 0', async () => {
    const w = makeFakeWriter();
    await submitScore({ writer: w, lobbyId: 'L', teamId: 1, gameKey: 'GZ', score: 'foo' });
    expect(w.updates[0].patch.GZ).toBe(0);
  });

  it('returns the persisted raw value', async () => {
    const w = makeFakeWriter();
    const out = await submitScore({ writer: w, lobbyId: 'L', teamId: 1, gameKey: 'GZ', score: 9 });
    expect(out).toBe(9);
  });
});
