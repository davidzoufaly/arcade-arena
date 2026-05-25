// Scoreboard format: STATION-TEAM-SCORE (e.g. DN-7-85). Score normalized 0..100.
export function generateCode({ station, team, score, max }) {
  const pts = Math.max(0, Math.min(100, Math.round((score / max) * 100)));
  return `${station}-${team}-${pts}`;
}

export function renderEndScreen(container, { station, team, score, max, code, message }) {
  const pts = Math.max(0, Math.min(100, Math.round((score / max) * 100)));
  const teamLine = team > 0
    ? `<div class="code">CODE: ${code}</div><div class="hint">TEAM ${team} · BRING CODE TO SCOREBOARD</div>`
    : `<div class="code" style="color:#ff5a3c">NO TEAM SET</div><div class="hint">REOPEN FROM HUB SO ?team=N IS SET</div>`;
  container.innerHTML = `
    <div class="end-screen">
      <h1>${message}</h1>
      <div class="score">SCORE: ${score} / ${max} (${pts} pts)</div>
      ${teamLine}
      <div class="hint">PRESS SPACE TO PLAY AGAIN</div>
    </div>
  `;
}

export function saveRun(game, score, code) {
  const key = `runs.${game}`;
  const list = JSON.parse(localStorage.getItem(key) ?? '[]');
  list.push({ score, code, at: Date.now() });
  if (list.length > 20) list.shift();
  localStorage.setItem(key, JSON.stringify(list));
}

export function loadRuns(game) {
  return JSON.parse(localStorage.getItem(`runs.${game}`) ?? '[]');
}

export function showDebugIfRequested(game) {
  if (!new URLSearchParams(location.search).has('debug')) return;
  const runs = loadRuns(game);
  const pre = document.createElement('pre');
  pre.style.cssText = 'position:fixed;bottom:0;left:0;right:0;max-height:40vh;overflow:auto;background:#000c;color:#0ff;padding:8px;font-size:11px;z-index:100';
  pre.textContent = runs.map(r => `${new Date(r.at).toLocaleTimeString()}  ${r.score}  ${r.code}`).join('\n');
  document.body.appendChild(pre);
}
