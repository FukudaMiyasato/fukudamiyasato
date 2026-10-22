/* ============================================================
   api/_lib/auth.js — sesión, roles y tabla de permisos
   ------------------------------------------------------------
   Vercel no publica como función nada que empiece con "_", así que
   este archivo solo lo importan las funciones de api/.

   Roles:
     supremo   → "amo supremo": solo ADMIN_EMAIL. Todo, incluido crear y
                 eliminar amos.
     amo       → ve y edita todos los dashboards, crea dashboards y
                 chismosos. No puede crear, cambiar ni eliminar amos.
     chismoso  → solo ve los dashboards que un amo le active desde el
                 botón "Integrantes" de cada dashboard.
     (nada)    → no tiene acceso.

   Variables:
     GOOGLE_CLIENT_ID      (obligatoria) OAuth Client ID "Web" de Google
     SESSION_SECRET        (obligatoria) secreto random para firmar la cookie
     ADMIN_EMAIL           (opcional, default fukuda.miyasato@gmail.com)
     Upstash Redis         (ver api/_lib/store.js) — guarda los permisos
   ============================================================ */

import crypto from 'node:crypto';
import { getJSON, setJSON, newId } from './store.js';
import { listDashboards, publicDash } from './dashboards.js';

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'fukuda.miyasato@gmail.com';

export const ROLES = ['supremo', 'amo', 'chismoso'];

/** Amo o amo supremo: ven todo y editan. */
export const isAmo = (user) => user?.role === 'supremo' || user?.role === 'amo';

/** Qué roles puede dar cada uno desde Permisos. */
export const rolesAssignableBy = (role) =>
  role === 'supremo' ? ['amo', 'chismoso'] : role === 'amo' ? ['chismoso'] : [];

/* "cliente" era el nombre anterior de chismoso */
const normRole = (r) => (r === 'cliente' ? 'chismoso' : r);

const PERMS_KEY = 'fm:perms';
const COOKIE = 'fm_session';
const MAX_AGE = 60 * 60 * 24 * 7; // 7 días

/* Gmail ignora puntos y lo que va tras "+": fuku.da@gmail.com y
   fukuda@gmail.com son la misma cuenta. Se compara normalizado. */
export function normEmail(email) {
  const e = String(email ?? '').trim().toLowerCase();
  const [user, domain] = e.split('@');
  if (!user || !domain) return e;
  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    return `${user.split('+')[0].replace(/\./g, '')}@gmail.com`;
  }
  return e;
}

export const isOwner = (email) => normEmail(email) === normEmail(ADMIN_EMAIL);

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email ?? '').trim());
}

/* ---------- cookie firmada (HMAC) ---------- */

function secret() {
  const s = String(process.env.SESSION_SECRET || '').trim();
  if (!s) throw new Error('SESSION_SECRET no está configurado.');
  return s;
}

const b64 = (buf) => Buffer.from(buf).toString('base64url');
const hmac = (data) => crypto.createHmac('sha256', secret()).update(data).digest('base64url');

export function signSession(user) {
  const payload = b64(JSON.stringify({ ...user, exp: Math.floor(Date.now() / 1000) + MAX_AGE }));
  return `${payload}.${hmac(payload)}`;
}

