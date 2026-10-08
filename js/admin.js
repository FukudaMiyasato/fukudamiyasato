/* ============================================================
   admin.js — login con Google + panel de los amos
   ------------------------------------------------------------
   Quién entra y qué ve lo decide el servidor (/api/auth). Esta
   página solo elige la vista:
     amo supremo / amo  → panel (Dashboards · Permisos; el supremo además
                          Portafolio · Configuración)
     chismoso sin nada  → "No tienes permisos"
     chismoso con uno   → entra directo
     chismoso con más   → lista para elegir
   ============================================================ */

import { dashIconHTML } from './dashboard-icons.js';
import { drawDots, fitCanvas, buildLensFilter } from './fisheye.js';
import { youtubeId, youtubeThumb } from './youtube.js';
import { DEFAULT_DURATION, TAGS } from './site-defaults.js';

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
  if (b.dataset.tab === 'folio') loadFolio();
}));

const escA = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ============================================================
   Portafolio (amo supremo): proyectos de la portada
   ------------------------------------------------------------
   Cada proyecto: nombre y año (chicos, arriba a la derecha de la
   tarjeta), «qué es» y «qué hice» (los dos cuadrados), etiquetas
   (checkbox) y una lista de
   videos que la portada pasa en orden; al terminar el último sigue
   el próximo proyecto. Switch de visibilidad y ↑ ↓ para el orden.
   ============================================================ */

let folio = { duration: DEFAULT_DURATION, projects: [] };
let pjEditing = null;     // proyecto que se edita (null = nuevo)
let pjVideos = [];        // [{ type, url, id?, name? }] del editor
let uploading = false;

const tagLabel = (key) => TAGS.find((t) => t.key === key)?.label || key;
const nameOf = (pj) => pj.name || 'Sin nombre';

async function loadFolio() {
  const r = await api('/api/site?t=portfolio&all=1'); // con los ocultos
  if (!r.ok) { $('folio-list').innerHTML = `<p class="form-msg err">${escA(r.data.error || 'No se pudo cargar.')}</p>`; return; }
  folio = r.data;
  $('folio-dur').value = folio.duration;
  $('folio-dur-value').textContent = `${folio.duration} s`;
  renderFolio();
}

/** Miniatura de un video (o de una imagen vieja). */
function thumb(m) {
  if (!m?.url) return '<span class="folio-thumb folio-thumb--none" aria-hidden="true"></span>';
  const yt = m.type === 'youtube' ? (m.id || youtubeId(m.url)) : '';
  if (yt) return `<span class="folio-thumb folio-thumb--yt"><img src="${youtubeThumb(yt)}" alt="" loading="lazy"></span>`;
  return m.type === 'image'
    ? `<img class="folio-thumb" src="${escA(m.url)}" alt="" loading="lazy">`
    : `<video class="folio-thumb" src="${escA(m.url)}#t=1" muted playsinline preload="metadata" aria-hidden="true"></video>`;
}

