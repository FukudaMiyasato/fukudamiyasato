/* ============================================================
   api/_lib/dashboards.js — catálogo de dashboards y sus widgets
   ------------------------------------------------------------
   Se guardan en Redis (api/_lib/store.js):
     fm:dashboards         [{ id, name, icon }]  — los que crea el admin
     fm:widgets:<dashId>   [{ id, type, x, y, w, h, data }]
   x, y, w, h van en celdas de la rejilla del lienzo.
   Los de BUILTIN existen siempre y no se pueden borrar.
   ============================================================ */

import { getJSON, setJSON, del, newId } from './store.js';

const DASH_KEY = 'fm:dashboards';
const widgetsKey = (dashId) => `fm:widgets:${dashId}`;

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

/* ---------- dashboards ---------- */

export async function listDashboards() {
  const created = await getJSON(DASH_KEY, []);
  const out = BUILTIN.map((b) => ({ ...b, builtin: true }));
  for (const d of created) {
    if (out.some((x) => x.id === d.id)) continue;
    out.push({ ...d, icon: ICON_KEYS.includes(d.icon) ? d.icon : 'grid', builtin: false });
  }
  return out.map((d) => ({ ...d, url: urlFor(d.id) }));
}

export const publicDash = (d) => ({ id: d.id, name: d.name, icon: d.icon, url: d.url, builtin: d.builtin });

export async function createDashboard(name, icon) {
  const all = await listDashboards();
  const base = slugify(name) || 'dashboard';
  let id = base;
  for (let i = 2; all.some((d) => d.id === id); i++) id = `${base}-${i}`;
  const dash = { id, name, icon };
  await setJSON(DASH_KEY, [...(await getJSON(DASH_KEY, [])), dash]);
  return { ...dash, builtin: false, url: urlFor(id) };
}

export async function deleteDashboard(d) {
  await del(widgetsKey(d.id));
  await setJSON(DASH_KEY, (await getJSON(DASH_KEY, [])).filter((x) => x.id !== d.id));
}

/* ---------- widgets ---------- */

export const listWidgets = (dashId) => getJSON(widgetsKey(dashId), []);

export async function createWidget(dashId, type, layout, data) {
  const widget = { id: newId(), type, ...layout, data };
  await setJSON(widgetsKey(dashId), [...(await listWidgets(dashId)), widget]);
  return widget;
}

export async function updateWidgetLayout(dashId, id, layout) {
  const list = await listWidgets(dashId);
  const w = list.find((x) => x.id === id);
  if (!w) return false;
  Object.assign(w, layout);
  await setJSON(widgetsKey(dashId), list);
  return true;
}

export async function deleteWidget(dashId, id) {
  const list = await listWidgets(dashId);
  if (!list.some((x) => x.id === id)) return false;
  await setJSON(widgetsKey(dashId), list.filter((x) => x.id !== id));
  return true;
}
