/* ============================================================
   dashboard.js — /dashboards/?d=<id> · lienzo de widgets
   ------------------------------------------------------------
   · Rejilla de puntos infinita: se arrastra el fondo (o la rueda)
     para moverse. Todos pueden moverse; solo los amos editan.
   · Los widgets viven en celdas de GRID px y encajan en la rejilla:
     se mueven desde la cabecera y se agrandan desde la esquina.
   · Ojo de pez (js/fisheye.js): la rejilla y todo lo de encima (tarjetas,
     tablas, líneas) se curvan con la misma función. El HTML se deforma con
     un filtro SVG; el "Redirector" traduce clics, scroll y hover de lo
     que se ve a dónde está cada elemento, para que coincidan.
   · Mantener presionado un widget: todos tiemblan y muestran un botón
     rojo para borrarlos. Tocar el fondo o Esc sale.

   Cada widget pasa por tres estados:
     draft     → recién creado: sus campos (pregunta, CSV…) y botones
     thinking  → se envió a la IA: carga al centro; no se puede tocar
     done      → muestra la respuesta (tabla, gráfico, número o texto)
   Varios pueden estar pensando a la vez: cada uno es independiente.

   Conectores (amos): a la izquierda recibe, a la derecha (+) da.
     · arrastrar desde el + → línea roja; soltarla en el conector
       izquierdo de otro widget los conecta (si no, desaparece)
     · un clic en el + → nuevo widget-pregunta ya conectado; lo que
       responde la IA usa como contexto todos los widgets conectados
     · mientras piensa, las líneas y los widgets conectados brillan
   · Enfoque: el lienzo se centra en el widget que lanzas y en cada
     uno que termina (con 2 s entre uno y otro si terminan juntos).
   · Seleccionar un widget (tocarlo): brillo rojo + bloque de información
     al centro-derecha (pregunta, archivo, lo conectado), sin lente.
   · Los widgets en creación son temporales: tocar otra zona los borra
     (salvo el + de otro widget, para poder conectarles cosas).
   Los permisos reales los aplica /api/dash en el servidor.
   ============================================================ */

import { dashIconHTML, TOOL_ICONS, ATTACHED_ICON } from './dashboard-icons.js';
import { parseCSV } from './csv.js';
import { drawDots, fitCanvas, buildLensFilter, unwarp } from './fisheye.js';
import {
  FACES, CHARACTERS, todayISO, addDays, defaultTimeline, timelineHTML, timelineSize, daysLeftText,
} from './timeline.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('d') || '';
const GRID = 32;              // px por celda
const MIN_W = 4, MIN_H = 3;   // tamaño mínimo de un widget, en celdas
let fisheye = 0.07;           // intensidad del ojo de pez; la define el amo supremo en Configuración
const MAX_CSV = 2 * 1024 * 1024;
const LONG_PRESS = 520;       // ms presionando para que tiemblen
const FOCUS_GAP = 2000;       // ms entre un enfoque automático y el siguiente
const SNAP_PORT = 28;         // px: qué tan cerca hay que soltar la línea del conector
const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

const board = $('board');
const world = $('world');
const dots = $('dots');
const linksSvg = $('links');
const linksTop = $('links-top');
const lensEl = $('lens');
const ctx = dots.getContext('2d');

let canEdit = false;
let widgets = [];   // { id, type, x, y, w, h, data, inputs, state, mode?, el, file?, fileText? }
const pan = { x: 0, y: 0 };
let draftSeq = 0;

/* ---------- utilidades ---------- */

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const byId = (wid) => widgets.find((w) => w.id === wid);

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
   Render: rejilla de puntos, ojo de pez y líneas de conexión
   ============================================================ */

let raf = 0;
const requestDraw = () => { if (!raf) raf = requestAnimationFrame(draw); };

function draw() {
  raf = 0;
  const { w, h } = fitCanvas(dots);
  drawDots(ctx, w, h, { panX: pan.x, panY: pan.y, grid: GRID, amount: fisheye });

  world.style.transform = `translate(${pan.x}px, ${pan.y}px)`;
  drawLinks();
}

/* ---------- lente sobre el HTML ----------
   El mapa de la lente depende solo del tamaño del lienzo y de la
   intensidad (no de por dónde vaya): se recalcula al cambiar de tamaño. */
let routing = false; // true = hay lente: los clics se redirigen
let lensSize = '';

function updateLens() {
  const { width: w, height: h } = board.getBoundingClientRect();
  const key = `${Math.round(w)}x${Math.round(h)}:${fisheye}`;
  if (key === lensSize) return;
  lensSize = key;
  // el filtro va sobre .lens-ss, que mide el doble (ver supersampling en el HTML)
  routing = buildLensFilter($('lens-filter'), w * 2, h * 2, fisheye);
  $('lens-ss').style.filter = routing ? 'url(#lens-filter)' : 'none';
  lensEl.classList.toggle('is-routed', routing);
}

new ResizeObserver(() => { updateLens(); requestDraw(); }).observe(board);

/* ---------- líneas ---------- */

/** Punto de un conector en coordenadas del lienzo (ya con el ojo de pez aplicado). */
function portPoint(wd, side) {
  const card = wd.el.querySelector('.wcard').getBoundingClientRect();
  const b = board.getBoundingClientRect();
  return { x: (side === 'out' ? card.right : card.left) - b.left, y: card.top + card.height / 2 - b.top };
}

function curve(a, z) {
  const dx = Math.max(40, Math.abs(z.x - a.x) / 2);
  return `M${a.x},${a.y} C${a.x + dx},${a.y} ${z.x - dx},${z.y} ${z.x},${z.y}`;
}

let tempLine = null; // línea que sigue al dedo mientras se conecta

function drawLinks() {
  const b = board.getBoundingClientRect();
  linksSvg.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
  linksTop.setAttribute('viewBox', `0 0 ${b.width} ${b.height}`);
  let html = '', ends = '';
  for (const t of widgets) {
    for (const srcId of t.inputs || []) {
      const s = byId(srcId);
      if (!s) continue;
      const a = portPoint(s, 'out'), z = portPoint(t, 'in');
      const glow = t.state === 'thinking' ? ' is-glowing' : '';
      html += `<g class="link${glow}" data-from="${esc(s.id)}" data-to="${esc(t.id)}">
        <path class="link-hit" d="${curve(a, z)}"/>
        <path class="link-line" d="${curve(a, z)}"/>
      </g>`;
      ends += `<circle class="link-end${glow}" cx="${a.x}" cy="${a.y}" r="3.5"/><circle class="link-end${glow}" cx="${z.x}" cy="${z.y}" r="3.5"/>`;
    }
  }
  if (tempLine) html += `<path class="link-line link-temp${tempLine.snap ? ' is-snapped' : ''}" d="${curve(tempLine.a, tempLine.z)}"/>`;
  linksSvg.innerHTML = html;
  linksTop.innerHTML = ends;
}

