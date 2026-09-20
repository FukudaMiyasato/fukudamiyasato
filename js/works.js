/* ============================================================
   works.js — render the grid, filters and the hover note
   ============================================================ */

import { CONFIG } from './config.js';
import { loadWorks } from './works-data.js';
import { NOTE_NAMES, playNote } from './audio.js';

const grid      = document.getElementById('grid');
const yearSel   = document.getElementById('f-year');
const typeSel   = document.getElementById('f-type');
const resetBtn  = document.getElementById('f-reset');
const countEl   = document.getElementById('count');
const sourceEl  = document.getElementById('source');

let ITEMS = [];

/* ---------- platform icons ---------- */
const ICONS = {
  ios: `<svg viewBox="0 0 24 24" class="solid" aria-hidden="true"><path d="M16.3 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.5-3.7zM14.1 5.5c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3z"/></svg>`,
  android: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 10.5h14v6.2a1.8 1.8 0 0 1-1.8 1.8H6.8A1.8 1.8 0 0 1 5 16.7z"/><path d="M5 10.5a7 7 0 0 1 14 0"/><path d="M8 7.2 6.8 5.2"/><path d="m16 7.2 1.2-2"/><path d="M9.3 8.2h.01"/><path d="M14.7 8.2h.01"/><path d="M2.3 11.6v3.8"/><path d="M21.7 11.6v3.8"/><path d="M9 18.5v2.2"/><path d="M15 18.5v2.2"/></svg>`,
  web: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.1 2.3 3.2 5.3 3.2 8.4s-1.1 6.1-3.2 8.4c-2.1-2.3-3.2-5.3-3.2-8.4S9.9 5.9 12 3.6z"/></svg>`,
  cel: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="7" y="2.6" width="10" height="18.8" rx="2.4"/><path d="M10.8 18.6h2.4"/></svg>`,
  monitor: `<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.6" y="4" width="18.8" height="12.4" rx="2"/><path d="M8.4 20.4h7.2"/><path d="M12 16.4v4"/></svg>`,
};

const LABELS = { ios: 'iOS', android: 'Android', web: 'Web', cel: 'Móvil', monitor: 'Escritorio' };

/* A deterministic red/black placeholder when the record has no photo. */
function placeholder(title) {
  const initials = (title || '?').replace(/[^\p{L}\p{N} ]/gu, '')
    .split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('') || '·';
  const hue = [...title].reduce((a, c) => a + c.charCodeAt(0), 0) % 24;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="hsl(${350 + hue}, 72%, 26%)"/>
      <stop offset="1" stop-color="#0c0c10"/></linearGradient></defs>
    <rect width="400" height="300" fill="url(#g)"/>
    <text x="200" y="176" text-anchor="middle" font-family="Helvetica,Arial,sans-serif"
      font-size="96" font-weight="800" fill="rgba(255,255,255,.14)">${initials}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/* Each item keeps one of the 5 notes, handed out at random. */
const noteFor = (() => {
  const cache = new Map();
  return (id) => {
    if (!cache.has(id)) {
      cache.set(id, NOTE_NAMES[Math.floor(Math.random() * NOTE_NAMES.length)]);
    }
    return cache.get(id);
  };
})();

function card(item, i) {
  const el = document.createElement(item.url ? 'a' : 'article');
  el.className = 'work';
  el.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
  el.dataset.note = noteFor(item.id);
  el.tabIndex = 0;
  if (item.url) {
    el.href = item.url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
  }

  const icons = item.platforms.map(
    (p) => `<span title="${LABELS[p] || p}">${ICONS[p] || ''}</span>`,
  ).join('');

  el.innerHTML = `
    <div class="work-media">
      <img src="${item.image || placeholder(item.title)}" alt="${item.title}" loading="lazy"
           onerror="this.onerror=null;this.src='${placeholder(item.title)}'">
    </div>
    <div class="work-veil"></div>
    <div class="work-body">
      <div>
        <p class="work-meta">${item.year} &middot; ${item.type}</p>
        <h3 class="work-title">${item.title}</h3>
      </div>
      <div class="work-icons">${icons}</div>
    </div>
    <span class="work-edge"></span>`;

  el.addEventListener('mouseenter', () => playNote(el.dataset.note));
  el.addEventListener('focus', () => playNote(el.dataset.note));
  return el;
}

function fillSelect(sel, values, label) {
  sel.innerHTML =
    `<option value="">${label}</option>` +
    values.map((v) => `<option value="${v}">${v}</option>`).join('');
}

function render() {
  const y = yearSel.value;
  const t = typeSel.value;
  const list = ITEMS.filter((it) => (!y || it.year === y) && (!t || it.type === t));

  grid.innerHTML = '';
  if (!list.length) {
    grid.innerHTML = `<div class="state" style="grid-column:1/-1">
      Nada por aquí con ese filtro.</div>`;
  } else {
    const frag = document.createDocumentFragment();
    list.forEach((it, i) => frag.appendChild(card(it, i)));
    grid.appendChild(frag);
  }

  countEl.innerHTML = `<b>${list.length}</b> ${list.length === 1 ? 'proyecto' : 'proyectos'}`;
}

async function init() {
  grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');

  const { items, source, error } = await loadWorks();
  ITEMS = items;

  if (!items.length) {
    grid.innerHTML = `<div class="state" style="grid-column:1/-1">
      <b>Sin proyectos visibles.</b><br>
      ${error ? 'No se pudo leer la data.' : 'Marca registros como “visible” en Airtable.'}</div>`;
    countEl.textContent = '';
  } else {
    const years = [...new Set(items.map((i) => i.year))].sort().reverse();
    const types = [...new Set(items.map((i) => i.type))].sort();
    fillSelect(yearSel, years, 'Todos los años');
    fillSelect(typeSel, types, 'Todos los tipos');
    render();
  }

  sourceEl.textContent = source === 'airtable'
    ? 'Data en vivo desde Airtable'
    : source === 'snapshot'
      ? 'Snapshot local · agrega tu token en js/config.js para leer Airtable en vivo'
      : 'Sin data';
}

[yearSel, typeSel].forEach((s) => s.addEventListener('change', render));
resetBtn.addEventListener('click', () => {
  yearSel.value = '';
  typeSel.value = '';
  render();
});

init();
