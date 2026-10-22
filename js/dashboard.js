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
   · Zoom (control arriba a la derecha, o Ctrl/pellizco + rueda): de 0,5× a
     2×; la esfera al centro es 1×. Escala el mundo alrededor del centro.
   · Tokens (amos): las herramientas de IA cuestan tokens (precio con
     sobrecargo, lo fija el amo supremo). El saldo se ve arriba; si no
     alcanza, la herramienta se apaga. El amo supremo no tiene límite.
   · Seleccionar un widget (tocarlo): brillo rojo + bloque de información
     al centro-derecha (pregunta, archivo, lo conectado), sin lente.
   · Los widgets en creación son temporales: tocar otra zona los borra
     (salvo el + de otro widget, para poder conectarles cosas).
   · Maleta (dock, amos): bandera al centro de la vista (color al azar, sin
     repetir, máx. 8) y raya divisoria a la derecha de todo (solo una). No son
     widgets. Con la primera bandera aparece, junto al zoom, un botón con el
     listado: elegir una centra el lienzo en ella.
   Los permisos reales los aplica /api/dash en el servidor.
   ============================================================ */

import { dashIconHTML, toIcon, TOOL_ICONS, ATTACHED_ICON } from './dashboard-icons.js';
import { parseCSV } from './csv.js';
import { confirmByName } from './confirm-name.js';
import { drawDots, fitCanvas, buildLensFilter, unwarp } from './fisheye.js';
import {
  FACES, CHARACTERS, todayISO, addDays, defaultTimeline, timelineHTML, timelineSize, daysLeftText,
} from './timeline.js';
import {
  defaultUser, randomUser, fromLegacy, nameForSex, userHTML, userSize, fileSize, avatarSVG, ageLabel, stageLabel,
  AGE_MAX, MAX_CONTEXT, MAX_TEXT,
} from './persona.js';
import { emptyJourney, journeySize, journeyHTML } from './journey.js';
import { LABEL_STYLES, GROUP_COLORS, newLabel, labelSize, newGroup, groupSize, labelHTML, groupHTML } from './blocks.js';
import { PROS, proOf, newPro, proSize, findingSize, proHTML, findingHTML, proAvatar } from './pro.js';
import { emptyFile, fileWidgetSize, fileHTML, readUploads, textLeft, MAX_FILES, ACCEPT } from './file.js';
import { EXPERTS, expertOf, fromPreset, defaultExpert, expertSize, expertHTML, expertAvatar } from './expert.js';

const $ = (id) => document.getElementById(id);
const id = new URLSearchParams(location.search).get('d') || '';
const GRID = 32;              // px por celda
const MIN_W = 4, MIN_H = 3;   // tamaño mínimo de un widget, en celdas
let fisheye = 0.07;           // intensidad del ojo de pez; la define el amo supremo en Configuración
const MAX_CSV = 2 * 1024 * 1024;
const LONG_PRESS = 520;       // ms presionando para que tiemblen
const FOCUS_GAP = 2000;       // ms entre un enfoque automático y el siguiente
const SNAP_PORT = 28;         // px: qué tan cerca hay que soltar la línea del conector
const REJECT_MS = 4500;       // cuánto se ve "No sirve tu…" antes de borrarse
const FILE_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>';

const board = $('board');
const world = $('world');
const dots = $('dots');
const linksSvg = $('links');
const linksTop = $('links-top');
const lensEl = $('lens');
const ctx = dots.getContext('2d');

let canEdit = false;
let tokens = null;    // saldo de tokens; null = sin límite (amo supremo)
let prices = {};      // { table, ask, follow }: lo que cuesta cada herramienta de IA
const nfTok = new Intl.NumberFormat('es-PE');
const AI_TOOLS = { table: 'table', ask: 'ask' }; // herramienta del dock → precio
let widgets = [];   // { id, type, x, y, w, h, data, inputs, state, mode?, el, file?, fileText? }
const pan = { x: 0, y: 0 };
let zoom = 1;                      // 0,5× … 2×; lo cambia el control de zoom
const cell = () => GRID * zoom;    // px en pantalla de una celda
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
  drawDots(ctx, w, h, { panX: pan.x, panY: pan.y, grid: cell(), amount: fisheye });

  world.style.transform = `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`;
  if (jiggling) placeDividerX();
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
const isGroup = (w) => w?.data?.kind === 'group';
// los grupos no chocan: están detrás y los widgets van dentro de ellos
const collides = (rect, skipId) => widgets.some((o) => o.id !== skipId && !isGroup(o) && overlaps(rect, o));

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
  // clic en el + de un widget: la IA normal (estrella), con lo conectado como contexto
  follow: {
    title: 'Pregúntale a la IA', icon: 'ask', endpoint: 'follow', file: false,
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
        <button class="btn m-ok" type="submit">${esc(m.submit)}${prices[m.endpoint] ? `<small title="Estimado de tokens">≈ ${nfTok.format(prices[m.endpoint])} tk</small>` : ''}</button>
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
  if (d.kind === 'user') return userHTML(d);
  if (d.kind === 'expert') return expertHTML(d);
  if (d.kind === 'journey') return journeyHTML(d, { linked: linkedUsers(wd), generating: wd.generating });
  if (d.kind === 'file') return fileHTML(d, { canEdit });
  if (d.kind === 'label') return labelHTML(d);
  if (d.kind === 'group') return groupHTML(d);
  if (d.kind === 'pro') return proHTML(d, { busy: wd.researching });
  if (d.kind === 'finding') return findingHTML(d);
  if (d.kind === 'nebula') return nebulaHTML(wd);
  return `
    <header class="whead" title="${esc(d.prompt || '')}">
      <h3>${esc(d.title || 'Respuesta')}</h3>
      ${d.source ? `<small>${esc(d.source)}</small>` : ''}
      ${d.voices?.length ? `<small class="wvoices">con la mirada de ${esc(d.voices.join(' y '))}</small>` : ''}
    </header>
    ${contentHTML(d)}`;
}

