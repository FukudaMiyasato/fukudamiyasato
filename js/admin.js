/* ============================================================
   admin.js — login con Google + panel de los amos
   ------------------------------------------------------------
   Quién entra y qué ve lo decide el servidor (/api/auth). Esta
   página solo elige la vista:
     amo supremo / amo  → panel (Dashboards · Permisos)
     chismoso sin nada  → "No tienes permisos"
     chismoso con uno   → entra directo
     chismoso con más   → lista para elegir
   ============================================================ */

import { dashIconHTML } from './dashboard-icons.js';
import { drawDots, fitCanvas, lensTransform } from './fisheye.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['loading', 'login', 'denied', 'nodash', 'picker', 'admin'];
const ROLE_LABEL = { supremo: 'Amo supremo', amo: 'Amo', chismoso: 'Chismoso' };
const isAmo = (role) => role === 'supremo' || role === 'amo';

let me = null;

function show(view) {
  for (const v of VIEWS) $(`v-${v}`).hidden = v !== view;
}

async function api(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await r.json(); } catch { /* sin cuerpo JSON */ }
  return { ok: r.ok, status: r.status, data };
}

function fillUser(user) {
  document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = user.name; });
  document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = user.email; });
  document.querySelectorAll('[data-user-pic]').forEach((el) => {
    if (user.picture) { el.src = user.picture; el.referrerPolicy = 'no-referrer'; } else el.hidden = true;
  });
}

/** Tarjeta-link de un dashboard (ícono + nombre). */
function dashLink(d) {
  const a = document.createElement('a');
  a.className = 'dash-card';
  a.href = d.url;
  a.innerHTML = `<span class="dash-ico">${dashIconHTML(d)}</span><span class="dash-name"></span>`;
  a.querySelector('.dash-name').textContent = d.name;
  return a;
}

function enter(user) {
  me = user;
  fillUser(user);
  const dashes = user.dashboards || [];

  if (isAmo(user.role)) {
    show('admin');
    $('tab-config').hidden = user.role !== 'supremo';
    const grid = $('dash-grid');
    grid.innerHTML = '';
    // primera tarjeta: crear
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'dash-card dash-card--new';
    add.innerHTML = '<span class="dash-ico">+</span><span class="dash-name">Nuevo dashboard</span>';
    add.addEventListener('click', openNewDash);
    grid.append(add);
    dashes.forEach((d) => grid.append(dashLink(d)));
    return;
  }

  if (!dashes.length) return show('nodash');
  if (dashes.length === 1) return location.replace(dashes[0].url);

  $('picker-list').innerHTML = '';
  dashes.forEach((d) => $('picker-list').append(dashLink(d)));
  show('picker');
}

/* ---------- pestañas del panel ---------- */

document.querySelectorAll('.admin-nav [data-tab]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.admin-nav [data-tab]').forEach((x) => x.classList.toggle('is-active', x === b));
  document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
  if (b.dataset.tab === 'perms') loadPerms();
  if (b.dataset.tab === 'config') loadConfig();
}));

/* ============================================================
   Nuevo dashboard: título + ícono opcional (modal encima)
   ============================================================ */

let ndImage = null;

function resetNewDash() {
  ndImage = null;
  $('nd-form').className = 'modal nd-modal';
  $('nd-title').value = '';
  $('nd-err').textContent = '';
  $('nd-file').value = '';
  $('nd-icon-note').textContent = 'Subir ícono';
  $('nd-icon').classList.remove('has-image');
  paintNdIcon();
}

/** Vista previa: la imagen subida o el ícono por defecto con las iniciales del título. */
function paintNdIcon() {
  $('nd-icon-img').innerHTML = dashIconHTML({ name: $('nd-title').value || '+', image: ndImage });
}

function openNewDash() {
  resetNewDash();
  $('nd-layer').hidden = false;
  setTimeout(() => $('nd-title').focus(), 50);
}
const closeNewDash = () => { $('nd-layer').hidden = true; };

$('nd-cancel').addEventListener('click', closeNewDash);
$('nd-layer').addEventListener('pointerdown', (e) => { if (e.target === $('nd-layer')) closeNewDash(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('nd-layer').hidden) closeNewDash(); });
$('nd-title').addEventListener('input', paintNdIcon);

