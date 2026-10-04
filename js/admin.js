/* ============================================================
   admin.js — login con Google + panel de los amos
   ------------------------------------------------------------
   Quién entra y qué ve lo decide el servidor (/api/auth). Esta
   página solo elige la vista:
     amo supremo / amo  → panel (Dashboards · Permisos; el supremo además
                          Portafolio · Aplicaciones · YO · Configuración)
     chismoso sin nada  → "No tienes permisos"
     chismoso con uno   → entra directo
     chismoso con más   → lista para elegir
   ============================================================ */

import { dashIconHTML } from './dashboard-icons.js';
import { drawDots, fitCanvas, buildLensFilter } from './fisheye.js';
import { PLATFORMS, platformIcon } from './app-platforms.js';
import { SOCIALS } from './socials.js';
import { DEFAULT_ME, DEFAULT_DURATION, PROJECT_DEFAULTS, shortDate } from './site-defaults.js';

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
  if (b.dataset.tab === 'folio') loadFolio();
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
   YO (amo supremo): título, texto y redes de la página Yo
   ============================================================ */

function meLinkRow(l = { platform: 'instagram', url: '' }) {
  const row = document.createElement('div');
  row.className = 'app-link';
  row.innerHTML = `
    <select aria-label="Red">${SOCIALS.map((s) => `<option value="${s.key}"${s.key === l.platform ? ' selected' : ''}>${s.label}</option>`).join('')}</select>
    <input placeholder="https://… o correo" aria-label="Link" value="${escA(l.platform === 'email' ? l.url.replace(/^mailto:/i, '') : l.url)}">
    <button class="icon-btn" type="button" aria-label="Quitar red" title="Quitar red">×</button>`;
  row.querySelector('button').addEventListener('click', () => row.remove());
  $('me-links').append(row);
  return row;
}

async function loadMe() {
  $('me-msg').textContent = '';
  const r = await api('/api/site?t=me');
  const me = { ...DEFAULT_ME, ...(r.ok && r.data.me ? r.data.me : {}) };
  $('me-title').value = me.title || '';
  $('me-text').value = me.text || '';
  $('me-links').innerHTML = '';
  (me.links || []).forEach((l) => meLinkRow(l));
}

$('me-add-link').addEventListener('click', () => meLinkRow().querySelector('input').focus());

$('me-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const body = {
    title: $('me-title').value.trim(),
    text: $('me-text').value.trim(),
    links: [...$('me-links').querySelectorAll('.app-link')].map((row) => ({
      platform: row.querySelector('select').value, url: row.querySelector('input').value.trim(),
    })).filter((l) => l.url),
  };
  $('me-save').disabled = true;
  const r = await api('/api/site?t=me', { method: 'PUT', body: JSON.stringify(body) });
  $('me-save').disabled = false;
  $('me-msg').className = `form-msg${r.ok ? '' : ' err'}`;
  $('me-msg').textContent = r.ok ? 'Guardado. Ya se ve en la página Yo.' : (r.data.error || 'No se pudo guardar.');
});

/* ============================================================
   Portafolio (amo supremo): proyectos de la portada y su tiempo
   ============================================================ */

let folio = { duration: DEFAULT_DURATION, projects: [] };
let pjEditing = null;     // proyecto que se edita (null = nuevo)
let pjMedia = null;       // { type, url } o null
let uploading = false;

const isVideoUrl = (u) => /\.(mp4|webm|mov|m4v)(\?|$)/i.test(u);

async function loadFolio() {
  const r = await api('/api/site?t=portfolio');
  if (!r.ok) { $('folio-list').innerHTML = `<p class="form-msg err">${escA(r.data.error || 'No se pudo cargar.')}</p>`; return; }
  folio = r.data;
  $('folio-dur').value = folio.duration;
  $('folio-dur-value').textContent = `${folio.duration} s`;
  renderFolio();
}

function thumb(m) {
  if (!m?.url) return '<span class="folio-thumb folio-thumb--none" aria-hidden="true"></span>';
  return m.type === 'video'
    ? `<video class="folio-thumb" src="${escA(m.url)}#t=1" muted playsinline preload="metadata" aria-hidden="true"></video>`
    : `<img class="folio-thumb" src="${escA(m.url)}" alt="" loading="lazy">`;
}

