/* ============================================================
   /api/site — apps (página Apps) y perfil (página Yo)
   ------------------------------------------------------------
   Público (sin login):
     GET    ?t=apps            → { apps, downloads, million }
     GET    ?t=me              → { me }   (null si nunca se editó)
   Solo amo supremo:
     POST   ?t=apps  { name, image?, year?, type?, downloads?, links? } → { app }
     PUT    ?t=apps&id=<id> { …igual }                                  → { app }
     DELETE ?t=apps&id=<id>                                             → { ok }
     PUT    ?t=me    { name, role, description, location, email }       → { me }
   ============================================================ */

import { currentUser } from './_lib/auth.js';
import {
  listApps, createApp, updateApp, deleteApp, cleanApp, getMe, setMe, cleanMe, MILLION,
} from './_lib/site.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const t = req.query?.t;

  try {
    if (req.method === 'GET') {
      if (t === 'apps') {
        const apps = await listApps();
        const downloads = apps.reduce((s, a) => s + (a.downloads || 0), 0);
        return res.status(200).json({ apps, downloads, million: MILLION });
      }
      if (t === 'me') return res.status(200).json({ me: await getMe() });
      return res.status(400).json({ error: 'Falta ?t=apps o ?t=me' });
    }

    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    if (user.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });

    if (t === 'apps') {
      const id = String(req.query?.id || '');
      if (req.method === 'DELETE') {
        if (!(await deleteApp(id))) return res.status(404).json({ error: 'App no encontrada.' });
        return res.status(200).json({ ok: true });
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const { app, error } = cleanApp(req.body);
        if (error) return res.status(400).json({ error });
        if (req.method === 'POST') return res.status(201).json({ app: await createApp(app) });
        const saved = await updateApp(id, app);
        if (!saved) return res.status(404).json({ error: 'App no encontrada.' });
        return res.status(200).json({ app: saved });
      }
    }

    if (t === 'me' && req.method === 'PUT') {
      const { me, error } = cleanMe(req.body);
      if (error) return res.status(400).json({ error });
      await setMe(me);
      return res.status(200).json({ me });
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[api/site]', err);
    return res.status(500).json({ error: err.message });
  }
}