/** Recorta la imagen al centro y la baja a 128×128 para guardarla chica. */
function toIcon(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const S = 128, c = document.createElement('canvas');
      c.width = c.height = S;
      const side = Math.min(img.naturalWidth, img.naturalHeight) || S;
      const sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
      c.getContext('2d').drawImage(img, sx, sy, side, side, 0, 0, S, S);
      URL.revokeObjectURL(url);
      let out = c.toDataURL('image/png');
      if (out.length > 100_000) out = c.toDataURL('image/webp', 0.85);
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

$('nd-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    ndImage = await toIcon(file);
    $('nd-icon').classList.add('has-image');
    $('nd-icon-note').textContent = 'Cambiar';
    $('nd-err').textContent = '';
  } catch (err) {
    $('nd-err').textContent = err.message;
  }
  paintNdIcon();
});

$('nd-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('nd-title').value.trim();
  const form = $('nd-form');
  if (!name) {
    $('nd-err').textContent = 'Ponle un título.';
    form.classList.remove('is-shaking'); void form.offsetWidth; form.classList.add('is-shaking');
    return;
  }
  $('nd-save').disabled = true;
  const r = await api('/api/dash', { method: 'POST', body: JSON.stringify({ name, image: ndImage }) });
  $('nd-save').disabled = false;
  if (!r.ok) { $('nd-err').textContent = r.data.error || 'No se pudo crear.'; return; }
  location.href = r.data.dashboard.url; // directo al lienzo nuevo
});

/* ---------- login ---------- */

let clientId = '';

function whenGoogle() {
  return new Promise((resolve) => {
    const tick = () => (window.google?.accounts?.id ? resolve() : setTimeout(tick, 60));
    tick();
  });
}

async function showLogin(msg = '') {
  show('login');
  $('login-err').textContent = msg;
  if (!clientId) {
    $('login-err').textContent = msg || 'La función no ve GOOGLE_CLIENT_ID. Revisa /api/auth?diag=1 y vuelve a desplegar en Vercel.';
    return;
  }
  await whenGoogle();
  google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: 'popup' });
  $('g-btn').innerHTML = '';
  google.accounts.id.renderButton($('g-btn'), {
    theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 260,
  });
}

async function onCredential({ credential }) {
  $('login-err').textContent = '';
  const { ok, status, data } = await api('/api/auth', { method: 'POST', body: JSON.stringify({ credential }) });
  if (ok) return enter(data.user);
  if (status === 403) {
    $('denied-email').textContent = data.email || '';
    return show('denied');
  }
  $('login-err').textContent = data.error || 'No se pudo iniciar sesión.';
}

$('denied-retry').addEventListener('click', () => {
  window.google?.accounts?.id?.disableAutoSelect();
  showLogin();
});

document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
  await api('/api/auth', { method: 'DELETE' });
  window.google?.accounts?.id?.disableAutoSelect();
  showLogin();
}));

/* ============================================================
   Permisos
   ============================================================ */

const list = $('perm-list');
const msg = (text, err = false) => { $('perm-msg').textContent = text; $('perm-msg').classList.toggle('err', err); };

