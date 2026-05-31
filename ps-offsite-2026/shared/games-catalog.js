// ps-offsite-2026/shared/games-catalog.js
export const GAMES = {
  GZ: { name: 'Gesture Lock',    emoji: '✋', kind: 'play',   href: 'games/1-gesture-lock.html' },
  PM: { name: 'Pantomime',       emoji: '🎭', kind: 'play',   href: 'games/2-pantomime.html' },
  DN: { name: 'Dino Dash',       emoji: '🦖', kind: 'play',   href: 'games/3-dino.html' },
  FL: { name: 'Flappy Voice',    emoji: '📢', kind: 'play',   href: 'games/4-flappy.html' },
  MX: { name: 'Math No-Brain',   emoji: '🧮', kind: 'manual', rules: 'Simple arithmetic round. Team writes answers, count correct out of total.\n\n- Submit number of correct answers as raw score.' },
  MB: { name: 'Math Big-Brain',  emoji: '🧠', kind: 'manual', rules: 'Harder math round. Same scoring: count correct.\n\n- Submit number of correct answers as raw score.' },
  SF: { name: 'Cipher',          emoji: '🔐', kind: 'manual', rules: 'Crack the cipher. Faster team = higher raw score.\n\n- Submit raw points awarded by host.' },
  GD: { name: 'Gandalf',         emoji: '🧙', kind: 'manual', rules: 'Prompt-injection challenge. Each cracked level scores points.\n\n- Submit total points reached.' },
  HD: { name: 'Hidden Document', emoji: '📄', kind: 'manual', rules: 'Some files were never meant to be found.\nOne of them still exists.\nHidden somewhere deep inside the internety is a file connected to the past.\nYou will receive five hints throughout the day.\n\nFind it.\nUnlock it.\nComplete what it asks.\nThe fastest team will be rewarded.' },
  DG: { name: 'Draw & Guess',    emoji: '🎨', kind: 'manual', rules: 'The announcer will present four different drawing prompts. For each prompt, your team will have exactly four minutes to create a single masterpiece. Once all drawings are complete, take one photo per prompt and post them to the #services-all Slack channel, making sure to include your team number. All submissions will be publicly evaluated by Gemini AI to determine the winners.' },
  PQ: { name: 'Pub Quiz',        emoji: '🎤', kind: 'quiz', rules: 'The host reads each question aloud. Type your team\'s answer for every question in the current category, then submit to lock it in and reveal the next category.\n\n- One category at a time — once you submit, those answers can\'t be changed.\n- After the last category, enter your raw score (number of correct answers), same as the other manual games.\n- Some questions are bonus questions — they show a second answer field worth extra points.' },
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
