/* ============================================================
   todo.js — carrusel de días, items, swipe y drag entre días
   ============================================================ */

import { CONFIG } from './config.js';
import { playDone, playFail, playTick } from './audio.js';

const STORE = 'fm.todo.v2';
const { daysBack, daysForward } = CONFIG.todo;

const $ = (id) => document.getElementById(id);
const daysEl   = $('days');
const listEl   = $('list');
const labelEl  = $('day-label');
const peopleEl = $('people');
const sheet    = $('sheet');
const sheetBg  = $('sheet-bg');
const textIn   = $('new-text');

/* ---------------- fechas ---------------- */
const keyOf = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const today = new Date();
today.setHours(0, 0, 0, 0);
const TODAY = keyOf(today);

const RANGE = Array.from({ length: daysBack + daysForward + 1 }, (_, i) => {
  const d = new Date(today);
  d.setDate(d.getDate() - daysBack + i);
  return d;
});

const WD = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/* ---------------- estado ---------------- */
const uid = () => Math.random().toString(36).slice(2, 10);

let items = load();
let people = [];                 // se llenan desde Airtable (todo_amos)
let activeDay = TODAY;
let pickedPerson = null;         // el responsable es opcional

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE));
    return Array.isArray(raw) ? raw.map(migrate) : seed();
  } catch {
    return seed();
  }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(items)); } catch { /* modo privado */ }
}

/* Los items viejos guardaban `done` booleano. */
function migrate(it) {
  if (!it.state) it.state = it.done ? 'done' : 'active';
  if (it.postponed == null) it.postponed = 0;
  if (!it.createdDate) it.createdDate = it.date;
  delete it.done;
  return it;
}

function seed() {
  const base = Date.now();
  return [
    { id: uid(), text: 'Revisar el brief del cliente', personId: null, date: TODAY,
      createdDate: TODAY, state: 'active', postponed: 0, createdAt: base },
    { id: uid(), text: 'Exportar íconos del sistema', personId: null, date: TODAY,
      createdDate: TODAY, state: 'active', postponed: 0, createdAt: base + 1 },
  ];
}

/* ============================================================
   Responsables — tabla todo_amos de Airtable
   ============================================================ */
const norm = (s) => String(s ?? '').trim().toLowerCase();

function pickField(fields, aliases) {
  const keys = Object.keys(fields);
  for (const a of aliases) {
    const hit = keys.find((k) => norm(k) === a);
    if (hit !== undefined) return fields[hit];
  }
  for (const a of aliases) {
    const hit = keys.find((k) => norm(k).includes(a));
    if (hit !== undefined) return fields[hit];
  }
  return undefined;
}

function truthy(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v > 0;
  return ['visible', 'true', 'yes', 'si', 'sí', '1', 'ok', 'activo', 'active'].includes(norm(v));
}

/** Attachment de Airtable, url suelta, o un emoji. */
function toIcon(v) {
  if (!v) return '';
  if (Array.isArray(v)) {
    const a = v[0];
    if (!a) return '';
    return typeof a === 'string' ? a : (a?.thumbnails?.large?.url || a?.url || '');
  }
  if (typeof v === 'object') return v.url || '';
  return String(v).trim();
}

/** Color estable a partir del nombre, para el avatar generado. */
function colorFor(name) {
  const h = [...String(name)].reduce((a, c) => (a * 31 + c.charCodeAt(0)) % 360, 7);
  return `hsl(${h}, 62%, 42%)`;
}

async function loadPeople() {
  try {
    const res = await fetch(CONFIG.peopleApi, { cache: 'no-store' });
    if (!res.ok) throw new Error(`api ${res.status}`);
    const { records = [] } = await res.json();

    const rows = records.map((r) => {
      const f = r.fields || {};
      return {
        id: r.id,
        name: String(pickField(f, ['name', 'nombre', 'responsable', 'persona']) ?? '').trim(),
        icon: toIcon(pickField(f, ['icon', 'icono', 'ícono', 'avatar', 'foto', 'imagen'])),
        visibleRaw: pickField(f, ['visible', 'activo', 'active', 'publicado']),
      };
    }).filter((p) => p.name);

    /* Si NINGÚN registro trae la columna `visible`, es que todavía no
       existe en la tabla: mostramos todos en vez de dejar la lista vacía. */
    const hasVisible = rows.some((p) => p.visibleRaw !== undefined);
    const list = hasVisible ? rows.filter((p) => truthy(p.visibleRaw)) : rows;

    if (!list.length) throw new Error('sin responsables visibles');

    return list.map(({ id, name, icon }) => ({ id, name, icon, color: colorFor(name) }));
  } catch (err) {
    console.info(`[todo] responsables desde Airtable no disponibles (${err.message}), uso los de config.js`);
    return CONFIG.todo.people;
  }
}

