/* ============================================================
   api/_lib/site.js — contenido público del sitio que edita el amo supremo
   ------------------------------------------------------------
   Vive en Redis (api/_lib/store.js):
     fm:portfolio { duration, projects: [{ id, name, year, info, tags, videos, visible }] }
              la portada (portafolio). Cada proyecto pasa sus videos en
              secuencia y, al terminar el último, sigue el próximo.
              tags: 'ai' (video generado con IA) · 'real' (testimonio real)
              videos: [{ type: 'video', url } | { type: 'youtube', url, id } | { type: 'image', url }]
              duration: segundos de un proyecto sin videos (o de una imagen)
              visible: false = oculto en la portada (sigue en el panel)
   ============================================================ */

import { getJSON, setJSON, newId } from './store.js';
import { youtubeId } from '../../js/youtube.js';

const PORTFOLIO_KEY = 'fm:portfolio';

const str = (v, max) => String(v ?? '').trim().slice(0, max);

const isUrl = (u) => /^https?:\/\//i.test(u);

/* ---------- Portafolio (la portada) ---------- */

export const DURATION_RANGE = [3, 60];   // segundos por proyecto
const DEFAULT_DURATION = 8;
const clampDur = (v) => Math.min(DURATION_RANGE[1], Math.max(DURATION_RANGE[0], Math.round(Number(v))));

export const TAGS = ['ai', 'real'];   // video generado con IA · testimonio real
const MAX_VIDEOS = 12;

/** Un video de la lista: archivo (Vercel Blob o link) o YouTube. null si no sirve. */
function cleanVideo(v) {
  const url = str(v?.url, 1000);
  if (!url) return null;
  if (!isUrl(url) && !/^\/assets\//.test(url)) throw Object.assign(new Error('Cada video debe ser un link https://'), { status: 400 });
  const yt = youtubeId(url);
  if (yt) return { type: 'youtube', url, id: yt };
  if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url, 'https://x').hostname)) {
    throw Object.assign(new Error('Ese link de YouTube no es de un video (usa el de «Compartir» del video).'), { status: 400 });
  }
  const type = v?.type === 'image' || (!/\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) && /\.(jpe?g|png|webp|gif|avif)(\?|$)/i.test(url)) ? 'image' : 'video';
  return { type, url };
}

/** Proyectos guardados con el formato anterior (título, categoría, media…) → el actual. */
function upgrade(x) {
  if (Array.isArray(x.videos)) return { ...x, visible: x.visible !== false };
  const media = x.media?.url ? [x.media] : [];
  return {
    id: x.id,
    name: x.title || '',
    year: String(x.date || '').slice(0, 4),
    info: x.text || '',
    tags: [],
    videos: media.map((m) => (m.type === 'youtube' ? { type: 'youtube', url: m.url, id: m.id } : { type: m.type === 'image' ? 'image' : 'video', url: m.url })),
    visible: x.visible !== false,
  };
}

/** Todos los proyectos (para el panel). */
export async function getPortfolio() {
  const p = await getJSON(PORTFOLIO_KEY, null);
  return { duration: p?.duration || DEFAULT_DURATION, projects: (p?.projects || []).map(upgrade) };
}

/** Lo que ve la portada: solo los visibles, y cuántos hay ocultos. */
export async function getPublicPortfolio() {
  const p = await getPortfolio();
  const projects = p.projects.filter((x) => x.visible);
  return { duration: p.duration, projects, hidden: p.projects.length - projects.length };
}
const savePortfolio = (p) => setJSON(PORTFOLIO_KEY, p);

/** Proyecto válido, o { error }. Todo es opcional; el año, si falta, es el actual. */
export function cleanProject(b) {
  try {
    const year = String(b?.year ?? '').trim();
    const out = {
      name: str(b?.name, 60),
      year: /^\d{4}$/.test(year) ? year : String(new Date().getFullYear()),
      info: str(b?.info, 700),
      tags: [...new Set((Array.isArray(b?.tags) ? b.tags : []).filter((t) => TAGS.includes(t)))],
      videos: (Array.isArray(b?.videos) ? b.videos : []).map(cleanVideo).filter(Boolean).slice(0, MAX_VIDEOS),
      // si no viene, se respeta lo que ya tenía (editar no lo vuelve visible)
      visible: typeof b?.visible === 'boolean' ? b.visible : undefined,
    };
    return { project: out };
  } catch (err) {
    if (err.status === 400) return { error: err.message };
    throw err;
  }
}

export async function createProject(project) {
  const p = await getPortfolio();
  const full = { id: newId(), ...project, visible: project.visible ?? true };
  p.projects.push(full);
  await savePortfolio(p);
  return full;
}

export async function updateProject(id, project) {
  const p = await getPortfolio();
  const i = p.projects.findIndex((x) => x.id === id);
  if (i < 0) return null;
  p.projects[i] = { ...project, id, visible: project.visible ?? p.projects[i].visible };
  await savePortfolio(p);
  return p.projects[i];
}

/** Switch de visibilidad del panel. */
export async function setProjectVisible(id, visible) {
  const p = await getPortfolio();
  const x = p.projects.find((y) => y.id === id);
  if (!x) return null;
  x.visible = Boolean(visible);
  await savePortfolio(p);
  return x;
}

export async function deleteProject(id) {
  const p = await getPortfolio();
  if (!p.projects.some((x) => x.id === id)) return false;
  p.projects = p.projects.filter((x) => x.id !== id);
  await savePortfolio(p);
  return true;
}

/** Duración general y/o nuevo orden (lista de ids). */
export async function setPortfolio({ duration, order }) {
  const p = await getPortfolio();
  if (duration != null) p.duration = clampDur(duration);
  if (Array.isArray(order)) {
    const byId = new Map(p.projects.map((x) => [x.id, x]));
    const sorted = order.map((i) => byId.get(i)).filter(Boolean);
    p.projects = [...sorted, ...p.projects.filter((x) => !order.includes(x.id))];
  }
  await savePortfolio(p);
  return p;
}