/* quitar una conexión: clic sobre la línea (amos) */
linksSvg.addEventListener('pointerdown', (e) => {
  const g = e.target.closest?.('.link');
  if (!g || !canEdit || !e.target.classList.contains('link-hit')) return;
  e.stopPropagation();
  const t = byId(g.dataset.to);
  if (!t || t.state === 'thinking') return;
  if (!confirm('¿Quitar esta conexión?')) return;
  t.inputs = t.inputs.filter((i) => i !== g.dataset.from);
  if (t.state === 'done') saveInputs(t);
  refreshContextNote(t);
  requestDraw();
});

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

/** Lo que respondió la IA: gráfico, número destacado, texto o tabla. */
function contentHTML(d) {
  if (d.kind === 'chart') {
    return `<div class="wchart" role="img" aria-label="${esc(chartSummary(d))}"></div>
      ${d.detail ? `<p class="wnote">${esc(d.detail)}</p>` : ''}`;
  }
  if (d.kind === 'number' || d.kind === 'text') {
    const long = d.kind === 'text' && d.value.length > 60 ? ' wanswer--long' : '';
    return `<div class="wanswer wanswer--${d.kind}${long}">
      <b>${esc(d.value)}</b>
      ${d.detail ? `<p>${esc(d.detail)}</p>` : ''}
    </div>`;
  }
  return tableHTML(d);
}

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

/* ---------- herramientas: cómo se ve cada widget en estado "draft" ---------- */

const MODES = {
  table: {
    title: 'Tabla con IA', icon: 'table', endpoint: 'table', file: true,
    placeholder: 'Pregunta que me aburro', submit: 'Apura', fail: 'No sirve tu tabla', size: { w: 12, h: 10 },
  },
  ask: {
    title: 'Pregúntale a la IA', icon: 'ask', endpoint: 'ask', file: false,
    placeholder: '¿Qué quieres saber?', submit: 'Apura', fail: 'No sirve tu pregunta', size: { w: 11, h: 7 },
  },
  follow: {
    title: 'Pregunta sobre lo conectado', icon: 'table', endpoint: 'table', file: false,
    placeholder: '¿Qué quieres saber de lo conectado?', submit: 'pregunta porfa', fail: 'No sirve tu pregunta', size: { w: 11, h: 8 },
  },
};

function draftHTML(wd) {
  const m = MODES[wd.mode];
  return `
    <header class="whead whead--draft">
      <span class="whead-ico">${TOOL_ICONS[m.icon]}</span>
      <h3>${esc(m.title)}</h3>
    </header>
    <form class="wform" novalidate autocomplete="off">
      ${m.file ? `
        <label class="m-drop">
          <span class="m-drop-ico">${FILE_ICON}</span>
          <span><b class="m-file-name">Adjunta un CSV (opcional)</b><small class="m-file-meta">Sin archivo, la IA responde con lo que sabe · máx. 2 MB</small></span>
          <input type="file" class="m-file" accept=".csv,.tsv,.txt,text/csv" hidden aria-label="Archivo CSV">
        </label>` : ''}
      <p class="wctx" hidden></p>
      <textarea class="m-prompt" maxlength="2000" placeholder="${esc(m.placeholder)}" aria-label="Tu pregunta"></textarea>
      <p class="m-err" role="alert"></p>
      <div class="m-actions">
        <button class="link-btn m-cancel" type="button">me arrepentí</button>
        <button class="btn m-ok" type="submit">${esc(m.submit)}</button>
      </div>
    </form>
    <div class="wthinking" aria-live="polite">
      <span class="spinner" aria-hidden="true"></span>
      <b>Pensando…</b>
      <small class="wthinking-note"></small>
    </div>`;
}

function doneHTML(wd) {
  const d = wd.data || {};
  if (d.kind === 'timeline') return timelineHTML(d);
  return `
    <header class="whead" title="${esc(d.prompt || '')}">
      <h3>${esc(d.title || 'Respuesta')}</h3>
      ${d.source ? `<small>${esc(d.source)}</small>` : ''}
    </header>
    ${contentHTML(d)}`;
}

/** Arma (o rearma, al cambiar de estado) el contenido del widget. */
function render(wd) {
  const el = wd.el;
  el.className = `widget is-${wd.state}${wd === selected ? ' is-selected' : ''}`;
  el.dataset.id = wd.id;
  const inner = wd.state === 'done' ? doneHTML(wd) : draftHTML(wd);
  el.innerHTML = `<div class="wbox">
    <div class="wcard${wd.data?.kind === 'timeline' ? ' wcard--timeline' : ''}">${inner}</div>
    ${canEdit ? `
      <button class="wport wport--in" type="button" tabindex="-1" aria-label="Conector de entrada"></button>
      ${wd.state === 'done' ? `<button class="wport wport--out" type="button" aria-label="Conectar o preguntar sobre «${esc(wd.data?.title || 'este widget')}»">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></button>` : ''}
      ${wd.data?.kind === 'timeline' ? '' : '<span class="whandle" aria-hidden="true"></span>'}
      ${wd.state === 'done' ? `<button class="wx" type="button" aria-label="Borrar «${esc(wd.data?.title || 'widget')}»">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg></button>` : ''}` : ''}
  </div>`;
  place(wd);

  const chart = el.querySelector('.wchart');
  if (chart) new ResizeObserver(() => drawChart(chart, wd.data)).observe(chart);

  if (!canEdit) return;
  (el.querySelector('.whead') || el.querySelector('.wtl')).addEventListener('pointerdown', (e) => startEdit(e, wd, 'move'));
  el.querySelector('.whandle')?.addEventListener('pointerdown', (e) => startEdit(e, wd, 'resize'));
  el.querySelector('.wport--out')?.addEventListener('pointerdown', (e) => startLink(e, wd));
  el.querySelector('.wx')?.addEventListener('click', () => removeWidget(wd));
  if (wd.state === 'done') bindLongPress(wd);
  else bindDraft(wd);
}

