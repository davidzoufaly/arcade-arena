export const GESTURE_POOL = [
  { id: 'Open_Palm',   emoji: '✋',  name: 'Open Palm' },
  { id: 'Closed_Fist', emoji: '✊',  name: 'Fist' },
  { id: 'Thumb_Up',    emoji: '👍', name: 'Thumbs Up' },
  { id: 'Thumb_Down',  emoji: '👎', name: 'Thumbs Down' },
  { id: 'Victory',     emoji: '✌️', name: 'Victory' },
  { id: 'Pointing_Up', emoji: '☝️', name: 'Point Up' },
];

export function pickSequenceWithRepeats(pool, len) {
  const out = [];
  for (let i = 0; i < len; i++) {
    out.push(pool[Math.floor(Math.random() * pool.length)]);
  }
  return out;
}
