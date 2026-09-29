/* ============================================================
   dashboard.js — /dashboards/?d=<id> · lienzo de widgets
   ------------------------------------------------------------
   · Rejilla de puntos infinita: se arrastra el fondo (o la rueda)
     para moverse. Todos pueden moverse; solo el admin edita.
   · Los widgets viven en celdas de GRID px y encajan en la rejilla:
     el admin los mueve desde su cabecera y los agranda desde la
     esquina, como los widgets de Android. No se pueden encimar.
   · Ojo de pez: lo que está al centro de la pantalla se ve un poco
     más grande que lo de los bordes (puntos y widgets).
   · Herramienta "tabla con IA": CSV + pedido → /api/dash, que se lo
     pasa a OpenAI. Si el pedido no sirve, el modal tiembla y se borra.
   Los permisos reales los aplica /api/dash en el servidor.
   ============================================================ */

import { iconFor, TOOL_ICONS } from './dashboard-icons.js';
import { parseCSV } from './csv.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('d') || '';
const GRID = 32;              // px por celda
const MIN_W = 4, MIN_H = 3;   // tamaño mínimo de un widget, en celdas
const FISHEYE = 0.07;         // cuánto más grande al centro (7%) y más chico en los bordes
const MAX_CSV = 2 * 1024 * 1024;

const board = $('board');
const world = $('world');
const dots = $('dots');
const ctx = dots.getContext('2d');

let canEdit = false;
let widgets = [];                  // { id, type, x, y, w, h, data, el }
const pan = { x: 0, y: 0 };

/* ---------- utilidades ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

async function api(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await r.json(); } catch { /* sin JSON */ }
  return { ok: r.ok, status: r.status, data };
}

function show(view) {
  for (const v of ['loading', 'denied', 'dash']) $(`v-${v}`).hidden = v !== view;
}

document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
  await fetch('/api/auth', { method: 'DELETE', credentials: 'same-origin' });
  location.href = '/admin/';
}));

/* ============================================================
   Render: rejilla de puntos + ojo de pez
   ============================================================ */

let raf = 0;
const requestDraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

/** 1 al centro de la pantalla → 0 en las esquinas. */
function lens(sx, sy, w, h) {
  const dx = (sx - w / 2) / (w / 2), dy = (sy - h / 2) / (h / 2);
  return clamp(1 - (dx * dx + dy * dy) / 2, 0, 1);
}

