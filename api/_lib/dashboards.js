/* ============================================================
   api/_lib/dashboards.js — catálogo de dashboards y sus widgets
   ------------------------------------------------------------
   Se guardan en Redis (api/_lib/store.js):
     fm:dashboards         [{ id, name, image }]  — los que crean los amos
                           image: ícono subido (data URL chica) o null →
                           el navegador dibuja uno por defecto con las iniciales
     fm:widgets:<dashId>   [{ id, type, x, y, w, h, data, inputs }]
   x, y, w, h van en celdas de la rejilla del lienzo. `inputs` son los ids
   de los widgets conectados a su conector izquierdo (le dan contexto).
   Los de BUILTIN existen siempre y no se pueden borrar (su `icon` es una
   clave de js/dashboard-icons.js).
   ============================================================ */

import { getJSON, setJSON, del, newId } from './store.js';

const DASH_KEY = 'fm:dashboards';
const widgetsKey = (dashId) => `fm:widgets:${dashId}`;

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
    out.push({ ...d, builtin: false });
  }
  return out.map((d) => ({ ...d, url: urlFor(d.id) }));
}

export const publicDash = (d) => ({
  id: d.id, name: d.name, icon: d.icon || null, image: d.image || null, url: d.url, builtin: d.builtin,
});

export async function createDashboard(name, image) {
  const all = await listDashboards();
  const base = slugify(name) || 'dashboard';
  let id = base;
  for (let i = 2; all.some((d) => d.id === id); i++) id = `${base}-${i}`;
  const dash = { id, name, image: image || null };
  await setJSON(DASH_KEY, [...(await getJSON(DASH_KEY, [])), dash]);
  return { ...dash, builtin: false, url: urlFor(id) };
}

export async function deleteDashboard(d) {
  await del(widgetsKey(d.id));
  await setJSON(DASH_KEY, (await getJSON(DASH_KEY, [])).filter((x) => x.id !== d.id));
}

/* ---------- widgets ---------- */

export const listWidgets = (dashId) => getJSON(widgetsKey(dashId), []);

export async function createWidget(dashId, type, layout, data, inputs = []) {
  const widget = { id: newId(), type, ...layout, data, inputs };
  await setJSON(widgetsKey(dashId), [...(await listWidgets(dashId)), widget]);
  return widget;
}

/** Cambia layout (x, y, w, h) y/o conexiones (inputs). */
export async function updateWidget(dashId, id, patch) {
  const list = await listWidgets(dashId);
  const w = list.find((x) => x.id === id);
  if (!w) return false;
  Object.assign(w, patch);
  await setJSON(widgetsKey(dashId), list);
  return true;
}

/** Borra el widget y las conexiones que salían de él. */
export async function deleteWidget(dashId, id) {
  const list = await listWidgets(dashId);
  if (!list.some((x) => x.id === id)) return false;
  const rest = list.filter((x) => x.id !== id);
  for (const w of rest) if (w.inputs?.includes(id)) w.inputs = w.inputs.filter((i) => i !== id);
  await setJSON(widgetsKey(dashId), rest);
  return true;
}