const personById = (id) => (id ? people.find((p) => p.id === id) || null : null);

function avatarHtml(person, size) {
  if (person.icon && /^https?:\/\/|^data:/.test(person.icon)) {
    return `<img class="avatar" width="${size}" height="${size}" alt="${person.name}" src="${person.icon}">`;
  }
  const glyph = person.icon || person.name[0].toUpperCase();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="32" fill="${person.color}"/>
    <text x="32" y="${person.icon ? 42 : 40}" text-anchor="middle"
      font-family="Helvetica,Arial,sans-serif" font-size="${person.icon ? 30 : 24}"
      font-weight="700" fill="rgba(255,255,255,.95)">${escapeHtml(glyph)}</text>
  </svg>`;
  return `<img class="avatar" width="${size}" height="${size}" alt="${person.name}"
    src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
}

/* ---------------- carrusel de días ---------------- */
function renderDays() {
  daysEl.innerHTML = '';
  RANGE.forEach((d) => {
    const k = keyOf(d);
    const load = items.filter((i) => i.date === k && i.state !== 'deleted').length;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day';
    b.dataset.date = k;
    b.setAttribute('role', 'tab');
    if (k === TODAY) b.classList.add('is-today');
    if (k < TODAY) b.classList.add('is-past');
    if (k === activeDay) { b.classList.add('is-active'); b.setAttribute('aria-selected', 'true'); }

    // más de 5 tareas (activas + hechas) en el día: un 8 echado
    const pips = load > 5
      ? '<span class="inf">&#8734;</span>'
      : '<i></i>'.repeat(load);

    b.innerHTML = `
      <span class="d">${WD[d.getDay()]}</span>
      <span class="n">${d.getDate()}</span>
      <span class="pips">${pips}</span>`;

    b.addEventListener('click', () => {
      activeDay = k;
      playTick(660);
      renderDays();
      renderList();
      centerDay();
    });
    daysEl.appendChild(b);
  });
}

function centerDay(behavior = 'smooth') {
  const el = daysEl.querySelector('.is-active');
  if (el) el.scrollIntoView({ behavior, inline: 'center', block: 'nearest' });
}

function renderLabel() {
  const d = RANGE.find((x) => keyOf(x) === activeDay) || today;
  const txt = d.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
  labelEl.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
}

/* La rueda del mouse mueve el carrusel en horizontal. */
daysEl.addEventListener('wheel', (e) => {
  const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
  if (!delta) return;
  e.preventDefault();
  daysEl.scrollLeft += delta;
}, { passive: false });

/* Y también se puede arrastrar con el mouse. */
(() => {
  let down = false, startX = 0, startScroll = 0, moved = false;

  daysEl.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return;      // el táctil ya hace su propio scroll
    down = true; moved = false;
    startX = e.clientX;
    startScroll = daysEl.scrollLeft;
  });

  daysEl.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - startX;
    if (Math.abs(dx) > 4) {
      moved = true;
      daysEl.classList.add('is-panning');
      daysEl.scrollLeft = startScroll - dx;
    }
  });

  const end = () => { down = false; daysEl.classList.remove('is-panning'); };
  daysEl.addEventListener('pointerup', end);
  daysEl.addEventListener('pointerleave', end);
  // si el usuario arrastró, el click sobre el chip no debe cambiar de día
  daysEl.addEventListener('click', (e) => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);
})();

/* ---------------- lista ---------------- */
const ORDER = { active: 0, done: 1, deleted: 2 };

function dayItems() {
  return items
    .filter((i) => i.date === activeDay)
    .sort((a, b) => (ORDER[a.state] - ORDER[b.state]) || (a.createdAt - b.createdAt));
}