function mount(wd, { isNew = false } = {}) {
  wd.el = document.createElement('div');
  wd.inputs ||= [];
  wd.state ||= 'done';
  render(wd);
  if (isNew) wd.el.classList.add('is-new');
  world.append(wd.el);
}

/** En el contenido (que hace scroll) solo cuenta mantener presionado. */
function bindLongPress(wd) {
  const body = wd.el.querySelector('.wbody, .wanswer, .wchart');
  body?.addEventListener('pointerdown', (e) => {
    if (jiggling) return startEdit(e, wd, 'move');
    const x0 = e.clientX, y0 = e.clientY;
    const timer = setTimeout(startJiggle, LONG_PRESS);
    // escucha en window: con la lente, los movimientos no pasan por el widget
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    const onMove = (ev) => { if (Math.hypot(ev.clientX - x0, ev.clientY - y0) > 6) stop(); };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  });
}

function refreshEmpty() {
  const empty = $('board-empty');
  empty.hidden = widgets.length > 0;
  empty.textContent = canEdit
    ? 'Tu lienzo está vacío. Usa las herramientas de abajo para agregar un widget.'
    : 'Todavía no hay nada en este dashboard.';
}

async function saveLayout(wd) {
  if (wd.state !== 'done') return; // los borradores viven solo en el navegador
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ widget: wd.id, x: wd.x, y: wd.y, w: wd.w, h: wd.h }),
  });
  if (!r.ok) console.warn('[dashboard] no se guardó la posición:', r.data.error);
}

async function saveInputs(wd) {
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}`, {
    method: 'PATCH', body: JSON.stringify({ widget: wd.id, inputs: wd.inputs }),
  });
  if (!r.ok) console.warn('[dashboard] no se guardó la conexión:', r.data.error);
}

/** Quita el widget del lienzo (y las líneas que salían de él). */
function unmount(wd, animate = true) {
  if (selected === wd) select(null);
  widgets = widgets.filter((x) => x !== wd);
  for (const o of widgets) if (o.inputs?.includes(wd.id)) { o.inputs = o.inputs.filter((i) => i !== wd.id); refreshContextNote(o); }
  if (animate) { wd.el.classList.add('is-leaving'); setTimeout(() => wd.el.remove(), 250); } else wd.el.remove();
  refreshEmpty();
  refreshGlow();
  requestDraw();
}

async function removeWidget(wd) {
  if (!confirm(`¿Borrar «${wd.data?.title || 'este widget'}»?`)) return;
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&widget=${encodeURIComponent(wd.id)}`, { method: 'DELETE' });
  if (!r.ok) return alert(r.data.error || 'No se pudo borrar.');
  unmount(wd);
  if (!widgets.some((w) => w.state === 'done')) stopJiggle();
}

/* ---------- modo "tiemblan" (mantener presionado) ---------- */

let jiggling = false;
function startJiggle() {
  if (jiggling) return;
  jiggling = true;
  board.classList.add('is-jiggle');
  navigator.vibrate?.(12);
}
function stopJiggle() {
  jiggling = false;
  board.classList.remove('is-jiggle');
}
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && jiggling) stopJiggle(); });

/* ---------- mover / redimensionar (amos) ---------- */