function renderFolio() {
  const list = $('folio-list');
  list.innerHTML = '';
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'folio-row folio-row--new';
  add.innerHTML = '<span class="folio-thumb folio-thumb--add">+</span><span class="folio-info"><b>Nuevo proyecto</b><small>Nombre, año, qué es, qué hice, etiquetas y videos</small></span>';
  add.addEventListener('click', () => openProject(null));
  list.append(add);
  if (!folio.projects.length) {
    const p = document.createElement('p');
    p.className = 'form-msg';
    p.textContent = 'Todavía no hay proyectos: la portada muestra el de ejemplo (ABC).';
    list.append(p);
  }
  folio.projects.forEach((pj, i) => {
    const n = pj.videos.length;
    const detail = [pj.year, n ? `${n} video${n === 1 ? '' : 's'}` : `sin video · ${folio.duration} s`, ...pj.tags.map(tagLabel)].filter(Boolean).join(' · ');
    const row = document.createElement('div');
    row.className = `folio-row${pj.visible ? '' : ' is-hidden'}`;
    row.innerHTML = `
      <span class="folio-n">${String(i + 1).padStart(2, '0')}</span>
      ${thumb(pj.videos[0])}
      <button class="folio-info" type="button">
        <b>${escA(nameOf(pj))}</b>
        <small>${escA(detail)}</small>
      </button>
      <button class="switch" type="button" role="switch" aria-checked="${pj.visible}"
        aria-label="Visible en la portada: ${escA(nameOf(pj))}" title="${pj.visible ? 'Visible en la portada' : 'Oculto en la portada'}"><span></span></button>
      <span class="folio-move">
        <button class="icon-btn" type="button" data-move="-1" aria-label="Subir" title="Subir"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="icon-btn" type="button" data-move="1" aria-label="Bajar" title="Bajar"${i === folio.projects.length - 1 ? ' disabled' : ''}>↓</button>
      </span>`;
    row.querySelector('.folio-info').addEventListener('click', () => openProject(pj));
    row.querySelector('.switch').addEventListener('click', (e) => toggleVisible(pj, row, e.currentTarget));
    row.querySelectorAll('[data-move]').forEach((b) => b.addEventListener('click', () => moveProject(i, Number(b.dataset.move))));
    list.append(row);
  });
}

/** Switch de visibilidad: cambia al toque y, si falla, vuelve atrás. */
async function toggleVisible(pj, row, sw) {
  const visible = !pj.visible;
  sw.setAttribute('aria-checked', String(visible));
  sw.title = visible ? 'Visible en la portada' : 'Oculto en la portada';
  row.classList.toggle('is-hidden', !visible);
  sw.disabled = true;
  const r = await api(`/api/site?t=project&id=${encodeURIComponent(pj.id)}`, { method: 'PATCH', body: JSON.stringify({ visible }) });
  sw.disabled = false;
  $('folio-msg').className = `form-msg${r.ok ? '' : ' err'}`;
  if (!r.ok) {
    sw.setAttribute('aria-checked', String(pj.visible));
    row.classList.toggle('is-hidden', !pj.visible);
    $('folio-msg').textContent = r.data.error || 'No se pudo cambiar.';
    return;
  }
  pj.visible = visible;
  const shown = folio.projects.filter((x) => x.visible).length;
  $('folio-msg').textContent = `«${nameOf(pj)}» ${visible ? 'ya se ve' : 'ya no se ve'} en la portada · ${shown} de ${folio.projects.length} visibles.`;
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

/* ---------- editor ---------- */

/** Lista de videos del editor: miniatura, nombre, ↑ ↓ y quitar. */
function renderVideos() {
  const ol = $('pj-videos');
  ol.innerHTML = '';
  if (!pjVideos.length) {
    ol.innerHTML = '<li class="pj-empty">Sin videos: en la portada se ve el fondo de nube por el tiempo general.</li>';
    return;
  }
  pjVideos.forEach((v, i) => {
    const li = document.createElement('li');
    li.className = 'pj-video';
    const yt = v.type === 'youtube' ? (v.id || youtubeId(v.url)) : '';
    const label = v.name || (yt ? `YouTube · ${yt}` : decodeURIComponent(v.url.split('/').pop().split('?')[0]));
    li.innerHTML = `
      <span class="pj-video-n">${i + 1}</span>
      ${thumb(v)}
      <span class="pj-video-name" title="${escA(v.url)}"></span>
      <span class="folio-move">
        <button class="icon-btn" type="button" data-v="up" aria-label="Subir"${i === 0 ? ' disabled' : ''}>↑</button>
        <button class="icon-btn" type="button" data-v="down" aria-label="Bajar"${i === pjVideos.length - 1 ? ' disabled' : ''}>↓</button>
        <button class="icon-btn" type="button" data-v="del" aria-label="Quitar video">×</button>
      </span>`;
    li.querySelector('.pj-video-name').textContent = label;
    li.querySelector('[data-v="up"]').addEventListener('click', () => { [pjVideos[i - 1], pjVideos[i]] = [pjVideos[i], pjVideos[i - 1]]; renderVideos(); });
    li.querySelector('[data-v="down"]').addEventListener('click', () => { [pjVideos[i + 1], pjVideos[i]] = [pjVideos[i], pjVideos[i + 1]]; renderVideos(); });
    li.querySelector('[data-v="del"]').addEventListener('click', () => { pjVideos.splice(i, 1); renderVideos(); });
    ol.append(li);
  });
}

function openProject(pj) {
  pjEditing = pj;
  pjVideos = (pj?.videos || []).map((v) => ({ ...v }));
  $('pj-form').className = 'modal app-modal';
  $('pj-name').value = pj?.name || '';
  $('pj-year').value = pj?.year || new Date().getFullYear(); // por defecto, el año actual
  $('pj-what').value = pj?.what ?? pj?.info ?? '';
  $('pj-did').value = pj?.did || '';
  document.querySelectorAll('#pj-form .pj-tags input').forEach((c) => { c.checked = Boolean(pj?.tags?.includes(c.value)); });
  $('pj-url').value = '';
  $('pj-err').textContent = '';
  $('pj-file').value = '';
  $('pj-bar').hidden = true;
  $('pj-bar-note').textContent = '';
  $('pj-del').hidden = !pj;
  renderVideos();
  checkBlob();
  $('pj-layer').hidden = false;
  setTimeout(() => $('pj-name').focus(), 50);
}
const closeProject = () => { if (!uploading) $('pj-layer').hidden = true; };

$('pj-cancel').addEventListener('click', closeProject);
$('pj-layer').addEventListener('pointerdown', (e) => { if (e.target === $('pj-layer')) closeProject(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('pj-layer').hidden) closeProject(); });

function pjFail(msg) {
  $('pj-err').textContent = msg;
  const f = $('pj-form');
  f.classList.remove('is-shaking'); void f.offsetWidth; f.classList.add('is-shaking');
}

/* pegar un link (mp4 o YouTube) + Enter → se suma a la lista */
$('pj-url').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const url = $('pj-url').value.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) return pjFail('El link debe empezar con https://');
  const yt = youtubeId(url);
  if (!yt && /(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url).hostname)) return pjFail('Ese link de YouTube no es de un video.');
  pjVideos.push(yt ? { type: 'youtube', url, id: yt } : { type: 'video', url });
  $('pj-url').value = '';
  $('pj-err').textContent = '';
  renderVideos();
});

