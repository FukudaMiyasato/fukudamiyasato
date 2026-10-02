/* ============================================================
   api/_lib/site.js — contenido público del sitio que edita el amo supremo
   ------------------------------------------------------------
   Vive en Redis (api/_lib/store.js):
     fm:apps  [{ id, name, image, year, type, downloads, links: [{ platform, url }] }]
              las apps de la página Apps (antes Works), en el orden en que se muestran.
              image: data URL chica (recortada a 4:3 en el navegador) o ''
     fm:me    { name, role, description, location, email } — la página Yo
   ============================================================ */

import { getJSON, setJSON, newId } from './store.js';

const APPS_KEY = 'fm:apps';
const ME_KEY = 'fm:me';

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

const ME_FIELDS = { name: 60, role: 80, description: 1200, location: 80, email: 120 };

/** Perfil guardado, o null si todavía no se editó (la página usa sus valores de js/config.js). */
export const getMe = () => getJSON(ME_KEY, null);

export function cleanMe(b) {
  const me = Object.fromEntries(Object.entries(ME_FIELDS).map(([k, max]) => [k, str(b?.[k], max)]));
  if (!me.name) return { error: 'Falta el nombre.' };
  if (me.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(me.email)) return { error: 'El correo no es válido.' };
  return { me };
}

export const setMe = (me) => setJSON(ME_KEY, me);