/** Arma (o rearma, al cambiar de estado) el contenido del widget. */
function render(wd) {
  const el = wd.el;
  el.className = `widget is-${wd.state}${wd === selected ? ' is-selected' : ''}${isGroup(wd) ? ' is-group' : ''}${wd.data?.kind === 'label' ? ' is-label' : ''}`;
  el.dataset.id = wd.id;
  const inner = wd.state === 'done' ? doneHTML(wd) : draftHTML(wd);
  el.innerHTML = `<div class="wbox">
    <div class="wcard${wd.data?.kind === 'timeline' ? ' wcard--timeline' : ''}${wd.data?.kind === 'user' || wd.data?.kind === 'expert' ? ' wcard--user' : ''}${wd.data?.kind === 'expert' ? ' wcard--expert' : ''}${wd.data?.kind === 'journey' ? ' wcard--journey' : ''}${wd.data?.kind === 'file' ? ' wcard--file' : ''}${wd.data?.kind === 'pro' ? ' wcard--user wcard--pro' : ''}${wd.data?.kind === 'finding' ? ' wcard--finding' : ''}${wd.data?.kind === 'nebula' ? ' wcard--nebula' : ''}${wd.data?.kind === 'label' ? ' wcard--label' : ''}${isGroup(wd) ? ' wcard--group' : ''}">${inner}</div>
    ${canEdit ? `
      ${isGroup(wd) ? '' : '<button class="wport wport--in" type="button" tabindex="-1" aria-label="Conector de entrada"></button>'}
      ${wd.state === 'done' && !isGroup(wd) ? `<button class="wport wport--out" type="button" data-tip-ai="follow" data-tip-label="Preguntar sobre esto (arrastra para conectar)" aria-label="Conectar o preguntar sobre «${esc(wd.data?.title || 'este widget')}»">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M12 6v12M6 12h12"/></svg></button>` : ''}
      ${wd.data?.kind === 'timeline' ? '' : '<span class="whandle" aria-hidden="true"></span>'}
      ${wd.state === 'done' ? `<button class="wx" type="button" aria-label="Borrar «${esc(wd.data?.title || 'widget')}»">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg></button>` : ''}` : ''}
  </div>`;
  place(wd);

  const chart = el.querySelector('.wchart');
  if (chart) new ResizeObserver(() => drawChart(chart, wd.data)).observe(chart);

  if (!canEdit) return;
  (el.querySelector('.whead') || el.querySelector('.wtl, .wuser, .wexpert, .wpro, .wneb, .wlabel, .wgroup-head')).addEventListener('pointerdown', (e) => startEdit(e, wd, 'move'));
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
  if (multi.has(wd)) { multi.delete(wd); if (multi.size < 2) selectMany([...multi]); else renderInfo(); }
  widgets = widgets.filter((x) => x !== wd);
  for (const o of widgets) {
    if (o.inputs?.includes(wd.id) || o.about?.includes(wd.id)) {
      o.inputs = o.inputs.filter((i) => i !== wd.id);
      if (o.about) o.about = o.about.filter((i) => i !== wd.id);
      refreshContextNote(o);
    }
  }
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
  placeDividerX();
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
  if (mode === 'move' && multi.size > 1 && multi.has(wd)) return startGroupMove(e, withContents([...multi]));
  if (mode === 'move' && isGroup(wd)) return startGroupMove(e, withContents([wd]));
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
    const sx = ev.clientX - start.px, sy = ev.clientY - start.py;
    const dx = sx / zoom, dy = sy / zoom; // en px del mundo
    if (!dragging) {
      if (Math.hypot(sx, sy) < 4) return;
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
    ghost.classList.toggle('is-bad', !isGroup(wd) && collides(next, wd.id));
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
    if (changed && (isGroup(wd) || !collides(next, wd.id))) {
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

/** Lo que está entero dentro de un grupo. */
const insideOf = (g) => widgets.filter((w) => w !== g && w.state === 'done'
  && w.x >= g.x && w.y >= g.y && w.x + w.w <= g.x + g.w && w.y + w.h <= g.y + g.h);
/** Los grupos de la lista arrastran a sus widgets. */
const withContents = (list) => [...new Set(list.flatMap((w) => (isGroup(w) ? [w, ...insideOf(w)] : [w])))];

/** Mueve varios widgets juntos (selección múltiple). Si alguno chocaría con
    otro que no se está moviendo, vuelven todos a su lugar. */
function startGroupMove(e, group) {
  e.preventDefault();
  e.stopPropagation();
  const target = e.currentTarget;
  target.setPointerCapture(e.pointerId);
  const px = e.clientX, py = e.clientY;
  const starts = group.map((w) => ({ w, x: w.x, y: w.y }));
  const ids = new Set(group.map((w) => w.id));
  const free = (r, w) => isGroup(w) || !widgets.some((o) => !ids.has(o.id) && !isGroup(o) && overlaps(r, o));
  const ghosts = group.map(() => Object.assign(document.createElement('div'), { className: 'ghost' }));
  let off = { x: 0, y: 0 }, dragging = false;

  const onMove = (ev) => {
    const sx = ev.clientX - px, sy = ev.clientY - py;
    if (!dragging) {
      if (Math.hypot(sx, sy) < 4) return;
      dragging = true;
      ghosts.forEach((g) => world.append(g));
      group.forEach((w) => w.el.classList.add('is-dragging'));
    }
    const dx = sx / zoom, dy = sy / zoom;
    off = { x: Math.round(dx / GRID), y: Math.round(dy / GRID) };
    const bad = starts.some((s) => !free({ x: s.x + off.x, y: s.y + off.y, w: s.w.w, h: s.w.h }, s.w));
    starts.forEach((s, i) => {
      s.w.el.style.left = `${s.x * GRID + dx}px`;
      s.w.el.style.top = `${s.y * GRID + dy}px`;
      Object.assign(ghosts[i].style, {
        left: `${(s.x + off.x) * GRID + 5}px`, top: `${(s.y + off.y) * GRID + 5}px`,
        width: `${s.w.w * GRID - 10}px`, height: `${s.w.h * GRID - 10}px`,
      });
      ghosts[i].classList.toggle('is-bad', bad);
    });
    requestDraw();
  };
  const onUp = () => {
    target.removeEventListener('pointermove', onMove);
    target.removeEventListener('pointerup', onUp);
    target.removeEventListener('pointercancel', onUp);
    if (!dragging) return;
    ghosts.forEach((g) => g.remove());
    const ok = (off.x || off.y) && starts.every((s) => free({ x: s.x + off.x, y: s.y + off.y, w: s.w.w, h: s.w.h }, s.w));
    for (const s of starts) {
      s.w.el.classList.remove('is-dragging');
      if (ok) { s.w.x = s.x + off.x; s.w.y = s.y + off.y; saveLayout(s.w); }
      place(s.w);
    }
    requestDraw();
  };
  target.addEventListener('pointermove', onMove);
  target.addEventListener('pointerup', onUp);
  target.addEventListener('pointercancel', onUp);
}

/* ============================================================
   Conectores: arrastrar desde el + o hacer clic en él
   ============================================================ */

/** ¿Se puede conectar src a t? Al user journey solo le llegan usuarios. */
const canLink = (src, t) => !isGroup(t) && (t.data?.kind !== 'journey' || src.data?.kind === 'user');

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
      if (t === src || t.state === 'thinking' || !canLink(src, t)) continue;
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
    markTarget(hit);
    tempLine = { a: portPoint(src, 'out'), z: hit ? portPoint(hit, 'in') : { x: px, y: py }, snap: Boolean(hit) };
    requestDraw();
  };

  const onUp = (ev) => {
    port.removeEventListener('pointermove', onMove);
    port.removeEventListener('pointerup', onUp);
    port.removeEventListener('pointercancel', onUp);
    tempLine = null;
    markTarget(null);
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

/** Resalta el conector de entrada donde caería la línea que se arrastra. */
let targetPort = null;
function markTarget(wd) {
  const port = wd?.el.querySelector('.wport--in') || null;
  if (port === targetPort) return;
  targetPort?.classList.remove('is-target');
  port?.classList.add('is-target');
  targetPort = port;
}

/** Nota en el borrador: "Contexto: 2 widgets conectados". */
function refreshContextNote(wd) {
  // el panel de journey muestra quiénes están conectados aunque todavía no se haya generado
  if (wd.data?.kind === 'journey' && wd.state === 'done') {
    render(wd);
    if (selected === wd) renderInfo();
    return;
  }
  const note = wd.el.querySelector('.wctx');
  if (!note) return;
  const title = (i) => byId(i)?.data?.title || byId(i)?.data?.name || 'un widget';
  const isExpert = (i) => byId(i)?.data?.kind === 'expert';
  const parts = [];
  if (wd.about?.length && !isExpert(wd.about[0])) parts.push(`Sobre «${title(wd.about[0])}»`);
  const ctx = wd.inputs.filter((i) => !isExpert(i));
  const n = ctx.length;
  if (n) parts.push(n === 1 ? `Contexto: «${title(ctx[0])}»` : `Contexto: ${n} widgets conectados`);
  // las celebridades no son contexto: le dan su mirada a la respuesta
  const voices = [...(wd.about || []), ...wd.inputs].filter(isExpert).map(title);
  if (voices.length) parts.push(`Con la mirada de ${voices.join(' y ')}`);
  note.hidden = !parts.length;
  note.textContent = parts.join(' · ');
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
  const cx = near ? near.x : Math.round((board.clientWidth / 2 - pan.x) / cell() - w / 2);
  const cy = near ? near.y : Math.round((board.clientHeight / 2 - pan.y) / cell() - h / 2);
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

/* `about`: ids de los widgets sobre los que se pregunta sin quedar conectados
   (el + de un widget): la IA los usa como contexto, pero no hay línea. */
function createDraft(mode, { near, inputs = [], about = [] } = {}) {
  const { w, h } = MODES[mode].size;
  select(null); // el foco pasa al widget nuevo
  const wd = { id: `draft-${++draftSeq}`, type: MODES[mode].endpoint, mode, state: 'draft', inputs, about, ...freeSpot(w, h, near) };
  widgets.push(wd);
  mount(wd, { isNew: true });
  refreshContextNote(wd);
  refreshEmpty();
  focusOn(wd);
  setTimeout(() => wd.el.querySelector('.m-prompt')?.focus({ preventScroll: true }), 350);
  return wd;
}

/** Clic en el + de un widget: pregunta nueva en el primer lugar libre a su
    costado, SIN conectar (usa ese widget y su cadena como contexto). */
function createFollow(src) {
  if (!canAfford('follow')) return flashBroke('follow');
  const { h } = MODES.follow.size;
  createDraft('follow', { near: { x: src.x + src.w + 2, y: src.y + Math.round((src.h - h) / 2) }, about: [src.id] });
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
  // el mensaje queda un rato para poder leerlo; después se borra
  setTimeout(() => {
    wd.el.querySelector('.wcard').classList.add('is-erasing');
    setTimeout(() => unmount(wd, false), 480);
  }, REJECT_MS);
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

  const body = { prompt, inputs: wd.inputs, about: wd.about || [], layout: { x: wd.x, y: wd.y, w: wd.w, h: wd.h } };
  if (wd.file) Object.assign(body, { csv: wd.fileText, filename: wd.file.name });
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&widget=${m.endpoint}`, { method: 'POST', body: JSON.stringify(body) });

  if (!widgets.includes(wd)) return; // lo borraron mientras pensaba
  if (r.data.tokens !== undefined) setTokens(r.data.tokens);
  if (r.data.spent !== undefined) setSpent(r.data.spent);
  if (r.status === 402) return reject(wd, r.data.error || 'No te quedan tokens.');
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
  if (d.kind === 'user') return userSize();
  if (d.kind === 'expert') return expertSize();
  if (d.kind === 'journey') return journeySize(d);
  if (d.kind === 'file') return fileWidgetSize();
  if (d.kind === 'pro') return proSize();
  if (d.kind === 'finding') return findingSize();
  if (d.kind === 'label') return labelSize(d.style);
  if (d.kind === 'group') return groupSize();
  if (d.kind === 'nebula') return NEBULA_SIZE;
  if (d.kind === 'number') return { w: 7, h: 6 };
  if (d.kind === 'text') {
    const n = d.value.length;
    return n > 300 ? { w: 12, h: 9 } : n > 60 ? { w: 11, h: 7 } : { w: 9, h: 6 };
  }
  if (d.kind === 'chart' && d.chartType === 'pie') return { w: 14, h: 10 };
  if (d.kind === 'chart') return { w: clamp((d.labels?.length || 4) * 2 + 4, 10, 22), h: 9 };
  const cols = d.columns?.length || 1, rows = d.rows?.length || 1;
  return { w: clamp(cols * 5, 10, 28), h: clamp(Math.ceil(rows * 0.9) + 3, 5, 16) };
}

/* ============================================================
   Enfoque: el lienzo se mueve hasta dejar el widget al centro
   ============================================================ */

let panAnim = 0;
const focusOn = (wd) => focusAt(wd.x + wd.w / 2, wd.y + wd.h / 2);

/** Mueve el lienzo hasta dejar el punto (en celdas) al centro de la vista. */
function focusAt(cx, cy) {
  const tx = Math.round(board.clientWidth / 2 - cx * cell());
  const ty = Math.round(board.clientHeight / 2 - cy * cell());
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
  // con la flecha, arrastrar sobre el fondo selecciona (la mano, o Espacio apretado, mueve el lienzo)
  if (canEdit && toolMode === 'arrow' && !spaceDown && !e.target.closest('.widget')) return startMarquee(e);
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
  if (e.target.closest('.info-wrap')) return; // el bloque de información hace su propio scroll
  if (e.ctrlKey) { // pellizco en el trackpad / Ctrl + rueda: zoom hacia el puntero
    e.preventDefault();
    const b = board.getBoundingClientRect();
    setZoom(zoom * Math.exp(-e.deltaY * 0.01), { x: e.clientX - b.left, y: e.clientY - b.top });
    return;
  }
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
  pan.x = Math.round(w / 2 - ((minX + maxX) / 2) * cell());
  pan.y = Math.round(h / 2 - ((minY + maxY) / 2) * cell());
}

/* ============================================================
   Selección y widgets temporales
   ============================================================ */

let selected = null;
let multi = new Set(); // selección múltiple (2 o más); `selected` es la de uno solo

function select(wd) {
  if (multi.size) { for (const w of multi) w.el.classList.remove('is-selected'); multi = new Set(); }
  else if (selected === wd) return;
  selected?.el.classList.remove('is-selected');
  selected = wd;
  wd?.el.classList.add('is-selected');
  renderInfo();
}

/** Selecciona un grupo: con uno solo es la selección de siempre (con su bloque). */
function selectMany(list) {
  const set = new Set(list.filter((w) => w.state === 'done' && widgets.includes(w)));
  if (set.size <= 1) return select([...set][0] || null);
  selected?.el.classList.remove('is-selected');
  selected = null;
  for (const w of multi) if (!set.has(w)) w.el.classList.remove('is-selected');
  multi = set;
  for (const w of multi) w.el.classList.add('is-selected');
  renderInfo();
}

const selection = () => (multi.size ? [...multi] : selected ? [selected] : []);

/** Shift + clic: suma o quita un widget de la selección. */
function toggleSelected(wd) {
  const cur = selection();
  selectMany(cur.includes(wd) ? cur.filter((w) => w !== wd) : [...cur, wd]);
}

/* ---------- herramientas: flecha (seleccionar) y mano (mover el lienzo) ---------- */

const MODE_KEY = 'fm-tool-mode';
let toolMode = 'arrow';
try { if (localStorage.getItem(MODE_KEY) === 'hand') toolMode = 'hand'; } catch { /* sin almacenamiento */ }
let spaceDown = false;

function setToolMode(m) {
  toolMode = m;
  try { localStorage.setItem(MODE_KEY, m); } catch { /* sin almacenamiento */ }
  paintToolMode();
}
function paintToolMode() {
  const hand = !canEdit || toolMode === 'hand' || spaceDown;
  board.classList.toggle('mode-arrow', !hand);
  document.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === toolMode)));
}

const typing = (e) => e.target.closest?.('input, textarea, select, [contenteditable="true"]');
document.addEventListener('keydown', (e) => {
  if (!canEdit || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'v' || e.key === 'V') setToolMode('arrow');
  else if (e.key === 'h' || e.key === 'H') setToolMode('hand');
  else if (e.code === 'Space' && !spaceDown) { spaceDown = true; paintToolMode(); e.preventDefault(); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && selection().length) { e.preventDefault(); removeMany(selection()); }
});
document.addEventListener('keydown', (e) => {
  // Cmd/Ctrl + A: todos
  if (canEdit && !typing(e) && (e.metaKey || e.ctrlKey) && (e.key === 'a' || e.key === 'A')) { e.preventDefault(); selectMany(widgets); }
});
document.addEventListener('keyup', (e) => { if (e.code === 'Space' && spaceDown) { spaceDown = false; paintToolMode(); } });
window.addEventListener('blur', () => { if (spaceDown) { spaceDown = false; paintToolMode(); } });

/** Recuadro de selección: arrastrar sobre el fondo con la flecha. */
function startMarquee(e) {
  e.preventDefault();
  board.setPointerCapture(e.pointerId);
  const b = board.getBoundingClientRect();
  const x0 = e.clientX - b.left, y0 = e.clientY - b.top;
  const base = e.shiftKey ? selection() : [];
  const box = document.createElement('div');
  box.className = 'marquee';
  let moved = false;

  // del lugar donde se ve (con lente) a celdas del mundo
  const toCell = (cx, cy) => {
    const p = sourcePoint(cx, cy);
    return { x: (p.x - b.left - pan.x) / cell(), y: (p.y - b.top - pan.y) / cell() };
  };
  const onMove = (ev) => {
    const x1 = ev.clientX - b.left, y1 = ev.clientY - b.top;
    if (!moved) {
      if (Math.hypot(x1 - x0, y1 - y0) < 4) return;
      moved = true;
      board.append(box);
    }
    Object.assign(box.style, {
      left: `${Math.min(x0, x1)}px`, top: `${Math.min(y0, y1)}px`,
      width: `${Math.abs(x1 - x0)}px`, height: `${Math.abs(y1 - y0)}px`,
    });
    const a = toCell(b.left + Math.min(x0, x1), b.top + Math.min(y0, y1));
    const z = toCell(b.left + Math.max(x0, x1), b.top + Math.max(y0, y1));
    const hit = widgets.filter((w) => w.state === 'done' && (isGroup(w)
      ? w.x >= a.x && w.y >= a.y && w.x + w.w <= z.x && w.y + w.h <= z.y
      : w.x < z.x && w.x + w.w > a.x && w.y < z.y && w.y + w.h > a.y));
    selectMany([...new Set([...base, ...hit])]);
  };
  const onUp = () => {
    box.remove();
    board.removeEventListener('pointermove', onMove);
    board.removeEventListener('pointerup', onUp);
    board.removeEventListener('pointercancel', onUp);
  };
  board.addEventListener('pointermove', onMove);
  board.addEventListener('pointerup', onUp);
  board.addEventListener('pointercancel', onUp);
}

/** Borra varios (Supr / Retroceso, o el botón del bloque). */
async function removeMany(list) {
  list = list.filter((w) => w.state === 'done');
  if (!list.length) return;
  if (list.length === 1) return removeWidget(list[0]);
  if (!confirm(`¿Borrar ${list.length} widgets?`)) return;
  const results = await Promise.all(list.map((w) => api(`/api/dash?d=${encodeURIComponent(id)}&widget=${encodeURIComponent(w.id)}`, { method: 'DELETE' })));
  select(null);
  list.forEach((w, i) => { if (results[i].ok) unmount(w); });
  if (results.some((r) => !r.ok)) alert('Algunos widgets no se pudieron borrar.');
}

/* bloque de información cuando hay varios seleccionados */
function renderMultiInfo(box) {
  $('info-kind').textContent = 'Selección';
  $('info-title').hidden = false;
  $('info-title').textContent = `${multi.size} widgets`;
  const list = $('info-list');
  list.innerHTML = '';
  const ul = document.createElement('ul');
  ul.className = 'sel-list';
  for (const w of multi) {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><small></small>';
    li.querySelector('span').textContent = w.data?.title || w.data?.name || 'Widget';
    li.querySelector('small').textContent = TOOL_LABEL[w.type] || '';
    ul.append(li);
  }
  list.append(ul);
  const hint = document.createElement('p');
  hint.className = 'sel-hint';
  hint.textContent = 'Arrastra cualquiera para moverlos juntos. Shift + clic suma o quita uno.';
  list.append(hint);
  if (canEdit) {
    const grp = document.createElement('button');
    grp.type = 'button';
    grp.className = 'btn sel-group';
    grp.textContent = 'Agrupar';
    grp.addEventListener('click', () => groupSelection([...multi]));
    list.append(grp);
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn sel-del';
    del.textContent = `Borrar ${multi.size}`;
    del.addEventListener('click', () => removeMany([...multi]));
    list.append(del);
  }
  box.hidden = false;
  if (box.dataset.for !== 'multi') {
    box.dataset.for = 'multi';
    box.classList.remove('is-in'); void box.offsetWidth; box.classList.add('is-in');
  }
}

/* Cada toque: qué hay debajo (con la lente, lo que se ve ahí), para
   seleccionar y para borrar los borradores que quedaron sin crear. */
document.addEventListener('pointerdown', (e) => {
  if (!e.isTrusted || e.button > 0) return;
  let el = e.target;
  if (routing && board.contains(el) && !el.closest('.info-wrap')) el = hitAt(e.clientX, e.clientY) || el;
  const wEl = el.closest?.('.widget');
  const wd = wEl ? widgets.find((w) => w.el === wEl) : null;

  if (el.closest?.('.view-tools')) return; // zoom y banderas no cambian nada más

  // temporales: sin crear, se van al tocar otra zona (el + de otro widget no cuenta)
  if (!el.closest?.('.wport--out')) {
    for (const d of widgets.filter((w) => w.state === 'draft' && w !== wd)) unmount(d);
  }

  if (el.closest?.('.wport')) return; // conectar no selecciona ni deselecciona
  if (wd?.state === 'done') {
    if (e.shiftKey && canEdit) toggleSelected(wd);
    else if (!multi.has(wd)) select(wd); // tocar uno del grupo no lo deshace: así se arrastran juntos
  } else if (!el.closest?.('.info-wrap, .dock, .board-top') && !(e.shiftKey && canEdit)) select(null);
}, true);

document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && (selected || multi.size) && !jiggling) select(null); });
$('info-x').addEventListener('click', () => select(null));

/* ---------- bloque de información del seleccionado ---------- */

const KIND_LABEL = { table: 'Tabla', chart: 'Gráfico', number: 'Número', text: 'Texto' };
const TOOL_LABEL = { table: 'Tabla con IA', ask: 'Pregúntale a la IA', timeline: 'Línea de tiempo', user: 'Usuario', expert: 'Celebridad', journey: 'User journey', file: 'Archivo', pro: 'Profesional', finding: 'Hallazgo', label: 'Texto', group: 'Grupo', nebula: 'Nebulosa de IA' };

/** Muestra el bloque; la animación de entrada solo cuando cambia de widget
    (editarlo no lo "recarga"). */
function showInfo(box) {
  box.hidden = false;
  if (box.dataset.for === selected.id) return;
  box.dataset.for = selected.id;
  box.classList.remove('is-in');
  void box.offsetWidth; // reinicia la animación de entrada
  box.classList.add('is-in');
}

function renderInfo() {
  const box = $('info');
  if (!selected && multi.size > 1) return renderMultiInfo(box);
  if (!selected) { box.hidden = true; delete box.dataset.for; return; }
  const d = selected.data || {};
  $('info-title').hidden = false;
  if (d.kind === 'timeline') return renderTimelineInfo(box);
  if (d.kind === 'user') return renderUserInfo(box);
  if (d.kind === 'expert') return renderExpertInfo(box);
  if (d.kind === 'journey') return renderJourneyInfo(box);
  if (d.kind === 'file') return renderFileInfo(box);
  if (d.kind === 'label') return renderLabelInfo(box);
  if (d.kind === 'group') return renderGroupInfo(box);
  if (d.kind === 'pro') return renderProInfo(box);
  if (d.kind === 'finding') return renderFindingInfo(box);
  const rows = [];
  const add = (label, value) => { if (value) rows.push(`<dt>${esc(label)}</dt><dd>${esc(value)}</dd>`); };
  add('Pregunta', d.prompt);
  add('Archivo', d.source);
  if (d.voices?.length) add('Con la mirada de', d.voices.join(' · '));
  if (d.kind === 'nebula') add('Qué es', 'Una nebulosa de IA. Todavía no hace nada más que verse.');
  const ctx = (selected.inputs || []).map((i) => byId(i)?.data?.title).filter(Boolean);
  add(ctx.length === 1 ? 'Conectado' : 'Conectados', ctx.join(' · '));
  if (d.kind === 'table') add('Tamaño', `${d.rows?.length || 0} filas × ${d.columns?.length || 0} columnas`);
  if (d.kind === 'chart') add('Datos', `${d.labels?.length || 0} valores${d.unit ? ` · ${d.unit}` : ''}`);
  add('Nota', d.cut ? 'Se guardaron solo las primeras filas.' : d.truncated ? 'Se usaron las primeras líneas del archivo (era muy grande).' : '');
  if (!d.prompt && !d.source && d.kind !== 'nebula') add('Origen', 'Sin datos de origen guardados.');

  $('info-kind').textContent = [TOOL_LABEL[selected.type], KIND_LABEL[d.kind]].filter(Boolean).join(' · ');
  $('info-title').textContent = d.title || 'Widget';
  $('info-list').innerHTML = rows.join('');
  showInfo(box);
}

/* ============================================================
   Línea de tiempo: crear y editar desde el bloque de información
   ============================================================ */

function createTimeline() {
  const data = defaultTimeline(todayISO());
  return createPlain('timeline', data, timelineSize(data.milestones.length));
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
  $('info-title').hidden = true; // no se repite el nombre: arriba ya dice línea de tiempo
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
    pick.querySelector('img').src = FACES[d.character].normal; // mismo panel: solo cambia la cara
    saveTimeline(wd);
  }));
  list.append(pick);

  // hitos, del más antiguo al más lejano
  const head = document.createElement('p');
  head.className = 'tl-head';
  head.textContent = 'Hitos';
  list.append(head);
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
    add.setAttribute('aria-label', 'Agregar hito');
    add.title = 'Agregar hito';
    add.innerHTML = '<span class="tl-plus" aria-hidden="true"></span>';
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

  showInfo(box);
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
   Zoom: 0,5× … 2× en escala logarítmica (la esfera al centro = 1×)
   ============================================================ */

const Z_MIN = 0.5, Z_MAX = 2, Z_STEP = 0.1; // el paso de −/+ es en posición del control (0…1)
const zoomRange = $('zoom-range');
const toZoom = (t) => Z_MIN * (Z_MAX / Z_MIN) ** t;
const toT = (z) => Math.log(z / Z_MIN) / Math.log(Z_MAX / Z_MIN);
const ZOOM_KEY = `fm-zoom:${id}`;

/** Cambia el zoom dejando fijo el punto `anchor` de la pantalla (por defecto, el centro). */
function setZoom(z, anchor) {
  const next = Math.min(Z_MAX, Math.max(Z_MIN, z));
  if (Math.abs(next - zoom) < 1e-4) return;
  const a = anchor || { x: board.clientWidth / 2, y: board.clientHeight / 2 };
  pan.x = a.x - (a.x - pan.x) * (next / zoom);
  pan.y = a.y - (a.y - pan.y) * (next / zoom);
  zoom = next;
  zoomRange.value = Math.round(toT(zoom) * 1000);
  try { localStorage.setItem(ZOOM_KEY, String(zoom)); } catch { /* sin almacenamiento */ }
  requestDraw();
}

zoomRange.addEventListener('input', () => setZoom(toZoom(zoomRange.value / 1000)));
document.querySelectorAll('.zoom-btn').forEach((b) => b.addEventListener('click', () => {
  setZoom(toZoom(Math.min(1, Math.max(0, toT(zoom) + Number(b.dataset.step) * Z_STEP))));
}));

/* el control va justo debajo de la cabecera, que cambia de alto según la pantalla */
new ResizeObserver(([e]) => {
  document.documentElement.style.setProperty('--head-h', `${Math.round(e.target.offsetHeight)}px`);
}).observe(document.querySelector('.board-top'));

/* ============================================================
   Usuario: tipo predefinido + archivos de contexto (subida simulada)
   ============================================================ */

/** Crea un widget sin IA (línea de tiempo, usuario) y lo deja seleccionado. */
async function createPlain(type, data, size) {
  select(null);
  const layout = freeSpot(size.w, size.h);
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&widget=${type}`, {
    method: 'POST', body: JSON.stringify({ data, layout }),
  });
  if (!r.ok) return alert(r.data.error || 'No se pudo crear el widget.');
  const wd = { ...r.data.widget, state: 'done', inputs: [] };
  widgets.push(wd);
  mount(wd, { isNew: true });
  refreshEmpty();
  focusOn(wd);
  select(wd); // abre su bloque para editarlo
  requestDraw();
}

const createUser = () => createPlain('user', defaultUser(), userSize());
const createExpert = () => createPlain('expert', defaultExpert(), expertSize());
const createJourney = () => createPlain('journey', emptyJourney(), journeySize({}));
const createFile = () => createPlain('file', emptyFile(), fileWidgetSize());
const createPro = (role) => createPlain('pro', newPro(role), proSize());
const createLabel = () => createPlain('label', newLabel(), labelSize('title'));
const createGroup = () => createPlain('group', newGroup(), groupSize());

/** «Agrupar»: un marco alrededor de lo seleccionado (con un poco de aire). */
async function groupSelection(list) {
  list = list.filter((w) => !isGroup(w));
  if (!list.length) return;
  const x = Math.min(...list.map((w) => w.x)) - 1, y = Math.min(...list.map((w) => w.y)) - 2;
  const layout = { x, y, w: Math.max(...list.map((w) => w.x + w.w)) + 1 - x, h: Math.max(...list.map((w) => w.y + w.h)) + 1 - y };
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&widget=group`, { method: 'POST', body: JSON.stringify({ data: newGroup(), layout }) });
  if (!r.ok) return alert(r.data.error || 'No se pudo agrupar.');
  const g = { ...r.data.widget, state: 'done', inputs: [] };
  widgets.push(g);
  mount(g, { isNew: true });
  select(g);
}

/* ---------- Texto y Grupo: se editan en su bloque ---------- */

function renderLabelInfo(box) {
  const wd = selected, d = wd.data;
  $('info-kind').textContent = 'Texto';
  $('info-title').hidden = true;
  const list = $('info-list');
  list.innerHTML = '';
  if (!canEdit) return showInfo(box);
  const ta = document.createElement('textarea');
  ta.className = 'jr-goal';
  ta.rows = 4;
  ta.maxLength = 600;
  ta.value = d.text;
  ta.addEventListener('input', () => { d.text = ta.value || ' '; saveData(wd); });
  list.append(ta);
  const seg = document.createElement('div');
  seg.className = 'us-sex lb-styles';
  seg.innerHTML = LABEL_STYLES.map((st) => `<button type="button" data-style="${st.id}">${st.name}</button>`).join('');
  const paint = () => seg.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === d.style)));
  seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { d.style = b.dataset.style; paint(); saveData(wd); }));
  paint();
  list.append(seg);
  showInfo(box);
  setTimeout(() => ta.focus({ preventScroll: true }), 60);
}

function renderGroupInfo(box) {
  const wd = selected, d = wd.data;
  $('info-kind').textContent = 'Grupo';
  $('info-title').hidden = true;
  const list = $('info-list');
  list.innerHTML = '';
  const n = insideOf(wd).length;
  if (canEdit) {
    const f = document.createElement('label');
    f.className = 'ex-field';
    f.innerHTML = '<span>Nombre</span><input maxlength="60">';
    const input = f.querySelector('input');
    input.value = d.title;
    input.addEventListener('input', () => { d.title = input.value.trim() || 'Grupo'; saveData(wd); });
    list.append(f);
    const colors = document.createElement('div');
    colors.className = 'gr-colors';
    colors.innerHTML = GROUP_COLORS.map((c) => `<button type="button" data-c="${c}" style="--c:${c}" aria-label="Color ${c}"></button>`).join('');
    const paint = () => colors.querySelectorAll('button').forEach((b) => b.classList.toggle('is-on', b.dataset.c === d.color));
    colors.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { d.color = b.dataset.c; paint(); saveData(wd); }));
    paint();
    list.append(colors);
  }
  const p = document.createElement('p');
  p.className = 'sel-hint';
  p.textContent = `${n} widget${n === 1 ? '' : 's'} adentro. Arrastra su nombre para mover el grupo con todo lo que tiene; desde la esquina lo agrandas.`;
  list.append(p);
  showInfo(box);
}

/* ============================================================
   Profesionales: el Researcher investiga y deja hallazgos
   ============================================================ */

/** n lugares libres en una columna a la derecha de src: se corre hacia la
    derecha hasta que la columna entera entra sin chocar (así los hallazgos
    quedan juntos y en orden). */
function slotsNear(src, n, size) {
  const y0 = src.y; // el primero a la altura del profesional (casi nunca llegan los 5)
  for (let r = 0; r < 80; r++) {
    const x = src.x + src.w + 3 + r * 2;
    const col = Array.from({ length: n }, (_, i) => ({ x, y: y0 + i * (size.h + 1), ...size }));
    if (!col.some((c) => collides(c))) return col;
  }
  return Array.from({ length: n }, (_, i) => freeSpot(size.w, size.h, { x: src.x + src.w + 3, y: src.y + i * (size.h + 1) }));
}

const RESEARCH_STEPS = ['Buscando en la web…', 'Leyendo fuentes…', 'Contrastando datos…', 'Ordenando hallazgos…'];

async function research(wd, question, btn, status) {
  if (!canAfford('research')) return flashBroke('research');
  question = question.trim();
  if (!question) { status.textContent = 'Escribe una pregunta.'; return; }
  const slots = slotsNear(wd, 5, findingSize());
  wd.researching = true;
  btn.disabled = true;
  wd.el.classList.add('is-glowing');
  render(wd);
  let step = 0;
  status.classList.remove('is-err');
  status.textContent = RESEARCH_STEPS[0];
  const ticker = setInterval(() => { step = Math.min(step + 1, RESEARCH_STEPS.length - 1); status.textContent = RESEARCH_STEPS[step]; }, 6000);
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&research=${encodeURIComponent(wd.id)}`, {
    method: 'POST', body: JSON.stringify({ question, slots }),
  });
  clearInterval(ticker);
  wd.researching = false;
  btn.disabled = false;
  wd.el.classList.remove('is-glowing');
  if (r.data.tokens !== undefined) setTokens(r.data.tokens);
  if (r.data.spent !== undefined) setSpent(r.data.spent);
  if (!r.ok) {
    render(wd);
    status.classList.add('is-err');
    status.textContent = r.data.error || 'No se pudo investigar.';
    return;
  }
  wd.data = r.data.pro;
  render(wd);
  for (const w of r.data.widgets) {
    const nw = { ...w, state: 'done', inputs: w.inputs || [] };
    widgets.push(nw);
    mount(nw, { isNew: true });
  }
  refreshEmpty();
  requestDraw();
  const n = r.data.widgets.length;
  if (selected === wd) renderInfo();
  const s = $('info-list').querySelector('.pro-status');
  if (s) s.textContent = n === 1 ? 'Listo: dejé un hallazgo en el mapa.' : `Listo: dejé ${n} hallazgos en el mapa.`;
  if (n) focusAt(...centerOf([wd, ...r.data.widgets]));
}

/** Centro (en celdas) de varios widgets, para enfocarlos juntos. */
function centerOf(list) {
  const minX = Math.min(...list.map((o) => o.x)), maxX = Math.max(...list.map((o) => o.x + o.w));
  const minY = Math.min(...list.map((o) => o.y)), maxY = Math.max(...list.map((o) => o.y + o.h));
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

function renderProInfo(box) {
  const wd = selected;
  const d = wd.data;
  const p = proOf(d.role);
  $('info-kind').textContent = `Profesional · ${p.name}`;
  $('info-title').hidden = true;
  const list = $('info-list');
  list.innerHTML = '';

  const top = document.createElement('div');
  top.className = 'pro-top';
  top.innerHTML = `<span class="us-av"></span><div><b></b><p></p></div>`;
  top.querySelector('.us-av').innerHTML = proAvatar(d);
  top.querySelector('b').textContent = d.name;
  top.querySelector('p').textContent = d.thought ? `«${d.thought}»` : p.note;
  list.append(top);

  if (canEdit) {
    const form = document.createElement('form');
    form.className = 'pro-ask';
    form.innerHTML = `<textarea rows="3" maxlength="300" placeholder="Ej.: ¿Qué soluciones parecidas existen para dividir gastos entre amigos?" aria-label="Pregunta"></textarea>
      <button type="submit" class="btn">Investigar${prices.research ? `<small title="Estimado de tokens">≈ ${nfTok.format(prices.research)} tk</small>` : ''}</button>
      <p class="pro-status" role="status"></p>`;
    const ta = form.querySelector('textarea'), btn = form.querySelector('button'), status = form.querySelector('.pro-status');
    if (wd.researching) { btn.disabled = true; status.textContent = 'Investigando…'; }
    form.addEventListener('submit', (e) => { e.preventDefault(); research(wd, ta.value, btn, status); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) form.requestSubmit(); });
    list.append(form);
    const hint = document.createElement('p');
    hint.className = 'ex-hint';
    hint.textContent = 'Busca en la web y cita sus fuentes. Si preguntas por varias cosas (soluciones, competidores, ejemplos) deja hasta 5 hallazgos; si no, uno con la respuesta. Conéctale widgets para que sepa de qué trata el proyecto.';
    list.append(hint);
    setTimeout(() => ta.focus({ preventScroll: true }), 60);
  }

  if (d.history?.length) {
    const h = document.createElement('p');
    h.className = 'tl-head pro-hist-head';
    h.textContent = 'Ya investigó';
    list.append(h);
    const ul = document.createElement('ul');
    ul.className = 'sel-list';
    for (const it of [...d.history].reverse()) {
      const li = document.createElement('li');
      li.innerHTML = '<span></span><small></small>';
      li.querySelector('span').textContent = it.q;
      li.querySelector('small').textContent = `${it.n} hallazgo${it.n === 1 ? '' : 's'}`;
      ul.append(li);
    }
    list.append(ul);
  }
  showInfo(box);
}

function renderFindingInfo(box) {
  const d = selected.data;
  $('info-kind').textContent = `Hallazgo · ${d.by || 'Researcher'}`;
  $('info-title').hidden = false;
  $('info-title').textContent = d.title;
  const list = $('info-list');
  list.innerHTML = '';
  const add = (label, node) => {
    const dt = document.createElement('dt'); dt.textContent = label;
    const dd = document.createElement('dd'); dd.append(node);
    list.append(dt, dd);
  };
  add('Pregunta', document.createTextNode(d.question || '—'));
  add('Resumen', document.createTextNode(d.summary));
  add('Confianza', document.createTextNode(d.confidence));
  const ul = document.createElement('ul');
  ul.className = 'pro-src';
  for (const s of d.sources || []) {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.href = s.url; a.target = '_blank'; a.rel = 'noopener noreferrer';
    a.textContent = s.title || s.url;
    li.append(a);
    ul.append(li);
  }
  add('Fuentes', ul);
  showInfo(box);
}

/* ============================================================
   Archivo: solo guarda información; con su + se le pregunta a la IA
   ============================================================ */

async function addFiles(wd, list, errEl) {
  const d = wd.data;
  const room = Math.min(textLeft(d), Infinity);
  const slots = MAX_FILES - d.files.length;
  const picked = [...list].slice(0, Math.max(0, slots));
  const { ok, skipped } = await readUploads(picked, room);
  skipped.push(...[...list].slice(picked.length).map((f) => f.name));
  if (ok.length) {
    d.files.push(...ok);
    if (d.title === 'Archivo') d.title = ok[0].name.replace(/\.[a-z0-9]+$/i, '').slice(0, 60);
    saveData(wd, 'No se pudo guardar el archivo.');
    if (selected === wd) renderInfo();
  }
  const msg = skipped.length ? `No se agregó: ${skipped.join(', ')} (solo CSV, Excel, JSON o texto; máx. ${MAX_FILES} archivos).` : '';
  // el bloque se pudo rearmar: el aviso va en el que se ve ahora
  const shown = selected === wd ? $('info-list').querySelector('.us-err') : errEl;
  if (shown) shown.textContent = msg; else if (msg) alert(msg);
}

/* arrastrar archivos encima de la tarjeta del widget */
board.addEventListener('dragover', (e) => {
  const w = e.target.closest?.('.widget');
  const wd = w && widgets.find((x) => x.el === w);
  if (canEdit && wd?.data?.kind === 'file' && e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); w.classList.add('is-drop'); }
});
board.addEventListener('dragleave', (e) => e.target.closest?.('.widget')?.classList.remove('is-drop'));
board.addEventListener('drop', (e) => {
  const w = e.target.closest?.('.widget');
  const wd = w && widgets.find((x) => x.el === w);
  if (!canEdit || wd?.data?.kind !== 'file') return;
  e.preventDefault();
  w.classList.remove('is-drop');
  addFiles(wd, e.dataTransfer.files);
});

function renderFileInfo(box) {
  const wd = selected;
  const d = wd.data;
  $('info-kind').textContent = 'Archivo';
  $('info-title').hidden = true;
  const list = $('info-list');
  list.innerHTML = '';

  if (canEdit) {
    const t = document.createElement('label');
    t.className = 'ex-field';
    t.innerHTML = '<span>Nombre</span><input maxlength="60">';
    const input = t.querySelector('input');
    input.value = d.title;
    input.addEventListener('input', () => { d.title = input.value.trim() || 'Archivo'; saveData(wd, 'No se pudo guardar.'); });
    list.append(t);
  }

  const head = document.createElement('p');
  head.className = 'tl-head';
  head.textContent = 'Archivos';
  list.append(head);
  const ul = document.createElement('ul');
  ul.className = 'us-files';
  for (const f of d.files) {
    const li = document.createElement('li');
    li.className = 'us-file';
    li.innerHTML = `<span class="us-kind">${f.type === 'xlsx' ? 'X' : f.type === 'csv' ? '▦' : f.type === 'json' ? '{}' : 'T'}</span><span class="us-fname"></span><small>${f.rows != null ? `${f.rows.toLocaleString('es')} filas` : fileSize(f.size)}</small>
      ${canEdit ? '<button type="button" class="tl-del" aria-label="Quitar archivo">×</button>' : ''}`;
    li.querySelector('.us-fname').textContent = f.name;
    li.querySelector('.tl-del')?.addEventListener('click', () => {
      d.files = d.files.filter((x) => x !== f);
      saveData(wd, 'No se pudo guardar.');
      renderInfo();
    });
    ul.append(li);
  }
  list.append(ul);
  if (!d.files.length && !canEdit) {
    const none = document.createElement('p');
    none.className = 'us-none';
    none.textContent = 'Sin archivos.';
    list.append(none);
  }

  if (canEdit && d.files.length < MAX_FILES) {
    const err = document.createElement('p');
    err.className = 'us-err';
    const drop = document.createElement('label');
    drop.className = 'us-drop';
    drop.innerHTML = `<b>Arrastra o sube archivos</b><small>CSV, Excel, JSON, TXT o Markdown</small><input type="file" multiple hidden accept="${ACCEPT}">`;
    drop.querySelector('input').addEventListener('change', (e) => { addFiles(wd, e.target.files, err); e.target.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('is-over'); addFiles(wd, e.dataTransfer.files, err); });
    list.append(drop, err);
  }

  const hint = document.createElement('p');
  hint.className = 'ex-hint wf-hint';
  hint.textContent = 'Toca su + para preguntarle a la IA. Puede responder con tablas o gráficos: «un pastel de ventas por región», «barras de clientes por mes».';
  list.append(hint);
  showInfo(box);
}

/** Usuarios conectados a un widget (para los paneles). */
const linkedUsers = (wd) => (wd.inputs || []).map(byId).filter((w) => w?.data?.kind === 'user').map((w) => fromLegacy(w.data));

/* ============================================================
   Panel User journey: objetivo + generar con los usuarios conectados
   ============================================================ */

async function generateJourney(wd, btn, errEl) {
  if (!canAfford('journey')) return flashBroke('journey');
  errEl.textContent = '';
  btn.disabled = true;
  wd.generating = true;
  wd.el.classList.add('is-glowing');
  render(wd);
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&journey=${encodeURIComponent(wd.id)}`, {
    method: 'POST', body: JSON.stringify({ goal: wd.data.goal || '' }),
  });
  wd.generating = false;
  wd.el.classList.remove('is-glowing');
  btn.disabled = false;
  if (r.data.tokens !== undefined) setTokens(r.data.tokens);
  if (r.data.spent !== undefined) setSpent(r.data.spent);
  if (!r.ok) { render(wd); errEl.textContent = r.data.error || 'No se pudo generar el journey.'; return; }
  wd.data = r.data.data;
  // crece para que entren todas las etapas
  const size = journeySize(wd.data);
  if (size.w !== wd.w || size.h !== wd.h) {
    const fits = !collides({ x: wd.x, y: wd.y, ...size }, wd.id);
    Object.assign(wd, fits ? { x: wd.x, y: wd.y, ...size } : freeSpot(size.w, size.h, { x: wd.x, y: wd.y }));
    saveLayout(wd);
  }
  render(wd);
  requestDraw();
  focusOn(wd);
  if (selected === wd) renderInfo();
}

function renderJourneyInfo(box) {
  const wd = selected;
  const d = wd.data;
  $('info-kind').textContent = 'Panel · User journey';
  $('info-title').hidden = true;
  const list = $('info-list');
  list.innerHTML = '';
  const users = linkedUsers(wd);

  const head = (t) => { const p = document.createElement('p'); p.className = 'tl-head'; p.textContent = t; list.append(p); };

  head('Objetivo');
  if (canEdit) {
    const goal = document.createElement('textarea');
    goal.className = 'jr-goal';
    goal.rows = 3;
    goal.maxLength = 300;
    goal.placeholder = 'Ej.: Contratar su primer seguro de auto por la web';
    goal.value = d.goal || '';
    goal.addEventListener('input', () => { d.goal = goal.value; saveData(wd, 'No se pudo guardar el objetivo.'); });
    list.append(goal);
  } else {
    const p = document.createElement('p');
    p.className = 'us-none';
    p.textContent = d.goal || 'Sin objetivo.';
    list.append(p);
  }

  head(users.length > 1 ? 'Usuarios (se promedian)' : 'Usuario');
  const who = document.createElement('div');
  who.className = 'jr-who';
  if (users.length) {
    for (const u of users) {
      const c = document.createElement('span');
      c.className = 'jr-who-u';
      c.innerHTML = `<span class="jr-av">${avatarSVG(u)}</span><b></b><small>${esc(ageLabel(u.age))}</small>`;
      c.querySelector('b').textContent = u.name;
      who.append(c);
    }
  } else {
    who.innerHTML = '<p class="us-none">Conecta uno o más usuarios: arrastra su + hasta el conector izquierdo del panel.</p>';
  }
  list.append(who);

  if (canEdit) {
    const err = document.createElement('p');
    err.className = 'us-err';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn jr-gen';
    btn.disabled = !users.length || wd.generating;
    btn.innerHTML = `${d.stages?.length ? 'Volver a generar' : 'Generar journey'}${prices.journey ? `<small title="Estimado de tokens">≈ ${nfTok.format(prices.journey)} tk</small>` : ''}`;
    btn.addEventListener('click', () => generateJourney(wd, btn, err));
    list.append(btn, err);
  }
  showInfo(box);
}

/* guardado con espera: los campos se editan letra por letra */
const dataSaveTimers = new Map();
function saveData(wd, failMsg = 'No se pudo guardar.') {
  render(wd);
  requestDraw();
  clearTimeout(dataSaveTimers.get(wd.id));
  dataSaveTimers.set(wd.id, setTimeout(async () => {
    const r = await api(`/api/dash?d=${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ widget: wd.id, data: wd.data }),
    });
    if (!r.ok) alert(r.data.error || failMsg);
  }, 300));
}