function badge(text, cls = '') {
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

function row(email, roleCell, dashCell, action) {
  const el = document.createElement('div');
  el.className = 'perm-row';
  el.setAttribute('role', 'row');
  const mail = document.createElement('span');
  mail.className = 'perm-email';
  mail.textContent = email;
  const role = document.createElement('span');
  role.append(roleCell);
  const dash = document.createElement('span');
  dash.className = 'perm-dash';
  dash.append(dashCell);
  const act = document.createElement('span');
  act.className = 'perm-act';
  if (action) act.append(action);
  el.append(mail, role, dash, act);
  return el;
}

async function loadPerms() {
  list.innerHTML = '<p class="perm-empty">Cargando…</p>';
  const { ok, data } = await api('/api/perms');
  if (!ok) {
    list.innerHTML = '';
    return msg(data.error || 'No se pudieron cargar los permisos.', true);
  }
  const supremo = data.me === 'supremo';
  const names = Object.fromEntries((me?.dashboards || []).map((d) => [d.id, d.name]));

  $('perm-help').textContent = supremo
    ? 'Agrega amos (ven y editan todo) y chismosos (solo ven lo que un amo les active desde cada dashboard).'
    : 'Agrega chismosos: solo ven lo que un amo les active desde el botón «Integrantes» de cada dashboard.';

  $('perm-role').innerHTML = '';
  for (const r of data.roles) $('perm-role').add(new Option(ROLE_LABEL[r], r));

  list.innerHTML = '';
  list.append(row(data.owner, badge(ROLE_LABEL.supremo, 'badge--admin'), badge('Todos'), null));

  // amos primero, luego chismosos
  const sorted = [...data.perms].sort((a, b) => (a.role === b.role ? a.email.localeCompare(b.email) : a.role === 'amo' ? -1 : 1));
  for (const p of sorted) {
    let roleCell;
    if (supremo) {
      roleCell = document.createElement('select');
      for (const r of data.roles) roleCell.add(new Option(ROLE_LABEL[r], r, false, r === p.role));
      roleCell.addEventListener('change', async () => {
        const r = await api('/api/perms', { method: 'PATCH', body: JSON.stringify({ id: p.id, role: roleCell.value }) });
        msg(r.ok ? `${p.email} ahora es ${ROLE_LABEL[roleCell.value]}.` : (r.data.error || 'No se pudo cambiar.'), !r.ok);
        if (r.ok) loadPerms();
      });
    } else {
      roleCell = badge(ROLE_LABEL[p.role], p.role === 'amo' ? 'badge--admin' : '');
    }

    const dashText = p.role === 'amo' ? 'Todos'
      : p.dashboards.length ? p.dashboards.map((id) => names[id] || id).join(', ') : 'Ninguno todavía';
    const dashCell = document.createElement('span');
    dashCell.className = 'perm-dash-text';
    dashCell.textContent = dashText;

    let del = null;
    if (supremo || p.role === 'chismoso') {
      del = document.createElement('button');
      del.type = 'button';
      del.className = 'link-btn';
      del.textContent = 'Quitar';
      del.addEventListener('click', async () => {
        if (!confirm(`¿Quitar el acceso de ${p.email}?`)) return;
        del.disabled = true;
        const r = await api(`/api/perms?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
        if (r.ok) { msg(`Se quitó el acceso de ${p.email}.`); loadPerms(); }
        else { del.disabled = false; msg(r.data.error || 'No se pudo quitar.', true); }
      });
    }

    list.append(row(p.email, roleCell, dashCell, del));
  }

  if (!data.perms.length) {
    const empty = document.createElement('p');
    empty.className = 'perm-empty';
    empty.textContent = 'Todavía no agregaste a nadie.';
    list.append(empty);
  }
}

$('perm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('perm-email').value.trim();
  const role = $('perm-role').value;
  $('perm-add').disabled = true;
  const r = await api('/api/perms', { method: 'POST', body: JSON.stringify({ email, role }) });
  $('perm-add').disabled = false;
  if (!r.ok) return msg(r.data.error || 'No se pudo agregar.', true);
  $('perm-email').value = '';
  msg(role === 'chismoso'
    ? `${email} es chismoso. Actívale dashboards desde «Integrantes» en cada uno.`
    : `${email} ahora es ${ROLE_LABEL[role]}.`);
  loadPerms();
});

/* ============================================================
   Configuración (amo supremo): intensidad del ojo de pez
   ============================================================ */

const feRange = $('fe-range');

/** Vista previa: la misma rejilla y el mismo efecto que el lienzo real. */
function paintPreview() {
  const amount = Number(feRange.value) / 100;
  const v = Number(feRange.value);
  $('fe-value').textContent = v > 0 ? `+${v}` : v < 0 ? `−${-v}` : '0';
  const { w, h } = fitCanvas($('fe-dots'));
  drawDots($('fe-dots').getContext('2d'), w, h, { amount, grid: 26 });
  for (const card of $('fe-preview').querySelectorAll('.fe-card')) {
    const cx = card.offsetLeft + card.offsetWidth / 2, cy = card.offsetTop + card.offsetHeight / 2;
    card.style.transform = lensTransform(cx, cy, w, h, amount);
  }
}

async function loadConfig() {
  const { ok, data } = await api('/api/config');
  if (!ok) { $('fe-msg').textContent = data.error || 'No se pudo cargar.'; return; }
  feRange.value = data.config.fisheye;
  paintPreview();
}

feRange.addEventListener('input', paintPreview);
feRange.addEventListener('change', async () => {
  $('fe-msg').textContent = 'Guardando…';
  $('fe-msg').classList.remove('err');
  const r = await api('/api/config', { method: 'PUT', body: JSON.stringify({ fisheye: Number(feRange.value) }) });
  $('fe-msg').textContent = r.ok ? 'Guardado. Se aplica al abrir o actualizar cada dashboard.' : (r.data.error || 'No se pudo guardar.');
  $('fe-msg').classList.toggle('err', !r.ok);
});
new ResizeObserver(() => { if (!$('fe-preview').closest('[hidden]')) paintPreview(); }).observe($('fe-preview'));

/* ---------- arranque ---------- */

(async () => {
  const { ok, status, data } = await api('/api/auth');
  if (!ok) {
    return showLogin(status === 404 || status === 501
      ? 'El login necesita la API: en local usa `npx vercel dev`.'
      : (data.error || 'No se pudo conectar con el servidor.'));
  }
  clientId = data.clientId;
  if (data.user) enter(data.user);
  else showLogin();
})();
