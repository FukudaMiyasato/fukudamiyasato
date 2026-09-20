/* ============================================================
   works-data.js — pull + normalise the Works list
   ------------------------------------------------------------
   The Airtable column names are not fixed in stone, so every field
   is resolved through a list of aliases and anything missing falls
   back to CONFIG.defaults.
   ============================================================ */

import { CONFIG } from './config.js';

const ALIASES = {
  title:    ['name', 'title', 'nombre', 'titulo', 'título', 'app', 'proyecto', 'project'],
  year:     ['year', 'año', 'ano', 'anio', 'fecha', 'date'],
  type:     ['type', 'tipo', 'category', 'categoria', 'categoría', 'kind'],
  visible:  ['visible', 'visable', 'activo', 'active', 'publicado', 'published', 'status', 'estado'],
  image:    ['image', 'imagen', 'foto', 'photo', 'cover', 'portada', 'thumbnail', 'thumb', 'icon', 'icono', 'ícono'],
  platforms:['platforms', 'platform', 'plataformas', 'plataforma', 'devices', 'dispositivos', 'os'],
  url:      ['url', 'link', 'enlace', 'web', 'sitio', 'demo'],
  order:    ['order', 'orden', 'sort', 'priority', 'prioridad'],
};

/* Which platform icon a raw value maps to. */
const PLATFORM_MAP = {
  ios: 'ios', 'ios app': 'ios', iphone: 'ios', ipad: 'ios', apple: 'ios', macos: 'monitor',
  android: 'android', 'android app': 'android', play: 'android',
  web: 'web', website: 'web', site: 'web', 'web app': 'web', pwa: 'web', online: 'web',
  cel: 'cel', celular: 'cel', mobile: 'cel', movil: 'cel', 'móvil': 'cel', phone: 'cel', responsive: 'cel',
  monitor: 'monitor', desktop: 'monitor', escritorio: 'monitor', pc: 'monitor', mac: 'monitor', tv: 'monitor',
};

const norm = (s) => String(s ?? '').trim().toLowerCase();

/** Find a value in an Airtable `fields` object by trying every alias. */
function pick(fields, key) {
  const keys = Object.keys(fields);
  for (const alias of ALIASES[key]) {
    const hit = keys.find((k) => norm(k) === alias);
    if (hit !== undefined) return fields[hit];
  }
  // second pass: substring match (e.g. "Año de lanzamiento")
  for (const alias of ALIASES[key]) {
    const hit = keys.find((k) => norm(k).includes(alias));
    if (hit !== undefined) return fields[hit];
  }
  return undefined;
}

function isTruthy(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v > 0;
  const s = norm(v);
  return ['visible', 'true', 'yes', 'si', 'sí', 'y', '1', 'ok', 'activo', 'active',
          'publicado', 'published', 'on'].includes(s);
}

/** Airtable attachment arrays, plain urls, or nothing at all. */
function toImage(v) {
  if (!v) return '';
  if (Array.isArray(v)) {
    const att = v[0];
    if (!att) return '';
    if (typeof att === 'string') return att;
    return att?.thumbnails?.large?.url || att?.url || '';
  }
  if (typeof v === 'object') return v.url || '';
  const s = String(v).trim();
  return /^https?:\/\//.test(s) ? s : '';
}

/** Single select objects, multi selects, comma strings, checkbox columns. */
function toPlatforms(fields) {
  const out = new Set();

  const add = (raw) => {
    const k = PLATFORM_MAP[norm(raw)];
    if (k) out.add(k);
  };

  const v = pick(fields, 'platforms');
  if (Array.isArray(v)) v.forEach((x) => add(typeof x === 'object' ? x?.name : x));
  else if (v && typeof v === 'object') add(v.name);
  else if (typeof v === 'string') v.split(/[,/|;]+/).forEach(add);

  // also accept one checkbox column per platform: "iOS", "Android", "Web"...
  Object.entries(fields).forEach(([k, val]) => {
    const key = PLATFORM_MAP[norm(k)];
    if (key && isTruthy(val)) out.add(key);
  });

  return [...out];
}

function toText(v) {
  if (v == null || v === '') return '';
  if (Array.isArray(v)) {
    return v.map((x) => (typeof x === 'object' ? x?.name ?? '' : x)).filter(Boolean).join(', ');
  }
  if (typeof v === 'object') return v.name ?? '';
  return String(v).trim();
}

function toYear(v) {
  const s = toText(v);
  const m = s.match(/(19|20)\d{2}/);
  return m ? m[0] : (s || '');
}

/** Airtable record (or plain json row) -> the shape the UI renders. */
export function normalise(record, index) {
  const fields = record.fields ?? record ?? {};
  const d = CONFIG.defaults;

  return {
    id:        record.id || `row-${index}`,
    title:     toText(pick(fields, 'title')) || d.title,
    year:      toYear(pick(fields, 'year')) || d.year,
    type:      toText(pick(fields, 'type')) || d.type,
    image:     toImage(pick(fields, 'image')) || d.image,
    platforms: (() => { const p = toPlatforms(fields); return p.length ? p : d.platforms; })(),
    url:       toText(pick(fields, 'url')),
    order:     Number(toText(pick(fields, 'order'))) || 0,
    visible:   isTruthy(pick(fields, 'visible')),
  };
}

async function fromAirtable() {
  const { token, baseId, tableId, viewId } = CONFIG.airtable;
  const records = [];
  let offset;

  do {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (viewId) qs.set('view', viewId);
    if (offset) qs.set('offset', offset);

    const res = await fetch(
      `https://api.airtable.com/v0/${baseId}/${tableId}?${qs}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) throw new Error(`Airtable ${res.status}`);

    const json = await res.json();
    records.push(...(json.records || []));
    offset = json.offset;
  } while (offset);

  return records;
}

async function fromSnapshot() {
  const res = await fetch(CONFIG.worksFallback, { cache: 'no-store' });
  if (!res.ok) throw new Error(`snapshot ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? json : (json.records || []);
}

/**
 * Pull the works once. Resolves to { items, source }.
 * Only rows flagged visible survive.
 */
export async function loadWorks() {
  let raw = [];
  let source = 'airtable';

  try {
    raw = CONFIG.airtable.token ? await fromAirtable() : await fromSnapshot();
    if (!CONFIG.airtable.token) source = 'snapshot';
  } catch (err) {
    console.warn('[works] live pull failed, using local snapshot:', err.message);
    source = 'snapshot';
    try {
      raw = await fromSnapshot();
    } catch (err2) {
      console.error('[works] snapshot failed too:', err2.message);
      return { items: [], source: 'none', error: err2.message };
    }
  }

  const yearNum = (it) => parseInt(it.year, 10) || -1;   // "S/F" cae al final

  const items = raw
    .map(normalise)
    .filter((it) => it.visible)
    .sort((a, b) => (b.order - a.order) || (yearNum(b) - yearNum(a)));

  return { items, source };
}
