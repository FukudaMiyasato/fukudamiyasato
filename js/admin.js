/* ============================================================
   admin.js — login con Google + panel de los amos
   ------------------------------------------------------------
   Quién entra y qué ve lo decide el servidor (/api/auth). Esta
   página solo elige la vista:
     amo supremo / amo  → panel (Dashboards · Permisos; el supremo además
                          Aplicaciones · YO · Configuración)
     chismoso sin nada  → "No tienes permisos"
     chismoso con uno   → entra directo
     chismoso con más   → lista para elegir
   ============================================================ */

import { dashIconHTML } from './dashboard-icons.js';
import { drawDots, fitCanvas, buildLensFilter } from './fisheye.js';
import { PLATFORMS, platformIcon } from './app-platforms.js';
import { CONFIG } from './config.js';

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
    document.querySelectorAll('[data-supremo]').forEach((b) => { b.hidden = user.role !== 'supremo'; });
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
  if (b.dataset.tab === 'apps') loadApps();
  if (b.dataset.tab === 'me') loadMe();
}));

/* ============================================================
   Aplicaciones (amo supremo): lo que muestra la página Apps
   ============================================================ */

const escA = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nfApps = new Intl.NumberFormat('es-PE');
let apps = [];
let editing = null;   // app que se edita (null = nueva)
let appImage = '';

async function loadApps() {
  const grid = $('app-grid');
  grid.innerHTML = '<p class="form-msg">Cargando…</p>';
  const r = await api('/api/site?t=apps');
  if (!r.ok) { grid.innerHTML = `<p class="form-msg err">${escA(r.data.error || 'No se pudo cargar.')}</p>`; return; }
  apps = r.data.apps;
  const left = Math.max(0, r.data.million - r.data.downloads);
  $('apps-total').innerHTML = `<b>${nfApps.format(r.data.downloads)}</b> descargas en total · faltan <b>${nfApps.format(left)}</b> para el millón`;
  grid.innerHTML = '';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'app-card app-card--new';
  add.innerHTML = '<span class="app-card-img">+</span><span class="app-card-name">Nueva app</span>';
  add.addEventListener('click', () => openApp(null));
  grid.append(add);
  for (const a of apps) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'app-card';
    b.innerHTML = `<span class="app-card-img">${a.image ? `<img src="${a.image}" alt="">` : escA(a.name.slice(0, 2).toUpperCase())}</span>
      <span class="app-card-name">${escA(a.name)}</span>
      <small>${nfApps.format(a.downloads || 0)} descargas</small>
      <span class="app-card-links">${(a.links || []).map((l) => platformIcon(l.platform)).join('')}</span>`;
    b.addEventListener('click', () => openApp(a));
    grid.append(b);
  }
}

function paintAppImage() {
  $('app-img-box').innerHTML = appImage ? `<img src="${appImage}" alt="">` : '<span>4:3</span>';
  $('app-img-note').textContent = appImage ? 'Cambiar imagen' : 'Subir imagen';
}

