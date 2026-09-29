/* ============================================================
   /api/auth — login con Google
   ------------------------------------------------------------
   GET     → { clientId, user }   user = { email, name, picture, role } | null
   POST    { credential }         ID token del botón de Google. Si el correo
                                  tiene rol, deja la cookie de sesión; si no,
                                  403 { error: 'no_access' } y sin cookie.
   DELETE  → cierra la sesión
   ============================================================ */

import {
  verifyGoogleToken, roleFor, currentUser,
  setSessionCookie, clearSessionCookie,
} from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const user = await currentUser(req);
      if (!user) clearSessionCookie(req, res);
      return res.status(200).json({ clientId: process.env.GOOGLE_CLIENT_ID || '', user });
    }

    if (req.method === 'POST') {
      const credential = String(req.body?.credential || '');
      if (!credential) return res.status(400).json({ error: 'Falta el credential de Google.' });

      const g = await verifyGoogleToken(credential);
      if (!g) return res.status(401).json({ error: 'No se pudo validar la cuenta de Google.' });

      const role = await roleFor(g.email);
      if (!role) {
        clearSessionCookie(req, res);
        return res.status(403).json({ error: 'no_access', email: g.email });
      }

      setSessionCookie(req, res, g);
      return res.status(200).json({ user: { ...g, role } });
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
