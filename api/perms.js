/* ============================================================
   /api/perms — correos y roles (solo el administrador)
   ------------------------------------------------------------
   GET                                → { owner, roles, dashboards, perms: [{ id, email, role, dashboards }] }
   POST   { email, role, dashboards } → agrega un correo
   PATCH  { id, role?, dashboards? }  → cambia rol y/o dashboards asignados
   DELETE ?id=rec...       → quita el acceso
   ============================================================ */

import {
  ADMIN_EMAIL, ASSIGNABLE_ROLES, currentUser, isOwner, isValidEmail, normEmail,
  listPerms, addPerm, updatePerm, deletePerm,
} from './_lib/auth.js';
import { listDashboards, publicDash } from './_lib/dashboards.js';

/** Lista de ids válida, o null si trae alguno que no existe. */
function dashList(v, catalog) {
  if (v == null) return [];
  if (!Array.isArray(v)) return null;
  const ids = [...new Set(v.map((x) => String(x).trim().toLowerCase()))];
  return ids.every((id) => catalog.some((d) => d.id === id)) ? ids : null;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const catalog = await listDashboards();
    const user = await currentUser(req, catalog);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador.' });

    if (req.method === 'GET') {
      return res.status(200).json({
        owner: ADMIN_EMAIL, roles: ASSIGNABLE_ROLES, dashboards: catalog.map(publicDash), perms: await listPerms(),
      });
    }

    if (req.method === 'POST') {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const role = String(req.body?.role || '');
      const dashboards = dashList(req.body?.dashboards, catalog);
      if (!dashboards) return res.status(400).json({ error: 'Dashboard desconocido.' });
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Correo inválido.' });
      if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Rol no permitido.' });
      if (isOwner(email)) return res.status(400).json({ error: 'Ese correo ya es el administrador.' });
      const n = normEmail(email);
      if ((await listPerms()).some((p) => normEmail(p.email) === n)) {
        return res.status(409).json({ error: 'Ese correo ya tiene acceso.' });
      }
      return res.status(201).json({ perm: await addPerm(email, role, dashboards) });
    }

    if (req.method === 'PATCH') {
      const id = String(req.body?.id || '');
      const role = req.body?.role == null ? undefined : String(req.body.role);
      const dashboards = req.body?.dashboards == null ? undefined : dashList(req.body.dashboards, catalog);
      if (!/^rec\w+$/.test(id)) return res.status(400).json({ error: 'id inválido.' });
      if (role !== undefined && !ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Rol no permitido.' });
      if (dashboards === null) return res.status(400).json({ error: 'Dashboard desconocido.' });
      if (role === undefined && dashboards === undefined) return res.status(400).json({ error: 'Nada que cambiar.' });
      await updatePerm(id, { role, dashboards });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '');
      if (!/^rec\w+$/.test(id)) return res.status(400).json({ error: 'id inválido.' });
      await deletePerm(id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[api/perms]', err);
    return res.status(500).json({ error: err.message });
  }
}
