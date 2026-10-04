/* ============================================================
   api/_lib/site.js — contenido público del sitio que edita el amo supremo
   ------------------------------------------------------------
   Vive en Redis (api/_lib/store.js):
     fm:apps  [{ id, name, image, year, type, downloads, links: [{ platform, url }] }]
              las apps de la página Apps (antes Works), en el orden en que se muestran.
              image: data URL chica (recortada a 4:3 en el navegador) o ''
     fm:me    { title, text, links: [{ platform, url }] } — la página Yo
     fm:portfolio { duration, projects: [{ id, media, date, category, title,
              text, tags, link, duration }] } — la portada (portafolio).
              media: { type: 'video' | 'image', url } (subido a Vercel Blob o un link)
              duration: segundos de ese proyecto (null = el general)
   ============================================================ */

import { getJSON, setJSON, newId } from './store.js';

const APPS_KEY = 'fm:apps';
const ME_KEY = 'fm:me';
const PORTFOLIO_KEY = 'fm:portfolio';

export const PLATFORMS = ['apple', 'android', 'itchio', 'steam', 'web', 'other'];
export const MILLION = 1_000_000;

const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 220_000;
const MAX_LINKS = 8;

const str = (v, max) => String(v ?? '').trim().slice(0, max);

/** App válida, o { error }. */
export function cleanApp(b) {
  const name = str(b?.name, 60);
  if (!name) return { error: 'Ponle un nombre.' };
  const image = b?.image ? String(b.image) : '';
  if (image && (!IMAGE_RE.test(image) || image.length > MAX_IMAGE_CHARS)) {
    return { error: 'La imagen debe ser PNG, JPG o WebP y no muy grande.' };
  }
  const links = [];
  for (const l of (Array.isArray(b?.links) ? b.links : []).slice(0, MAX_LINKS)) {
    const url = str(l?.url, 500);
    if (!url) continue;
    if (!/^https?:\/\//i.test(url)) return { error: `El link «${url.slice(0, 40)}» debe empezar con https://` };
    links.push({ platform: PLATFORMS.includes(l?.platform) ? l.platform : 'other', url });
  }
  return {
    app: {
      name,
      image,
      year: /^\d{4}$/.test(str(b?.year, 4)) ? str(b.year, 4) : '',
      type: str(b?.type, 40),
      downloads: Math.max(0, Math.min(1e12, Math.round(Number(b?.downloads) || 0))),
      links,
    },
  };
}

export const listApps = () => getJSON(APPS_KEY, []);

export async function createApp(app) {
  const full = { id: newId(), ...app };
  await setJSON(APPS_KEY, [...(await listApps()), full]);
  return full;
}

export async function updateApp(id, app) {
  const list = await listApps();
  const i = list.findIndex((a) => a.id === id);
  if (i < 0) return null;
  list[i] = { ...list[i], ...app, id };
  await setJSON(APPS_KEY, list);
  return list[i];
}

export async function deleteApp(id) {
  const list = await listApps();
  if (!list.some((a) => a.id === id)) return false;
  await setJSON(APPS_KEY, list.filter((a) => a.id !== id));
  return true;
}

/* ---------- Yo ---------- */

export const SOCIALS = ['instagram', 'linkedin', 'github', 'x', 'behance', 'dribbble', 'youtube', 'tiktok', 'email', 'web'];
const isUrl = (u) => /^https?:\/\//i.test(u);

/** Perfil guardado, o null si todavía no se editó (la página usa sus valores por defecto).
    Los perfiles viejos ({ name, role, … }) se leen como título + texto. */
export async function getMe() {
  const me = await getJSON(ME_KEY, null);
  if (!me) return null;
  if (me.title != null) return me;
  return {
    title: [me.name, me.role].filter(Boolean).join(' — '),
    text: me.description || '',
    links: me.email ? [{ platform: 'email', url: `mailto:${me.email}` }] : [],
  };
}

export function cleanMe(b) {
  const title = str(b?.title, 140);
  if (!title) return { error: 'Falta el título.' };
  const links = [];
  for (const l of (Array.isArray(b?.links) ? b.links : []).slice(0, 12)) {
    let url = str(l?.url, 500);
    if (!url) continue;
    const platform = SOCIALS.includes(l?.platform) ? l.platform : 'web';
    if (platform === 'email' && !/^mailto:/i.test(url)) url = `mailto:${url}`;
    if (platform === 'email' ? !/^mailto:[^\s@]+@[^\s@]+\.[^\s@]+$/i.test(url) : !isUrl(url)) {
      return { error: `El link «${url.slice(0, 40)}» no es válido${platform === 'email' ? '' : ' (debe empezar con https://)'}.` };
    }
    links.push({ platform, url });
  }
  return { me: { title, text: str(b?.text, 2000), links } };
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

/** Proyecto válido, o { error }. Todo es opcional: lo que falte lo completa la portada. */
export function cleanProject(b) {
  const out = {
    media: null,
    date: /^\d{4}-\d{2}(-\d{2})?$/.test(str(b?.date, 10)) ? str(b.date, 10) : '',
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
