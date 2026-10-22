/* ============================================================
   api/_lib/dashboards.js — catálogo de dashboards y sus widgets
   ------------------------------------------------------------
   Se guardan en Redis (api/_lib/store.js):
     fm:dashboards         [{ id, name, image }]  — los que crean los amos
                           image: ícono subido (data URL chica) o null →
                           el navegador dibuja uno por defecto con las iniciales
     fm:widgets:<dashId>   [{ id, type, x, y, w, h, data, inputs }]
     fm:marks:<dashId>     { flags: [{ id, x, y, color }], divider: { x } | null }
                           banderas y raya divisoria (no son widgets)
   x, y, w, h van en celdas de la rejilla del lienzo. `inputs` son los ids
   de los widgets conectados a su conector izquierdo (le dan contexto).
   Los de BUILTIN existen siempre y no se pueden borrar (su `icon` es una
   clave de js/dashboard-icons.js).
   ============================================================ */

import { getJSON, setJSON, del, newId } from './store.js';

const DASH_KEY = 'fm:dashboards';
const widgetsKey = (dashId) => `fm:widgets:${dashId}`;
const marksKey = (dashId) => `fm:marks:${dashId}`;

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
  await del(marksKey(d.id));
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

/* ---------- banderas y raya divisoria ---------- */

export const FLAG_COLORS = ['#ff3b4f', '#ff9f1c', '#ffd60a', '#2ecc71', '#22d3ee', '#3b82f6', '#a855f7', '#ff5fa2'];

export async function getMarks(dashId) {
  const m = await getJSON(marksKey(dashId), null);
  return { flags: m?.flags || [], divider: m?.divider || null };
}

/** Pone una bandera con un color al azar que no tenga otra. null si ya están los 8. */
export async function addFlag(dashId, x, y) {
  const marks = await getMarks(dashId);
  const free = FLAG_COLORS.filter((c) => !marks.flags.some((f) => f.color === c));
  if (!free.length) return null;
  const flag = { id: newId(), x, y, color: free[Math.floor(Math.random() * free.length)] };
  marks.flags.push(flag);
  await setJSON(marksKey(dashId), marks);
  return flag;
}

/** Pone la raya divisoria en la columna x. false si ya hay una. */
export async function setDivider(dashId, x) {
  const marks = await getMarks(dashId);
  if (marks.divider) return false;
  marks.divider = { x };
  await setJSON(marksKey(dashId), marks);
  return marks.divider;
}

/** Quita una bandera (por id) o la raya ('divider'). */
export async function deleteMark(dashId, markId) {
  const marks = await getMarks(dashId);
  if (markId === 'divider') {
    if (!marks.divider) return false;
    marks.divider = null;
  } else {
    if (!marks.flags.some((f) => f.id === markId)) return false;
    marks.flags = marks.flags.filter((f) => f.id !== markId);
  }
  await setJSON(marksKey(dashId), marks);
  return true;
}