function startEdit(e, wd, mode) {
  if (wd.state === 'thinking' || e.target.closest('button, input, textarea, label')) return;
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  const start = { px: e.clientX, py: e.clientY, x: wd.x, y: wd.y, w: wd.w, h: wd.h };
  const ghost = document.createElement('div');
  ghost.className = 'ghost';
  let next = { x: wd.x, y: wd.y, w: wd.w, h: wd.h };
  let dragging = false;
  // quieto un rato sobre la cabecera de un widget terminado → modo "tiemblan"
  const press = mode === 'move' && !jiggling && wd.state === 'done' ? setTimeout(startJiggle, LONG_PRESS) : 0;

  const onMove = (ev) => {
    const dx = ev.clientX - start.px, dy = ev.clientY - start.py;
    if (!dragging) {
      if (Math.hypot(dx, dy) < 4) return;
      dragging = true;
      clearTimeout(press);
      world.append(ghost);
      wd.el.classList.add('is-dragging');
    }
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
    requestDraw(); // las líneas siguen al widget
  };

  const onUp = () => {
    clearTimeout(press);
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    if (!dragging) return;
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

/* ============================================================
   Conectores: arrastrar desde el + o hacer clic en él
   ============================================================ */

function startLink(e, src) {
  e.preventDefault();
  e.stopPropagation();
  const port = e.currentTarget;
  port.setPointerCapture(e.pointerId);
  const b0 = board.getBoundingClientRect();
  const x0 = e.clientX, y0 = e.clientY;
  let dragging = false;

  /** El conector de entrada más cercano al puntero (de otro widget, que no esté pensando). */
  const nearestIn = (px, py) => {
    let best = null, bestD = SNAP_PORT;
    for (const t of widgets) {
      if (t === src || t.state === 'thinking') continue;
      const p = portPoint(t, 'in');
      const d = Math.hypot(p.x - px, p.y - py);
      if (d < bestD) { best = t; bestD = d; }
    }
    return best;
  };

  const onMove = (ev) => {
    if (!dragging && Math.hypot(ev.clientX - x0, ev.clientY - y0) < 5) return;
    dragging = true;
    const sp = sourcePoint(ev.clientX, ev.clientY); // la línea termina bajo el dedo, ya con la lente
    const px = sp.x - b0.left, py = sp.y - b0.top;
    const hit = nearestIn(px, py);
    tempLine = { a: portPoint(src, 'out'), z: hit ? portPoint(hit, 'in') : { x: px, y: py }, snap: Boolean(hit) };
    requestDraw();
  };

  const onUp = (ev) => {
    port.removeEventListener('pointermove', onMove);
    port.removeEventListener('pointerup', onUp);
    port.removeEventListener('pointercancel', onUp);
    tempLine = null;
    if (!dragging) { createFollow(src); requestDraw(); return; } // clic: pregunta sobre este widget
    const sp = sourcePoint(ev.clientX, ev.clientY);
    const t = nearestIn(sp.x - b0.left, sp.y - b0.top);
    if (t && !t.inputs.includes(src.id)) {
      t.inputs.push(src.id);
      if (t.state === 'done') saveInputs(t);
      refreshContextNote(t);
    }
    requestDraw(); // sin conectar, la línea desaparece
  };

  port.addEventListener('pointermove', onMove);
  port.addEventListener('pointerup', onUp);
  port.addEventListener('pointercancel', onUp);
}

/** Nota en el borrador: "Contexto: 2 widgets conectados". */
function refreshContextNote(wd) {
  const note = wd.el.querySelector('.wctx');
  if (!note) return;
  const n = wd.inputs.length;
  note.hidden = !n;
  note.textContent = n === 1 ? `Contexto: «${byId(wd.inputs[0])?.data?.title || '1 widget'}»` : `Contexto: ${n} widgets conectados`;
}

/** Brillo y bloqueo: los que piensan y los widgets conectados a ellos. */
function refreshGlow() {
  const busy = new Set();
  for (const w of widgets) if (w.state === 'thinking') { busy.add(w.id); w.inputs.forEach((i) => busy.add(i)); }
  for (const w of widgets) w.el.classList.toggle('is-glowing', busy.has(w.id));
  drawLinks(); // las líneas que llegan a un widget pensando también brillan
}

/* ============================================================
   Crear widgets (estado draft) y mandarlos a la IA
   ============================================================ */

/** Primer lugar libre de w×h lo más cerca posible de (cx, cy) en celdas
    (por defecto, el centro de la pantalla). */
function freeSpot(w, h, near) {
  const cx = near ? near.x : Math.round((board.clientWidth / 2 - pan.x) / GRID - w / 2);
  const cy = near ? near.y : Math.round((board.clientHeight / 2 - pan.y) / GRID - h / 2);
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

function createDraft(mode, { near, inputs = [] } = {}) {
  const { w, h } = MODES[mode].size;
  select(null); // el foco pasa al widget nuevo
  const wd = { id: `draft-${++draftSeq}`, type: MODES[mode].endpoint, mode, state: 'draft', inputs, ...freeSpot(w, h, near) };
  widgets.push(wd);
  mount(wd, { isNew: true });
  refreshContextNote(wd);
  refreshEmpty();
  focusOn(wd);
  setTimeout(() => wd.el.querySelector('.m-prompt')?.focus({ preventScroll: true }), 350);
  return wd;
}

/** Clic en el + de un widget: pregunta nueva a su derecha, ya conectada. */
function createFollow(src) {
  const { h } = MODES.follow.size;
  createDraft('follow', { near: { x: src.x + src.w + 2, y: src.y + Math.round((src.h - h) / 2) }, inputs: [src.id] });
}

function bindDraft(wd) {
  const el = wd.el;
  const form = el.querySelector('.wform');
  const err = (text) => { el.querySelector('.m-err').textContent = text; };

  el.querySelector('.m-cancel').addEventListener('click', () => unmount(wd));
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(wd); });
  el.querySelector('.m-prompt').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(wd); }
  });

  const drop = el.querySelector('.m-drop');
  if (!drop) return;
  const pick = async (file) => {
    if (!file) return;
    err('');
    if (file.size > MAX_CSV) { err('El CSV supera 2 MB.'); return shake(wd); }
    const text = await file.text();
    if (!parseCSV(text).headers.length) { err('Ese archivo está vacío.'); return shake(wd); }
    wd.file = file;
    wd.fileText = text;
    // ya adjunto: ícono de listo + nombre corto (máx. 10 caracteres)
    drop.querySelector('.m-drop-ico').innerHTML = ATTACHED_ICON;
    const name = drop.querySelector('.m-file-name');
    name.textContent = file.name.length > 10 ? `${file.name.slice(0, 10)}…` : file.name;
    name.title = file.name;
    drop.querySelector('.m-file-meta').hidden = true;
    drop.classList.add('has-file');
  };
  drop.querySelector('.m-file').addEventListener('change', (e) => pick(e.target.files[0]));
  drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
  drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); pick(e.dataTransfer.files[0]); });
}

function shake(wd) {
  const card = wd.el.querySelector('.wcard');
  card.classList.remove('is-shaking');
  void card.offsetWidth; // reinicia la animación
  card.classList.add('is-shaking');
}

/** Pregunta que no sirve: mensaje, sacudida y el widget se borra. */
function reject(wd, message) {
  wd.state = 'draft';
  wd.el.className = 'widget is-draft';
  refreshGlow();
  requestDraw();
  wd.el.querySelector('.m-err').textContent = message;
  shake(wd);
  setTimeout(() => {
    wd.el.querySelector('.wcard').classList.add('is-erasing');
    setTimeout(() => unmount(wd, false), 480);
  }, 1500);
}

