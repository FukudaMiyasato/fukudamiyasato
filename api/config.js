/* ============================================================
   /api/config — configuración global (solo amo supremo)
   ------------------------------------------------------------
   GET                  → { config, ranges }
   PUT  { fisheye }     → guarda y devuelve { config }
   Los dashboards la reciben junto con sus widgets (GET /api/dash).
   ============================================================ */

import { currentUser } from './_lib/auth.js';
import { getConfig, setConfig, FISHEYE_RANGE } from './_lib/config.js';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    if (user.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });

    if (req.method === 'GET') {
      return res.status(200).json({ config: await getConfig(), ranges: { fisheye: FISHEYE_RANGE } });
    }

    if (req.method === 'PUT') {
      const n = Math.round(Number(req.body?.fisheye));
      const [min, max] = FISHEYE_RANGE;
      if (!Number.isFinite(n) || n < min || n > max) {
        return res.status(400).json({ error: `El ojo de pez va de ${min} a ${max}.` });
      }
      return res.status(200).json({ config: await setConfig({ fisheye: n }) });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[api/config]', err);
    return res.status(500).json({ error: err.message });
  }
}
