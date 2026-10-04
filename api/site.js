/* ============================================================
   /api/site — portada (portafolio), perfil (Yo) y apps
   ------------------------------------------------------------
   Público (sin login):
     GET    ?t=portfolio       → { duration, projects }
     GET    ?t=me              → { me }   (null si nunca se editó)
     GET    ?t=apps            → { apps, downloads, million }
   Solo amo supremo:
     PUT    ?t=portfolio { duration?, order? }                          → { duration, projects }
     POST   ?t=project  { media?, date?, category?, title?, text?, tags?, link?, duration? } → { project }
     PUT    ?t=project&id=<id> { …igual }                               → { project }
     DELETE ?t=project&id=<id>                                          → { ok }
     PUT    ?t=me    { title, text?, links? }                           → { me }
     POST/PUT/DELETE ?t=apps…  (ver api/_lib/site.js)
   Los videos e imágenes se suben aparte, a Vercel Blob (api/upload.js).
   ============================================================ */

import { currentUser } from './_lib/auth.js';
import {
  listApps, createApp, updateApp, deleteApp, cleanApp, getMe, setMe, cleanMe, MILLION,
  getPortfolio, setPortfolio, cleanProject, createProject, updateProject, deleteProject,
} from './_lib/site.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const t = req.query?.t;
  const id = String(req.query?.id || '');

  try {
    if (req.method === 'GET') {
      if (t === 'portfolio') return res.status(200).json(await getPortfolio());
      if (t === 'me') return res.status(200).json({ me: await getMe() });
      if (t === 'apps') {
        const apps = await listApps();
        const downloads = apps.reduce((s, a) => s + (a.downloads || 0), 0);
        return res.status(200).json({ apps, downloads, million: MILLION });
      }
      return res.status(400).json({ error: 'Falta ?t=portfolio, ?t=me o ?t=apps' });
    }

    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    if (user.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });

    if (t === 'portfolio' && req.method === 'PUT') {
      return res.status(200).json(await setPortfolio({ duration: req.body?.duration, order: req.body?.order }));
    }

    if (t === 'project') {
      if (req.method === 'DELETE') {
        if (!(await deleteProject(id))) return res.status(404).json({ error: 'Proyecto no encontrado.' });
        return res.status(200).json({ ok: true });
      }
      if (req.method === 'POST' || req.method === 'PUT') {
        const { project, error } = cleanProject(req.body);
        if (error) return res.status(400).json({ error });
        if (req.method === 'POST') return res.status(201).json({ project: await createProject(project) });
        const saved = await updateProject(id, project);
        if (!saved) return res.status(404).json({ error: 'Proyecto no encontrado.' });
        return res.status(200).json({ project: saved });
      }
    }

    if (t === 'me' && req.method === 'PUT') {
      const { me, error } = cleanMe(req.body);
      if (error) return res.status(400).json({ error });
      await setMe(me);
      return res.status(200).json({ me });
    }

    if (t === 'apps') {
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

    res.setHeader('Allow', 'GET, POST, PUT, DELETE');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[api/site]', err);
    return res.status(500).json({ error: err.message });
  }
}
