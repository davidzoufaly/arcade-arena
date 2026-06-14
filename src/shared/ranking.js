// Convert a map of raw scores into rank-points using fractional ranking
// (avg-rank for ties). The top submitter in an N-team lobby always gets
// N points; non-submitters are absent from the result (caller treats as 0).
export function rankPointsByTeam({ teamCount, raw }) {
  const entries = Object.entries(raw)
    .filter(([, v]) => typeof v === 'number' && Number.isFinite(v))
    .map(([id, v]) => ({ id, raw: v }));
  if (entries.length === 0) return {};

  entries.sort((a, b) => b.raw - a.raw);

  const out = {};
  let i = 0;
  while (i < entries.length) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1].raw === entries[i].raw) j++;
    const avgPos = (i + 1 + j + 1) / 2;
    const points = teamCount - avgPos + 1;
    for (let k = i; k <= j; k++) {
      out[entries[k].id] = points;
    }
    i = j + 1;
  }
  return out;
}