function renderList() {
  renderLabel();
  const list = dayItems();
  listEl.innerHTML = '';

  if (!list.length) {
    listEl.innerHTML = `<div class="empty-day">Sin pendientes para este día.
      <span>Toca “Agregar” para crear el primero</span></div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  list.forEach((it) => frag.appendChild(itemNode(it)));
  listEl.appendChild(frag);
}

function itemNode(it) {
  const p = personById(it.personId);
  const locked = it.state !== 'active';

  const el = document.createElement('article');
  el.className = `item ${it.state}` + (locked ? ' is-locked' : '');
  el.dataset.id = it.id;

  const actions = locked
    ? `<span class="act-right">${iconRestore()}Reponer</span>
       <span class="act-left">Reponer${iconRestore()}</span>`
    : `<span class="act-right">${iconCheck()}Hecho</span>
       <span class="act-left">Eliminar${iconX()}</span>`;

  const tag = it.state === 'done' ? 'Hecho' : it.state === 'deleted' ? 'Eliminado' : '';

  el.innerHTML = `
    <div class="item-actions">${actions}</div>
    <div class="item-surface">
      <div class="item-main">
        <p class="item-text">${escapeHtml(it.text)}</p>
        ${p ? `<span class="item-owner">${avatarHtml(p, 22)}<span class="who">${escapeHtml(p.name)}</span></span>` : ''}
        ${it.postponed > 0
          ? `<span class="item-postponed">Postergado ${it.postponed} ${it.postponed === 1 ? 'vez' : 'veces'}</span>`
          : ''}
      </div>
      ${tag ? `<span class="tag-state">${tag}</span>` : ''}
    </div>`;

  wireGestures(el, it);
  return el;
}

const iconCheck = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
  stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>`;
const iconX = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
  stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>`;
const iconRestore = () => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
  stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 5.5v5h5"/>
  <path d="M4.2 13a8 8 0 1 0 1.6-5.3L3.5 10.5"/></svg>`;

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- acciones ---------------- */
function setState(id, state) {
  const it = items.find((x) => x.id === id);
  if (!it || it.state === state) return;
  it.state = state;
  it.createdAt = Date.now();          // lo reubica dentro de su bloque
  save();
  if (state === 'done') playDone();
  else if (state === 'deleted') playFail();
  else playTick(700);
  renderDays();
  renderList();
}

/** Mover a otro día. Solo hacia días que sigan activos (hoy en adelante). */
function moveItem(id, date) {
  const it = items.find((x) => x.id === id);
  if (!it || it.date === date || date < TODAY) return false;

  const postponing = date > it.date;
  it.date = date;
  if (postponing) it.postponed = (it.postponed || 0) + 1;
  save();
  return true;
}

/* ============================================================
   Gestos: swipe horizontal + long-press para arrastrar
   ============================================================ */
const SWIPE_TRIGGER = 92;
const LONG_PRESS_MS = 420;

function wireGestures(el, it) {
  const surface = el.querySelector('.item-surface');
  const actions = el.querySelector('.item-actions');
  const locked = it.state !== 'active';

  let startX = 0, startY = 0, dx = 0, dy = 0;
  let mode = null;
  let lpTimer = null;
  let ghost = null;
  let dropDay = null;

  const onDown = (e) => {
    if (e.button != null && e.button !== 0) return;
    startX = e.clientX; startY = e.clientY;
    dx = dy = 0; mode = null;
    el.classList.remove('snap-back');

    lpTimer = setTimeout(() => { if (!mode) lift(e); }, LONG_PRESS_MS);

    document.addEventListener('pointermove', onMove, { passive: false });
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  };

  const onMove = (e) => {
    dx = e.clientX - startX;
    dy = e.clientY - startY;

    if (!mode) {
      if (Math.abs(dx) > 9 && Math.abs(dx) > Math.abs(dy)) {
        mode = 'swipe';
        clearTimeout(lpTimer);
      } else if (Math.abs(dy) > 11) {
        mode = 'scroll';
        clearTimeout(lpTimer);
        cleanup();
        return;
      }
    }

    if (mode === 'swipe') {
      e.preventDefault();
      surface.style.transform = `translateX(${dx}px)`;
      paintActions(dx);
    } else if (mode === 'drag') {
      e.preventDefault();
      moveGhost(e.clientX, e.clientY);
      highlightDay(e.clientX, e.clientY);
    }
  };

  const onUp = () => {
    clearTimeout(lpTimer);

    if (mode === 'drag') {
      dropGhost();
    } else if (mode === 'swipe') {
      const passed = Math.abs(dx) >= SWIPE_TRIGGER;

      if (passed && locked) {
        // hecho o eliminado: cualquier lado lo repone
        surface.style.transform = '';
        setState(it.id, 'active');
      } else if (passed && dx > 0) {
        surface.style.transform = 'translateX(110%)';
        setTimeout(() => setState(it.id, 'done'), 130);
      } else if (passed) {
        surface.style.transform = 'translateX(-110%)';
        setTimeout(() => setState(it.id, 'deleted'), 130);
      } else {
        el.classList.add('snap-back');
        surface.style.transform = '';
        paintActions(0);
      }
    }
    cleanup();
  };

  function cleanup() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
  }

  function paintActions(v) {
    const t = Math.min(Math.abs(v) / SWIPE_TRIGGER, 1);
    if (!v) { actions.style.background = ''; return; }
    const color = locked ? '90,90,110' : (v > 0 ? '31,180,110' : '224,16,43');
    const dir = v > 0 ? 90 : 270;
    actions.style.background = `linear-gradient(${dir}deg, rgba(${color},${.25 + t * .65}), transparent 68%)`;
  }

  /* ---------- levantar ---------- */
  function lift(e) {
    mode = 'drag';
    playTick(880);
    if (navigator.vibrate) navigator.vibrate(12);

    const r = el.getBoundingClientRect();
    ghost = el.cloneNode(true);
    ghost.classList.add('lifted');
    Object.assign(ghost.style, {
      position: 'fixed',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      margin: '0',
    });
    ghost.dataset.ox = e.clientX - r.left;
    ghost.dataset.oy = e.clientY - r.top;
    document.body.appendChild(ghost);

    el.style.opacity = '.22';
    document.body.style.overflow = 'hidden';
    document.body.classList.add('is-dragging');
    centerDay('auto');
  }

  function moveGhost(x, y) {
    if (!ghost) return;
    ghost.style.left = `${x - ghost.dataset.ox}px`;
    ghost.style.top = `${y - ghost.dataset.oy}px`;
  }

  function highlightDay(x, y) {
    const el2 = document.elementFromPoint(x, y)?.closest('.day');
    // no se puede postergar hacia atrás
    const hit = el2 && el2.dataset.date >= TODAY ? el2 : null;
    if (hit === dropDay) return;
    dropDay?.classList.remove('is-drop');
    dropDay = hit;
    dropDay?.classList.add('is-drop');
  }

  function dropGhost() {
    const target = dropDay?.dataset.date;
    dropDay?.classList.remove('is-drop');
    dropDay = null;

    ghost?.remove();
    ghost = null;
    el.style.opacity = '';
    document.body.style.overflow = '';
    document.body.classList.remove('is-dragging');

    if (target && moveItem(it.id, target)) {
      playTick(523);
      renderDays();
      renderList();
    } else {
      playTick(330);
    }
  }

  surface.addEventListener('pointerdown', onDown);
  surface.addEventListener('contextmenu', (e) => e.preventDefault());
  surface.addEventListener('dragstart', (e) => e.preventDefault());
}

/* ============================================================
   Composer
   ============================================================ */
function renderPeople() {
  peopleEl.innerHTML = '';

  // el responsable es opcional: primera opción, sin nadie
  const none = document.createElement('button');
  none.type = 'button';
  none.className = 'person' + (pickedPerson === null ? ' sel' : '');
  none.innerHTML = `<span class="avatar none">&ndash;</span><span>Nadie</span>`;
  none.addEventListener('click', () => { pickedPerson = null; playTick(600); renderPeople(); });
  peopleEl.appendChild(none);

  people.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'person' + (p.id === pickedPerson ? ' sel' : '');
    b.innerHTML = `${avatarHtml(p, 38)}<span>${escapeHtml(p.name)}</span>`;
    b.addEventListener('click', () => {
      pickedPerson = p.id === pickedPerson ? null : p.id;   // se puede deseleccionar
      playTick(740);
      renderPeople();
    });
    peopleEl.appendChild(b);
  });
}

