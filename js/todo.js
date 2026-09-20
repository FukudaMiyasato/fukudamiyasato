/* ============================================================
   todo.js — carrusel de días, items, swipe y drag entre días
   ============================================================ */

import { CONFIG } from './config.js';
import { playDone, playFail, playTick } from './audio.js';

const STORE = 'fm.todo.v1';
const { people, daysBack, daysForward } = CONFIG.todo;

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
let activeDay = TODAY;
let pickedPerson = people[0].id;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE));
    return Array.isArray(raw) ? raw : seed();
  } catch {
    return seed();
  }
}
function save() {
  try { localStorage.setItem(STORE, JSON.stringify(items)); } catch { /* modo privado */ }
}
function seed() {
  return [
    { id: uid(), text: 'Revisar el brief del cliente', personId: people[0].id, date: TODAY, done: false, createdAt: Date.now() },
    { id: uid(), text: 'Exportar íconos del sistema', personId: people[1].id, date: TODAY, done: false, createdAt: Date.now() + 1 },
    { id: uid(), text: 'Subir build a TestFlight', personId: people[2].id, date: TODAY, done: true, createdAt: Date.now() + 2 },
  ];
}

/* ---------------- avatares ---------------- */
const personById = (id) => people.find((p) => p.id === id) || people[0];

function avatar(person, size = 38) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
    <circle cx="32" cy="32" r="32" fill="${person.color}"/>
    <circle cx="32" cy="25" r="10" fill="rgba(0,0,0,.28)"/>
    <path d="M12 60c0-11 9-18 20-18s20 7 20 18z" fill="rgba(0,0,0,.28)"/>
    <text x="32" y="39" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
      font-size="24" font-weight="700" fill="rgba(255,255,255,.95)">${person.name[0].toUpperCase()}</text>
  </svg>`;
  return `<img class="avatar" width="${size}" height="${size}" alt="${person.name}"
    src="data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}">`;
}

/* ---------------- carrusel de días ---------------- */
function renderDays() {
  daysEl.innerHTML = '';
  RANGE.forEach((d) => {
    const k = keyOf(d);
    const pending = items.filter((i) => i.date === k && !i.done).length;

    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'day';
    b.dataset.date = k;
    b.setAttribute('role', 'tab');
    if (k === TODAY) b.classList.add('is-today');
    if (k === activeDay) { b.classList.add('is-active'); b.setAttribute('aria-selected', 'true'); }

    b.innerHTML = `
      <span class="d">${WD[d.getDay()]}</span>
      <span class="n">${d.getDate()}</span>
      <span class="pips">${'<i></i>'.repeat(Math.min(pending, 3))}</span>`;

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
  const txt = d.toLocaleDateString('es-ES', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
  labelEl.textContent = txt.charAt(0).toUpperCase() + txt.slice(1);
}

/* ---------------- lista ---------------- */
function dayItems() {
  return items
    .filter((i) => i.date === activeDay)
    .sort((a, b) => (a.done - b.done) || (a.createdAt - b.createdAt));
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
  list.forEach((it, i) => frag.appendChild(itemNode(it, i)));
  listEl.appendChild(frag);
}

function itemNode(it, i) {
  const p = personById(it.personId);

  const el = document.createElement('article');
  el.className = 'item' + (it.done ? ' done' : '');
  el.dataset.id = it.id;
  el.style.animationDelay = `${Math.min(i, 10) * 28}ms`;

  el.innerHTML = `
    <div class="item-actions">
      <span class="act-done">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4"
             stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5L20 6.5"/></svg>Hecho
      </span>
      <span class="act-delete">Eliminar
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"
             stroke-linecap="round" style="margin:0 0 0 8px"><path d="M6 6l12 12M18 6L6 18"/></svg>
      </span>
    </div>
    <div class="item-surface">
      <div class="item-main">
        <p class="item-text">${escapeHtml(it.text)}</p>
        <span class="item-owner">${avatar(p, 22)}<span class="who">${p.name}</span></span>
      </div>
      <span class="tag-done">Hecho</span>
    </div>`;

  wireGestures(el, it);
  return el;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- acciones ---------------- */
function markDone(id) {
  const it = items.find((x) => x.id === id);
  if (!it || it.done) return;
  it.done = true;
  it.createdAt = Date.now();          // lo manda al final de la fila
  save();
  playDone();
  renderDays();
  renderList();
}

function removeItem(id, node) {
  playFail();
  node.classList.add('removing');
  setTimeout(() => {
    items = items.filter((x) => x.id !== id);
    save();
    renderDays();
    renderList();
  }, 260);
}

function moveItem(id, date) {
  const it = items.find((x) => x.id === id);
  if (!it || it.date === date) return false;
  it.date = date;
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

  let startX = 0, startY = 0, dx = 0, dy = 0;
  let mode = null;            // 'swipe' | 'drag' | 'scroll'
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
      const pull = it.done && dx > 0 ? dx * 0.25 : dx;   // ya está hecho: casi no cede
      surface.style.transform = `translateX(${pull}px)`;
      paintActions(pull);
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
      if (dx >= SWIPE_TRIGGER && !it.done) {
        surface.style.transform = 'translateX(110%)';
        setTimeout(() => markDone(it.id), 130);
      } else if (dx <= -SWIPE_TRIGGER) {
        surface.style.transform = 'translateX(-110%)';
        removeItem(it.id, el);
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
    if (v > 0) actions.style.background = `linear-gradient(90deg, rgba(31,180,110,${.25 + t * .65}), transparent 68%)`;
    else if (v < 0) actions.style.background = `linear-gradient(270deg, rgba(224,16,43,${.25 + t * .7}), transparent 68%)`;
    else actions.style.background = '';
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
      animation: 'none',
    });
    ghost.dataset.ox = e.clientX - r.left;
    ghost.dataset.oy = e.clientY - r.top;
    document.body.appendChild(ghost);

    el.style.opacity = '.22';
    document.body.style.overflow = 'hidden';
    centerDay('auto');
  }

  function moveGhost(x, y) {
    if (!ghost) return;
    ghost.style.left = `${x - ghost.dataset.ox}px`;
    ghost.style.top = `${y - ghost.dataset.oy}px`;
  }

  function highlightDay(x, y) {
    const hit = document.elementFromPoint(x, y)?.closest('.day');
    if (hit === dropDay) return;
    dropDay?.classList.remove('is-drop');
    dropDay = hit || null;
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
  people.forEach((p) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'person' + (p.id === pickedPerson ? ' sel' : '');
    b.innerHTML = `${avatar(p)}<span>${p.name}</span>`;
    b.addEventListener('click', () => {
      pickedPerson = p.id;
      playTick(740);
      renderPeople();
    });
    peopleEl.appendChild(b);
  });
  const sel = peopleEl.querySelector('.sel');
  if (sel) sel.scrollIntoView({ inline: 'center', block: 'nearest' });
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
    date: activeDay,           // queda en el día activo del carrusel
    done: false,
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
