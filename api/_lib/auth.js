/* ============================================================
   api/_lib/auth.js — sesión, roles y tabla de permisos
   ------------------------------------------------------------
   Vercel no publica como función nada que empiece con "_", así que
   este archivo solo lo importan api/auth.js y api/perms.js.

   Roles:
     admin    → solo ADMIN_EMAIL (el dueño). No se puede asignar
                desde el panel.
     cliente  → los correos que el admin agrega en Permisos.
     (nada)   → no tiene acceso.

   Variables:
     GOOGLE_CLIENT_ID      (obligatoria) OAuth Client ID "Web" de Google
     SESSION_SECRET        (obligatoria) secreto random para firmar la cookie
     ADMIN_EMAIL           (opcional, default fukuda.miyasato@gmail.com)
     AIRTABLE_TOKEN        (ya existe; necesita data.records:write)
     AIRTABLE_PERMS_TABLE  (opcional, default "permisos")
   ============================================================ */

import crypto from 'node:crypto';
import { DASHBOARDS, isDashboard } from './dashboards.js';

export const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'fukuda.miyasato@gmail.com';

/* Roles que se pueden asignar desde el panel. "admin" queda fuera a
   propósito: de momento solo el dueño es administrador. */
export const ASSIGNABLE_ROLES = ['cliente'];

const BASE = process.env.AIRTABLE_BASE || 'appU39PYosvxt8FfG';
const PERMS_TABLE = process.env.AIRTABLE_PERMS_TABLE || 'permisos';
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

/* ---------- Airtable: tabla de permisos (Email, Rol) ---------- */

function airtable(path = '', init = {}) {
  const token = process.env.AIRTABLE_TOKEN;
  if (!token) throw new Error('AIRTABLE_TOKEN no está configurado.');
  return fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(PERMS_TABLE)}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...init.headers },
  });
}

const fieldOf = (fields, name) => {
  const k = Object.keys(fields || {}).find((f) => f.trim().toLowerCase() === name);
  const v = k ? fields[k] : '';
  return String(v?.name ?? v ?? '').trim();
};

/* La columna Dashboards guarda ids separados por coma ("proyecto-jazz, otro").
   Si alguien la convierte en multiple select también se lee bien. */
const parseDashIds = (v) => [...new Set(String(v || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean))];

async function airtableError(r, what) {
  const body = (await r.text()).slice(0, 300);
  const hint = /UNKNOWN_FIELD_NAME/.test(body)
    ? ` — falta una columna en "${PERMS_TABLE}" (Email, Rol, Dashboards)`
    : '';
  return new Error(`Airtable respondió ${r.status} ${what}${hint}`);
}

const toPerm = (rec) => ({
  id: rec.id,
  email: fieldOf(rec.fields, 'email'),
  role: fieldOf(rec.fields, 'rol').toLowerCase() || 'cliente',
  dashboards: parseDashIds(fieldOf(rec.fields, 'dashboards')),
});

export async function listPerms() {
  const out = [];
  let offset;
  do {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (offset) qs.set('offset', offset);
    const r = await airtable(`?${qs}`);
    if (!r.ok) throw await airtableError(r, `leyendo "${PERMS_TABLE}"`);
    const json = await r.json();
    for (const rec of json.records || []) {
      const p = toPerm(rec);
      if (p.email) out.push(p);
    }
    offset = json.offset;
  } while (offset);
  return out;
}

export async function addPerm(email, role, dashboards = []) {
  const r = await airtable('', {
    method: 'POST',
    body: JSON.stringify({
      records: [{ fields: { Email: email.trim().toLowerCase(), Rol: role, Dashboards: dashboards.join(', ') } }],
      typecast: true,
    }),
  });
  if (!r.ok) throw await airtableError(r, 'guardando el permiso');
  return toPerm((await r.json()).records[0]);
}

export async function updatePerm(id, { role, dashboards } = {}) {
  const fields = {};
  if (role) fields.Rol = role;
  if (dashboards) fields.Dashboards = dashboards.join(', ');
  const r = await airtable(`/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields, typecast: true }),
  });
  if (!r.ok) throw await airtableError(r, 'actualizando el permiso');
}

export async function deletePerm(id) {
  const r = await airtable(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw await airtableError(r, 'borrando el permiso');
}

/** Rol y dashboards vigentes de un correo, o null si no tiene acceso. Se
    consulta en cada request: lo que cambies en el panel aplica al instante. */
export async function accessFor(email) {
  if (isOwner(email)) return { role: 'admin', dashboards: DASHBOARDS.map((d) => d.id) };
  const n = normEmail(email);
  const hit = (await listPerms()).find((p) => normEmail(p.email) === n);
  if (!hit || !ASSIGNABLE_ROLES.includes(hit.role)) return null;
  return { role: hit.role, dashboards: hit.dashboards.filter(isDashboard) };
}

/** { email, name, picture } + rol y dashboards vigentes, o null si no tiene acceso. */
export async function userFor(profile) {
  if (!profile?.email) return null;
  const access = await accessFor(profile.email);
  if (!access) return null;
  return {
    email: profile.email, name: profile.name, picture: profile.picture,
    role: access.role,
    dashboards: DASHBOARDS.filter((d) => access.dashboards.includes(d.id)),
  };
}

/** Usuario de la cookie, o null. */
export const currentUser = (req) => userFor(readSession(req));

/** Para las APIs de datos de cada dashboard: ¿este usuario puede verlo? */
export const canSeeDashboard = (user, id) => Boolean(user?.dashboards?.some((d) => d.id === id));
