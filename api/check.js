/* ============================================================
   /api/check — ¿la persona de la cookie puede ver este proyecto?
   ------------------------------------------------------------
   Lo consulta cada proyecto en su subdominio (<ruta>.fukudamiyasato.com),
   desde su middleware de Vercel (reenviando el header Cookie) o desde
   el navegador (fetch con credentials: 'include').

   GET ?p=<ruta>  → 200 { ok: true, user: { email, name, picture, role } }
                    401 { ok: false, login }   sin sesión
                    403 { ok: false, login }   con sesión pero sin acceso
   `login` es a dónde mandar a la persona para entrar o elegir otro proyecto.
   ============================================================ */

import { currentUser, canSeeDashboard } from './_lib/auth.js';
import { PROJECTS_DOMAIN } from './_lib/dashboards.js';

const LOGIN = `https://${PROJECTS_DOMAIN}/admin/`;

/** CORS solo para los subdominios del dominio de proyectos. */
function allowOrigin(req, res) {
  const origin = String(req.headers?.origin || '');
  let host = '';
  try { host = new URL(origin).hostname; } catch { return; }
  if (host.endsWith(`.${PROJECTS_DOMAIN}`)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Vary', 'Origin');
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  allowOrigin(req, res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const id = String(req.query?.p || '').toLowerCase();
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ ok: false, login: LOGIN });
    if (!canSeeDashboard(user, id)) return res.status(403).json({ ok: false, login: LOGIN });
    const { email, name, picture, role } = user;
    return res.status(200).json({ ok: true, user: { email, name, picture, role } });
  } catch (err) {
    console.error('[api/check]', err);
    return res.status(500).json({ error: err.message });
  }
}
