export const GESTURE_POOL = [
  { id: 'Open_Palm',   emoji: '✋',  name: 'Open Palm' },
  { id: 'Closed_Fist', emoji: '✊',  name: 'Fist' },
  { id: 'Thumb_Up',    emoji: '👍', name: 'Thumbs Up' },
  { id: 'Thumb_Down',  emoji: '👎', name: 'Thumbs Down' },
  { id: 'Victory',     emoji: '✌️', name: 'Victory' },
  { id: 'Pointing_Up', emoji: '☝️', name: 'Point Up' },
];

export const SEQUENCE_LEN = 16;

export function pickSequenceWithRepeats(pool, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}

export function scoreAttempt({ result, completed, timeSec }) {
  if (result === 'success') {
    const raw = 100 - Math.max(0, timeSec - 10) * 2;
    return Math.max(40, Math.min(100, Math.round(raw)));
  }
  return Math.floor((completed / SEQUENCE_LEN) * 35);
}

export function finalScore(attempts) {
  if (!attempts.length) return 0;
  const successes = attempts.filter(a => a.result === 'success');
  const pool = successes.length ? successes : attempts;
  return Math.max(0, ...pool.map(a => a.score));
}