function openSheet() {
  renderPeople();
  sheet.classList.add('open');
  sheetBg.classList.add('open');
  setTimeout(() => textIn.focus(), 240);
}
function closeSheet() {
  sheet.classList.remove('open');
  sheetBg.classList.remove('open');
  textIn.value = '';
}
function saveNew() {
  const text = textIn.value.trim();
  if (!text) { textIn.focus(); return; }
  items.push({
    id: uid(),
    text,
    personId: pickedPerson,
    date: activeDay,
    createdDate: activeDay,
    state: 'active',
    postponed: 0,
    createdAt: Date.now(),
  });
  save();
  playTick(880);
  closeSheet();
  renderDays();
  renderList();
}

$('add-btn').addEventListener('click', openSheet);
$('cancel-btn').addEventListener('click', closeSheet);
$('save-btn').addEventListener('click', saveNew);
sheetBg.addEventListener('click', closeSheet);
textIn.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') saveNew();
  if (e.key === 'Escape') closeSheet();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sheet.classList.contains('open')) closeSheet();
});
$('go-today').addEventListener('click', () => {
  activeDay = TODAY;
  renderDays();
  renderList();
  centerDay();
});

/* ---------------- arranque ---------------- */
renderDays();
renderList();
centerDay('auto');

people = await loadPeople();
renderList();          // ya con los responsables resueltos
