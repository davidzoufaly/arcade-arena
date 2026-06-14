// ps-offsite-2026/shared/games-catalog.js
export const GAMES = {
  GZ: { name: 'Gesture Lock', emoji: '✋', kind: 'play',   href: 'games/1-gesture-lock.html' },
  PM: { name: 'Pantomime', emoji: '🤸', kind: 'play',   href: 'games/2-pantomime.html' },
  DN: { name: 'Dino Run', emoji: '🦖', kind: 'play',   href: 'games/3-dino.html' },
  FL: { name: 'Flappy', emoji: '🐦', kind: 'play',   href: 'games/4-flappy.html' },
  GD: { name: 'AI Jailbreak', emoji: '🤖', kind: 'manual', rules: 'Gandalf is an AI that guards a secret password. Its job is to never reveal it — and it gets harder at every level. Your job is to talk it into giving the password up anyway.\n\nObjective: reach the highest level possible in the Gandalf system within the time limit.\n\nBefore time runs out:\n\n- Submit the highest level reached into the portal.\n- Take a screenshot showing the achieved level as evidence.\n\nRules:\n\n- Use your own reasoning only. Forbidden: AI tools or assistants, internet search, interfering with anyone else\'s session, exploiting the platform, or faking screenshots/level submissions.\n\nGandalf: https://gandalf.lakera.ai/baseline' },
  DG: { name: 'AI Judged Draw', emoji: '🎨', kind: 'manual', rules: 'An AI vision model is the judge. Draw each prompt clearly enough that the machine recognizes exactly what you intended.\n\n- The host presents the drawing prompts.\n- For each prompt, your team has a set time to create a single drawing.\n- When all drawings are done, photo each one and submit them as the host instructs — include your team or player number.\n- All submissions are evaluated by AI to determine the winners.' },
  PQ: { name: 'Pub Quiz', emoji: '❓', kind: 'quiz', rules: 'A classic quiz. The host reads each question aloud. Type your answer for every question in the current category, then submit to lock it in and reveal the next category.\n\n- One category at a time — once you submit, those answers can\'t be changed.\n- After the last category you\'re done — the host marks every answer and tallies your score.\n- Some questions are bonus questions — they show a second answer field worth an extra point.' },
};

export function getGame(key) {
  return GAMES[key] ?? null;
}

export function playableKeys() {
  return Object.keys(GAMES).filter(k => GAMES[k].kind === 'play');
}

export function manualKeys() {
  return Object.keys(GAMES).filter(k => GAMES[k].kind === 'manual');
}

export function quizKeys() {
  return Object.keys(GAMES).filter(k => GAMES[k].kind === 'quiz');
}

export function allEnteredKeys() {
  return Object.keys(GAMES).filter(k => GAMES[k].kind !== 'soon');
}
