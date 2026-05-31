// Theme switcher: persists choice in localStorage, falls back to system preference.
// Initial theme is set by an inline <head> snippet (anti-FOUC); this module mounts the toggle.
// On pages with a topbar, the toggle lives in the bar (next to Leave); elsewhere it floats.
const KEY = 'ps-theme';
const buttons = new Set();

function system() {
  return matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}
function stored() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}
function current() {
  return document.documentElement.getAttribute('data-theme') || stored() || system();
}
function apply(t) {
  document.documentElement.setAttribute('data-theme', t);
}
// Icon shows the theme you'll switch TO. Topbar buttons are icon-only (compact,
// matches the Leave button); the floating fallback keeps a text label.
function face(btn) {
  const icon = current() === 'light' ? '🌙' : '☀️';
  if (btn.dataset.iconOnly) return icon;
  return `${icon} ${current() === 'light' ? 'Dark' : 'Light'}`;
}
function update() {
  for (const b of buttons) b.textContent = face(b);
}
function setTheme(t) {
  apply(t);
  try { localStorage.setItem(KEY, t); } catch {}
  update();
}

// Build a wired toggle button. Pass {float:true} for the standalone floating variant.
export function createToggle({ float = false } = {}) {
  const btn = document.createElement('button');
  btn.className = 'ps-theme-toggle' + (float ? ' is-float' : '');
  btn.type = 'button';
  if (!float) btn.dataset.iconOnly = '1';
  btn.setAttribute('aria-label', 'Toggle light/dark theme');
  btn.textContent = face(btn);
  btn.addEventListener('click', () => setTheme(current() === 'light' ? 'dark' : 'light'));
  buttons.add(btn);
  return btn;
}

// Remove the floating fallback (topbar takes over hosting the toggle).
export function removeFloating() {
  for (const b of [...buttons]) {
    if (b.classList.contains('is-float')) { b.remove(); buttons.delete(b); }
  }
}

function mountFloating() {
  if (document.querySelector('.ps-theme-toggle')) return;
  document.body.appendChild(createToggle({ float: true }));
}

// Follow system changes only while the user has made no explicit choice.
try {
  if (!stored()) {
    matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
      apply(e.matches ? 'light' : 'dark');
      update();
    });
  }
} catch {}

// Float by default; topbar.js calls removeFloating() + hosts its own on topbar pages.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mountFloating);
} else {
  mountFloating();
}
