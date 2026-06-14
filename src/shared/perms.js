export function showDenialModal(kind) {
  const overlay = document.createElement('div');
  overlay.className = 'denial-overlay';
  overlay.innerHTML = `
    <div class="denial-box">
      <h1>${kind.toUpperCase()} ACCESS NEEDED</h1>
      <p>This game needs your ${kind}. Click the lock icon in the address bar, allow ${kind}, then reload.</p>
      <button onclick="location.reload()">RELOAD</button>
    </div>
  `;
  document.body.appendChild(overlay);
}
