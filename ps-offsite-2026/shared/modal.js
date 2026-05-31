// ps-offsite-2026/shared/modal.js
// Shared confirmation/input dialog. Styles live in shared/modal.css (link it on
// the page). Builds a <dialog class="modal-box">, appends it, auto-removes on
// close. bodyHtml may contain an #cfgInput field — it gets autofocus.
export function openModal({ title, bodyHtml, onConfirm, confirmLabel = 'Confirm', danger = false }) {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal-box';
  dialog.innerHTML = `
    <h2>${title}</h2>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-actions">
      <button type="button" id="modalCancel">Cancel</button>
      <button type="button" class="${danger ? 'danger' : 'primary'}" id="modalConfirm">${confirmLabel}</button>
    </div>`;
  document.body.appendChild(dialog);
  dialog.addEventListener('close', () => dialog.remove());
  dialog.querySelector('#modalCancel').addEventListener('click', () => dialog.close());
  dialog.querySelector('#modalConfirm').addEventListener('click', () => { onConfirm(); dialog.close(); });
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); }); // backdrop click closes
  dialog.showModal();
  const field = dialog.querySelector('#cfgInput');
  if (field) field.focus();
  return dialog;
}
