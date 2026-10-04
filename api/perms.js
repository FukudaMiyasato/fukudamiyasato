/* ============================================================
   /api/perms — personas y roles (amos y amo supremo)
   ------------------------------------------------------------
   GET                     → { me, owner, roles, perms: [{ id, email, role, dashboards, tokens?, soles? }], rate? }
                             (tokens, soles y rate solo para el amo supremo)
   POST   { email, role }  → agrega a alguien
   PATCH  { id, role }     → cambia el rol            (solo amo supremo)
   PATCH  { id, dashboard, active }
                           → activa / quita un dashboard a un chismoso
   PATCH  { id, soles }    → suma S/ (negativo = quita) y su equivalente en tokens
                             al saldo de esa persona   (solo amo supremo) · { tokens, soles }
   DELETE ?id=<id>         → quita el acceso (y su saldo)

   Reglas:
     amo supremo → agrega, cambia y elimina amos y chismosos.
     amo         → agrega y elimina chismosos; no toca a otros amos.
   ============================================================ */

import {
  ADMIN_EMAIL, currentUser, isAmo, isOwner, isValidEmail, normEmail, rolesAssignableBy,
  listPerms, addPerm, updatePerm, deletePerm, setDashboardAccess,
} from './_lib/auth.js';
import { listDashboards } from './_lib/dashboards.js';
import { getConfig, solesToTokens } from './_lib/config.js';
import { balanceOf, solesOf, assignSoles, forgetTokens } from './_lib/tokens.js';

const validId = (id) => /^[\w-]{6,40}$/.test(id);

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const catalog = await listDashboards();
    const user = await currentUser(req, catalog);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    if (!isAmo(user)) return res.status(403).json({ error: 'Solo los amos.' });
    const supremo = user.role === 'supremo';
    const canAssign = rolesAssignableBy(user.role);

    if (req.method === 'GET') {
      let perms = await listPerms();
      let rate;
      if (supremo) {
        perms = await Promise.all(perms.map(async (p) => ({ ...p, tokens: await balanceOf(p.email), soles: await solesOf(p.email) })));
        const cfg = await getConfig();
        rate = { usdPen: cfg.usdPen, usdPerM: cfg.usdPerM, tokensPerSol: solesToTokens(cfg, 1) };
      }
      return res.status(200).json({ me: user.role, owner: ADMIN_EMAIL, roles: canAssign, perms, rate });
    }

    if (req.method === 'POST') {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const role = String(req.body?.role || '');
      if (!isValidEmail(email)) return res.status(400).json({ error: 'Correo inválido.' });
      if (!canAssign.includes(role)) return res.status(403).json({ error: 'No puedes dar ese rol.' });
      if (isOwner(email)) return res.status(400).json({ error: 'Ese correo es el amo supremo.' });
      const n = normEmail(email);
      if ((await listPerms()).some((p) => normEmail(p.email) === n)) {
        return res.status(409).json({ error: 'Ese correo ya está en la lista.' });
      }
      return res.status(201).json({ perm: await addPerm(email, role) });
    }

    const perms = await listPerms();

    if (req.method === 'PATCH') {
      const id = String(req.body?.id || '');
      const target = validId(id) && perms.find((p) => p.id === id);
      if (!target) return res.status(404).json({ error: 'No encontrado.' });

      // activar / quitar un dashboard a un chismoso — cualquier amo
      if (req.body?.dashboard != null) {
        const dashId = String(req.body.dashboard).toLowerCase();
        if (!catalog.some((d) => d.id === dashId)) return res.status(400).json({ error: 'Dashboard desconocido.' });
        if (!(await setDashboardAccess(id, dashId, Boolean(req.body.active)))) {
          return res.status(400).json({ error: 'Solo se activan dashboards a chismosos.' });
        }
        return res.status(200).json({ ok: true });
      }

      // asignar soles (→ tokens) — solo el amo supremo
      if (req.body?.soles != null) {
        if (!supremo) return res.status(403).json({ error: 'Solo el amo supremo asigna tokens.' });
        const soles = Math.round(Number(req.body.soles) * 100) / 100;
        if (!Number.isFinite(soles) || soles === 0 || Math.abs(soles) > 100_000) {
          return res.status(400).json({ error: 'Pon un monto en soles (puede ser negativo para quitar).' });
        }
        const tokens = await assignSoles(target.email, soles, solesToTokens(await getConfig(), soles));
        return res.status(200).json({ tokens, soles: await solesOf(target.email) });
      }

      // cambiar el rol — solo el amo supremo
      const role = String(req.body?.role || '');
      if (!supremo) return res.status(403).json({ error: 'Solo el amo supremo cambia roles.' });
      if (!canAssign.includes(role)) return res.status(400).json({ error: 'Rol no permitido.' });
      await updatePerm(id, { role });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'DELETE') {
      const id = String(req.query?.id || '');
      const target = validId(id) && perms.find((p) => p.id === id);
      if (!target) return res.status(404).json({ error: 'No encontrado.' });
      if (target.role === 'amo' && !supremo) return res.status(403).json({ error: 'Solo el amo supremo elimina amos.' });
      await deletePerm(id);
      await forgetTokens(target.email);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[api/perms]', err);
    return res.status(500).json({ error: err.message });
  }
}