/* ============================================================
   Celebridad: elige una celebridad (o arma una) y cómo piensa
   ============================================================ */

function renderExpertInfo(box) {
  const wd = selected;
  const d = wd.data;
  $('info-kind').textContent = 'Celebridad';
  $('info-title').hidden = true;
  const list = $('info-list');
  list.innerHTML = '';

  // ‹ avatar › para cambiar de experto
  const pick = document.createElement('div');
  pick.className = 'tl-pick ex-pick';
  pick.innerHTML = `${canEdit ? '<button type="button" class="tl-arrow" data-step="-1" aria-label="Experto anterior">‹</button>' : ''}
    <figure><span class="us-av"></span><figcaption></figcaption></figure>
    ${canEdit ? '<button type="button" class="tl-arrow" data-step="1" aria-label="Experto siguiente">›</button>' : ''}`;
  const paintPick = () => {
    pick.querySelector('.us-av').innerHTML = expertAvatar(d);
    pick.querySelector('figcaption').textContent = d.preset === 'custom' ? 'Personalizado' : `Inspirado en ${expertOf(d.preset).name}`;
  };
  paintPick();
  list.append(pick);

  if (!canEdit) {
    const who = document.createElement('div');
    who.className = 'ex-read';
    who.innerHTML = '<b></b><small></small><p></p>';
    who.querySelector('b').textContent = d.name;
    who.querySelector('small').textContent = d.role;
    who.querySelector('p').textContent = d.prompt || 'Sin descripción.';
    list.append(who);
    return showInfo(box);
  }

  pick.querySelectorAll('.tl-arrow').forEach((b) => b.addEventListener('click', () => {
    const i = EXPERTS.findIndex((e) => e.id === d.preset);
    wd.data = fromPreset(EXPERTS[(i + Number(b.dataset.step) + EXPERTS.length) % EXPERTS.length].id);
    saveData(wd, 'No se pudo guardar la celebridad.');
    renderInfo(); // cambian todos los campos
  }));

  const field = (label, el) => {
    const f = document.createElement('label');
    f.className = 'ex-field';
    f.innerHTML = `<span>${label}</span>`;
    f.append(el);
    list.append(f);
    return el;
  };
  const input = (value, max, onInput) => {
    const i = document.createElement('input');
    i.maxLength = max;
    i.value = value;
    i.addEventListener('input', () => { onInput(i.value); saveData(wd, 'No se pudo guardar la celebridad.'); });
    return i;
  };
  field('Nombre', input(d.name, 40, (v) => { d.name = v.trim() || 'Celebridad'; }));
  field('Rol', input(d.role, 40, (v) => { d.role = v.trim() || 'Celebridad'; }));

  if (d.preset === 'custom') {
    const sex = document.createElement('div');
    sex.className = 'us-sex';
    sex.innerHTML = '<button type="button" data-sex="m">Hombre</button><button type="button" data-sex="f">Mujer</button>';
    const paintSex = () => sex.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sex === d.sex)));
    sex.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { d.sex = b.dataset.sex; paintSex(); paintPick(); saveData(wd); }));
    paintSex();
    list.append(sex);
    const age = document.createElement('input');
    age.type = 'range';
    age.min = 18; age.max = AGE_MAX; age.value = d.age;
    age.className = 'ex-age';
    age.setAttribute('aria-label', 'Edad');
    age.addEventListener('input', () => { d.age = Number(age.value); paintPick(); saveData(wd); });
    field(`Edad`, age);
  }

  const prompt = document.createElement('textarea');
  prompt.rows = 6;
  prompt.maxLength = 2000;
  prompt.placeholder = 'Ej.: Piensa como una diseñadora de servicios: empieza por el problema, cuestiona supuestos y propone prototipos rápidos.';
  prompt.value = d.prompt;
  prompt.addEventListener('input', () => { d.prompt = prompt.value; saveData(wd, 'No se pudo guardar la celebridad.'); });
  field('Cómo piensa y actúa', prompt);

  const hint = document.createElement('p');
  hint.className = 'ex-hint';
  hint.textContent = 'Conéctala a una pregunta o a una tabla (o usa su +): la IA responde con esta mirada.';
  list.append(hint);
  showInfo(box);
}

