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
