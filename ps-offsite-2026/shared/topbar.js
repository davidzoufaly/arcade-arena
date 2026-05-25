import { resolveSession, clearSession } from './lobby.js';

function prefix() {
  const p = location.pathname;
  if (p.includes('/stations/') || p.includes('/dino/') || p.includes('/flappy/')) {
    return '../';
  }
  return './';
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function isCanvasGamePage() {
  return !!(document.getElementById('game') || document.getElementById('cam'));
}

function buildHeader({ lobbyId, teamId }, activePage) {
  const pfx = prefix();
  const hubHref = `${pfx}index.html`;
  const scoreHref = `${pfx}scoreboard.html?lobby=${encodeURIComponent(lobbyId)}`;

  const header = document.createElement('header');
  header.className = 'ps-topbar';
  header.innerHTML = `
    <a class="ps-topbar-brand" href="${hubHref}">PS Offsite</a>
    <nav class="ps-topbar-nav">
      <a data-nav="dashboard" href="${hubHref}">Dashboard</a>
      <a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>
    </nav>
    <div class="ps-topbar-info">
      Lobby <code>${esc(lobbyId)}</code> · <strong>Team ${teamId}</strong>
    </div>
    <button class="ps-topbar-leave" type="button">Leave</button>
  `;
  const activeLink = header.querySelector(`a[data-nav="${activePage}"]`);
  if (activeLink) activeLink.setAttribute('aria-current', 'page');
  header.querySelector('.ps-topbar-leave').addEventListener('click', () => {
    clearSession();
    location.href = hubHref;
  });
  return header;
}

export function mountTopbar({ activePage }) {
  const session = resolveSession();
  if (!session) {
    location.replace(`${prefix()}index.html`);
    return;
  }
  const header = buildHeader(session, activePage);
  document.body.insertBefore(header, document.body.firstChild);
  if (!isCanvasGamePage()) {
    document.body.classList.add('ps-topbar-host');
  }
}