let userSaveTimer = 0;
function saveUser(wd) {
  render(wd);
  requestDraw();
  clearTimeout(userSaveTimer);
  userSaveTimer = setTimeout(async () => {
    const r = await api(`/api/dash?d=${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ widget: wd.id, data: wd.data }),
    });
    if (!r.ok) alert(r.data.error || 'No se pudo guardar el usuario.');
  }, 250);
}

/* Contexto del usuario: audios y textos. Los textos se leen y se guardan (la
   IA los usa); los audios por ahora solo nombre y tamaño (subida simulada). */
const TEXT_EXT = /\.(txt|md|markdown|csv|json|srt|vtt|html?|rtf)$/i;
const kindOfFile = (f) => (f.type.startsWith('audio/') ? 'audio'
  : f.type.startsWith('text/') || f.type === 'application/json' || TEXT_EXT.test(f.name) ? 'text' : null);

function addContext(wd, files, listEl, errEl) {
  const d = wd.data;
  const rejected = [];
  for (const f of [...files]) {
    if (d.context.length + (wd.uploading || 0) >= MAX_CONTEXT) { rejected.push(`${f.name} (máximo ${MAX_CONTEXT})`); continue; }
    const kind = kindOfFile(f);
    if (!kind) { rejected.push(f.name); continue; }
    const row = document.createElement('li');
    row.className = 'us-file is-uploading';
    row.innerHTML = `<span class="us-kind">${kind === 'audio' ? '♪' : 'T'}</span><span class="us-fname"></span><small>subiendo…</small><span class="us-bar"><i></i></span>`;
    row.querySelector('.us-fname').textContent = f.name;
    listEl.append(row);
    requestAnimationFrame(() => { row.querySelector('.us-bar i').style.width = '100%'; });
    wd.uploading = (wd.uploading || 0) + 1;
    const read = kind === 'text' ? f.text().then((t) => t.slice(0, MAX_TEXT)) : Promise.resolve(null);
    const wait = new Promise((r) => setTimeout(r, 700 + Math.random() * 400));
    Promise.all([read, wait]).then(([text]) => {
      d.context.push({ kind, name: f.name.slice(0, 120), size: f.size, ...(text != null ? { text } : {}) });
      // cuando terminan todos, se guarda y se rearma la lista (con sus botones ×)
      if (--wd.uploading === 0) {
        saveUser(wd);
        if (selected === wd) renderInfo();
      }
    }).catch(() => { wd.uploading--; row.remove(); });
  }
  if (errEl) errEl.textContent = rejected.length ? `Solo audio o texto: no se agregó ${rejected.join(', ')}.` : '';
}

/** Nota escrita o texto arrastrado (sin archivo). */
function addNote(wd, text) {
  const t = String(text || '').trim().slice(0, MAX_TEXT);
  if (!t || wd.data.context.length >= MAX_CONTEXT) return false;
  const name = t.split('\n')[0].slice(0, 60) + (t.length > 60 ? '…' : '');
  wd.data.context.push({ kind: 'text', name, size: new Blob([t]).size, text: t });
  saveUser(wd);
  renderInfo();
  return true;
}

function renderUserInfo(box) {
  const wd = selected;
  wd.data = fromLegacy(wd.data); // los de tipo fijo pasan al formato nuevo al abrirlos
  const d = wd.data;
  $('info-kind').textContent = 'Usuario';
  $('info-title').hidden = true; // el nombre va en su campo
  const list = $('info-list');
  list.innerHTML = '';

  // avatar grande + aleatorio
  const top = document.createElement('div');
  top.className = 'us-top';
  top.innerHTML = `<span class="us-av"></span>
    ${canEdit ? `<button type="button" class="us-dice" title="Usuario al azar" aria-label="Usuario al azar">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r="1.2" fill="currentColor"/><circle cx="15" cy="15" r="1.2" fill="currentColor"/><circle cx="15" cy="9" r="1.2" fill="currentColor"/><circle cx="9" cy="15" r="1.2" fill="currentColor"/></svg>
      Aleatorio</button>` : ''}`;
  list.append(top);
  const paintAvatar = () => { top.querySelector('.us-av').innerHTML = avatarSVG(d); };
  paintAvatar();

  if (canEdit) {
    // nombre
    const name = document.createElement('input');
    name.className = 'us-name';
    name.maxLength = 40;
    name.placeholder = 'Nombre';
    name.setAttribute('aria-label', 'Nombre del usuario');
    name.value = d.name;
    name.addEventListener('input', () => { d.name = name.value.trim().slice(0, 40) || 'Usuario'; saveUser(wd); });
    list.append(name);

    // sexo
    const sex = document.createElement('div');
    sex.className = 'us-sex';
    sex.setAttribute('role', 'radiogroup');
    sex.setAttribute('aria-label', 'Sexo');
    sex.innerHTML = '<button type="button" role="radio" data-sex="m">Hombre</button><button type="button" role="radio" data-sex="f">Mujer</button>';
    const paintSex = () => sex.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.sex === d.sex)));
    sex.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      d.sex = b.dataset.sex;
      d.name = nameForSex(d.name, d.sex);
      name.value = d.name;
      paintSex(); paintAvatar(); paintAge(); saveUser(wd);
    }));
    paintSex();
    list.append(sex);

    // edad: a la derecha envejece, a la izquierda rejuvenece
    const ageBox = document.createElement('label');
    ageBox.className = 'us-age';
    ageBox.innerHTML = `<span class="us-age-head"><span>Edad</span><b></b></span>
      <input type="range" min="0" max="${AGE_MAX}" step="1" aria-label="Edad">
      <span class="us-age-ends"><small>Bebé</small><small>Anciano</small></span>`;
    const range = ageBox.querySelector('input');
    range.value = d.age;
    const paintAge = () => {
      ageBox.querySelector('b').textContent = `${stageLabel(d.sex, d.age)} · ${ageLabel(d.age)}`;
      range.style.setProperty('--p', `${(d.age / AGE_MAX) * 100}%`);
    };
    range.addEventListener('input', () => { d.age = Number(range.value); paintAge(); paintAvatar(); saveUser(wd); });
    paintAge();
    list.append(ageBox);

    top.querySelector('.us-dice').addEventListener('click', () => {
      const r = randomUser(d.context);
      Object.assign(d, r);
      name.value = d.name;
      range.value = d.age;
      paintSex(); paintAge(); paintAvatar(); saveUser(wd);
    });
  } else {
    const who = document.createElement('p');
    who.className = 'us-who';
    who.innerHTML = '<b></b><small></small>';
    who.querySelector('b').textContent = d.name;
    who.querySelector('small').textContent = `${stageLabel(d.sex, d.age)} · ${ageLabel(d.age)}`;
    list.append(who);
  }

  // contexto: audios y textos
  const ch = document.createElement('p');
  ch.className = 'tl-head us-ctx-head';
  ch.textContent = 'Contexto';
  list.append(ch);
  const files = document.createElement('ul');
  files.className = 'us-files';
  for (const f of d.context) {
    const li = document.createElement('li');
    li.className = 'us-file';
    li.innerHTML = `<span class="us-kind">${f.kind === 'audio' ? '♪' : 'T'}</span><span class="us-fname"></span><small>${fileSize(f.size)}</small>
      ${canEdit ? '<button type="button" class="tl-del" aria-label="Quitar">×</button>' : ''}`;
    li.querySelector('.us-fname').textContent = f.name;
    if (f.text) li.title = f.text.slice(0, 400);
    li.querySelector('.tl-del')?.addEventListener('click', () => {
      d.context = d.context.filter((x) => x !== f);
      saveUser(wd);
      renderInfo();
    });
    files.append(li);
  }
  list.append(files);

  if (canEdit && d.context.length < MAX_CONTEXT) {
    const err = document.createElement('p');
    err.className = 'us-err';
    const drop = document.createElement('label');
    drop.className = 'us-drop';
    drop.innerHTML = `<b>Arrastra audio o texto</b><small>Archivos de audio, .txt, .md, .csv… o texto seleccionado</small>
      <input type="file" multiple hidden accept="audio/*,text/*,.txt,.md,.csv,.json,.srt,.vtt">`;
    drop.querySelector('input').addEventListener('change', (e) => { addContext(wd, e.target.files, files, err); e.target.value = ''; });
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('is-over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('is-over'));
    drop.addEventListener('drop', (e) => {
      e.preventDefault();
      drop.classList.remove('is-over');
      if (e.dataTransfer.files.length) addContext(wd, e.dataTransfer.files, files, err);
      else addNote(wd, e.dataTransfer.getData('text/plain'));
    });
    list.append(drop);

    // o escribirlo a mano
    const note = document.createElement('form');
    note.className = 'us-note';
    note.innerHTML = `<textarea rows="2" maxlength="${MAX_TEXT}" placeholder="O escribe una nota sobre este usuario…" aria-label="Nota"></textarea>
      <button type="submit" class="us-note-add">Agregar</button>`;
    const ta = note.querySelector('textarea');
    note.addEventListener('submit', (e) => { e.preventDefault(); addNote(wd, ta.value); });
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) note.requestSubmit(); });
    list.append(note, err);
  } else if (!d.context.length) {
    const none = document.createElement('p');
    none.className = 'us-none';
    none.textContent = 'Sin contexto todavía.';
    list.append(none);
  }

  showInfo(box);
}

/* ============================================================
   Tokens: saldo arriba, precio en cada herramienta de IA
   ============================================================ */

const canAfford = (tool) => tokens == null || tokens >= (prices[tool] || 0);

function setTokens(n) {
  tokens = n;
  refreshTokens();
}

function refreshTokens() {
  const el = $('dash-tokens');
  el.hidden = tokens == null;
  if (tokens != null) {
    el.textContent = `${nfTok.format(tokens)} tokens`;
    el.classList.toggle('is-low', Object.values(prices).some((p) => tokens < p));
  }
  for (const b of document.querySelectorAll('.tool[data-ai]')) {
    const tool = b.dataset.ai, ok = canAfford(tool), label = b.getAttribute('aria-label');
    b.classList.toggle('is-broke', !ok);
    b.removeAttribute('title'); // el costo lo muestra el tooltip (data-tip-ai)
    // el estimado se ve siempre, también sin límite de tokens
    let tag = b.querySelector('.tool-price');
    if (!prices[tool]) { tag?.remove(); continue; }
    if (!tag) { tag = document.createElement('span'); tag.className = 'tool-price'; b.append(tag); }
    tag.textContent = `≈${nfTok.format(prices[tool])}`;
  }
}

/** Tokens gastados en este dashboard (solo lo ven los amos). */
function setSpent(n) {
  const el = $('dash-spent');
  el.hidden = false;
  el.textContent = `${nfTok.format(n || 0)} tokens gastados`;
  el.title = 'Tokens que se gastaron en este dashboard con las herramientas de IA';
}

/** Aviso corto cuando no alcanzan los tokens. */
function flashBroke(tool) {
  const el = $('dash-tokens');
  el.classList.remove('is-shaking'); void el.offsetWidth; el.classList.add('is-shaking');
  alert(`No te alcanzan los tokens: esto cuesta ${nfTok.format(prices[tool] || 0)} y te quedan ${nfTok.format(tokens || 0)}. Pídele más al amo supremo.`);
}

/* ============================================================
   Dock
   ============================================================ */

const TOOLS = [
  { key: 'table', label: 'Tabla con IA', open: () => createDraft('table') },
  { key: 'ask', label: 'Pregúntale a la IA', open: () => createDraft('ask') },
  { key: 'timeline', label: 'Línea de tiempo', open: () => createTimeline() },
  { key: 'user', label: 'Usuario', open: () => createUser() },
  { key: 'expert', label: 'Celebridad', open: () => createExpert() },
  { key: 'file', label: 'Archivo', open: () => createFile() },
  { key: 'label', label: 'Texto', open: () => createLabel() },
  { key: 'group', label: 'Grupo', open: () => createGroup() },
  { key: 'pros', label: 'Profesionales', menu: 'pros' },
  { key: 'panels', label: 'Paneles', menu: 'panels' },
  { key: 'nebula', label: 'Nebulosa de IA', open: () => createPlain('nebula', { kind: 'nebula', title: 'Nebulosa de IA' }, NEBULA_SIZE) },
];
// profesionales: trabajan con la IA (el Researcher busca en la web)
const PRO_ITEMS = PROS.map((p) => ({ key: p.role, label: p.name, note: p.note, price: 'research', open: () => createPro(p.role) }));
// paneles: widgets más complejos (se abren desde su propio menú)
const PANELS = [
  { key: 'journey', label: 'User journey', note: 'Puntos de entrada y emociones de los usuarios conectados', open: () => createJourney() },
];
// dentro de la maleta: no son widgets
const KIT = [
  { key: 'flag', label: 'Bandera', open: () => placeFlag() },
  { key: 'divider', label: 'Raya divisoria', open: () => placeDivider() },
];
// los chismosos solo tienen un botón: actualizar toda la página
const VIEWER_TOOLS = [{ key: 'refresh', label: 'Actualizar', open: () => location.reload() }];

function renderDock() {
  const dock = $('dock');
  dock.hidden = false;
  dock.innerHTML = '';
  if (canEdit) {
    // flecha (seleccionar) y mano (mover el lienzo), antes de las herramientas
    const modes = document.createElement('div');
    modes.className = 'modes';
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', 'Herramienta');
    modes.innerHTML = `
      <button class="tool tool--mode" type="button" data-mode="arrow" aria-pressed="false" title="Flecha · seleccionar (V)" aria-label="Flecha: seleccionar">${TOOL_ICONS.arrow}</button>
      <button class="tool tool--mode" type="button" data-mode="hand" aria-pressed="false" title="Mano · mover el lienzo (H, o mantén Espacio)" aria-label="Mano: mover el lienzo">${TOOL_ICONS.hand}</button>`;
    modes.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => setToolMode(b.dataset.mode)));
    const sep0 = document.createElement('span');
    sep0.className = 'dock-sep';
    sep0.setAttribute('aria-hidden', 'true');
    dock.append(modes, sep0);
  }
  for (const t of canEdit ? TOOLS : VIEWER_TOOLS) {
    if (t.menu) { dock.append(dockMenu(t.menu)); continue; }
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'tool';
    b.title = t.label;
    b.setAttribute('aria-label', t.label);
    b.innerHTML = TOOL_ICONS[t.key];
    if (canEdit && AI_TOOLS[t.key]) {
      b.dataset.ai = AI_TOOLS[t.key];
      b.dataset.tipAi = AI_TOOLS[t.key];
      b.addEventListener('click', (e) => {
        if (canAfford(b.dataset.ai)) return t.open();
        e.stopImmediatePropagation();
        flashBroke(b.dataset.ai);
      });
    } else b.addEventListener('click', t.open);
    dock.append(b);
  }
  paintToolMode();
  if (!canEdit) return;
  refreshTokens();

  // separación + maleta (se ve distinta: abre más herramientas)
  const sep = document.createElement('span');
  sep.className = 'dock-sep';
  sep.setAttribute('aria-hidden', 'true');
  const kit = document.createElement('div');
  kit.className = 'kit';
  kit.innerHTML = `
    <button class="tool tool--kit" id="kit-btn" type="button" title="Maleta" aria-label="Maleta" aria-haspopup="true" aria-expanded="false" aria-controls="kit-menu">${TOOL_ICONS.kit}</button>
    <div class="kit-menu" id="kit-menu" role="menu" hidden>
      ${KIT.map((t) => `<button class="tool tool--${t.key}" type="button" role="menuitem" data-kit="${t.key}" title="${t.label}" aria-label="${t.label}">${TOOL_ICONS[t.key]}</button>`).join('')}
    </div>`;
  kit.querySelector('#kit-btn').addEventListener('click', () => toggleKit($('kit-menu').hidden));
  for (const t of KIT) {
    kit.querySelector(`[data-kit="${t.key}"]`).addEventListener('click', () => { toggleKit(false); t.open(); });
  }
  dock.append(sep, kit);
  refreshKit();
}

/** Botón del dock que abre una lista con nombre y para qué sirve cada cosa
    (Profesionales, Paneles). El estimado de tokens va a la derecha. */
const DOCK_MENUS = {
  pros: { label: 'Profesionales', icon: 'pros', items: () => PRO_ITEMS },
  panels: { label: 'Paneles', icon: 'panels', items: () => PANELS },
};
function dockMenu(key) {
  const m = DOCK_MENUS[key];
  const items = m.items();
  const wrap = document.createElement('div');
  wrap.className = `kit dock-menu dock-menu--${key}`;
  wrap.innerHTML = `
    <button class="tool" type="button" title="${m.label}" aria-label="${m.label}" aria-haspopup="true" aria-expanded="false">${TOOL_ICONS[m.icon]}</button>
    <div class="kit-menu panels-menu" role="menu" hidden>
      <p class="panels-title">${m.label}</p>
      ${items.map((p) => {
        const price = prices[p.price || p.key];
        return `<button class="panel-item" type="button" role="menuitem" data-item="${p.key}">
        <span class="panel-ico">${TOOL_ICONS[p.key] || TOOL_ICONS[m.icon]}</span><span><b>${esc(p.label)}</b><small>${esc(p.note)}</small></span>
        ${price ? `<em title="Estimado de tokens${p.price ? ' por pregunta' : ''}">≈ ${nfTok.format(price)} tk</em>` : ''}</button>`;
      }).join('')}
    </div>`;
  const btn = wrap.querySelector('.tool'), menu = wrap.querySelector('.kit-menu');
  const toggle = (open) => { menu.hidden = !open; btn.setAttribute('aria-expanded', String(open)); };
  btn.addEventListener('click', () => toggle(menu.hidden));
  for (const p of items) wrap.querySelector(`[data-item="${p.key}"]`).addEventListener('click', () => { toggle(false); p.open(); });
  document.addEventListener('pointerdown', (e) => { if (!wrap.contains(e.target)) toggle(false); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggle(false); });
  return wrap;
}

function toggleKit(open) {
  const menu = $('kit-menu');
  if (!menu) return;
  menu.hidden = !open;
  $('kit-btn').setAttribute('aria-expanded', String(open));
}
document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.kit')) toggleKit(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleKit(false); });

/** Bandera: sin colores libres no se puede. Raya: solo una. */
function refreshKit() {
  const flag = document.querySelector('[data-kit="flag"]');
  const line = document.querySelector('[data-kit="divider"]');
  if (!flag) return;
  const full = marks.flags.length >= FLAG_MAX;
  flag.disabled = full;
  flag.title = full ? `Ya hay ${FLAG_MAX} banderas` : 'Bandera';
  line.disabled = !!marks.divider;
  line.title = marks.divider ? 'Ya hay una raya divisoria' : 'Raya divisoria';
}

/* ============================================================
   Banderas y raya divisoria (no son widgets: sin tarjeta ni bloque)
   ============================================================ */

const FLAG_MAX = 8;
const FLAG_NAMES = {
  '#ff3b4f': 'Roja', '#ff9f1c': 'Naranja', '#ffd60a': 'Amarilla', '#2ecc71': 'Verde',
  '#22d3ee': 'Celeste', '#3b82f6': 'Azul', '#a855f7': 'Morada', '#ff5fa2': 'Rosada',
};
const flagName = (f) => `Bandera ${(FLAG_NAMES[f.color] || '').toLowerCase()}`.trim();
let marks = { flags: [], divider: null };
const marksEl = document.createElement('div');
marksEl.className = 'marks';
world.prepend(marksEl); // debajo de los widgets (las banderas suben con z-index)

const DEL_BTN = (label) => `<button class="wx" type="button" aria-label="${esc(label)}">
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" aria-hidden="true"><path d="M6 12h12"/></svg></button>`;

function renderMarks({ fresh } = {}) {
  marksEl.innerHTML = '';
  if (marks.divider) {
    const d = document.createElement('div');
    d.className = 'mark-divider';
    d.style.left = `${marks.divider.x * GRID}px`;
    if (canEdit) {
      d.innerHTML = DEL_BTN('Quitar la raya divisoria');
      d.querySelector('.wx').addEventListener('click', () => removeMark('divider'));
    }
    marksEl.append(d);
    placeDividerX();
  }
  for (const f of marks.flags) {
    const el = document.createElement('div');
    el.className = `mark-flag${f.id === fresh ? ' is-new' : ''}`;
    el.style.cssText = `left:${f.x * GRID}px;top:${f.y * GRID}px;--flag:${f.color}`;
    el.dataset.tip = flagName(f);
    el.innerHTML = TOOL_ICONS.flag + (canEdit ? DEL_BTN(`Quitar ${flagName(f).toLowerCase()}`) : '');
    el.querySelector('.wx')?.addEventListener('click', () => removeMark(f.id));
    marksEl.append(el);
  }
  renderFlagsMenu();
  refreshKit();
}

/* el botón rojo de la raya va a la altura del centro de la vista */
function placeDividerX() {
  const wx = marksEl.querySelector('.mark-divider .wx');
  if (wx) wx.style.top = `${50000 + (board.clientHeight / 2 - pan.y) / zoom - 13}px`;
}

/** Punto de la rejilla al centro de la vista, en celdas. */
const viewCenter = () => ({
  x: Math.round((board.clientWidth / 2 - pan.x) / cell()),
  y: Math.round((board.clientHeight / 2 - pan.y) / cell()),
});

async function placeFlag() {
  if (marks.flags.length >= FLAG_MAX) return;
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&mark=flag`, { method: 'POST', body: JSON.stringify(viewCenter()) });
  if (!r.ok) return alert(r.data.error || 'No se pudo poner la bandera.');
  marks.flags.push(r.data.flag);
  renderMarks({ fresh: r.data.flag.id });
  requestDraw();
}

async function placeDivider() {
  if (marks.divider) return;
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&mark=divider`, { method: 'POST', body: '{}' });
  if (!r.ok) return alert(r.data.error || 'No se pudo poner la raya.');
  marks.divider = r.data.divider;
  renderMarks();
  requestDraw();
}

async function removeMark(markId) {
  const what = markId === 'divider' ? 'la raya divisoria' : flagName(marks.flags.find((f) => f.id === markId) || {}).toLowerCase();
  if (!confirm(`¿Quitar ${what}?`)) return;
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&mark=${encodeURIComponent(markId)}`, { method: 'DELETE' });
  if (!r.ok) return alert(r.data.error || 'No se pudo quitar.');
  if (markId === 'divider') marks.divider = null;
  else marks.flags = marks.flags.filter((f) => f.id !== markId);
  renderMarks();
  requestDraw();
}

/* ---------- listado de banderas (junto al zoom) ---------- */

function renderFlagsMenu() {
  const box = $('flags');
  box.hidden = !marks.flags.length;
  if (!marks.flags.length) { toggleFlags(false); return; }
  const btn = $('flags-btn');
  btn.innerHTML = TOOL_ICONS.flag;
  btn.style.setProperty('--flag', marks.flags[marks.flags.length - 1].color);
  const list = $('flags-list');
  list.innerHTML = marks.flags.map((f) => `<li><button type="button" data-flag="${esc(f.id)}" style="color:${f.color}">
    ${TOOL_ICONS.flag}<span style="color:#f2f2f4">${esc(flagName(f))}</span></button></li>`).join('');
  list.querySelectorAll('[data-flag]').forEach((b) => b.addEventListener('click', () => {
    const f = marks.flags.find((x) => x.id === b.dataset.flag);
    toggleFlags(false);
    if (f) focusAt(f.x, f.y);
  }));
}

function toggleFlags(open) {
  $('flags-list').hidden = !open;
  $('flags-btn').setAttribute('aria-expanded', String(open));
}
$('flags-btn').addEventListener('click', () => toggleFlags($('flags-list').hidden));
document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.flags')) toggleFlags(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') toggleFlags(false); });

/* ============================================================
   Nebulosa de IA (por ahora solo se ve: nube que gira y estrellas)
   ============================================================ */

const NEBULA_SIZE = { w: 8, h: 7 };

function nebulaHTML(wd) {
  // estrellas fijas por widget (salen del id), para que no salten al redibujar
  let seed = [...String(wd.id)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
  const rnd = () => ((seed = (seed * 1103515245 + 12345) >>> 0) / 2 ** 32);
  const stars = Array.from({ length: 18 }, () => `<i style="left:${(rnd() * 100).toFixed(1)}%;top:${(rnd() * 100).toFixed(1)}%;animation-delay:${(-rnd() * 3).toFixed(2)}s"></i>`).join('');
  return `<div class="wneb" role="img" aria-label="Nebulosa de IA">
    <span class="wneb-cloud"></span><span class="wneb-cloud"></span>
    <span class="wneb-stars">${stars}</span>
    <b>Nebulosa de IA</b>
  </div>`;
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

/* porciones del pastel: colores que se distinguen entre sí sobre fondo oscuro */
const PIE_COLORS = ['#ff3b4f', '#ff9f1c', '#ffd60a', '#2ecc71', '#22d3ee', '#3b82f6', '#a855f7', '#ff5fa2', '#8a8a96'];

/** Pastel (dona) con su leyenda: etiqueta, valor y porcentaje. */
function drawPie(host, d, W, H) {
  const total = d.values.reduce((a, v) => a + v, 0) || 1;
  const legendW = W > 300 ? Math.min(220, W * 0.45) : 0;
  const size = Math.min(W - legendW - 16, H - 12);
  const R = size / 2, r = R * 0.58, cx = 8 + R, cy = H / 2;
  let a0 = -Math.PI / 2;
  const slices = d.values.map((v, i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    const big = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad, ang) => `${(cx + rad * Math.cos(ang)).toFixed(2)},${(cy + rad * Math.sin(ang)).toFixed(2)}`;
    // una sola porción: dos medias vueltas (un arco de 360° no se dibuja)
    const path = d.values.length === 1
      ? `M${p(R, -Math.PI / 2)}A${R},${R} 0 1 1 ${p(R, Math.PI / 2)}A${R},${R} 0 1 1 ${p(R, -Math.PI / 2)}M${p(r, -Math.PI / 2)}A${r},${r} 0 1 0 ${p(r, Math.PI / 2)}A${r},${r} 0 1 0 ${p(r, -Math.PI / 2)}Z`
      : `M${p(R, a0)}A${R},${R} 0 ${big} 1 ${p(R, a1)}L${p(r, a1)}A${r},${r} 0 ${big} 0 ${p(r, a0)}Z`;
    a0 = a1;
    const pct = (v / total) * 100;
    const tip = esc(`${d.labels[i]}: ${fmt(v)}${d.unit ? ` ${d.unit}` : ''} (${pct.toLocaleString('es', { maximumFractionDigits: 1 })}%)`);
    return `<path class="c-slice" d="${path}" fill="${PIE_COLORS[i % PIE_COLORS.length]}" fill-rule="evenodd" data-tip="${tip}"/>`;
  }).join('');
  const legend = legendW ? d.labels.map((l, i) => {
    const pct = (d.values[i] / total) * 100;
    return `<li><i style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></i><span>${esc(l)}</span><b>${pct.toLocaleString('es', { maximumFractionDigits: 1 })}%</b></li>`;
  }).join('') : '';
  host.innerHTML = `<div class="c-pie">
    <svg width="${size + 16}" height="${H}" viewBox="0 0 ${size + 16} ${H}" aria-hidden="true">${slices}
      <text class="c-pie-total" x="${cx}" y="${cy + 2}" text-anchor="middle">${esc(fmt(total))}</text>
      ${d.unit ? `<text class="c-pie-unit" x="${cx}" y="${cy + 16}" text-anchor="middle">${esc(d.unit)}</text>` : ''}
    </svg>
    ${legend ? `<ul class="c-legend">${legend}</ul>` : ''}
  </div>`;
}

function drawChart(host, d) {
  const W = host.clientWidth, H = host.clientHeight;
  if (W < 40 || H < 40) return;
  if (d.chartType === 'pie') return drawPie(host, d, W, H);
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

/* ---------- tooltip compartido: cualquier elemento con data-tip ----------
   data-tip-ai="<herramienta>": el tooltip se arma al mostrarse, con el
   costo en tokens y, en letra chica, cuánto te quedaría después. */
function aiTip(t) {
  const tool = t.dataset.tipAi;
  const price = prices[tool] || 0;
  const label = t.dataset.tipLabel || t.getAttribute('aria-label') || '';
  let sub, cls = '';
  if (tokens == null) sub = 'Estimado · no tienes límite de tokens';
  else if (tokens >= price) sub = `Te quedarían ${nfTok.format(tokens - price)} tokens`;
  else { sub = `Te faltan ${nfTok.format(price - tokens)} tokens · tienes ${nfTok.format(tokens)}`; cls = ' is-broke'; }
  tipEl.innerHTML = `<span class="tip-ai${cls}"><span class="tip-ai-main"></span><b>≈ ${nfTok.format(price)} tokens</b><small></small></span>`;
  tipEl.querySelector('.tip-ai-main').textContent = label;
  tipEl.querySelector('small').textContent = sub;
}

const tipEl = $('tip');
function showTip(el, cx, cy) {
  const t = el?.closest?.('[data-tip], [data-tip-ai]');
  if (!t) { tipEl.hidden = true; return; }
  if (t.dataset.tipAi) aiTip(t); else tipEl.textContent = t.dataset.tip;
  tipEl.classList.toggle('tip--light', t.hasAttribute('data-tip-light'));
  tipEl.hidden = false;
  const pad = 14, w = tipEl.offsetWidth, h = tipEl.offsetHeight;
  const x = Math.min(innerWidth - w - 8, cx + pad);
  const yy = cy - h - pad < 8 ? cy + pad : cy - h - pad;
  tipEl.style.transform = `translate(${x}px, ${yy}px)`;
}
// fuera del lienzo (dock, cabecera) el navegador sabe qué hay bajo el puntero aunque haya lente
document.addEventListener('pointermove', (e) => { if (!routing || !board.contains(e.target)) showTip(e.target, e.clientX, e.clientY); });
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
const PORT_REACH = 20; // px: a esta distancia del centro de un +, gana el +

/** El + (conector de salida) más cercano a (x, y) — en px reales, sin lente —
    si está al alcance. Tiene prioridad sobre lo que haya encima (el borde de una
    tarjeta vecina, etc.). El conector de entrada no cuenta: no se toca, solo
    recibe líneas (startLink tiene su propio imán para eso). */
function portNear(x, y) {
  if (!canEdit || jiggling) return null;
  let best = null, bestD = PORT_REACH;
  for (const port of world.querySelectorAll('.wport--out')) {
    if (port.closest('.is-thinking, .is-glowing')) continue;
    const r = port.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
    if (d < bestD) { best = port; bestD = d; }
  }
  return best;
}

const WX_REACH = 26; // px: en modo "tiemblan", a esta distancia gana el botón rojo

/** Botón rojo de borrar más cercano a (x, y) — px reales, sin lente — mientras
    los widgets tiemblan. Tiene prioridad sobre todo lo demás. */
function wxNear(x, y) {
  if (!jiggling) return null;
  let best = null, bestD = WX_REACH;
  for (const wx of world.querySelectorAll('.wx')) {
    const r = wx.getBoundingClientRect();
    const d = Math.hypot(r.left + r.width / 2 - x, r.top + r.height / 2 - y);
    if (d < bestD) { best = wx; bestD = d; }
  }
  return best;
}

function hitAt(cx, cy) {
  const p = sourcePoint(cx, cy);
  const wx = wxNear(p.x, p.y);
  if (wx) return wx;
  const port = portNear(p.x, p.y);
  if (port) return port;
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

/* Sin lente el navegador detecta solo, pero el botón rojo igual necesita
   prioridad: los widgets que tiemblan se tapan entre sí. */
board.addEventListener('pointerdown', (e) => {
  if (routing || !e.isTrusted || !wxNear(e.clientX, e.clientY)) return;
  e.stopPropagation(); // ni arrastre ni moverse por el lienzo: es para el botón
  e.preventDefault();
}, true);
board.addEventListener('click', (e) => {
  if (routing || !e.isTrusted) return;
  const wx = wxNear(e.clientX, e.clientY);
  if (!wx || e.target === wx) return;
  e.stopPropagation();
  e.preventDefault();
  wx.click();
}, true);

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

/* ============================================================
   ⋯ (amos): editar o eliminar el dashboard
   ============================================================ */

let dashInfo = null; // { id, name, image, icon, builtin } del dashboard abierto

function toggleDashMenu(open) {
  $('dash-menu-pop').hidden = !open;
  $('dash-menu-btn').setAttribute('aria-expanded', String(open));
  if (open) $('dash-edit').focus();
}
$('dash-menu-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleDashMenu($('dash-menu-pop').hidden); });
document.addEventListener('pointerdown', (e) => {
  if (!$('dash-menu-pop').hidden && !e.target.closest('.dash-menu')) toggleDashMenu(false);
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('dash-menu-pop').hidden) { toggleDashMenu(false); $('dash-menu-btn').focus(); }
});

/** Pinta título e ícono en la cabecera (al cargar y después de editar). */
function paintDashHead() {
  document.title = `${dashInfo.name} — fukudamiyasato`;
  $('dash-title').textContent = dashInfo.name;
  $('dash-ico').innerHTML = dashIconHTML(dashInfo);
}

/* editar: título + ícono */
let deImage = null;

function paintDeIcon() {
  $('de-icon-img').innerHTML = dashIconHTML({ name: $('de-title').value || '+', image: deImage, icon: dashInfo.icon });
  $('de-icon').classList.toggle('has-image', Boolean(deImage));
  $('de-icon-note').textContent = deImage ? 'Cambiar' : 'Subir ícono';
  $('de-clear').hidden = !deImage;
}

function openEditDash() {
  toggleDashMenu(false);
  deImage = dashInfo.image || null;
  $('de-title').value = dashInfo.name;
  $('de-err').textContent = '';
  $('de-file').value = '';
  $('de-form').className = 'modal nd-modal';
  paintDeIcon();
  $('de-layer').hidden = false;
  setTimeout(() => $('de-title').select(), 50);
}
const closeEditDash = () => { $('de-layer').hidden = true; };

$('dash-edit').addEventListener('click', openEditDash);
$('de-cancel').addEventListener('click', closeEditDash);
$('de-layer').addEventListener('pointerdown', (e) => { if (e.target === $('de-layer')) closeEditDash(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('de-layer').hidden) closeEditDash(); });
$('de-title').addEventListener('input', paintDeIcon);
$('de-clear').addEventListener('click', () => { deImage = null; $('de-file').value = ''; paintDeIcon(); });
$('de-file').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    deImage = await toIcon(file);
    $('de-err').textContent = '';
  } catch (err) {
    $('de-err').textContent = err.message;
  }
  paintDeIcon();
});

$('de-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('de-title').value.trim();
  const form = $('de-form');
  if (!name) {
    $('de-err').textContent = 'Ponle un título.';
    form.classList.remove('is-shaking'); void form.offsetWidth; form.classList.add('is-shaking');
    return;
  }
  $('de-save').disabled = true;
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name, image: deImage }) });
  $('de-save').disabled = false;
  if (!r.ok) { $('de-err').textContent = r.data.error || 'No se pudo guardar.'; return; }
  dashInfo = r.data.dashboard;
  paintDashHead();
  closeEditDash();
});

/* ---------- exportar / importar / plantillas ---------- */

/** Descarga los widgets como JSON (se pueden importar en otro dashboard). */
$('dash-export').addEventListener('click', () => {
  toggleDashMenu(false);
  const out = {
    version: 1,
    name: dashInfo.name,
    widgets: widgets.filter((w) => w.state === 'done')
      .map((w) => ({ id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, data: w.data, inputs: w.inputs || [] })),
  };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }));
  a.download = `${(dashInfo.name || 'dashboard').toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

async function importWidgets(json, label) {
  const list = Array.isArray(json?.widgets) ? json.widgets : [];
  if (!list.length) return alert('Ese archivo no tiene widgets.');
  if (!confirm(`¿Agregar ${list.length} widgets de «${label}» a este dashboard? Van a la derecha de lo que ya hay.`)) return;
  const r = await api(`/api/dash?d=${encodeURIComponent(id)}&import=1`, { method: 'POST', body: JSON.stringify({ widgets: list }) });
  if (!r.ok) return alert(r.data.error || 'No se pudo importar.');
  location.reload(); // carga todo con sus posiciones y conexiones
}

$('dash-import').addEventListener('click', () => {
  toggleDashMenu(false);
  const input = Object.assign(document.createElement('input'), { type: 'file', accept: '.json,application/json' });
  input.addEventListener('change', async () => {
    const f = input.files[0];
    if (!f) return;
    try { await importWidgets(JSON.parse(await f.text()), f.name); } catch { alert('No se pudo leer el archivo (debe ser un JSON exportado).'); }
  });
  input.click();
});

/** Plantillas del sitio (/templates/index.json): presentaciones listas para cargar. */
$('dash-templates').addEventListener('click', async () => {
  toggleDashMenu(false);
  let list = [];
  try { list = await (await fetch('/templates/index.json', { cache: 'no-store' })).json(); } catch { /* sin plantillas */ }
  if (!list.length) return alert('Todavía no hay plantillas.');
  const layer = document.createElement('div');
  layer.className = 'modal-layer';
  layer.innerHTML = `<div class="modal tp-modal" role="dialog" aria-label="Plantillas">
    <h2 class="cn-title">Plantillas</h2>
    <p class="cn-body">Se agregan a la derecha de lo que ya hay en este dashboard.</p>
    <div class="tp-list">${list.map((t, i) => `<button type="button" class="panel-item tp-item" data-i="${i}"><span><b>${esc(t.name)}</b><small>${esc(t.note || '')}</small></span><em>${t.count || ''}</em></button>`).join('')}</div>
    <div class="m-actions"><button class="link-btn" type="button" data-close>Cerrar</button></div>
  </div>`;
  const close = () => layer.remove();
  layer.addEventListener('pointerdown', (e) => { if (e.target === layer) close(); });
  layer.querySelector('[data-close]').addEventListener('click', close);
  layer.querySelectorAll('.tp-item').forEach((b) => b.addEventListener('click', async () => {
    const t = list[Number(b.dataset.i)];
    close();
    try { await importWidgets(await (await fetch(`/templates/${t.file}`, { cache: 'no-store' })).json(), t.name); } catch { alert('No se pudo cargar la plantilla.'); }
  }));
  document.body.append(layer);
});

/* eliminar */
$('dash-delete').addEventListener('click', async () => {
  toggleDashMenu(false);
  const yes = await confirmByName({
    name: dashInfo.name,
    title: `¿Eliminar «${dashInfo.name}»?`,
    body: 'Se borran el dashboard y todos sus widgets. No se puede deshacer.',
  });
  if (!yes) return;
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
  tokens = data.tokens ?? null;
  if (data.spent !== undefined) setSpent(data.spent);
  prices = data.prices || {};
  fisheye = (data.config?.fisheye ?? 7) / 100;
  document.body.classList.toggle('can-edit', canEdit);
  dashInfo = data.dashboard;
  paintDashHead();
  document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = user.email; });
  // con un solo dashboard no hay a dónde volver: /admin/ lo mandaría aquí mismo
  $('dash-back').hidden = !(canEdit || user.dashboards.length > 1);
  if (canEdit) setupMembers(data.members || 0);

  $('dash-menu').hidden = !canEdit;

  show('dash');
  renderDock();
  widgets = data.widgets.map((w) => ({ ...w, state: 'done', inputs: w.inputs || [] }));
  widgets.forEach((wd) => mount(wd));
  marks = { flags: data.marks?.flags || [], divider: data.marks?.divider || null };
  renderMarks();
  refreshEmpty();
  try {
    const saved = Number(localStorage.getItem(ZOOM_KEY));
    if (saved >= Z_MIN && saved <= Z_MAX) zoom = saved;
  } catch { /* sin almacenamiento */ }
  zoomRange.value = Math.round(toT(zoom) * 1000);
  frame();
  updateLens();
  draw(); // primer cuadro ya, sin esperar a requestAnimationFrame
})();