async function submit(wd) {
  if (wd.state !== 'draft') return;
  const m = MODES[wd.mode];
  const prompt = wd.el.querySelector('.m-prompt').value.trim();
  if (!prompt) return reject(wd, `${m.fail}: no escribiste nada.`);

  // estado "pensando": carga al centro; él y sus conectados brillan y no se tocan
  wd.state = 'thinking';
  wd.el.className = 'widget is-thinking';
  wd.el.querySelector('.m-err').textContent = '';
  wd.el.querySelector('.wthinking-note').textContent = wd.file ? 'La IA está leyendo tu archivo'
    : wd.inputs.length ? 'La IA está leyendo lo conectado' : 'La IA está pensando';
  refreshGlow();
  requestDraw();

  const body = { prompt, inputs: wd.inputs, layout: { x: wd.x, y: wd.y, w: wd.w, h: wd.h } };
  if (wd.file) Object.assign(body, { csv: wd.fileText, filename: wd.file.name });
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&widget=${m.endpoint}`, { method: 'POST', body: JSON.stringify(body) });

  if (!widgets.includes(wd)) return; // lo borraron mientras pensaba
  if (r.status === 422) return reject(wd, r.data.error || `${m.fail}.`);
  if (!r.ok) {
    wd.state = 'draft';
    wd.el.className = 'widget is-draft';
    wd.el.querySelector('.m-err').textContent = r.data.error || 'Algo falló. Intenta de nuevo.';
    refreshGlow();
    requestDraw();
    return shake(wd);
  }

  // estado "terminado": el mismo widget pasa a mostrar la respuesta
  const done = r.data.widget;
  const oldId = wd.id;
  Object.assign(wd, { id: done.id, type: done.type, data: done.data, inputs: done.inputs, state: 'done' });
  for (const o of widgets) if (o.inputs.includes(oldId)) o.inputs = o.inputs.map((i) => (i === oldId ? wd.id : i));
  const size = sizeFor(wd.data);
  const fits = !collides({ x: wd.x, y: wd.y, ...size }, wd.id);
  const spot = fits ? { x: wd.x, y: wd.y, ...size } : freeSpot(size.w, size.h, { x: wd.x, y: wd.y });
  const moved = spot.x !== wd.x || spot.y !== wd.y || spot.w !== wd.w || spot.h !== wd.h;
  Object.assign(wd, spot);
  render(wd);
  wd.el.classList.add('is-new');
  if (moved) saveLayout(wd);
  refreshGlow();
  requestDraw();
  queueFocus(wd);
}

/** Tamaño según el tipo de respuesta (y, si es tabla, sus columnas y filas). */
function sizeFor(d) {
  if (d.kind === 'timeline') return timelineSize(d.milestones.length);
  if (d.kind === 'number') return { w: 7, h: 6 };
  if (d.kind === 'text') {
    const n = d.value.length;
    return n > 300 ? { w: 12, h: 9 } : n > 60 ? { w: 11, h: 7 } : { w: 9, h: 6 };
  }
  if (d.kind === 'chart') return { w: clamp((d.labels?.length || 4) * 2 + 4, 10, 22), h: 9 };
  const cols = d.columns?.length || 1, rows = d.rows?.length || 1;
  return { w: clamp(cols * 5, 10, 28), h: clamp(Math.ceil(rows * 0.9) + 3, 5, 16) };
}

/* ============================================================
   Enfoque: el lienzo se mueve hasta dejar el widget al centro
   ============================================================ */

let panAnim = 0;
function focusOn(wd) {
  const tx = Math.round(board.clientWidth / 2 - (wd.x + wd.w / 2) * GRID);
  const ty = Math.round(board.clientHeight / 2 - (wd.y + wd.h / 2) * GRID);
  const from = { ...pan }, t0 = performance.now(), dur = 600;
  const ease = (t) => 1 - (1 - t) ** 3;
  cancelAnimationFrame(panAnim);
  const step = (now) => {
    const t = Math.min(1, (now - t0) / dur);
    pan.x = from.x + (tx - from.x) * ease(t);
    pan.y = from.y + (ty - from.y) * ease(t);
    draw();
    if (t < 1) panAnim = requestAnimationFrame(step);
  };
  if (document.hidden) { pan.x = tx; pan.y = ty; draw(); } else panAnim = requestAnimationFrame(step);
}

// los que terminan casi a la vez se enfocan de a uno, con 2 s entre cada uno
const focusQueue = [];
let focusBusy = false;
function queueFocus(wd) {
  focusQueue.push(wd);
  if (!focusBusy) nextFocus();
}
function nextFocus() {
  const wd = focusQueue.shift();
  if (!wd) { focusBusy = false; return; }
  focusBusy = true;
  if (widgets.includes(wd)) focusOn(wd);
  setTimeout(nextFocus, FOCUS_GAP);
}

/* ============================================================
   Moverse por el lienzo (todos)
   ============================================================ */

board.addEventListener('pointerdown', (e) => {
  // en tablas y formularios se hace scroll/escribe; en controles, su acción
  if (e.button !== 0 || e.target.closest('.wbody, .wform, .whandle, .wx, .wport, .link-hit, .info-wrap')) return;
  if (canEdit && e.target.closest('.whead')) return;
  if (jiggling && !e.target.closest('.widget')) stopJiggle();
  cancelAnimationFrame(panAnim);
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
  const body = e.target.closest('.wbody, textarea');
  if (body && (body.scrollHeight > body.clientHeight || body.scrollWidth > body.clientWidth)) return;
  e.preventDefault();
  cancelAnimationFrame(panAnim);
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

/* ============================================================
   Selección y widgets temporales
   ============================================================ */

let selected = null;

function select(wd) {
  if (selected === wd) return;
  selected?.el.classList.remove('is-selected');
  selected = wd;
  wd?.el.classList.add('is-selected');
  renderInfo();
}

/* Cada toque: qué hay debajo (con la lente, lo que se ve ahí), para
   seleccionar y para borrar los borradores que quedaron sin crear. */
document.addEventListener('pointerdown', (e) => {
  if (!e.isTrusted || e.button > 0) return;
  let el = e.target;
  if (routing && board.contains(el) && !el.closest('.info-wrap')) el = hitAt(e.clientX, e.clientY) || el;
  const wEl = el.closest?.('.widget');
  const wd = wEl ? widgets.find((w) => w.el === wEl) : null;

  // temporales: sin crear, se van al tocar otra zona (el + de otro widget no cuenta)
  if (!el.closest?.('.wport--out')) {
    for (const d of widgets.filter((w) => w.state === 'draft' && w !== wd)) unmount(d);
  }

  if (el.closest?.('.wport')) return; // conectar no selecciona ni deselecciona
  if (wd?.state === 'done') select(wd);
  else if (!el.closest?.('.info-wrap, .dock, .board-top')) select(null);
}, true);

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && selected && !jiggling) select(null); });
$('info-x').addEventListener('click', () => select(null));

/* ---------- bloque de información del seleccionado ---------- */

const KIND_LABEL = { table: 'Tabla', chart: 'Gráfico', number: 'Número', text: 'Texto' };
const TOOL_LABEL = { table: 'Tabla con IA', ask: 'Pregúntale a la IA', timeline: 'Línea de tiempo' };

function renderInfo() {
  const box = $('info');
  if (!selected) { box.hidden = true; return; }
  const d = selected.data || {};
  if (d.kind === 'timeline') return renderTimelineInfo(box);
  const rows = [];
  const add = (label, value) => { if (value) rows.push(`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`); };
  add('Pregunta', d.prompt);
  add('Archivo', d.source);
  const ctx = (selected.inputs || []).map((i) => byId(i)?.data?.title).filter(Boolean);
  add(ctx.length === 1 ? 'Conectado' : 'Conectados', ctx.join(' · '));
  if (d.kind === 'table') add('Tamaño', `${d.rows?.length || 0} filas × ${d.columns?.length || 0} columnas`);
  if (d.kind === 'chart') add('Datos', `${d.labels?.length || 0} valores${d.unit ? ` · ${d.unit}` : ''}`);
  add('Nota', d.cut ? 'Se guardaron solo las primeras filas.' : d.truncated ? 'Se usaron las primeras líneas del archivo (era muy grande).' : '');
  if (!d.prompt && !d.source) add('Origen', 'Sin datos de origen guardados.');

  $('info-kind').textContent = [TOOL_LABEL[selected.type], KIND_LABEL[d.kind]].filter(Boolean).join(' · ');
  $('info-title').textContent = d.title || 'Widget';
  $('info-list').innerHTML = rows.join('');
  box.hidden = false;
  box.classList.remove('is-in');
  void box.offsetWidth; // reinicia la animación de entrada
  box.classList.add('is-in');
}

/* ============================================================
   Línea de tiempo: crear y editar desde el bloque de información
   ============================================================ */

async function createTimeline() {
  select(null);
  const data = defaultTimeline(todayISO());
  const { w, h } = timelineSize(data.milestones.length);
  const layout = freeSpot(w, h);
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&widget=timeline`, {
    method: 'POST', body: JSON.stringify({ data, layout }),
  });
  if (!r.ok) return alert(r.data.error || 'No se pudo crear la línea de tiempo.');
  const wd = { ...r.data.widget, state: 'done', inputs: [] };
  widgets.push(wd);
  mount(wd, { isNew: true });
  refreshEmpty();
  focusOn(wd);
  select(wd); // abre su bloque para editar hitos y personaje
  requestDraw();
}

