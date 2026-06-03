import { resolveSession, clearSession } from './lobby.js';
import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, onValue } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { allEnteredKeys } from './games-catalog.js';
import { rankPointsByTeam } from './ranking.js';
import { createToggle, removeFloating } from './theme.js';

function prefix() {
  const p = location.pathname;
  if (p.includes('/games/') || p.includes('/dino/') || p.includes('/flappy/')) {
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

function buildHeader({ lobbyId, teamId }, activePage, admin) {
  const pfx = prefix();
  const lobbyQ = `?lobby=${encodeURIComponent(lobbyId)}${teamId ? `&team=${teamId}` : ''}`;
  const indexHref    = `${pfx}index.html`;
  const gamesHref    = `${pfx}games.html${lobbyQ}`;
  const scoreHref    = `${pfx}scoreboard.html?lobby=${encodeURIComponent(lobbyId)}`;
  const quizAdminHref = `${pfx}quiz-admin.html?lobby=${encodeURIComponent(lobbyId)}`;

  const nav = admin
    ? `<a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>
       <a data-nav="quiz-admin" href="${quizAdminHref}">Quiz</a>`
    : `<a data-nav="games" href="${gamesHref}">Missions</a>
       <a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>`;
  const info = admin
    ? `Lobby <code>${esc(lobbyId)}</code> · <strong>Admin</strong>`
    : `Lobby <code>${esc(lobbyId)}</code> · <strong>Team ${teamId}</strong> · <strong class="ps-topbar-pts" title="Total rank-points across all entered games">— pts</strong>`;
  const brandHref = admin ? scoreHref : gamesHref;
  const leaveLabel = 'Leave';

  const header = document.createElement('header');
  header.className = 'ps-topbar';
  header.innerHTML = `
    <a class="ps-topbar-brand" href="${brandHref}">Project Future is US!</a>
    <nav class="ps-topbar-nav">${nav}</nav>
    <div class="ps-topbar-info">${info}</div>
    <button class="ps-topbar-leave" type="button">${leaveLabel}</button>
  `;
  const activeLink = header.querySelector(`a[data-nav="${activePage}"]`);
  if (activeLink) activeLink.setAttribute('aria-current', 'page');
  const leaveBtn = header.querySelector('.ps-topbar-leave');
  leaveBtn.addEventListener('click', () => {
    clearSession();
    location.href = indexHref;
  });
  // Theme toggle lives right next to Leave; drop the floating fallback theme.js mounted.
  removeFloating();
  leaveBtn.insertAdjacentElement('afterend', createToggle());
  return header;
}

function formatPts(n) {
  if (!Number.isFinite(n)) return '—';
  return Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toFixed(1);
}

function subscribeTeamPoints(lobbyId, teamId, onUpdate) {
  if (!firebaseConfig?.databaseURL || firebaseConfig.databaseURL.includes('REPLACE_ME')) return;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const db = getDatabase(app);
  onValue(ref(db, `lobbies/${lobbyId}`), snap => {
    const root = snap.val() || {};
    const teams = root.teams ? Object.values(root.teams) : [];
    const teamCount = teams.length;
    const scoresObj = root.scores || {};
    let total = 0;
    for (const g of allEnteredKeys()) {
      const raw = {};
      for (const t of teams) {
        const v = scoresObj[t.id]?.[g];
        if (typeof v === 'number') raw[t.id] = v;
      }
      const points = rankPointsByTeam({ teamCount, raw });
      total += points[teamId] || 0;
    }
    onUpdate(total);
  });
}

export function mountTopbar({ activePage }) {
  const ctx = resolveSession();
  if (!ctx) {
    location.replace(`${prefix()}index.html`);
    return;
  }
  const admin = ctx.role === 'admin';
  const header = buildHeader(ctx, activePage, admin);
  document.body.insertBefore(header, document.body.firstChild);
  if (!isCanvasGamePage()) {
    document.body.classList.add('ps-topbar-host');
  }
  if (!admin) {
    const ptsEl = header.querySelector('.ps-topbar-pts');
    subscribeTeamPoints(ctx.lobbyId, ctx.teamId, total => {
      ptsEl.textContent = `${formatPts(total)} pts`;
    });
  }
}