function draw() {
  raf = 0;
  const w = board.clientWidth, h = board.clientHeight, dpr = devicePixelRatio || 1;
  if (dots.width !== Math.round(w * dpr) || dots.height !== Math.round(h * dpr)) {
    dots.width = Math.round(w * dpr);
    dots.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const ox = ((pan.x % GRID) + GRID) % GRID, oy = ((pan.y % GRID) + GRID) % GRID;
  for (let y = oy; y <= h; y += GRID) {
    for (let x = ox; x <= w; x += GRID) {
      const f = lens(x, y, w, h);
      ctx.globalAlpha = 0.07 + 0.2 * f;
      ctx.fillStyle = '#e8e8ee';
      ctx.beginPath();
      ctx.arc(x, y, 0.8 + 0.7 * f, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;

  world.style.transform = `translate(${pan.x}px, ${pan.y}px)`;

  // ojo de pez en los widgets: escala según qué tan cerca del centro está su centro
  for (const wd of widgets) {
    const card = wd.el.querySelector('.wcard');
    if (wd.el.classList.contains('is-dragging')) { card.style.transform = ''; continue; }
    const cx = pan.x + (wd.x + wd.w / 2) * GRID, cy = pan.y + (wd.y + wd.h / 2) * GRID;
    const s = 1 - FISHEYE + 2 * FISHEYE * lens(clamp(cx, -w, 2 * w), clamp(cy, -h, 2 * h), w, h);
    card.style.transform = `scale(${s.toFixed(4)})`;
  }
}

new ResizeObserver(requestDraw).observe(board);

/* ============================================================
   Widgets
   ============================================================ */

const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const collides = (rect, skipId) => widgets.some((o) => o.id !== skipId && overlaps(rect, o));

function place(wd) {
  Object.assign(wd.el.style, {
    left: `${wd.x * GRID}px`, top: `${wd.y * GRID}px`, width: `${wd.w * GRID}px`, height: `${wd.h * GRID}px`,
  });
}

const isNumeric = (v) => /^[-+]?[\d.,\s]+%?$/.test(String(v).trim()) && /\d/.test(v);

function tableHTML(d) {
  const cols = d.columns || [];
  const rows = d.rows || [];
  const numCol = cols.map((_, i) => rows.length > 0 && rows.every((r) => !r[i] || isNumeric(r[i])));
  const note = d.cut ? 'Se muestran solo las primeras filas.'
    : d.truncated ? 'Basada en las primeras líneas del archivo (era muy grande).' : '';
  return `
    <div class="wbody"><table class="wtable">
      <thead><tr>${cols.map((c, i) => `<th class="${numCol[i] ? 'num' : ''}">${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${r.map((v, i) => `<td class="${numCol[i] ? 'num' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>
    ${note ? `<p class="wnote">${note}</p>` : ''}`;
}

function mount(wd, { isNew = false } = {}) {
  const el = document.createElement('div');
  el.className = `widget${isNew ? ' is-new' : ''}`;
  el.dataset.id = wd.id;
  const d = wd.data || {};
  el.innerHTML = `
    <div class="wcard">
      <header class="whead" title="${esc(d.prompt || '')}">
        <h3>${esc(d.title || 'Tabla')}</h3>
        ${d.source ? `<small>${esc(d.source)}</small>` : ''}
        ${canEdit ? '<button class="wdel" type="button" aria-label="Borrar widget" title="Borrar">×</button>' : ''}
      </header>
      ${tableHTML(d)}
    </div>
    ${canEdit ? '<span class="whandle" aria-hidden="true"></span>' : ''}`;
  wd.el = el;
  place(wd);
  world.append(el);

  if (canEdit) {
    el.querySelector('.whead').addEventListener('pointerdown', (e) => {
      if (e.target.closest('.wdel')) return;
      startEdit(e, wd, 'move');
    });
    el.querySelector('.whandle').addEventListener('pointerdown', (e) => startEdit(e, wd, 'resize'));
    el.querySelector('.wdel').addEventListener('click', () => removeWidget(wd));
  }
}

function refreshEmpty() {
  const empty = $('board-empty');
  empty.hidden = widgets.length > 0;
  empty.textContent = canEdit
    ? 'Tu lienzo está vacío. Usa las herramientas de abajo para agregar un widget.'
    : 'Todavía no hay nada en este dashboard.';
}

async function saveLayout(wd) {
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ widget: wd.id, x: wd.x, y: wd.y, w: wd.w, h: wd.h }),
  });
  if (!r.ok) console.warn('[dashboard] no se guardó la posición:', r.data.error);
}

async function removeWidget(wd) {
  if (!confirm(`¿Borrar «${wd.data?.title || 'este widget'}»?`)) return;
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&widget=${encodeURIComponent(wd.id)}`, { method: 'DELETE' });
  if (!r.ok) return alert(r.data.error || 'No se pudo borrar.');
  wd.el.remove();
  widgets = widgets.filter((x) => x !== wd);
  refreshEmpty();
}

/* ---------- mover / redimensionar (admin) ---------- */

function startEdit(e, wd, mode) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  const start = { px: e.clientX, py: e.clientY, x: wd.x, y: wd.y, w: wd.w, h: wd.h };
  const ghost = document.createElement('div');
  ghost.className = 'ghost';
  world.append(ghost);
  wd.el.classList.add('is-dragging');
  requestDraw();
  let next = { x: wd.x, y: wd.y, w: wd.w, h: wd.h };

  const onMove = (ev) => {
    const dx = ev.clientX - start.px, dy = ev.clientY - start.py;
    if (mode === 'move') {
      // el widget sigue al dedo libremente; el fantasma muestra dónde encaja
      wd.el.style.left = `${start.x * GRID + dx}px`;
      wd.el.style.top = `${start.y * GRID + dy}px`;
      next = { ...next, x: Math.round(start.x + dx / GRID), y: Math.round(start.y + dy / GRID) };
    } else {
      const pw = Math.max(MIN_W * GRID, start.w * GRID + dx), ph = Math.max(MIN_H * GRID, start.h * GRID + dy);
      wd.el.style.width = `${pw}px`;
      wd.el.style.height = `${ph}px`;
      next = { ...next, w: Math.max(MIN_W, Math.round(pw / GRID)), h: Math.max(MIN_H, Math.round(ph / GRID)) };
    }
    Object.assign(ghost.style, {
      left: `${next.x * GRID + 5}px`, top: `${next.y * GRID + 5}px`,
      width: `${next.w * GRID - 10}px`, height: `${next.h * GRID - 10}px`,
    });
    ghost.classList.toggle('is-bad', collides(next, wd.id));
  };

  const onUp = () => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    ghost.remove();
    wd.el.classList.remove('is-dragging');
    const changed = next.x !== start.x || next.y !== start.y || next.w !== start.w || next.h !== start.h;
    if (changed && !collides(next, wd.id)) {
      Object.assign(wd, next);
      saveLayout(wd);
    }
    place(wd); // encaja en la rejilla (o vuelve a su lugar si chocaba)
    requestDraw();
  };

  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

/* ---------- moverse por el lienzo (todos) ---------- */

board.addEventListener('pointerdown', (e) => {
  // dentro de una tabla se hace scroll/selección; en los controles, su acción
  if (e.button !== 0 || e.target.closest('.wbody, .whandle, .wdel, .whead button')) return;
  if (canEdit && e.target.closest('.whead')) return;
  board.setPointerCapture(e.pointerId);
  board.classList.add('is-panning');
  const start = { px: e.clientX, py: e.clientY, x: pan.x, y: pan.y };
  const onMove = (ev) => {
    pan.x = start.x + ev.clientX - start.px;
    pan.y = start.y + ev.clientY - start.py;
    requestDraw();
  };
  const onUp = () => {
    board.classList.remove('is-panning');
    board.removeEventListener('pointermove', onMove);
    board.removeEventListener('pointerup', onUp);
    board.removeEventListener('pointercancel', onUp);
  };
  board.addEventListener('pointermove', onMove);
  board.addEventListener('pointerup', onUp);
  board.addEventListener('pointercancel', onUp);
});

board.addEventListener('wheel', (e) => {
  const body = e.target.closest('.wbody');
  if (body && (body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth)) return;
  e.preventDefault();
  pan.x -= e.deltaX;
  pan.y -= e.deltaY;
  requestDraw();
}, { passive: false });

/** Encuadra: centra los widgets, o el origen si no hay ninguno. */
function frame() {
  const w = board.clientWidth, h = board.clientHeight;
  if (!widgets.length) { pan.x = Math.round(w / 2); pan.y = Math.round(h / 2); return; }
  const minX = Math.min(...widgets.map((o) => o.x)), maxX = Math.max(...widgets.map((o) => o.x + o.w));
  const minY = Math.min(...widgets.map((o) => o.y)), maxY = Math.max(...widgets.map((o) => o.y + o.h));
  pan.x = Math.round(w / 2 - ((minX + maxX) / 2) * GRID);
  pan.y = Math.round(h / 2 - ((minY + maxY) / 2) * GRID);
}

/** Primer lugar libre de w×h lo más cerca posible del centro de la pantalla. */
function freeSpot(w, h) {
  const cx = Math.round((board.clientWidth / 2 - pan.x) / GRID - w / 2);
  const cy = Math.round((board.clientHeight / 2 - pan.y) / GRID - h / 2);
  for (let r = 0; r < 80; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const rect = { x: cx + dx, y: cy + dy, w, h };
        if (!collides(rect)) return rect;
      }
    }
  }
  return { x: cx, y: cy + 100, w, h };
}

/** Tamaño inicial de una tabla según cuántas columnas y filas trae. */
function tableSize(d) {
  const cols = d.columns?.length || 1, rows = d.rows?.length || 1;
  return { w: clamp(cols * 5, 10, 28), h: clamp(Math.ceil(rows * 0.9) + 3, 5, 16) };
}

/* ============================================================
   Dock y herramienta "tabla con IA" (admin)
   ============================================================ */

const TOOLS = [{ key: 'table', label: 'Tabla con IA', open: openTableModal }];

function renderDock() {
  const dock = $('dock');
  dock.hidden = !canEdit;
  dock.innerHTML = '';
  for (const t of TOOLS) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.title = t.label;
    b.setAttribute('aria-label', t.label);
    b.innerHTML = TOOL_ICONS[t.key];
    b.addEventListener('click', t.open);
    dock.append(b);
  }
}

const layer = $('modal-layer');
const modal = $('modal');
let pickedFile = null;
let pickedText = '';
let busy = false;

function resetModal() {
  modal.className = 'modal';
  modal.removeAttribute('style');
  layer.className = 'modal-layer';
  modal.reset();
  pickedFile = null;
  pickedText = '';
  $('m-file-name').textContent = 'Elige o arrastra un CSV';
  $('m-file-meta').textContent = 'Máx. 2 MB';
  $('m-drop').classList.remove('has-file');
  $('m-err').textContent = '';
}

function openTableModal() {
  resetModal();
  $('modal-ico').innerHTML = TOOL_ICONS.table;
  layer.hidden = false;
  setTimeout(() => $('m-prompt').focus(), 50);
}

function closeModal() {
  if (busy) return;
  layer.hidden = true;
  resetModal();
}

$('m-cancel').addEventListener('click', closeModal);
layer.addEventListener('pointerdown', (e) => { if (e.target === layer) closeModal(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !layer.hidden) closeModal(); });

async function pick(file) {
  if (!file) return;
  $('m-err').textContent = '';
  if (file.size > MAX_CSV) { $('m-err').textContent = 'El CSV supera 2 MB.'; return shake(); }
  pickedFile = file;
  pickedText = await file.text();
  const p = parseCSV(pickedText);
  $('m-file-name').textContent = file.name;
  $('m-file-meta').textContent = `${p.rows.length.toLocaleString('es')} filas · ${p.headers.length} columnas`;
  $('m-drop').classList.add('has-file');
}

$('m-file').addEventListener('change', (e) => pick(e.target.files[0]));
$('m-drop').addEventListener('dragover', (e) => { e.preventDefault(); $('m-drop').classList.add('is-over'); });
$('m-drop').addEventListener('dragleave', () => $('m-drop').classList.remove('is-over'));
$('m-drop').addEventListener('drop', (e) => {
  e.preventDefault();
  $('m-drop').classList.remove('is-over');
  pick(e.dataTransfer.files[0]);
});

function shake() {
  modal.classList.remove('is-shaking');
  void modal.offsetWidth; // reinicia la animación
  modal.classList.add('is-shaking');
}

/** Pedido que no sirve: mensaje, sacudida y el modal se borra. */
function reject(message) {
  busy = false;
  modal.classList.remove('is-loading');
  $('m-err').textContent = message;
  shake();
  setTimeout(() => {
    modal.classList.add('is-erasing');
    setTimeout(() => { layer.hidden = true; resetModal(); }, 500);
  }, 1500);
}

modal.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (busy) return;
  const prompt = $('m-prompt').value.trim();
  if (!pickedFile) { $('m-err').textContent = 'Primero elige un archivo CSV.'; return shake(); }
  if (!prompt) return reject('No sirve tu tabla: no escribiste qué quieres ver.');

  busy = true;
  $('m-err').textContent = '';
  modal.classList.add('is-loading');

  // lugar provisorio: se ajusta al tamaño real cuando llega la tabla
  const guess = freeSpot(10, 8);
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&widget=table`, {
    method: 'POST',
    body: JSON.stringify({ prompt, csv: pickedText, filename: pickedFile.name, layout: guess }),
  });

  if (r.status === 422) return reject(r.data.error || 'No sirve tu tabla.');
  if (!r.ok) {
    busy = false;
    modal.classList.remove('is-loading');
    $('m-err').textContent = r.data.error || 'Algo falló. Intenta de nuevo.';
    return shake();
  }

  const wd = r.data.widget;
  const size = tableSize(wd.data);
  Object.assign(wd, freeSpot(size.w, size.h));
  if (wd.x !== guess.x || wd.y !== guess.y || wd.w !== guess.w || wd.h !== guess.h) saveLayout(wd);
  morphInto(wd);
});

/** El modal viaja y se encoge hasta el lugar del widget, y ahí aparece la tabla. */
function morphInto(wd) {
  const from = modal.getBoundingClientRect();
  const boardBox = board.getBoundingClientRect();
  const to = {
    left: boardBox.left + pan.x + wd.x * GRID + 5,
    top: boardBox.top + pan.y + wd.y * GRID + 5,
    width: wd.w * GRID - 10,
    height: wd.h * GRID - 10,
  };
  Object.assign(modal.style, { position: 'fixed', margin: 0, left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  layer.classList.add('is-morphing');
  modal.classList.add('is-morphing');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    Object.assign(modal.style, { left: `${to.left}px`, top: `${to.top}px`, width: `${to.width}px`, height: `${to.height}px`, borderRadius: '16px' });
  }));
  setTimeout(() => {
    widgets.push(wd);
    mount(wd, { isNew: true });
    refreshEmpty();
    requestDraw();
    busy = false;
    layer.hidden = true;
    resetModal();
  }, 520);
}

