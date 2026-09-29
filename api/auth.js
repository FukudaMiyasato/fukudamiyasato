/* ============================================================
   /api/auth — login con Google
   ------------------------------------------------------------
   GET     → { clientId, user }   user = { email, name, picture, role, dashboards } | null
   POST    { credential }         ID token del botón de Google. Si el correo
                                  tiene rol, deja la cookie de sesión; si no,
                                  403 { error: 'no_access' } y sin cookie.
   DELETE  → cierra la sesión
   ============================================================ */

import {
  verifyGoogleToken, currentUser, userFor,
  setSessionCookie, clearSessionCookie,
} from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET' && req.query?.diag) {
      // Solo dice SI cada variable llega a la función, nunca su valor.
      const has = (k) => Boolean(String(process.env[k] || '').trim());
      return res.status(200).json({
        entorno: process.env.VERCEL_ENV || 'local',
        GOOGLE_CLIENT_ID: has('GOOGLE_CLIENT_ID'),
        SESSION_SECRET: has('SESSION_SECRET'),
        AIRTABLE_TOKEN: has('AIRTABLE_TOKEN'),
      });
    }

    if (req.method === 'GET') {
      const user = await currentUser(req);
      if (!user) clearSessionCookie(req, res);
      return res.status(200).json({ clientId: String(process.env.GOOGLE_CLIENT_ID || '').trim(), user });
    }

    if (req.method === 'POST') {
      const credential = String(req.body?.credential || '');
      if (!credential) return res.status(400).json({ error: 'Falta el credential de Google.' });

      const g = await verifyGoogleToken(credential);
      if (!g) return res.status(401).json({ error: 'No se pudo validar la cuenta de Google.' });

      const user = await userFor(g);
      if (!user) {
        clearSessionCookie(req, res);
        return res.status(403).json({ error: 'no_access', email: g.email });
      }
      setSessionCookie(req, res, g);
      return res.status(200).json({ user });
    }

    if (req.method === 'DELETE') {
      clearSessionCookie(req, res);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[api/auth]', err);
    return res.status(500).json({ error: err.message });
  }
}
