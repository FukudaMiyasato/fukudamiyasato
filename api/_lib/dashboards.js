/* ============================================================
   api/_lib/dashboards.js — catálogo de dashboards y sus widgets
   ------------------------------------------------------------
   Se guardan en Redis (api/_lib/store.js):
     fm:dashboards         [{ id, name, image, icon? }]  — los que crean los amos
                           image: ícono subido (data URL chica) o null →
                           el navegador dibuja uno por defecto con las iniciales
     fm:dashboards:removed [id]  — fijos (BUILTIN) que un amo eliminó
     fm:spent:<dashId>     tokens gastados en ese dashboard (precio de cada uso de IA
                           que salió bien, también los del amo supremo)
     fm:widgets:<dashId>   [{ id, type, x, y, w, h, data, inputs }]
     fm:marks:<dashId>     { flags: [{ id, x, y, color }], divider: { x } | null }
                           banderas y raya divisoria (no son widgets)
   x, y, w, h van en celdas de la rejilla del lienzo. `inputs` son los ids
   de los widgets conectados a su conector izquierdo (le dan contexto).
   Los de BUILTIN vienen del código (su `icon` es una clave de
   js/dashboard-icons.js). Al editar uno se copia a fm:dashboards (esa copia
   manda); al eliminarlo su id va a fm:dashboards:removed.
   ============================================================ */

import { getJSON, setJSON, del, newId, incrBy, getNum } from './store.js';

const DASH_KEY = 'fm:dashboards';
const REMOVED_KEY = 'fm:dashboards:removed';
const widgetsKey = (dashId) => `fm:widgets:${dashId}`;
const marksKey = (dashId) => `fm:marks:${dashId}`;
const spentKey = (dashId) => `fm:spent:${dashId}`;

/** Suma al gasto del dashboard y devuelve el total. */
export const addSpent = (dashId, n) => (n > 0 ? incrBy(spentKey(dashId), n) : spentOf(dashId));
export const spentOf = (dashId) => getNum(spentKey(dashId));

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
  const [created, removed] = await Promise.all([getJSON(DASH_KEY, []), getJSON(REMOVED_KEY, [])]);
  const out = BUILTIN
    .filter((b) => !removed.includes(b.id) && !created.some((d) => d.id === b.id))
    .map((b) => ({ ...b, builtin: true }));
  for (const d of created) out.push({ ...d, builtin: false });
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

/** Cambia nombre y/o ícono (image: data URL o null para quitarlo). Un fijo
    se copia a fm:dashboards con el cambio. false si no existe. */
export async function updateDashboard(id, patch) {
  const list = await getJSON(DASH_KEY, []);
  let d = list.find((x) => x.id === id);
  if (!d) {
    const b = BUILTIN.find((x) => x.id === id);
    if (!b) return false;
    d = { ...b, image: null };
    list.unshift(d); // primero, como cuando era fijo
  }
  Object.assign(d, patch);
  await setJSON(DASH_KEY, list);
  return true;
}

export async function deleteDashboard(d) {
  await del(widgetsKey(d.id));
  await del(marksKey(d.id));
  await del(spentKey(d.id));
  await setJSON(DASH_KEY, (await getJSON(DASH_KEY, [])).filter((x) => x.id !== d.id));
  if (BUILTIN.some((b) => b.id === d.id)) {
    const removed = await getJSON(REMOVED_KEY, []);
    if (!removed.includes(d.id)) await setJSON(REMOVED_KEY, [...removed, d.id]);
  }
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
  for (const w of rest) if (w.tops?.includes(id)) w.tops = w.tops.filter((i) => i !== id);
  for (const w of rest) if (w.feeds?.includes(id)) w.feeds = w.feeds.filter((i) => i !== id);
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

/** Mueve una bandera (x, y) o la raya ('divider', solo x). false si no existe. */
export async function moveMark(dashId, markId, x, y) {
  const marks = await getMarks(dashId);
  if (markId === 'divider') {
    if (!marks.divider) return false;
    marks.divider.x = x;
  } else {
    const f = marks.flags.find((m) => m.id === markId);
    if (!f) return false;
    Object.assign(f, { x, y });
  }
  await setJSON(marksKey(dashId), marks);
  return true;
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
