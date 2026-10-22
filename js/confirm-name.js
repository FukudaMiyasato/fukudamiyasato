/* ============================================================
   confirm-name.js — "escribe el nombre para confirmar"
   ------------------------------------------------------------
   Para lo que no se puede deshacer (eliminar un dashboard): el
   botón rojo solo se activa cuando lo escrito es igual al nombre.
   Usa el modal compartido (css/modal.css) y lo arma al vuelo.
   ============================================================ */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Resuelve true si confirma, false si cancela. */
export function confirmByName({ name, title, body, action = 'Eliminar' }) {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'modal-layer';
    layer.innerHTML = `
      <form class="modal cn-modal" autocomplete="off" novalidate>
        <h2 class="cn-title">${esc(title)}</h2>
        <p class="cn-body">${esc(body)}</p>
        <label class="cn-label">Escribe <b>${esc(name)}</b> para confirmar</label>
        <input class="cn-input" spellcheck="false" autocapitalize="off" aria-label="Nombre para confirmar">
        <div class="m-actions">
          <button class="link-btn" type="button" data-cancel>Cancelar</button>
          <button class="btn" type="submit" disabled>${esc(action)}</button>
        </div>
      </form>`;
    const form = layer.querySelector('form');
    const input = layer.querySelector('.cn-input');
    const ok = layer.querySelector('[type="submit"]');
    const matches = () => input.value.trim() === String(name).trim();

    const done = (v) => {
      document.removeEventListener('keydown', onKey, true);
      layer.remove();
      resolve(v);
    };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(false); } };

    input.addEventListener('input', () => { ok.disabled = !matches(); });
    form.addEventListener('submit', (e) => { e.preventDefault(); if (matches()) done(true); });
    layer.querySelector('[data-cancel]').addEventListener('click', () => done(false));
    layer.addEventListener('pointerdown', (e) => { if (e.target === layer) done(false); });
    document.addEventListener('keydown', onKey, true);

    document.body.append(layer);
    setTimeout(() => input.focus(), 50);
  });
}