/* ¿este despliegue tiene Vercel Blob? (GET /api/upload; no revela el token) */
let blobStatus = null;
async function checkBlob(force = false) {
  const el = $('pj-blob');
  if (!blobStatus || force) {
    const r = await api('/api/upload');
    blobStatus = r.ok ? r.data : { configured: false, error: r.data.error || `No se pudo consultar (${r.status}).` };
  }
  el.className = `pj-blob ${blobStatus.configured ? 'is-ok' : 'is-missing'}`;
  el.textContent = blobStatus.configured
    ? `Vercel Blob conectado (${blobStatus.env}): puedes subir videos.`
    : blobStatus.error || `Este despliegue (${blobStatus.deploy}) no ve Vercel Blob. Variables de Blob que ve: ${blobStatus.seen?.length ? blobStatus.seen.join(', ') : 'ninguna'}. Conecta el store a este proyecto con ${blobStatus.deploy === 'preview' ? 'Preview' : 'Production'} marcado y vuelve a desplegar. Mientras, pega links.`;
  return blobStatus.configured;
}

/* subir videos: van directo del navegador a Vercel Blob, uno tras otro */
$('pj-file').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  if (!(await checkBlob(true))) { e.target.value = ''; return pjFail('Falta Vercel Blob en este despliegue (mira el aviso de arriba). Mientras, pega un link.'); }
  const bar = $('pj-bar');
  uploading = true;
  $('pj-save').disabled = true;
  bar.hidden = false;
  $('pj-err').textContent = '';
  try {
    // OIDC (stores nuevos, sin token fijo) → uploadPresigned; token fijo → upload
    const lib = await import('https://esm.sh/@vercel/blob@2.8.1/client');
    const send = blobStatus.mode === 'oidc' ? lib.uploadPresigned : lib.upload;
    for (const [k, file] of files.entries()) {
      $('pj-bar-note').textContent = `Subiendo ${k + 1} de ${files.length}: ${file.name}`;
      bar.firstElementChild.style.width = '0%';
      const name = file.name.normalize('NFD').replace(/[^\w.-]+/g, '-').toLowerCase();
      const blob = await send(`portafolio/${name}`, file, {
        access: 'public',
        handleUploadUrl: '/api/upload',
        contentType: file.type,
        multipart: file.size > 20 * 1024 * 1024,
        onUploadProgress: ({ percentage }) => { bar.firstElementChild.style.width = `${percentage}%`; },
      });
      pjVideos.push({ type: 'video', url: blob.url, name: file.name });
      renderVideos();
    }
    $('pj-bar-note').textContent = '';
  } catch (err) {
    pjFail(`No se pudo subir: ${err.message}`); // el error real (Blob sí está: se revisó antes)
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
    name: $('pj-name').value.trim(),
    year: $('pj-year').value.trim(),
    what: $('pj-what').value.trim(),
    did: $('pj-did').value.trim(),
    tags: [...document.querySelectorAll('#pj-form .pj-tags input:checked')].map((c) => c.value),
    videos: pjVideos.map(({ type, url, id: vid }) => ({ type, url, id: vid })),
  };
  if (body.year && !/^\d{4}$/.test(body.year)) return pjFail('El año va con 4 números.');
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
  if (!pjEditing || !confirm(`¿Borrar «${nameOf(pjEditing)}»? Deja de verse en la portada.`)) return;
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