$('dash-delete').addEventListener('click', async () => {
  if (!confirm(`¿Eliminar el dashboard «${$('dash-title').textContent}» y todos sus widgets? No se puede deshacer.`)) return;
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) return alert(r.data.error || 'No se pudo eliminar.');
  location.href = '/admin/';
});

/* ============================================================
   Arranque
   ============================================================ */

(async () => {
  if (!id) { $('denied-msg').textContent = 'Falta el dashboard en la dirección.'; return show('denied'); }
  const me = await api('/api/auth');
  const user = me.ok ? me.data.user : null;
  if (!user) return location.replace('/admin/');

  const { ok, status, data } = await api(`/api/dash?d=${encodeURIComponent(id)}`);
  if (status === 401) return location.replace('/admin/');
  if (!ok) {
    $('denied-msg').textContent = data.error || 'Tu cuenta no tiene acceso a este dashboard.';
    return show('denied');
  }

  canEdit = data.canEdit;
  document.body.classList.toggle('can-edit', canEdit);
  document.title = `${data.dashboard.name} — fukudamiyasato`;
  $('dash-title').textContent = data.dashboard.name;
  $('dash-ico').innerHTML = iconFor(data.dashboard.icon);
  document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = user.email; });
  // con un solo dashboard no hay a dónde volver: /admin/ lo mandaría aquí mismo
  $('dash-back').hidden = !(user.role === 'admin' || user.dashboards.length > 1);

  $('dash-delete').hidden = !canEdit || data.dashboard.builtin;

  show('dash');
  renderDock();
  widgets = data.widgets;
  widgets.forEach((wd) => mount(wd));
  refreshEmpty();
  frame();
  draw(); // primer cuadro ya, sin esperar a requestAnimationFrame
})();