function renderFolio() {
  const list = $('folio-list');
  list.innerHTML = '';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'folio-row folio-row--new';
  add.innerHTML = '<span class="folio-thumb folio-thumb--add">+</span><span class="folio-info"><b>Nuevo proyecto</b><small>Video o imagen, fecha, categoría, título, texto, etiquetas y link</small></span>';
  add.addEventListener('click', () => openProject(null));
  list.append(add);
  if (!folio.projects.length) {
    const p = document.createElement('p');
    p.className = 'form-msg';
    p.textContent = 'Todavía no hay proyectos: la portada muestra el de ejemplo (ABC).';
    list.append(p);
  }
  folio.projects.forEach((pj, i) => {
    const row = document.createElement('div');
    row.className = 'folio-row';
    row.innerHTML = `
      <span class="folio-n">${String(i + 1).padStart(2, '0')}</span>
      ${thumb(pj.media)}
      <button class="folio-info" type="button">
        <b>${escA(pj.title || PROJECT_DEFAULTS.title)}</b>
        <small>${escA([pj.category || PROJECT_DEFAULTS.category, shortDate(pj.date), `${pj.duration || folio.duration} s`].filter(Boolean).join(' · '))}</small>
      </button>
      <span class="folio-move">
        <button class="icon-btn" type="button" data-move="-1" aria-label="Subir" title="Subir"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="icon-btn" type="button" data-move="1" aria-label="Bajar" title="Bajar"${i === folio.projects.length - 1 ? ' disabled' : ''}>↓</button>
      </span>`;
    row.querySelector('.folio-info').addEventListener('click', () => openProject(pj));
    row.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => moveProject(i, Number(b.dataset.move))));
    list.append(row);
  });
}

async function moveProject(i, dir) {
  const order = folio.projects.map((p) => p.id);
  const j = i + dir;
  if (j < 0 || j >= order.length) return;
  [order[i], order[j]] = [order[j], order[i]];
  const r = await api('/api/site?t=portfolio', { method: 'PUT', body: JSON.stringify({ order }) });
  if (!r.ok) { $('folio-msg').className = 'form-msg err'; $('folio-msg').textContent = r.data.error || 'No se pudo mover.'; return; }
  folio = r.data;
  renderFolio();
}

let durTimer = 0;
$('folio-dur').addEventListener('input', () => {
  $('folio-dur-value').textContent = `${$('folio-dur').value} s`;
  clearTimeout(durTimer);
  durTimer = setTimeout(async () => {
    const r = await api('/api/site?t=portfolio', { method: 'PUT', body: JSON.stringify({ duration: Number($('folio-dur').value) }) });
    $('folio-msg').className = `form-msg${r.ok ? '' : ' err'}`;
    $('folio-msg').textContent = r.ok ? 'Guardado.' : (r.data.error || 'No se pudo guardar.');
    if (r.ok) { folio = r.data; renderFolio(); }
  }, 400);
});

function paintPjMedia() {
  const box = $('pj-preview');
  box.innerHTML = pjMedia?.url
    ? (pjMedia.type === 'video'
      ? `<video src="${escA(pjMedia.url)}" muted loop playsinline autoplay></video>`
      : `<img src="${escA(pjMedia.url)}" alt="">`)
    : '<span>Sin video ni imagen<br><small>se verá una nube de color con el tramado</small></span>';
  $('pj-url').value = pjMedia?.url && !pjMedia.url.startsWith('blob:') ? pjMedia.url : '';
  $('pj-media-clear').hidden = !pjMedia;
}