/** Guarda la línea de tiempo: reordena por fecha, redibuja y ajusta el ancho. */
let tlSaveTimer = 0;
function saveTimeline(wd, { rerenderInfo = false } = {}) {
  const d = wd.data;
  d.milestones.sort((a, b) => a.date.localeCompare(b.date));
  const size = timelineSize(d.milestones.length);
  if (size.w !== wd.w || size.h !== wd.h) {
    const fits = !collides({ x: wd.x, y: wd.y, ...size }, wd.id);
    Object.assign(wd, fits ? { x: wd.x, y: wd.y, ...size } : freeSpot(size.w, size.h, { x: wd.x, y: wd.y }));
    saveLayout(wd);
  }
  render(wd);
  requestDraw();
  if (rerenderInfo) renderInfo();
  clearTimeout(tlSaveTimer);
  tlSaveTimer = setTimeout(async () => {
    const r = await api(`/api/dash?d=${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ widget: wd.id, data: wd.data }),
    });
    if (!r.ok) alert(r.data.error || 'No se pudo guardar la línea de tiempo.');
  }, 250);
}

function renderTimelineInfo(box) {
  const wd = selected;
  const d = wd.data;
  const today = todayISO();
  $('info-kind').textContent = 'Línea de tiempo';
  $('info-title').textContent = d.title || 'Línea de tiempo';
  const list = $('info-list');
  list.innerHTML = '';

  // personaje: ‹ cara › (solo la cara normal en el selector)
  const pick = document.createElement('div');
  pick.className = 'tl-pick';
  pick.innerHTML = `${canEdit ? '<button type="button" class="tl-arrow" data-step="-1" aria-label="Personaje anterior">‹</button>' : ''}
    <img src="${FACES[d.character].normal}" alt="Personaje">
    ${canEdit ? '<button type="button" class="tl-arrow" data-step="1" aria-label="Personaje siguiente">›</button>' : ''}`;
  pick.querySelectorAll('.tl-arrow').forEach((b) => b.addEventListener('click', () => {
    const i = CHARACTERS.indexOf(d.character);
    d.character = CHARACTERS[(i + Number(b.dataset.step) + CHARACTERS.length) % CHARACTERS.length];
    saveTimeline(wd, { rerenderInfo: true });
  }));
  list.append(pick);

  // hitos, del más antiguo al más lejano
  const rows = document.createElement('div');
  rows.className = 'tl-rows';
  for (const m of d.milestones) {
    const row = document.createElement('div');
    row.className = 'tl-row';
    if (canEdit) {
      row.innerHTML = `<input class="tl-name" maxlength="40" aria-label="Nombre del hito">
        <input class="tl-date" type="date" aria-label="Fecha del hito">
        ${d.milestones.length > 2 ? '<button type="button" class="tl-del" aria-label="Quitar hito">×</button>' : ''}`;
      const name = row.querySelector('.tl-name'), date = row.querySelector('.tl-date');
      name.value = m.name;
      date.value = m.date;
      name.addEventListener('change', () => { m.name = name.value.trim().slice(0, 40) || m.name; saveTimeline(wd); });
      date.addEventListener('change', () => { if (date.value) { m.date = date.value; saveTimeline(wd, { rerenderInfo: true }); } });
      row.querySelector('.tl-del')?.addEventListener('click', () => {
        d.milestones = d.milestones.filter((x) => x !== m);
        saveTimeline(wd, { rerenderInfo: true });
      });
    } else {
      row.innerHTML = '<span class="tl-name"></span><span class="tl-date"></span>';
      row.querySelector('.tl-name').textContent = m.name;
      row.querySelector('.tl-date').textContent = m.date;
    }
    row.title = daysLeftText(m.date, today);
    rows.append(row);
  }
  list.append(rows);

  if (canEdit) {
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'tl-add';
    add.textContent = 'agregar';
    add.addEventListener('click', () => {
      const last = d.milestones[d.milestones.length - 1];
      const m = { id: `h${Date.now().toString(36)}`, name: `hito ${d.milestones.length + 1}`, date: addDays(last.date, 7) };
      d.milestones.push(m);
      saveTimeline(wd, { rerenderInfo: true });
      const input = [...$('info-list').querySelectorAll('.tl-name')].find((x) => x.value === m.name);
      input?.focus();
      input?.select();
    });
    list.append(add);
  }

  box.hidden = false;
  box.classList.remove('is-in');
  void box.offsetWidth;
  box.classList.add('is-in');
}

// la cabeza avanza con los días: si la página queda abierta, se redibuja al cambiar el día
let lastDay = todayISO();
setInterval(() => {
  const now = todayISO();
  if (now === lastDay) return;
  lastDay = now;
  widgets.filter((w) => w.data?.kind === 'timeline').forEach((w) => render(w));
  requestDraw();
}, 60_000);

/* ============================================================
   Dock
   ============================================================ */

const TOOLS = [
  { key: 'table', label: 'Tabla con IA', open: () => createDraft('table') },
  { key: 'ask', label: 'Pregúntale a la IA', open: () => createDraft('ask') },
  { key: 'timeline', label: 'Línea de tiempo', open: () => createTimeline() },
];
// los chismosos solo tienen un botón: actualizar toda la página
const VIEWER_TOOLS = [{ key: 'refresh', label: 'Actualizar', open: () => location.reload() }];

function renderDock() {
  const dock = $('dock');
  dock.hidden = false;
  dock.innerHTML = '';
  for (const t of canEdit ? TOOLS : VIEWER_TOOLS) {
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

/* ============================================================
   Gráfico (una sola serie, un solo tono): barras o líneas
   ============================================================ */

const nfShort = new Intl.NumberFormat('es', { maximumFractionDigits: 2 });
const nfCompact = new Intl.NumberFormat('es', { notation: 'compact', maximumFractionDigits: 1 });
const fmt = (n) => (Math.abs(n) >= 10000 ? nfCompact.format(n) : nfShort.format(n));

function chartSummary(d) {
  const i = d.values.indexOf(Math.max(...d.values));
  return `${d.title}: ${d.labels.length} valores; el mayor es ${d.labels[i]} (${fmt(d.values[i])}${d.unit ? ` ${d.unit}` : ''}).`;
}

/** Marcas "redondas" del eje Y: 0, 50, 100… */
function niceTicks(min, max, count = 4) {
  const span = max - min || Math.abs(max) || 1;
  const raw = span / count, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((st) => st >= raw);
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const out = [];
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.round(v / step) * step);
  return out;
}

/** Barra con esquinas redondeadas solo en el extremo del dato, apoyada en la base. */
function barPath(x, y0, w, y1, r) {
  const up = y1 < y0, h = Math.abs(y1 - y0), rr = Math.min(r, w / 2, h);
  if (h < 0.5) return '';
  return up
    ? `M${x},${y0}V${y1 + rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 + rr}V${y0}Z`
    : `M${x},${y0}V${y1 - rr}Q${x},${y1} ${x + rr},${y1}H${x + w - rr}Q${x + w},${y1} ${x + w},${y1 - rr}V${y0}Z`;
}

function drawChart(host, d) {
  const W = host.clientWidth, H = host.clientHeight;
  if (W < 40 || H < 40) return;
  const n = d.values.length;
  const ticks = niceTicks(Math.min(0, ...d.values), Math.max(0, ...d.values));
  const yMin = ticks[0], yMax = ticks[ticks.length - 1];
  const left = Math.max(...ticks.map((t) => fmt(t).length)) * 6.5 + 10, right = 10, top = 10, bottom = 22;
  const pw = W - left - right, ph = H - top - bottom;
  const y = (v) => top + ph - ((v - yMin) / (yMax - yMin || 1)) * ph;
  const band = pw / n;
  const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(pw / 56))));
  const maxChars = Math.max(3, Math.floor((band * every) / 6.2));
  const cut = (t) => (t.length > maxChars ? `${t.slice(0, maxChars - 1)}…` : t);
  const tip = (i) => esc(`${d.labels[i]}: ${fmt(d.values[i])}${d.unit ? ` ${d.unit}` : ''}`);

  let marks = '';
  if (d.chartType === 'line') {
    const px = (i) => left + band * i + band / 2;
    marks = `<path class="c-line" d="${d.values.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(1)},${y(v).toFixed(1)}`).join('')}"/>`;
    marks += d.values.map((v, i) => `<g class="c-hit" data-tip="${tip(i)}">
      <rect x="${left + band * i}" y="${top}" width="${band}" height="${ph}" fill="transparent"/>
      <circle class="c-dot" cx="${px(i)}" cy="${y(v)}" r="4"/></g>`).join('');
  } else {
    const gap = Math.max(2, band * 0.28), bw = Math.max(2, band - gap);
    marks = d.values.map((v, i) => `<g class="c-hit" data-tip="${tip(i)}">
      <rect x="${left + band * i}" y="${top}" width="${band}" height="${ph}" fill="transparent"/>
      <path class="c-bar" d="${barPath(left + band * i + gap / 2, y(0), bw, y(v), 4)}"/></g>`).join('');
  }

  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    ${ticks.map((t) => `<line class="c-grid${t === 0 ? ' c-zero' : ''}" x1="${left}" x2="${W - right}" y1="${y(t)}" y2="${y(t)}"/>
      <text class="c-ytick" x="${left - 8}" y="${y(t) + 3.5}" text-anchor="end">${fmt(t)}</text>`).join('')}
    ${marks}
    ${d.labels.map((l, i) => (i % every ? '' : `<text class="c-xtick" x="${left + band * i + band / 2}" y="${H - 6}" text-anchor="middle">${esc(cut(l))}</text>`)).join('')}
  </svg>`;
}

/* ---------- tooltip compartido: cualquier elemento con data-tip ---------- */
const tipEl = $('tip');
function showTip(el, cx, cy) {
  const t = el?.closest?.('[data-tip]');
  if (!t) { tipEl.hidden = true; return; }
  tipEl.textContent = t.dataset.tip;
  tipEl.classList.toggle('tip--light', t.hasAttribute('data-tip-light'));
  tipEl.hidden = false;
  const pad = 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  const x = Math.min(innerWidth - w - 8, cx + pad);
  const yy = cy - h - pad < 8 ? cy + pad : cy - h - pad;
  tipEl.style.transform = `translate(${x}px, ${yy}px)`;
}
document.addEventListener('pointermove', (e) => { if (!routing) showTip(e.target, e.clientX, e.clientY); });
document.addEventListener('pointerleave', () => { tipEl.hidden = true; });

/* ============================================================
   Redirector: con la lente, lo que ves en q está en unwarp(q)
   ------------------------------------------------------------
   El filtro SVG solo cambia cómo se pinta la capa .lens; el navegador
   sigue detectando clics en la posición real de cada elemento. Así que,
   mientras hay lente, nada dentro de .lens recibe el puntero (CSS) y
   aquí se traduce cada evento: se busca qué elemento está en unwarp(q)
   y se le entrega el evento (pointerdown, click, rueda, hover).
   ============================================================ */

/** Punto real (en px de ventana) que se ve en (cx, cy). */
function sourcePoint(cx, cy) {
  if (!routing) return { x: cx, y: cy };
  const b = board.getBoundingClientRect();
  const p = unwarp(cx - b.left, cy - b.top, b.width, b.height, fisheye);
  return { x: p.x + b.left, y: p.y + b.top };
}

/** Elemento de la capa deformada que se ve bajo (cx, cy), o null. */
function hitAt(cx, cy) {
  const p = sourcePoint(cx, cy);
  lensEl.classList.add('is-hittable');
  const el = document.elementsFromPoint(p.x, p.y)
    .find((n) => lensEl.contains(n) && n !== lensEl && n !== world && n !== linksSvg && n !== linksTop);
  lensEl.classList.remove('is-hittable');
  return el || null;
}

const eventInit = (e) => ({
  bubbles: true, cancelable: true, composed: true,
  clientX: e.clientX, clientY: e.clientY, screenX: e.screenX, screenY: e.screenY,
  pointerId: e.pointerId, pointerType: e.pointerType, isPrimary: e.isPrimary,
  button: e.button, buttons: e.buttons,
  ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, metaKey: e.metaKey,
});

board.addEventListener('pointerdown', (e) => {
  if (!routing || !e.isTrusted || e.target.closest('.info-wrap')) return;
  const el = hitAt(e.clientX, e.clientY);
  if (!el) return; // fondo: sigue al manejo normal (moverse por el lienzo)
  e.stopPropagation();
  e.preventDefault();
  el.dispatchEvent(new PointerEvent('pointerdown', eventInit(e)));
  el.closest('textarea, input:not([type=file])')?.focus({ preventScroll: true });
  if (e.pointerType === 'touch') touchScroll(e, el);
}, true);

board.addEventListener('click', (e) => {
  if (!routing || !e.isTrusted || e.target.closest('.info-wrap')) return;
  const el = hitAt(e.clientX, e.clientY);
  if (!el) return;
  e.stopPropagation();
  e.preventDefault();
  // botones y etiquetas: su acción real (enviar, cancelar, abrir el selector de archivo…)
  const act = el.closest('button, label, a');
  if (act) act.click(); else el.dispatchEvent(new MouseEvent('click', eventInit(e)));
}, true);

board.addEventListener('wheel', (e) => {
  if (!routing || e.target.closest('.info-wrap')) return;
  const el = hitAt(e.clientX, e.clientY);
  const sc = el?.closest('.wbody, .wform, textarea');
  if (!sc || (sc.scrollHeight <= sc.clientHeight && sc.scrollWidth <= sc.clientWidth)) return; // mueve el lienzo
  e.stopPropagation();
  e.preventDefault();
  sc.scrollBy(e.deltaX, e.deltaY);
}, { capture: true, passive: false });

/* hover: el navegador no sabe qué hay bajo el puntero, así que se marca a mano */
let hovered = [];
let hoverRaf = 0;
function setHover(el, cx, cy) {
  const chain = [];
  for (let n = el; n && n !== lensEl; n = n.parentElement) chain.push(n);
  for (const n of hovered) if (!chain.includes(n)) n.classList.remove('is-hover');
  for (const n of chain) n.classList.add('is-hover');
  hovered = chain;
  board.style.cursor = el ? getComputedStyle(el).cursor : '';
  showTip(el, cx, cy);
}
board.addEventListener('pointermove', (e) => {
  if (!routing || e.buttons || e.pointerType === 'touch') return;
  if (e.target.closest('.info-wrap')) { setHover(null); return; }
  cancelAnimationFrame(hoverRaf);
  hoverRaf = requestAnimationFrame(() => setHover(hitAt(e.clientX, e.clientY), e.clientX, e.clientY));
});
board.addEventListener('pointerleave', () => { if (routing) setHover(null); });

/* táctil: arrastrar dentro de una tabla la desplaza (el scroll nativo no llega) */
function touchScroll(e, el) {
  const sc = el.closest('.wbody, .wform');
  if (!sc) return;
  let lx = e.clientX, ly = e.clientY;
  const move = (ev) => { sc.scrollBy(lx - ev.clientX, ly - ev.clientY); lx = ev.clientX; ly = ev.clientY; };
  const up = () => {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
  };
  window.addEventListener('pointermove', move);
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

/* ============================================================
   Integrantes (amos): qué chismosos ven este dashboard
   ============================================================ */

function setupMembers(count) {
  $('members').hidden = false;
  $('members-count').textContent = count;
}

async function loadMembers() {
  const listEl = $('members-list');
  listEl.innerHTML = '<li class="members-empty">Cargando…</li>';
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&members=1`);
  if (!r.ok) { listEl.innerHTML = `<li class="members-empty">${esc(r.data.error || 'No se pudo cargar.')}</li>`; return; }
  const members = r.data.members;
  listEl.innerHTML = '';
  if (!members.length) {
    listEl.innerHTML = '<li class="members-empty">Todavía no hay chismosos. Créalos en el panel → Permisos.</li>';
    return;
  }
  for (const m of members) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="members-mail"></span>
      <button class="switch" type="button" role="switch" aria-checked="${m.active}"><span></span></button>`;
    li.querySelector('.members-mail').textContent = m.email;
    const sw = li.querySelector('.switch');
    sw.setAttribute('aria-label', `Acceso de ${m.email}`);
    sw.addEventListener('click', async () => {
      const active = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(active)); // optimista
      sw.disabled = true;
      const res = await api('/api/perms', { method: 'PATCH', body: JSON.stringify({ id: m.id, dashboard: id, active }) });
      sw.disabled = false;
      if (!res.ok) { sw.setAttribute('aria-checked', String(!active)); return alert(res.data.error || 'No se pudo cambiar.'); }
      const n = Number($('members-count').textContent) + (active ? 1 : -1);
      $('members-count').textContent = Math.max(0, n);
    });
    listEl.append(li);
  }
}

function toggleMembers(open) {
  $('members-panel').hidden = !open;
  $('members-btn').setAttribute('aria-expanded', String(open));
  if (open) loadMembers();
}
$('members-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleMembers($('members-panel').hidden); });
document.addEventListener('pointerdown', (e) => {
  if (!$('members-panel').hidden && !e.target.closest('.members')) toggleMembers(false);
});
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('members-panel').hidden) toggleMembers(false); });

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
  fisheye = (data.config?.fisheye ?? 7) / 100;
  document.body.classList.toggle('can-edit', canEdit);
  document.title = `${data.dashboard.name} — fukudamiyasato`;
  $('dash-title').textContent = data.dashboard.name;
  $('dash-ico').innerHTML = dashIconHTML(data.dashboard);
  document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = user.email; });
  // con un solo dashboard no hay a dónde volver: /admin/ lo mandaría aquí mismo
  $('dash-back').hidden = !(canEdit || user.dashboards.length > 1);
  if (canEdit) setupMembers(data.members || 0);

  $('dash-delete').hidden = !canEdit || data.dashboard.builtin;

  show('dash');
  renderDock();
  widgets = data.widgets.map((w) => ({ ...w, state: 'done', inputs: w.inputs || [] }));
  widgets.forEach((wd) => mount(wd));
  refreshEmpty();
  frame();
  updateLens();
  draw(); // primer cuadro ya, sin esperar a requestAnimationFrame
})();
