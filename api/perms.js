/* ============================================================
   /api/perms — correos y roles (solo el administrador)
   ------------------------------------------------------------
   GET                     → { owner, roles, perms: [{ id, email, role }] }
   POST   { email, role }  → agrega un correo
   PATCH  { id, role }     → cambia el rol
   DELETE ?id=rec...       → quita el acceso
   ============================================================ */

import {
  ADMIN_EMAIL, ASSIGNABLE_ROLES, currentUser, isOwner, isValidEmail, normEmail,
  listPerms, addPerm, updatePerm, deletePerm,
} from './_lib/auth.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    if (user.role !== 'admin') return res.status(403).json({ error: 'Solo el administrador.' });

    if (req.method === 'GET') {
      return res.status(200).json({ owner: ADMIN_EMAIL, roles: ASSIGNABLE_ROLES, perms: await listPerms() });
    }

    if (req.method === 'POST') {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const role = String(req.body?.role || '');
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Correo inválido.' });
      if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Rol no permitido.' });
      if (isOwner(email)) return res.status(400).json({ error: 'Ese correo ya es el administrador.' });
      const n = normEmail(email);
      if ((await listPerms()).some((p) => normEmail(p.email) === n)) {
        return res.status(409).json({ error: 'Ese correo ya tiene acceso.' });
      }
      return res.status(201).json({ perm: await addPerm(email, role) });
    }

    if (req.method === 'PATCH') {
      const id = String(req.body?.id || '');
      const role = String(req.body?.role || '');
      if (!/^rec\w+$/.test(id)) return res.status(400).json({ error: 'id inválido.' });
      if (!ASSIGNABLE_ROLES.includes(role)) return res.status(400).json({ error: 'Rol no permitido.' });
      await updatePerm(id, role);
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