function row(email, roleCell, dashCell, action, creditCell) {
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
  el.append(mail, role, dash);
  if (creditCell !== undefined) {
    const cr = document.createElement('span');
    cr.className = 'perm-credits';
    if (creditCell) cr.append(creditCell);
    el.append(cr);
  }
  el.append(act);
  return el;
}

/* ---------- créditos (amo supremo): S/ asignados → tokens ---------- */

const nfTk = new Intl.NumberFormat('es-PE');
const nfSol = new Intl.NumberFormat('es-PE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
let rate = null;       // { usdPen, usdPerM, tokensPerSol }
let tkTarget = null;   // persona a la que se le asignan

/** Celda: S/ asignados, tokens que le quedan y el botón para asignar. null = el amo supremo (sin límite). */
function creditCell(p) {
  const box = document.createElement('span');
  box.className = 'credit';
  if (!p) { box.innerHTML = '<b class="credit-tk">∞ tokens</b><small>sin límite</small>'; return box; }
  box.innerHTML = `<b class="credit-tk">${nfTk.format(p.tokens || 0)} tk</b><small>S/ ${nfSol.format(p.soles || 0)} asignados</small>`;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'mini-btn';
  btn.textContent = '+ S/';
  btn.title = `Asignar soles a ${p.email}`;
  btn.addEventListener('click', () => openCredit(p));
  box.append(btn);
  return box;
}

const tokensFor = (soles) => (rate ? Math.floor((soles / rate.usdPen / rate.usdPerM) * 1e6) : 0);

function paintConv() {
  const soles = Number($('tk-soles').value) || 0;
  $('tk-conv').textContent = `= ${soles < 0 ? '−' : ''}${nfTk.format(Math.abs(tokensFor(soles)))} tokens`;
  $('tk-conv').classList.toggle('is-neg', soles < 0);
}

function openCredit(p) {
  tkTarget = p;
  $('tk-form').className = 'modal tk-modal';
  $('tk-who').textContent = p.email;
  $('tk-now').textContent = `Le quedan ${nfTk.format(p.tokens || 0)} tokens · S/ ${nfSol.format(p.soles || 0)} asignados en total`;
  $('tk-soles').value = '';
  $('tk-err').textContent = '';
  paintConv();
  $('tk-layer').hidden = false;
  setTimeout(() => $('tk-soles').focus(), 50);
}
const closeCredit = () => { $('tk-layer').hidden = true; };
$('tk-cancel').addEventListener('click', closeCredit);
$('tk-layer').addEventListener('pointerdown', (e) => { if (e.target === $('tk-layer')) closeCredit(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('tk-layer').hidden) closeCredit(); });
$('tk-soles').addEventListener('input', paintConv);

$('tk-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const soles = Number($('tk-soles').value);
  if (!soles) {
    $('tk-err').textContent = 'Pon un monto en soles.';
    const f = $('tk-form'); f.classList.remove('is-shaking'); void f.offsetWidth; f.classList.add('is-shaking');
    return;
  }
  $('tk-save').disabled = true;
  const r = await api('/api/perms', { method: 'PATCH', body: JSON.stringify({ id: tkTarget.id, soles }) });
  $('tk-save').disabled = false;
  if (!r.ok) { $('tk-err').textContent = r.data.error || 'No se pudo asignar.'; return; }
  closeCredit();
  msg(`${tkTarget.email}: ahora tiene ${nfTk.format(r.data.tokens)} tokens (S/ ${nfSol.format(r.data.soles)} asignados).`);
  loadPerms();
});

