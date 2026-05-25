// ps-offsite-2026/shared/lobby.js
export const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const LOBBY_ID_RE = /^PS-[A-HJ-NP-Z2-9]{4}$/;

function pick(n) {
  let out = '';
  for (let i = 0; i < n; i++) {
    out += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return out;
}

export function generateLobbyId() {
  return `PS-${pick(4)}`;
}

export function generatePwd(len = 6) {
  return pick(len);
}

export function isValidLobbyId(s) {
  return typeof s === 'string' && LOBBY_ID_RE.test(s);
}
