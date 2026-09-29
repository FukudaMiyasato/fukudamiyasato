/* ============================================================
   admin.js — login con Google + panel de administrador
   ------------------------------------------------------------
   Quién entra y qué dashboards ve lo decide el servidor
   (/api/auth). Esta página solo elige la vista:
     admin              → panel (Dashboards · Permisos)
     sin dashboards     → "No tienes permisos"
     un dashboard       → entra directo
     varios dashboards  → lista para elegir
   ============================================================ */

import { iconFor } from './dashboard-icons.js';

const $ = (id) => document.getElementById(id);
const VIEWS = ['loading', 'login', 'denied', 'nodash', 'picker', 'admin'];
const ROLE_LABEL = { admin: 'Administrador', cliente: 'Cliente' };

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
  a.innerHTML = `<span class="dash-ico">${iconFor(d.icon)}</span><span class="dash-name"></span>`;
  a.querySelector('.dash-name').textContent = d.name;
  return a;
}

function enter(user) {
  fillUser(user);
  const dashes = user.dashboards || [];

  if (user.role === 'admin') {
    show('admin');
    const grid = $('dash-grid');
    grid.innerHTML = '';
    if (dashes.length) dashes.forEach((d) => grid.append(dashLink(d)));
    else grid.innerHTML = '<p class="perm-empty perm-empty--box">Todavía no hay dashboards.</p>';
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
}));

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

/* ---------- permisos ---------- */

const list = $('perm-list');
const msg = (text, err = false) => { $('perm-msg').textContent = text; $('perm-msg').classList.toggle('err', err); };

function badge(text, cls = '') {
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

/** Chips on/off, uno por dashboard. onChange recibe la lista de ids marcados. */
function dashChips(catalog, selected, onChange) {
  const wrap = document.createElement('div');
  wrap.className = 'chips';
  const on = new Set(selected);
  for (const d of catalog) {
    const c = document.createElement('button');
    c.type = 'button';
    c.className = 'chip';
    c.innerHTML = `${iconFor(d.icon)}<span></span>`;
    c.querySelector('span').textContent = d.name;
    c.setAttribute('aria-pressed', String(on.has(d.id)));
    c.addEventListener('click', async () => {
      const next = new Set(on);
      next.has(d.id) ? next.delete(d.id) : next.add(d.id);
      c.disabled = true;
      const ok = onChange ? await onChange([...next]) : true;
      c.disabled = false;
      if (!ok) return;
      next.has(d.id) ? on.add(d.id) : on.delete(d.id);
      c.setAttribute('aria-pressed', String(on.has(d.id)));
    });
    wrap.append(c);
  }
  wrap.value = () => [...on];
  return wrap;
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

let newDashChips = null;

async function loadPerms() {
  list.innerHTML = '<p class="perm-empty">Cargando…</p>';
  const { ok, data } = await api('/api/perms');
  if (!ok) {
    list.innerHTML = '';
    return msg(data.error || 'No se pudieron cargar los permisos.', true);
  }

  $('perm-role').innerHTML = '';
  for (const r of data.roles) $('perm-role').add(new Option(ROLE_LABEL[r] || r, r));

  // chips del formulario: se eligen antes de agregar, sin llamar a la API
  newDashChips = dashChips(data.dashboards, []);
  newDashChips.id = 'perm-dash';
  $('perm-dash').replaceWith(newDashChips);

  list.innerHTML = '';
  list.append(row(data.owner, badge('Administrador', 'badge--admin'), badge('Todos'), badge('Propietario')));

  for (const p of data.perms) {
    const chips = dashChips(data.dashboards, p.dashboards, async (ids) => {
      const r = await api('/api/perms', { method: 'PATCH', body: JSON.stringify({ id: p.id, dashboards: ids }) });
      msg(r.ok ? `Dashboards de ${p.email} actualizados.` : (r.data.error || 'No se pudo actualizar.'), !r.ok);
      return r.ok;
    });

    const del = document.createElement('button');
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

    list.append(row(p.email, badge(ROLE_LABEL[p.role] || p.role), chips, del));
  }

  if (!data.perms.length) {
    const empty = document.createElement('p');
    empty.className = 'perm-empty';
    empty.textContent = 'Aún no agregaste correos.';
    list.append(empty);
  }
}

$('perm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('perm-email').value.trim();
  const role = $('perm-role').value;
  const dashboards = newDashChips ? newDashChips.value() : [];
  $('perm-add').disabled = true;
  const r = await api('/api/perms', { method: 'POST', body: JSON.stringify({ email, role, dashboards }) });
  $('perm-add').disabled = false;
  if (!r.ok) return msg(r.data.error || 'No se pudo agregar.', true);
  $('perm-email').value = '';
  msg(`${email} ahora tiene acceso${dashboards.length ? '' : ' (sin dashboards todavía)'}.`);
  loadPerms();
});

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
