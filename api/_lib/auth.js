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
  const s = process.env.SESSION_SECRET;
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
  const clientId = process.env.GOOGLE_CLIENT_ID;
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

export async function listPerms() {
  const out = [];
  let offset;
  do {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (offset) qs.set('offset', offset);
    const r = await airtable(`?${qs}`);
    if (!r.ok) throw new Error(`Airtable respondió ${r.status} leyendo "${PERMS_TABLE}"`);
    const json = await r.json();
    for (const rec of json.records || []) {
      const email = fieldOf(rec.fields, 'email');
      if (!email) continue;
      out.push({ id: rec.id, email, role: fieldOf(rec.fields, 'rol').toLowerCase() || 'cliente' });
    }
    offset = json.offset;
  } while (offset);
  return out;
}

export async function addPerm(email, role) {
  const r = await airtable('', {
    method: 'POST',
    body: JSON.stringify({ records: [{ fields: { Email: email.trim().toLowerCase(), Rol: role } }], typecast: true }),
  });
  if (!r.ok) throw new Error(`Airtable respondió ${r.status} guardando el permiso`);
  const rec = (await r.json()).records[0];
  return { id: rec.id, email: fieldOf(rec.fields, 'email'), role: fieldOf(rec.fields, 'rol').toLowerCase() };
}

export async function updatePerm(id, role) {
  const r = await airtable(`/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ fields: { Rol: role }, typecast: true }),
  });
  if (!r.ok) throw new Error(`Airtable respondió ${r.status} actualizando el permiso`);
}

export async function deletePerm(id) {
  const r = await airtable(`/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!r.ok) throw new Error(`Airtable respondió ${r.status} borrando el permiso`);
}

/** Rol actual de un correo: se consulta en cada request, así quitar un
    permiso en el panel corta el acceso al instante. */
export async function roleFor(email) {
  if (isOwner(email)) return 'admin';
  const n = normEmail(email);
  const hit = (await listPerms()).find((p) => normEmail(p.email) === n);
  return hit && ASSIGNABLE_ROLES.includes(hit.role) ? hit.role : null;
}

/** Usuario de la cookie con su rol vigente, o null. */
export async function currentUser(req) {
  const s = readSession(req);
  if (!s?.email) return null;
  const role = await roleFor(s.email);
  return role ? { email: s.email, name: s.name, picture: s.picture, role } : null;
}
