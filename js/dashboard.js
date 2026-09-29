/* ============================================================
   dashboard.js — guardia común de /dashboards/<id>/
   ------------------------------------------------------------
   Pregunta a /api/auth quién es y qué dashboards tiene. Sin sesión
   manda al login; sin permiso para este dashboard muestra el aviso.
   Ojo: esto solo decide qué se ve. Cuando un dashboard traiga datos,
   su API debe revisar canSeeDashboard() en el servidor.
   ============================================================ */

import { iconFor } from './dashboard-icons.js';

const $ = (id) => document.getElementById(id);
const id = document.body.dataset.dash;

function show(view) {
  for (const v of ['loading', 'denied', 'dash']) $(`v-${v}`).hidden = v !== view;
}

document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
  await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
  location.href = '/admin/';
}));

(async () => {
  let user = null;
  try {
    const r = await fetch('/api/auth', { credentials: 'same-origin' });
    user = r.ok ? (await r.json()).user : null;
  } catch { /* sin API */ }

  if (!user) return location.replace('/admin/');

  const dash = user.dashboards.find((d) => d.id === id);
  if (!dash) return show('denied');

  $('dash-title').textContent = dash.name;
  $('dash-ico').innerHTML = iconFor(dash.icon);
  document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = user.email; });
  // con un solo dashboard no hay a dónde volver: /admin/ lo mandaría aquí mismo
  $('dash-back').hidden = !(user.role === 'admin' || user.dashboards.length > 1);
  show('dash');
})();
