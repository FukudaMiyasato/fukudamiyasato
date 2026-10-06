/* ============================================================
   api/_lib/site.js — contenido público del sitio que edita el amo supremo
   ------------------------------------------------------------
   Vive en Redis (api/_lib/store.js):
     fm:me    { title, phrases: [texto…] } — la página Yo (las frases se alternan)
     fm:portfolio { duration, projects: [{ id, media, date, category, title,
              text, tags, link, duration }] } — la portada (portafolio).
              media: { type: 'video' | 'image', url } (subido a Vercel Blob o un link)
                     o { type: 'youtube', url, id } (link de YouTube)
              duration: segundos de ese proyecto (null = el general)
   ============================================================ */

import { getJSON, setJSON, newId } from './store.js';
import { youtubeId } from '../../js/youtube.js';

const ME_KEY = 'fm:me';
const PORTFOLIO_KEY = 'fm:portfolio';

const str = (v, max) => String(v ?? '').trim().slice(0, max);

/* ---------- Yo ---------- */

const isUrl = (u) => /^https?:\/\//i.test(u);
const MAX_PHRASES = 8;

/** Perfil guardado ({ title, phrases }), o null si todavía no se editó con este
    formato (los viejos — nombre, rol, redes — se ignoran: la página usa
    FUKU y sus frases por defecto). */
export async function getMe() {
  const me = await getJSON(ME_KEY, null);
  return Array.isArray(me?.phrases) ? { title: me.title || '', phrases: me.phrases } : null;
}

export function cleanMe(b) {
  const title = str(b?.title, 40);
  if (!title) return { error: 'Falta el título.' };
  const phrases = (Array.isArray(b?.phrases) ? b.phrases : String(b?.phrases ?? '').split('\n'))
    .map((p) => str(p, 80)).filter(Boolean).slice(0, MAX_PHRASES);
  if (!phrases.length) return { error: 'Pon al menos una frase.' };
  return { me: { title, phrases } };
}

export const setMe = (me) => setJSON(ME_KEY, me);

/* ---------- Portafolio (la portada) ---------- */

export const DURATION_RANGE = [3, 60];   // segundos por proyecto
const DEFAULT_DURATION = 8;
const clampDur = (v) => Math.min(DURATION_RANGE[1], Math.max(DURATION_RANGE[0], Math.round(Number(v))));

export async function getPortfolio() {
  const p = await getJSON(PORTFOLIO_KEY, null);
  return { duration: p?.duration || DEFAULT_DURATION, projects: p?.projects || [] };
}
const savePortfolio = (p) => setJSON(PORTFOLIO_KEY, p);

/** "2026" · "2026-03" · "2026-03-14" (mes y día opcionales). Sin año válido, el actual. */
function cleanDate(v) {
  const m = String(v ?? '').trim().match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/);
  const year = String(new Date().getFullYear());
  if (!m) return year;
  const [, y, mo, d] = m;
  if (!mo || +mo < 1 || +mo > 12) return y;
  if (!d || +d < 1 || +d > new Date(Date.UTC(+y, +mo, 0)).getUTCDate()) return `${y}-${mo}`;
  return `${y}-${mo}-${d}`;
}

/** Proyecto válido, o { error }. Todo es opcional: lo que falte lo completa la portada. */
export function cleanProject(b) {
  const out = {
    media: null,
    date: cleanDate(b?.date),
    category: str(b?.category, 40),
    title: str(b?.title, 80),
    text: str(b?.text, 600),
    tags: (Array.isArray(b?.tags) ? b.tags : String(b?.tags ?? '').split(','))
      .map((t) => str(t, 24)).filter(Boolean).slice(0, 6),
    link: str(b?.link, 500),
    duration: b?.duration === '' || b?.duration == null ? null : clampDur(b.duration),
  };
  if (Number.isNaN(out.duration)) out.duration = null;
  if (out.link && !isUrl(out.link)) return { error: 'El link debe empezar con https://' };
  const url = str(b?.media?.url, 1000);
  if (url) {
    if (!isUrl(url) && !/^\/assets\//.test(url)) return { error: 'El video o imagen debe ser un link https://' };
    // YouTube: no es un archivo, la portada lo muestra con su reproductor
    const yt = youtubeId(url);
    if (yt) { out.media = { type: 'youtube', url, id: yt }; return { project: out }; }
    if (/(^|\.)(youtube\.com|youtu\.be)$/i.test(new URL(url, 'https://x').hostname)) {
      return { error: 'Ese link de YouTube no es de un video (usa el de «Compartir» del video).' };
    }
    const type = b?.media?.type === 'image' || b?.media?.type === 'video'
      ? b.media.type
      : /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) ? 'video' : 'image';
    out.media = { type, url };
  }
  return { project: out };
}

export async function createProject(project) {
  const p = await getPortfolio();
  const full = { id: newId(), ...project };
  p.projects.push(full);
  await savePortfolio(p);
  return full;
}

export async function updateProject(id, project) {
  const p = await getPortfolio();
  const i = p.projects.findIndex((x) => x.id === id);
  if (i < 0) return null;
  p.projects[i] = { ...project, id };
  await savePortfolio(p);
  return p.projects[i];
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