async function loadPerms() {
  list.innerHTML = '<p class="perm-empty">Cargando…</p>';
  const { ok, data } = await api('/api/perms');
  if (!ok) {
    list.innerHTML = '';
    return msg(data.error || 'No se pudieron cargar los permisos.', true);
  }
  const supremo = data.me === 'supremo';
  rate = data.rate || null;
  $('perm-table').classList.toggle('has-credits', supremo);
  document.querySelector('.perm-credits-col').hidden = !supremo;
  const names = Object.fromEntries((me?.dashboards || []).map((d) => [d.id, d.name]));

  $('perm-help').textContent = supremo
    ? 'Agrega amos (ven y editan todo) y chismosos (solo ven lo que un amo les active desde cada dashboard).'
    : 'Agrega chismosos: solo ven lo que un amo les active desde el botón «Integrantes» de cada dashboard.';

  $('perm-role').innerHTML = '';
  for (const r of data.roles) $('perm-role').add(new Option(ROLE_LABEL[r], r));

  list.innerHTML = '';
  list.append(row(data.owner, badge(ROLE_LABEL.supremo, 'badge--admin'), badge('Todos'), null, supremo ? creditCell(null) : undefined));

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

    list.append(row(p.email, roleCell, dashCell, del, supremo ? creditCell(p) : undefined));
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
   Configuración (amo supremo): ojo de pez y tokens
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
  paintTokens(data);
}

/* ---------- tokens: sobrecargo, conversión y costo de cada herramienta ---------- */

let cfgTools = {};
let cfg = null;

function paintTokens(data) {
  cfg = data.config;
  cfgTools = data.tools;
  $('tk-surcharge').value = cfg.surcharge;
  $('tk-usdpen').value = cfg.usdPen;
  $('tk-usdperm').value = cfg.usdPerM;
  $('ai-key-status').textContent = data.aiKey ? 'Usa tu OPENAI_API_KEY.' : '⚠ Falta OPENAI_API_KEY en Vercel.';
  paintRate();
  const list = $('tk-list');
  list.innerHTML = '';
  for (const [key, t] of Object.entries(cfgTools)) {
    const row = document.createElement('div');
    row.className = 'tk-row';
    row.dataset.tool = key;
    row.innerHTML = `
      <span class="tk-name"><b></b><small></small></span>
      <span class="tk-field"><input type="number" min="0" step="1" aria-label="Costo en tokens"><i>tk</i></span>
      <span class="tk-price"></span>
      <button class="mini-btn tk-measure" type="button" title="Llama a la herramienta de verdad y guarda los tokens que gastó">Medir</button>`;
    row.querySelector('b').textContent = t.label;
    row.querySelector('small').textContent = t.note;
    const input = row.querySelector('input');
    input.value = cfg.costs[key];
    input.addEventListener('input', () => paintPrice(row));
    input.addEventListener('change', () => saveTokens({ costs: { [key]: Number(input.value) || 0 } }));
    row.querySelector('.tk-measure').addEventListener('click', () => measure(row));
    paintPrice(row);
    list.append(row);
  }
}