export function readSession(req) {
  const raw = String(req.headers?.cookie || '')
    .split(';').map((c) => c.trim())
    .find((c) => c.startsWith(`${COOKIE}=`));
  if (!raw) return null;
  const [payload, sig] = raw.slice(COOKIE.length + 1).split('.');
  if (!payload || !sig) return null;
  const expected = Buffer.from(hmac(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
    if (!data.exp || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}

function cookieAttrs(req) {
  // En local (http) una cookie Secure no se guardaría.
  const local = /^(localhost|127\.0\.0\.1)(:|$)/.test(String(req.headers?.host || ''));
  return `Path=/; HttpOnly; SameSite=Strict${local ? '' : '; Secure'}`;
}

export function setSessionCookie(req, res, user) {
  res.setHeader('Set-Cookie', `${COOKIE}=${signSession(user)}; ${cookieAttrs(req)}; Max-Age=${MAX_AGE}`);
}

export function clearSessionCookie(req, res) {
  res.setHeader('Set-Cookie', `${COOKIE}=; ${cookieAttrs(req)}; Max-Age=0`);
}

/* ---------- Google: valida el ID token del botón "Sign in with Google" ---------- */

export async function verifyGoogleToken(credential) {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || '').trim();
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID no está configurado.');
  const r = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!r.ok) return null;
  const t = await r.json();
  const okIss = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
  const okAud = t.aud === clientId;
  const okExp = Number(t.exp) > Date.now() / 1000;
  const okMail = t.email_verified === true || t.email_verified === 'true';
  if (!okIss || !okAud || !okExp || !okMail) return null;
  return { email: t.email, name: t.name || t.email, picture: t.picture || '' };
}

/* ---------- permisos: [{ id, email, role, dashboards }] ---------- */

export const listPerms = async () =>
  (await getJSON(PERMS_KEY, [])).map((p) => ({ ...p, role: normRole(p.role), dashboards: p.dashboards || [] }));

export async function addPerm(email, role, dashboards = []) {
  const perms = await listPerms();
  const perm = { id: newId(), email: email.trim().toLowerCase(), role, dashboards };
  await setJSON(PERMS_KEY, [...perms, perm]);
  return perm;
}

export async function updatePerm(id, { role, dashboards } = {}) {
  const perms = await listPerms();
  const p = perms.find((x) => x.id === id);
  if (!p) throw new Error('Permiso no encontrado.');
  if (role) p.role = role;
  if (dashboards) p.dashboards = dashboards;
  await setJSON(PERMS_KEY, perms);
}

/** Activa o quita un dashboard a un chismoso (botón "Integrantes"). */
export async function setDashboardAccess(id, dashId, active) {
  const perms = await listPerms();
  const p = perms.find((x) => x.id === id);
  if (!p || p.role !== 'chismoso') return false;
  const set = new Set(p.dashboards);
  if (active) set.add(dashId); else set.delete(dashId);
  p.dashboards = [...set];
  await setJSON(PERMS_KEY, perms);
  return true;
}

export async function deletePerm(id) {
  await setJSON(PERMS_KEY, (await listPerms()).filter((x) => x.id !== id));
}

/** Al borrar un dashboard, se lo quita también de los permisos. */
export async function forgetDashboard(dashId) {
  const perms = await listPerms();
  for (const p of perms) p.dashboards = (p.dashboards || []).filter((d) => d !== dashId);
  await setJSON(PERMS_KEY, perms);
}

/** Rol y dashboards vigentes de un correo, o null si no tiene acceso. Se
    consulta en cada request: lo que cambies en el panel aplica al instante. */
export async function accessFor(email, catalog) {
  const ids = catalog.map((d) => d.id);
  if (isOwner(email)) return { role: 'supremo', dashboards: ids };
  const n = normEmail(email);
  const hit = (await listPerms()).find((p) => normEmail(p.email) === n);
  if (!hit || !ROLES.includes(hit.role)) return null;
  if (hit.role === 'amo') return { role: 'amo', dashboards: ids };
  return { role: 'chismoso', dashboards: hit.dashboards.filter((id) => ids.includes(id)) };
}

/** { email, name, picture } + rol y dashboards vigentes, o null si no tiene acceso.
    `catalog` es opcional: pásalo si ya lo tienes para no leerlo dos veces. */
export async function userFor(profile, catalog) {
  if (!profile?.email) return null;
  const cat = catalog || await listDashboards();
  const access = await accessFor(profile.email, cat);
  if (!access) return null;
  return {
    email: profile.email, name: profile.name, picture: profile.picture,
    role: access.role,
    dashboards: cat.filter((d) => access.dashboards.includes(d.id)).map(publicDash),
  };
}

/** Usuario de la cookie, o null. */
export const currentUser = (req, catalog) => userFor(readSession(req), catalog);

/** ¿Este usuario puede ver este dashboard? Úsalo en toda API que entregue datos. */
export const canSeeDashboard = (user, id) => Boolean(user?.dashboards?.some((d) => d.id === id));
