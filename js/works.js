/* ============================================================
   works.js — página Apps (antes Works): grilla, filtros y nota al hover
   ------------------------------------------------------------
   Las apps salen de /api/site?t=apps (las edita el amo supremo en
   el panel → Aplicaciones). Cada una puede tener links a varias
   plataformas, que se ven como íconos en su tarjeta. Si todavía no
   hay ninguna cargada ahí, se usa la lista vieja (Airtable / snapshot).
   Arriba, la barra: cuántas descargas faltan para el millón.
   ============================================================ */

import { CONFIG } from './config.js';
import { loadWorks } from './works-data.js';
import { NOTE_NAMES, playNote } from './audio.js';
import { platformOf, platformIcon } from './app-platforms.js';

const grid      = document.getElementById('grid');
const yearSel   = document.getElementById('f-year');
const typeSel   = document.getElementById('f-type');
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

const escHTML = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Links de la app: un ícono por plataforma (siguen visibles y se pueden tocar en el hover). */
function linksHTML(links) {
  return `<div class="work-links">${links.map((l) => {
    const p = platformOf(l.platform);
    return `<a href="${escHTML(l.url)}" target="_blank" rel="noopener noreferrer" title="${escHTML(p.label)}" aria-label="${escHTML(p.label)}">${platformIcon(p.key)}</a>`;
  }).join('')}</div>`;
}

function card(item, i) {
  const el = document.createElement(item.url && !item.links ? 'a' : 'article');
  el.className = 'work';
  el.style.animationDelay = `${Math.min(i, 12) * 35}ms`;
  el.dataset.note = noteFor(item.id);
  el.tabIndex = 0;
  if (item.url && !item.links) {
    el.href = item.url;
    el.target = '_blank';
    el.rel = 'noopener noreferrer';
  }

  const icons = item.platforms.map(
    (p) => `<span title="${LABELS[p] || p}">${ICONS[p] || ''}</span>`,
  ).join('');

  el.innerHTML = `
    <div class="work-media">
      <img src="${item.image || placeholder(item.title)}" alt="${escHTML(item.title)}" loading="lazy"
           onerror="this.onerror=null;this.src='${placeholder(item.title)}'">
    </div>
    <div class="work-veil"></div>
    <div class="work-body">
      <div>
        <p class="work-meta">${[item.year, item.type].filter(Boolean).map(escHTML).join(' &middot; ')}</p>
        <h3 class="work-title">${escHTML(item.title)}</h3>
      </div>
      ${item.links ? '' : `<div class="work-icons">${icons}</div>`}
    </div>
    ${item.links?.length ? linksHTML(item.links) : ''}
    <span class="work-edge"></span>`;

  // giro al azar en cada hover: dirección aleatoria, hasta 20 grados
  const spin = () => {
    const deg = (8 + Math.random() * 12) * (Math.random() < .5 ? -1 : 1);
    el.style.setProperty('--rot', `${deg.toFixed(2)}deg`);
  };

  el.addEventListener('mouseenter', () => { spin(); playNote(el.dataset.note); });
  el.addEventListener('focus', () => { spin(); playNote(el.dataset.note); });
  return el;
}

function fillSelect(sel, values, label) {
  sel.innerHTML =
    `<option value="">${label}</option>` +
    values.map((v) => `<option value="${escHTML(v)}">${escHTML(v)}</option>`).join('');
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
}

/* ---------- barra del millón ---------- */
const nf = new Intl.NumberFormat('es-PE');
function renderMillion(downloads, million) {
  const left = Math.max(0, million - downloads);
  document.getElementById('million').hidden = false;
  document.getElementById('million-left').textContent = nf.format(left);
  const pct = Math.min(100, (downloads / million) * 100);
  document.getElementById('million-fill').style.width = `${Math.max(pct, downloads ? 0.6 : 0)}%`;
  const bar = document.getElementById('million-bar');
  bar.setAttribute('aria-valuenow', String(Math.min(downloads, million)));
  bar.setAttribute('aria-valuetext', `${nf.format(downloads)} descargas`);
}

/** Apps del panel; null si no hay ninguna (o la API no responde). */
async function loadApps() {
  try {
    const r = await fetch('/api/site?t=apps', { cache: 'no-store' });
    if (!r.ok) throw new Error(`api ${r.status}`);
    const { apps, downloads, million } = await r.json();
    renderMillion(downloads, million);
    if (!apps.length) return null;
    return apps.map((a) => ({
      id: a.id, title: a.name, year: a.year, type: a.type, image: a.image, platforms: [], links: a.links || [],
    }));
  } catch (err) {
    console.info(`[apps] /api/site no disponible (${err.message})`);
    renderMillion(0, 1_000_000);
    return null;
  }
}

async function init() {
  grid.innerHTML = Array.from({ length: 6 }, () => '<div class="skeleton"></div>').join('');

  const apps = await loadApps();
  const { items, source, error } = apps ? { items: apps, source: 'apps' } : await loadWorks();
  ITEMS = items;

  if (!items.length) {
    grid.innerHTML = `<div class="state" style="grid-column:1/-1">
      <b>Sin apps visibles.</b><br>
      ${error ? 'No se pudo leer la data.' : 'Marca registros como “visible” en Airtable.'}</div>`;
  } else {
    const years = [...new Set(items.map((i) => i.year).filter(Boolean))].sort().reverse();
    const types = [...new Set(items.map((i) => i.type).filter(Boolean))].sort();
    fillSelect(yearSel, years, 'Todos los años');
    fillSelect(typeSel, types, 'Todos los tipos');
    render();
  }

  sourceEl.textContent = {
    apps:     '',
    api:      'Data en vivo desde Airtable',
    airtable: 'Data en vivo desde Airtable · token expuesto en el cliente',
    snapshot: 'Snapshot local · configura AIRTABLE_TOKEN en Vercel para data en vivo',
    none:     'Sin data',
  }[source] || '';
}

[yearSel, typeSel].forEach((s) => s.addEventListener('change', render));

init();
