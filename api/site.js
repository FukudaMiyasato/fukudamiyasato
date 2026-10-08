/* ============================================================
   /api/site — portada (portafolio)
   ------------------------------------------------------------
   Público (sin login):
     GET    ?t=portfolio       → { duration, projects, hidden }  (solo los visibles;
                                  hidden = cuántos están ocultos)
     GET    ?t=portfolio&all=1 → { duration, projects }  todos (solo amo supremo)
   Solo amo supremo:
     PUT    ?t=portfolio { duration?, order? }                          → { duration, projects }
     POST   ?t=project  { name?, year?, info?, tags?: ['ai'|'real'], videos?: [{ url }] } → { project }
     PUT    ?t=project&id=<id> { …igual }                               → { project }
     PATCH  ?t=project&id=<id> { visible }                              → { project }
     DELETE ?t=project&id=<id>                                          → { ok }
   Los videos e imágenes se suben aparte, a Vercel Blob (api/upload.js).
   ============================================================ */

import { currentUser } from './_lib/auth.js';
import {
  getPortfolio, getPublicPortfolio, setPortfolio, cleanProject, createProject, updateProject,
  deleteProject, setProjectVisible,
} from './_lib/site.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const t = req.query?.t;
  const id = String(req.query?.id || '');

  try {
    if (req.method === 'GET') {
      if (t === 'portfolio') {
        if (req.query?.all) {
          const user = await currentUser(req);
          if (user?.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });
          return res.status(200).json(await getPortfolio());
        }
        return res.status(200).json(await getPublicPortfolio());
      }
      return res.status(400).json({ error: 'Falta ?t=portfolio' });
    }

    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    if (user.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });

    if (t === 'portfolio' && req.method === 'PUT') {
      return res.status(200).json(await setPortfolio({ duration: req.body?.duration, order: req.body?.order }));
    }

    if (t === 'project') {
      if (req.method === 'PATCH') {
        if (typeof req.body?.visible !== 'boolean') return res.status(400).json({ error: 'Falta visible (true o false).' });
        const project = await setProjectVisible(id, req.body.visible);
        if (!project) return res.status(404).json({ error: 'Proyecto no encontrado.' });
        return res.status(200).json({ project });
      }
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

    res.setHeader('Allow', 'GET, POST, PUT, PATCH, DELETE');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[api/site]', err);
    return res.status(500).json({ error: err.message });
  }
}