function openProject(pj) {
  pjEditing = pj;
  pjMedia = pj?.media ? { ...pj.media } : null;
  $('pj-form').className = 'modal app-modal';
  $('pj-title').value = pj?.title || '';
  $('pj-date').value = /^\d{4}-\d{2}-\d{2}$/.test(pj?.date || '') ? pj.date : (pj?.date ? `${pj.date}-01` : '');
  $('pj-cat').value = pj?.category || '';
  $('pj-dur').value = pj?.duration || '';
  $('pj-dur').placeholder = `general: ${folio.duration}`;
  $('pj-text').value = pj?.text || '';
  $('pj-tags').value = (pj?.tags || []).join(', ');
  $('pj-link').value = pj?.link || '';
  $('pj-err').textContent = '';
  $('pj-file').value = '';
  $('pj-bar').hidden = true;
  $('pj-del').hidden = !pj;
  paintPjMedia();
  $('pj-layer').hidden = false;
  setTimeout(() => $('pj-title').focus(), 50);
}
const closeProject = () => { if (!uploading) $('pj-layer').hidden = true; };

$('pj-cancel').addEventListener('click', closeProject);
$('pj-layer').addEventListener('pointerdown', (e) => { if (e.target === $('pj-layer')) closeProject(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('pj-layer').hidden) closeProject(); });
$('pj-media-clear').addEventListener('click', () => { pjMedia = null; paintPjMedia(); });
$('pj-url').addEventListener('change', () => {
  const url = $('pj-url').value.trim();
  pjMedia = url ? { type: isVideoUrl(url) ? 'video' : 'image', url } : null;
  paintPjMedia();
});

function pjFail(msg) {
  $('pj-err').textContent = msg;
  const f = $('pj-form');
  f.classList.remove('is-shaking'); void f.offsetWidth; f.classList.add('is-shaking');
}

/* el archivo va directo del navegador a Vercel Blob; /api/upload solo firma el permiso */
$('pj-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const type = file.type.startsWith('video/') ? 'video' : 'image';
  const bar = $('pj-bar');
  uploading = true;
  $('pj-save').disabled = true;
  bar.hidden = false;
  bar.firstElementChild.style.width = '0%';
  $('pj-err').textContent = '';
  try {
    const { upload } = await import('https://esm.sh/@vercel/blob@2.8.0/client');
    const name = file.name.normalize('NFD').replace(/[^\w.-]+/g, '-').toLowerCase();
    const blob = await upload(`portafolio/${name}`, file, {
      access: 'public',
      handleUploadUrl: '/api/upload',
      contentType: file.type,
      multipart: file.size > 20 * 1024 * 1024,
      onUploadProgress: ({ percentage }) => { bar.firstElementChild.style.width = `${percentage}%`; },
    });
    pjMedia = { type, url: blob.url };
    paintPjMedia();
  } catch (err) {
    pjFail(/Blob|BLOB|503/.test(err.message) ? 'Falta Vercel Blob en Vercel (Storage → Blob). Mientras, pega un link.' : `No se pudo subir: ${err.message}`);
  } finally {
    uploading = false;
    $('pj-save').disabled = false;
    bar.hidden = true;
    e.target.value = '';
  }
});

$('pj-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  if (uploading) return;
  const body = {
    media: pjMedia,
    title: $('pj-title').value.trim(),
    date: $('pj-date').value,
    category: $('pj-cat').value.trim(),
    duration: $('pj-dur').value === '' ? null : Number($('pj-dur').value),
    text: $('pj-text').value.trim(),
    tags: $('pj-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    link: $('pj-link').value.trim(),
  };
  $('pj-save').disabled = true;
  const r = pjEditing
    ? await api(`/api/site?t=project&id=${encodeURIComponent(pjEditing.id)}`, { method: 'PUT', body: JSON.stringify(body) })
    : await api('/api/site?t=project', { method: 'POST', body: JSON.stringify(body) });
  $('pj-save').disabled = false;
  if (!r.ok) return pjFail(r.data.error || 'No se pudo guardar.');
  closeProject();
  loadFolio();
});

$('pj-del').addEventListener('click', async () => {
  if (!pjEditing || !confirm(`¿Borrar «${pjEditing.title || PROJECT_DEFAULTS.title}»? Deja de verse en la portada.`)) return;
  const r = await api(`/api/site?t=project&id=${encodeURIComponent(pjEditing.id)}`, { method: 'DELETE' });
  if (!r.ok) return pjFail(r.data.error || 'No se pudo borrar.');
  closeProject();
  loadFolio();
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
