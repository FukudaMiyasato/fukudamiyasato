/* ============================================================
   api/_lib/dashboards.js — catálogo de dashboards y sus widgets
   ------------------------------------------------------------
   Tabla `dashboards` (los que crea el admin):
     Id      texto  (slug: "ventas-2026")
     Nombre  texto
     Icono   texto  (una clave de ICON_KEYS)
   Tabla `widgets` (lo que el admin pinta en cada lienzo):
     Dashboard  texto       (el Id del dashboard)
     Tipo       texto       ("table")
     Layout     texto       JSON { x, y, w, h } en celdas de la rejilla
     Datos      texto largo JSON del contenido (título, columnas, filas…)
   Los de BUILTIN existen siempre y no se pueden borrar.
   ============================================================ */

import { at, atError, listAll, field, text } from './at.js';

export const DASH_TABLE = process.env.AIRTABLE_DASH_TABLE || 'dashboards';
export const WIDGET_TABLE = process.env.AIRTABLE_WIDGET_TABLE || 'widgets';
const DASH_COLUMNS = 'Id, Nombre, Icono';
const WIDGET_COLUMNS = 'Dashboard, Tipo, Layout, Datos';

/* Deben coincidir con las claves de js/dashboard-icons.js */
export const ICON_KEYS = ['sax', 'chart', 'grid', 'music', 'folder', 'star', 'briefcase', 'globe', 'heart', 'cart', 'users'];

const BUILTIN = [
  { id: 'proyecto-jazz', name: 'PROYECTO-JAZZ', icon: 'sax' },
];

const urlFor = (id) => `/dashboards/?d=${encodeURIComponent(id)}`;

export function slugify(name) {
  return String(name || '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function fromRecord(rec) {
  const f = rec.fields || {};
  return {
    id: text(field(f, 'id')).toLowerCase(),
    name: text(field(f, 'nombre')),
    icon: text(field(f, 'icono')),
    recordId: rec.id,
  };
}

/* ---------- dashboards ---------- */

export async function listDashboards() {
  let rows = [];
  try {
    rows = (await listAll(DASH_TABLE, DASH_COLUMNS)).map(fromRecord).filter((d) => d.id);
  } catch (err) {
    // Sin la tabla todavía, al menos los fijos siguen funcionando.
    console.error('[dashboards]', err.message);
  }
  const out = BUILTIN.map((b) => ({ ...b, recordId: null, builtin: true }));
  for (const r of rows) {
    if (out.some((d) => d.id === r.id)) continue;
    out.push({ ...r, name: r.name || r.id, icon: ICON_KEYS.includes(r.icon) ? r.icon : 'grid', builtin: false });
  }
  return out.map((d) => ({ ...d, url: urlFor(d.id) }));
}

export const publicDash = (d) => ({ id: d.id, name: d.name, icon: d.icon, url: d.url, builtin: d.builtin });

export async function createDashboard(name, icon) {
  const all = await listDashboards();
  const base = slugify(name) || 'dashboard';
  let id = base;
  for (let i = 2; all.some((d) => d.id === id); i++) id = `${base}-${i}`;
  const r = await at(DASH_TABLE, '', {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: { Id: id, Nombre: name, Icono: icon } }], typecast: true }),
  });
  if (!r.ok) throw await atError(r, DASH_TABLE, 'creando el dashboard', DASH_COLUMNS);
  const rec = (await r.json()).records[0];
  return { ...fromRecord(rec), builtin: false, url: urlFor(id) };
}

export async function deleteDashboard(d) {
  const widgets = await listWidgets(d.id);
  // Airtable borra de a 10 por request
  for (let i = 0; i < widgets.length; i += 10) {
    const qs = widgets.slice(i, i + 10).map((w) => `records[]=${w.id}`).join('&');
    const r = await at(WIDGET_TABLE, `?${qs}`, { method: 'DELETE' });
    if (!r.ok) throw await atError(r, WIDGET_TABLE, 'borrando los widgets', WIDGET_COLUMNS);
  }
  if (!d.recordId) return;
  const r = await at(DASH_TABLE, `/${d.recordId}`, { method: 'DELETE' });
  if (!r.ok) throw await atError(r, DASH_TABLE, 'borrando el dashboard', DASH_COLUMNS);
}

/* ---------- widgets ---------- */

const parseJSON = (v, fallback) => { try { return JSON.parse(v); } catch { return fallback; } };

function widgetFrom(rec) {
  const f = rec.fields || {};
  const l = parseJSON(text(field(f, 'layout')), {});
  return {
    id: rec.id,
    dashboard: text(field(f, 'dashboard')).toLowerCase(),
    type: text(field(f, 'tipo')) || 'table',
    x: Number(l.x) || 0, y: Number(l.y) || 0, w: Number(l.w) || 8, h: Number(l.h) || 6,
    data: parseJSON(String(field(f, 'datos') ?? ''), {}),
  };
}

export async function listWidgets(dashId) {
  // dashId es un slug [a-z0-9-]: seguro dentro de la fórmula
  const formula = `LOWER({Dashboard})='${dashId.replace(/[^a-z0-9-]/g, '')}'`;
  return (await listAll(WIDGET_TABLE, WIDGET_COLUMNS, formula)).map(widgetFrom);
}

export async function createWidget(dashId, type, layout, data) {
  const r = await at(WIDGET_TABLE, '', {
    method: 'POST',
    body: JSON.stringify({
      records: [{ fields: { Dashboard: dashId, Tipo: type, Layout: JSON.stringify(layout), Datos: JSON.stringify(data) } }],
      typecast: true,
    }),
  });
  if (!r.ok) throw await atError(r, WIDGET_TABLE, 'guardando el widget', WIDGET_COLUMNS);
  return widgetFrom((await r.json()).records[0]);
}

export async function updateWidgetLayout(id, layout) {
  const r = await at(WIDGET_TABLE, `/${id}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { Layout: JSON.stringify(layout) } }),
  });
  if (!r.ok) throw await atError(r, WIDGET_TABLE, 'moviendo el widget', WIDGET_COLUMNS);
}

export async function deleteWidget(id) {
  const r = await at(WIDGET_TABLE, `/${id}`, { method: 'DELETE' });
  if (!r.ok) throw await atError(r, WIDGET_TABLE, 'borrando el widget', WIDGET_COLUMNS);
}
