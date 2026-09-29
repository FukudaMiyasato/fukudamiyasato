/* ============================================================
   /api/dash — dashboards y los widgets de su lienzo
   ------------------------------------------------------------
   Cualquiera con acceso al dashboard:
     GET    ?d=<id>                → { dashboard, widgets, canEdit, config, members? }
   Solo amos:
     GET    ?d=<id>&members=1      → chismosos y si tienen este dashboard activo
     POST   { name, image? }                        → crea un dashboard
     DELETE ?d=<id>                                 → borra el dashboard (no los fijos)
     POST   ?d=<id>&widget=table
            { prompt, csv, filename, layout }       → OpenAI responde (tabla, número o
                                                      texto) y se guarda como widget
                                                      422 { error } si el pedido no sirve
     PATCH  ?d=<id>  { widget, x, y, w, h }         → mueve / redimensiona
     DELETE ?d=<id>&widget=<widgetId>               → borra el widget
   ============================================================ */

import { currentUser, canSeeDashboard, forgetDashboard, isAmo, listPerms } from './_lib/auth.js';
import {
  listDashboards, publicDash, createDashboard, deleteDashboard,
  listWidgets, createWidget, updateWidgetLayout, deleteWidget,
} from './_lib/dashboards.js';
import { tableFromCsv, TableError } from './_lib/table-ai.js';
import { getConfig } from './_lib/config.js';

export const maxDuration = 60; // OpenAI puede tardar

const MAX_CSV_BYTES = 2 * 1024 * 1024;
const MAX_DATA_CHARS = 300_000; // tope por widget, para que el lienzo cargue rápido

/** Layout válido en celdas de la rejilla. */
function cleanLayout(b) {
  const int = (v, min, max, d) => {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
  };
  return { x: int(b?.x, -500, 500, 0), y: int(b?.y, -500, 500, 0), w: int(b?.w, 3, 60, 10), h: int(b?.h, 3, 60, 8) };
}

/* Ícono subido: imagen chica ya recortada en el navegador. */
const IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
const MAX_IMAGE_CHARS = 120_000;

const publicWidget = (w) => ({ id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, data: w.data });

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const catalog = await listDashboards();
    const user = await currentUser(req, catalog);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    const canEdit = isAmo(user);

    const id = String(req.query?.d || '').toLowerCase();
    const dash = id ? catalog.find((d) => d.id === id) : null;
    if (id && (!dash || !canSeeDashboard(user, id))) {
      return res.status(403).json({ error: 'No tienes permisos para este dashboard.' });
    }

    if (req.method === 'GET') {
      if (!dash) return res.status(400).json({ error: 'Falta ?d=' });
      const chismosos = canEdit ? (await listPerms()).filter((p) => p.role === 'chismoso') : [];

      if (req.query?.members) {
        if (!canEdit) return res.status(403).json({ error: 'Solo los amos.' });
        return res.status(200).json({
          members: chismosos.map((p) => ({ id: p.id, email: p.email, active: p.dashboards.includes(dash.id) })),
        });
      }

      const widgets = await listWidgets(dash.id);
      return res.status(200).json({
        dashboard: publicDash(dash),
        widgets: widgets.map(publicWidget),
        canEdit,
        config: await getConfig(),
        members: canEdit ? chismosos.filter((p) => p.dashboards.includes(dash.id)).length : undefined,
      });
    }

    if (!canEdit) return res.status(403).json({ error: 'Solo los amos.' });

    /* ---------- crear dashboard ---------- */
    if (req.method === 'POST' && !dash) {
      const name = String(req.body?.name || '').trim().slice(0, 60);
      const image = req.body?.image ? String(req.body.image) : null;
      if (!name) return res.status(400).json({ error: 'Ponle un título.' });
      if (image && (!IMAGE_RE.test(image) || image.length > MAX_IMAGE_CHARS)) {
        return res.status(400).json({ error: 'El ícono debe ser una imagen PNG, JPG o WebP chica.' });
      }
      return res.status(201).json({ dashboard: publicDash(await createDashboard(name, image)) });
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

      const data = { ...table, prompt, source: filename };
      while (JSON.stringify(data).length > MAX_DATA_CHARS && data.rows?.length > 1) {
        data.rows = data.rows.slice(0, Math.floor(data.rows.length * 0.8));
        data.cut = true;
      }
      const widget = await createWidget(dash.id, 'table', cleanLayout(req.body?.layout), data);
      return res.status(201).json({ widget: publicWidget(widget) });
    }

    /* ---------- mover / redimensionar ---------- */
    if (req.method === 'PATCH' && dash) {
      const wid = String(req.body?.widget || '');
      if (!(await updateWidgetLayout(dash.id, wid, cleanLayout(req.body)))) return res.status(404).json({ error: 'Widget no encontrado.' });
      return res.status(200).json({ ok: true });
    }

    /* ---------- borrar ---------- */
    if (req.method === 'DELETE' && dash) {
      const wid = String(req.query?.widget || '');
      if (wid) {
        if (!(await deleteWidget(dash.id, wid))) return res.status(404).json({ error: 'Widget no encontrado.' });
        return res.status(200).json({ ok: true });
      }
      if (dash.builtin) return res.status(400).json({ error: 'Este dashboard es fijo y no se puede borrar.' });
      await deleteDashboard(dash);
      await forgetDashboard(dash.id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    console.error('[api/dash]', err);
    return res.status(500).json({ error: err.message });
  }
}
