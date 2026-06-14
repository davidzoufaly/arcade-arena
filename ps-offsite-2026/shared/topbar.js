import { resolveSession, clearSession } from './lobby.js';
import { getApps, getApp, initializeApp } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js';
import { getDatabase, ref, onValue, set } from 'https://www.gstatic.com/firebasejs/10.13.0/firebase-database.js';
import { firebaseConfig } from '../firebase-config.js';
import { GAMES } from './games-catalog.js';
import { resolveCatalog, addedKeys } from './lobby-games.js';
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

function buildHeader({ lobbyId, teamId }, activePage, admin, teamName) {
  const pfx = prefix();
  const lobbyQ = `?lobby=${encodeURIComponent(lobbyId)}${teamId ? `&team=${teamId}` : ''}`;
  const indexHref    = `${pfx}index.html`;
  const gamesHref    = `${pfx}games.html${lobbyQ}`;
  const scoreHref    = `${pfx}scoreboard.html?lobby=${encodeURIComponent(lobbyId)}`;
  const quizAdminHref = `${pfx}quiz-admin.html?lobby=${encodeURIComponent(lobbyId)}`;

  const nav = admin
    ? `<a data-nav="games" href="${gamesHref}">Games</a>
       <a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>
       <a data-nav="quiz-admin" href="${quizAdminHref}">Quiz</a>`
    : `<a data-nav="games" href="${gamesHref}">Games</a>
       <a data-nav="scoreboard" href="${scoreHref}">Scoreboard</a>`;
  const info = admin
    ? `Lobby <code>${esc(lobbyId)}</code> · <strong>Admin</strong>`
    : `Lobby <code>${esc(lobbyId)}</code> · <strong class="ps-topbar-team" title="Click to rename" style="cursor:pointer">${esc(teamName || `Team ${teamId}`)}</strong> · <strong class="ps-topbar-pts" title="Total rank-points across all entered games">— pts</strong>`;
  const brandHref = admin ? scoreHref : gamesHref;
  const leaveLabel = 'Leave';

  const header = document.createElement('header');
  header.className = 'ps-topbar';
  header.innerHTML = `
    <a class="ps-topbar-brand" href="${brandHref}">Arcade Arena</a>
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

function subscribeTeam(lobbyId, teamId, onUpdate) {
  if (!firebaseConfig?.databaseURL || firebaseConfig.databaseURL.includes('REPLACE_ME')) return;
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const db = getDatabase(app);
  onValue(ref(db, `lobbies/${lobbyId}`), snap => {
    const root = snap.val() || {};
    const teams = root.teams ? Object.values(root.teams) : [];
    const teamCount = teams.length;
    const scoresObj = root.scores || {};
    let total = 0;
    const keys = addedKeys(resolveCatalog(GAMES, root.games || null));
    for (const g of keys) {
      const raw = {};
      for (const t of teams) {
        const v = scoresObj[t.id]?.[g];
        if (typeof v === 'number') raw[t.id] = v;
      }
      const points = rankPointsByTeam({ teamCount, raw });
      total += points[teamId] || 0;
    }
    const teamName = root.teams?.[teamId]?.name;
    const mode = root.meta?.mode === 'individuals' ? 'individuals' : 'teams';
    onUpdate({ total, teamName, mode });
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
    const teamEl = header.querySelector('.ps-topbar-team');
    let noun = 'Team';  // updated once the lobby mode arrives
    teamEl.style.cursor = 'pointer';
    teamEl.title = 'Click to rename';
    teamEl.addEventListener('click', async () => {
      const next = prompt(`Rename your ${noun.toLowerCase()}:`, teamEl.textContent);
      if (next == null) return;
      const name = next.trim().slice(0, 24);
      if (!name) return;
      if (!firebaseConfig?.databaseURL || firebaseConfig.databaseURL.includes('REPLACE_ME')) return;
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const db = getDatabase(app);
      await set(ref(db, `lobbies/${ctx.lobbyId}/teams/${ctx.teamId}/name`), name);
    });
    subscribeTeam(ctx.lobbyId, ctx.teamId, ({ total, teamName, mode }) => {
      noun = mode === 'individuals' ? 'Player' : 'Team';
      ptsEl.textContent = `${formatPts(total)} pts`;
      if (teamName != null) teamEl.textContent = teamName || `${noun} ${ctx.teamId}`;
    });
  }
}