function linkRow(l = { platform: 'apple', url: '' }) {
  const row = document.createElement('div');
  row.className = 'app-link';
  row.innerHTML = `
    <select aria-label="Plataforma">${PLATFORMS.map((p) => `<option value="${p.key}"${p.key === l.platform ? ' selected' : ''}>${p.label}</option>`).join('')}</select>
    <input type="url" placeholder="https://…" aria-label="Link" value="${escA(l.url)}">
    <button class="icon-btn" type="button" aria-label="Quitar link" title="Quitar link">×</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('app-links').append(row);
  return row;
}

function openApp(a) {
  editing = a;
  appImage = a?.image || '';
  $('app-form').className = 'modal app-modal';
  $('app-name').value = a?.name || '';
  $('app-year').value = a?.year || '';
  $('app-type').value = a?.type || '';
  $('app-downloads').value = a ? String(a.downloads || 0) : '';
  $('app-links').innerHTML = '';
  (a?.links?.length ? a.links : [{ platform: 'apple', url: '' }]).forEach((l) => linkRow(l));
  $('app-err').textContent = '';
  $('app-file').value = '';
  $('app-del').hidden = !a;
  paintAppImage();
  $('app-layer').hidden = false;
  setTimeout(() => $('app-name').focus(), 50);
}
const closeApp = () => { $('app-layer').hidden = true; };

$('app-cancel').addEventListener('click', closeApp);
$('app-layer').addEventListener('pointerdown', (e) => { if (e.target === $('app-layer')) closeApp(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('app-layer').hidden) closeApp(); });
$('app-add-link').addEventListener('click', () => linkRow({ platform: 'android', url: '' }).querySelector('input').focus());

/** Recorta al centro en 4:3 y la baja a 640×480 para guardarla chica. */
function toCover(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const W = 640, H = 480, c = document.createElement('canvas');
      c.width = W; c.height = H;
      const iw = img.naturalWidth, ih = img.naturalHeight;
      const scale = Math.max(W / iw, H / ih);
      const sw = W / scale, sh = H / scale;
      c.getContext('2d').drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, 0, 0, W, H);
      URL.revokeObjectURL(url);
      let out = c.toDataURL('image/webp', 0.82);
      if (!out.startsWith('data:image/webp')) out = c.toDataURL('image/jpeg', 0.82); // Safari viejo
      if (out.length > 200_000) out = c.toDataURL('image/jpeg', 0.6);
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen.')); };
    img.src = url;
  });
}

$('app-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try { appImage = await toCover(file); $('app-err').textContent = ''; } catch (err) { $('app-err').textContent = err.message; }
  paintAppImage();
});

function appFail(msg) {
  $('app-err').textContent = msg;
  const f = $('app-form');
  f.classList.remove('is-shaking'); void f.offsetWidth; f.classList.add('is-shaking');
}

$('app-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    name: $('app-name').value.trim(),
    image: appImage,
    year: $('app-year').value.trim(),
    type: $('app-type').value.trim(),
    downloads: Number($('app-downloads').value) || 0,
    links: [...$('app-links').querySelectorAll('.app-link')].map((row) => ({
      platform: row.querySelector('select').value, url: row.querySelector('input').value.trim(),
    })).filter((l) => l.url),
  };
  if (!body.name) return appFail('Ponle un nombre.');
  if (body.year && !/^\d{4}$/.test(body.year)) return appFail('El año va con 4 números.');
  $('app-save').disabled = true;
  const r = editing
    ? await api(`/api/site?t=apps&id=${encodeURIComponent(editing.id)}`, { method: 'PUT', body: JSON.stringify(body) })
    : await api('/api/site?t=apps', { method: 'POST', body: JSON.stringify(body) });
  $('app-save').disabled = false;
  if (!r.ok) return appFail(r.data.error || 'No se pudo guardar.');
  closeApp();
  loadApps();
});

$('app-del').addEventListener('click', async () => {
  if (!editing || !confirm(`¿Borrar «${editing.name}»? Deja de verse en la página Apps.`)) return;
  const r = await api(`/api/site?t=apps&id=${encodeURIComponent(editing.id)}`, { method: 'DELETE' });
  if (!r.ok) return appFail(r.data.error || 'No se pudo borrar.');
  closeApp();
  loadApps();
});

/* ============================================================
   YO (amo supremo): datos personales de la página Yo
   ============================================================ */

const ME_DEFAULTS = CONFIG.me;
const ME_INPUTS = { name: 'me-name', role: 'me-role', description: 'me-desc', location: 'me-loc', email: 'me-mail' };

async function loadMe() {
  $('me-msg').textContent = '';
  const r = await api('/api/site?t=me');
  const me = { ...ME_DEFAULTS, ...(r.ok && r.data.me ? r.data.me : {}) };
  for (const [k, idEl] of Object.entries(ME_INPUTS)) $(idEl).value = me[k] || '';
}

$('me-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = Object.fromEntries(Object.entries(ME_INPUTS).map(([k, idEl]) => [k, $(idEl).value.trim()]));
  $('me-save').disabled = true;
  const r = await api('/api/site?t=me', { method: 'PUT', body: JSON.stringify(body) });
  $('me-save').disabled = false;
  $('me-msg').className = `form-msg${r.ok ? '' : ' err'}`;
  $('me-msg').textContent = r.ok ? 'Guardado. Ya se ve en la página Yo.' : (r.data.error || 'No se pudo guardar.');
});

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
  const on = buildLensFilter($('fe-filter'), w, h, amount);
  $('fe-lens').style.filter = on ? 'url(#fe-filter)' : 'none';
}

async function loadConfig() {
  const { ok, data } = await api('/api/config');
  if (!ok) { $('fe-msg').textContent = data.error || 'No se pudo cargar.'; return; }
  feRange.value = data.config.fisheye;
  paintPreview();
  paintAiKey(data.config.aiKey, data.keys);
}

/* ---------- qué API key de OpenAI va primero ---------- */

const KEY_ENV = { yo: 'OPENAI_API_KEY', lvl: 'OPENAI_API_KEY2' };

function paintAiKey(active, keys) {
  document.querySelectorAll('#ai-key [data-key]').forEach((b) => {
    b.setAttribute('aria-checked', String(b.dataset.key === active));
  });
  if (keys) {
    for (const [k, loaded] of Object.entries(keys)) {
      document.querySelector(`[data-key-status="${k}"]`).textContent = loaded ? KEY_ENV[k] : `falta ${KEY_ENV[k]}`;
    }
  }
}

document.querySelectorAll('#ai-key [data-key]').forEach((b) => b.addEventListener('click', async () => {
  const prev = document.querySelector('#ai-key [aria-checked="true"]')?.dataset.key;
  paintAiKey(b.dataset.key);
  $('ai-key-msg').classList.remove('err');
  $('ai-key-msg').textContent = 'Guardando…';
  const r = await api('/api/config', { method: 'PUT', body: JSON.stringify({ aiKey: b.dataset.key }) });
  if (!r.ok) paintAiKey(prev);
  $('ai-key-msg').textContent = r.ok ? `Listo: primero ${b.querySelector('b').textContent}, y si falla, la otra.` : (r.data.error || 'No se pudo guardar.');
  $('ai-key-msg').classList.toggle('err', !r.ok);
}));

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
