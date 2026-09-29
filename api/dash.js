/* ============================================================
   /api/dash — dashboards y los widgets de su lienzo
   ------------------------------------------------------------
   Cualquiera con acceso al dashboard:
     GET    ?d=<id>                → { dashboard, widgets, canEdit }
   Solo admin:
     POST   { name, icon }                          → crea un dashboard
     DELETE ?d=<id>                                 → borra el dashboard (no los fijos)
     POST   ?d=<id>&widget=table
            { prompt, csv, filename, layout }       → OpenAI arma la tabla y se guarda
                                                      422 { error } si el pedido no sirve
     PATCH  ?d=<id>  { widget, x, y, w, h }         → mueve / redimensiona
     DELETE ?d=<id>&widget=<recId>                  → borra el widget
   ============================================================ */

import { currentUser, canSeeDashboard } from './_lib/auth.js';
import {
  ICON_KEYS, listDashboards, publicDash, createDashboard, deleteDashboard,
  listWidgets, createWidget, updateWidgetLayout, deleteWidget,
} from './_lib/dashboards.js';
import { tableFromCsv, TableError } from './_lib/table-ai.js';

export const maxDuration = 60; // OpenAI puede tardar

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_DATA_CHARS = 95_000; // Airtable: texto largo hasta 100k

/** Layout válido en celdas de la rejilla. */
function cleanLayout(b) {
  const int = (v, min, max, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  return { x: int(b?.x, -500, 500, 0), y: int(b?.y, -500, 500, 0), w: int(b?.w, 3, 60, 10), h: int(b?.h, 3, 60, 8) };
}

const publicWidget = (w) => ({ id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, data: w.data });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const catalog = await listDashboards();
    const user = await currentUser(req, catalog);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    const isAdmin = user.role === 'admin';

    const id = String(req.query?.d || '').toLowerCase();
    const dash = id ? catalog.find((d) => d.id === id) : null;
    if (id && (!dash || !canSeeDashboard(user, id))) {
      return res.status(403).json({ error: 'No tienes permisos para este dashboard.' });
    }

    if (req.method === 'GET') {
      if (!dash) return res.status(400).json({ error: 'Falta ?d=' });
      const widgets = await listWidgets(dash.id);
      return res.status(200).json({ dashboard: publicDash(dash), widgets: widgets.map(publicWidget), canEdit: isAdmin });
    }

    if (!isAdmin) return res.status(403).json({ error: 'Solo el administrador.' });

    /* ---------- crear dashboard ---------- */
    if (req.method === 'POST' && !dash) {
      const name = String(req.body?.name || '').trim().slice(0, 60);
      const icon = String(req.body?.icon || 'grid');
      if (!name) return res.status(400).json({ error: 'Ponle un nombre.' });
      if (!ICON_KEYS.includes(icon)) return res.status(400).json({ error: 'Ícono desconocido.' });
      return res.status(201).json({ dashboard: publicDash(await createDashboard(name, icon)) });
    }

    /* ---------- widget tabla: CSV + pedido → OpenAI ---------- */
    if (req.method === 'POST' && dash && req.query?.widget === 'table') {
      const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
      const csv = String(req.body?.csv || '');
      const filename = String(req.body?.filename || 'datos.csv').slice(0, 120);
      if (!csv.trim()) return res.status(422).json({ error: 'No sirve tu tabla: falta el archivo CSV.' });
      if (Buffer.byteLength(csv) > MAX_CSV_BYTES) return res.status(413).json({ error: 'El CSV supera 2 MB.' });
      if (!prompt) return res.status(422).json({ error: 'No sirve tu tabla: no escribiste qué quieres ver.' });

      let table;
      try {
        table = await tableFromCsv({ csv, filename, prompt });
      } catch (err) {
        if (err instanceof TableError) return res.status(422).json({ error: `No sirve tu tabla: ${err.message}` });
        throw err;
      }

      const data = { title: table.title, prompt, source: filename, columns: table.columns, rows: table.rows, truncated: table.truncated };
      while (JSON.stringify(data).length > MAX_DATA_CHARS && data.rows.length > 1) {
        data.rows = data.rows.slice(0, Math.floor(data.rows.length * 0.8));
        data.cut = true;
      }
      const widget = await createWidget(dash.id, 'table', cleanLayout(req.body?.layout), data);
      return res.status(201).json({ widget: publicWidget(widget) });
    }

    /* ---------- mover / redimensionar ---------- */
    if (req.method === 'PATCH' && dash) {
      const wid = String(req.body?.widget || '');
      if (!(await listWidgets(dash.id)).some((w) => w.id === wid)) return res.status(404).json({ error: 'Widget no encontrado.' });
      await updateWidgetLayout(wid, cleanLayout(req.body));
      return res.status(200).json({ ok: true });
    }

    /* ---------- borrar ---------- */
    if (req.method === 'DELETE' && dash) {
      const wid = String(req.query?.widget || '');
      if (wid) {
        if (!(await listWidgets(dash.id)).some((w) => w.id === wid)) return res.status(404).json({ error: 'Widget no encontrado.' });
        await deleteWidget(wid);
        return res.status(200).json({ ok: true });
      }
      if (dash.builtin) return res.status(400).json({ error: 'Este dashboard es fijo y no se puede borrar.' });
      await deleteDashboard(dash);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[api/dash]', err);
    return res.status(500).json({ error: err.message });
  }
}
