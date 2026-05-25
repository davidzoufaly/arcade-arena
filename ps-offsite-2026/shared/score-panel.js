const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 chars, no ambiguous (I/O/0/1)

function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function generateCode(score, timestamp) {
  let h = fnv1a(`${score}|${timestamp}`);
  let out = '';
  for (let i = 0; i < 4; i++) {
    out += ALPHABET[h % ALPHABET.length];
    h = Math.floor(h / ALPHABET.length);
    if (h === 0) h = fnv1a(`${score}|${timestamp}|${i}`);
  }
  return out;
}

export function renderEndScreen(container, { score, code, message }) {
  container.innerHTML = `
    <div class="end-screen">
      <h1>${message}</h1>
      <div class="score">SCORE: ${score} / 30</div>
      <div class="code">CODE: ${code}</div>
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
  pre.textContent = runs.map(r => `${new Date(r.at).toLocaleTimeString()}  ${r.score}/30  ${r.code}`).join('\n');
  document.body.appendChild(pre);
}