const surchargeNow = () => Number($('tk-surcharge').value) || 0;
const withSurcharge = (cost) => Math.ceil(cost * (1 + surchargeNow() / 100));

function paintPrice(row) {
  const cost = Number(row.querySelector('input').value) || 0;
  row.querySelector('.tk-price').innerHTML = `<b>${nfTk.format(withSurcharge(cost))}</b> <small>tk · ${nfTk.format(cost)} + ${surchargeNow()}%</small>`;
}

function paintRate() {
  const usdPen = Number($('tk-usdpen').value) || 0, usdPerM = Number($('tk-usdperm').value) || 0;
  const perSol = usdPen && usdPerM ? Math.floor((1 / usdPen / usdPerM) * 1e6) : 0;
  $('tk-rate').innerHTML = `S/ 1 = <b>${nfTk.format(perSol)}</b> tokens · S/ 10 = <b>${nfTk.format(perSol * 10)}</b> tokens`;
}

async function saveTokens(patch) {
  $('tk-msg').className = 'form-msg';
  $('tk-msg').textContent = 'Guardando…';
  const r = await api('/api/config', { method: 'PUT', body: JSON.stringify(patch) });
  $('tk-msg').classList.toggle('err', !r.ok);
  $('tk-msg').textContent = r.ok ? 'Guardado. Se aplica en la próxima vez que usen la herramienta.' : (r.data.error || 'No se pudo guardar.');
  if (r.ok) cfg = r.data.config;
}

async function measure(row) {
  const btn = row.querySelector('.tk-measure');
  const name = cfgTools[row.dataset.tool].label;
  btn.disabled = true;
  btn.textContent = '···';
  row.classList.add('is-measuring');
  $('tk-msg').className = 'form-msg';
  $('tk-msg').textContent = `Llamando a «${name}» para contar sus tokens…`;
  const r = await api(`/api/config?measure=${encodeURIComponent(row.dataset.tool)}`, { method: 'POST' });
  btn.disabled = false;
  btn.textContent = 'Medir';
  row.classList.remove('is-measuring');
  if (!r.ok) { $('tk-msg').className = 'form-msg err'; $('tk-msg').textContent = r.data.error || 'No se pudo medir.'; return; }
  cfg = r.data.config;
  row.querySelector('input').value = r.data.tokens;
  paintPrice(row);
  row.classList.add('is-updated');
  setTimeout(() => row.classList.remove('is-updated'), 1200);
  $('tk-msg').textContent = `«${name}» gastó ${nfTk.format(r.data.tokens)} tokens: ese es su costo ahora (al usuario: ${nfTk.format(r.data.prices[row.dataset.tool])}).`;
}

$('tk-surcharge').addEventListener('input', () => document.querySelectorAll('#tk-list .tk-row').forEach(paintPrice));
$('tk-surcharge').addEventListener('change', () => saveTokens({ surcharge: surchargeNow() }));
for (const idIn of ['tk-usdpen', 'tk-usdperm']) {
  $(idIn).addEventListener('input', paintRate);
  $(idIn).addEventListener('change', () => saveTokens({ usdPen: Number($('tk-usdpen').value), usdPerM: Number($('tk-usdperm').value) }));
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
