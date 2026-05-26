// tests/score-panel.test.js
import { describe, it, expect } from 'vitest';
import { renderEndScreen, saveRun, loadRuns } from '../ps-offsite-2026/shared/score-panel.js';

function makeContainer() {
  // Lightweight stand-in for an element — renderEndScreen only assigns innerHTML.
  return { innerHTML: '' };
}

describe('renderEndScreen', () => {
  it('shows the raw score, saved badge, and return-to-catalog link', () => {
    const el = makeContainer();
    renderEndScreen(el, {
      gameKey: 'DN', score: 73, saved: true, message: 'NICE',
      catalogHref: 'games.html?lobby=PS-AB12&team=3',
    });
    expect(el.innerHTML).toContain('NICE');
    expect(el.innerHTML).toContain('73');
    expect(el.innerHTML).toContain('SAVED');
    expect(el.innerHTML).toContain('games.html?lobby=PS-AB12&team=3');
  });

  it('shows SAVING when saved flag is null', () => {
    const el = makeContainer();
    renderEndScreen(el, { gameKey: 'DN', score: 10, saved: null, message: 'DONE', catalogHref: '#' });
    expect(el.innerHTML).toContain('SAVING');
  });

  it('shows FAILED with retry hint when saved=false', () => {
    const el = makeContainer();
    renderEndScreen(el, { gameKey: 'DN', score: 10, saved: false, message: 'DONE', catalogHref: '#' });
    expect(el.innerHTML).toContain('FAILED');
  });
});

// Note: saveRun / loadRuns / showDebugIfRequested rely on localStorage and document,
// which the default vitest node env does not provide. Coverage stays manual (devtools).
