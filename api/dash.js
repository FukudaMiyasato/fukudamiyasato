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
            { prompt, csv?, filename?, inputs?, layout }
                                                    → OpenAI responde (tabla, gráfico, número o
                                                      texto) y se guarda como widget. Sin CSV
                                                      responde con lo que sabe; `inputs` (widgets
                                                      conectados) se le pasan como contexto
     POST   ?d=<id>&widget=ask { prompt, inputs?, layout }
                                                    → un párrafo como máximo (estrella)
     POST   ?d=<id>&widget=follow { prompt, about, inputs?, layout }
                                                    → clic en el + de un widget: un párrafo más
                                                      libre con el contexto de TODA la cadena
                                                      hacia atrás de `about` (el widget de origen,
                                                      que NO queda conectado) y de `inputs`.
                                                      Se guarda como "ask".
                                                      422 { error } si el pedido no sirve
     POST   ?d=<id>&widget=timeline { data, layout }
                                                    → línea de tiempo (sin IA): hitos + personaje
     POST   ?d=<id>&widget=user { data, layout }
                                                    → usuario (sin IA): tipo + archivos de contexto
     POST   ?d=<id>&widget=nebula { data, layout }  → nebulosa de IA (sin IA por ahora)
     POST   ?d=<id>&mark=flag { x, y }              → bandera (color al azar, sin repetir; máx. 8)
     POST   ?d=<id>&mark=divider                    → raya divisoria una columna a la derecha
                                                      de lo más a la derecha (solo una)
     DELETE ?d=<id>&mark=<flagId|divider>           → quita una bandera o la raya
     PATCH  ?d=<id>  { widget, x?, y?, w?, h?, inputs?, data? }
                                                    → mueve / redimensiona / conecta;
                                                      `data` solo en líneas de tiempo y usuarios
     DELETE ?d=<id>&widget=<widgetId>               → borra el widget
   ============================================================ */

import { currentUser, canSeeDashboard, forgetDashboard, isAmo, listPerms } from './_lib/auth.js';
import {
  listDashboards, publicDash, createDashboard, deleteDashboard,
  listWidgets, createWidget, updateWidget, deleteWidget,
  getMarks, addFlag, setDivider, deleteMark,
} from './_lib/dashboards.js';
import { askVisual, askShort, askFollow, AIError } from './_lib/ai.js';
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

const publicWidget = (w) => ({ id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, data: w.data, inputs: w.inputs || [] });

/* ---------- línea de tiempo ---------- */
const CHARACTERS = ['m', 'f'];
const MAX_MILESTONES = 30;
const isDate = (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));

/** Datos válidos de una línea de tiempo (hitos ordenados por fecha), o null. */
function cleanTimeline(d) {
  if (!d || !Array.isArray(d.milestones)) return null;
  const milestones = d.milestones.slice(0, MAX_MILESTONES).map((m, i) => ({
    id: /^[\w-]{1,24}$/.test(String(m?.id)) ? String(m.id) : `h${i}`,
    name: String(m?.name ?? '').trim().slice(0, 40) || `Hito ${i + 1}`,
    date: String(m?.date ?? ''),
  }));
  if (milestones.length < 2 || !milestones.every((m) => isDate(m.date))) return null;
  milestones.sort((a, b) => a.date.localeCompare(b.date));
  return {
    kind: 'timeline',
    title: String(d.title ?? '').trim().slice(0, 60) || 'Línea de tiempo',
    character: CHARACTERS.includes(d.character) ? d.character : 'm',
    milestones,
  };
}

/* ---------- usuario ---------- */
const PERSONAS = ['default', 'joven', 'papa', 'mama', 'familia', 'nido', 'jubilado'];

/** Datos válidos de un widget de usuario. Del contexto solo se guarda nombre y
    tamaño de cada archivo (por ahora la subida es simulada). */
function cleanUser(d) {
  if (!d || typeof d !== 'object') return null;
  const context = (Array.isArray(d.context) ? d.context : []).slice(0, 10).map((f) => ({
    name: String(f?.name ?? '').trim().slice(0, 120),
    size: Math.max(0, Math.round(Number(f?.size) || 0)),
  })).filter((f) => f.name);
  return { kind: 'user', persona: PERSONAS.includes(d.persona) ? d.persona : 'default', context };
}

/* ---------- nebulosa de IA ---------- */
const cleanNebula = () => ({ kind: 'nebula', title: 'Nebulosa de IA' });

const CLEANERS = { timeline: cleanTimeline, user: cleanUser, nebula: cleanNebula };

/** ids de conexiones válidos: existen en este dashboard, sin repetir y sin el propio. */
function cleanInputs(v, widgets, selfId) {
  if (!Array.isArray(v)) return [];
  const ids = new Set(widgets.map((w) => w.id));
  return [...new Set(v.map(String))].filter((i) => i !== selfId && ids.has(i)).slice(0, 20);
}

/** Los widgets conectados y, hacia atrás, los conectados a esos (sin repetir,
    sin ciclos): primero los directos, luego los de más atrás en la cadena. */
function chainOf(ids, all, max = 30) {
  const byId = new Map(all.map((w) => [w.id, w]));
  const seen = new Set(), out = [];
  let level = ids;
  while (level.length && out.length < max) {
    const next = [];
    for (const id of level) {
      const w = byId.get(id);
      if (!w || seen.has(id)) continue;
      seen.add(id);
      out.push(w);
      next.push(...(w.inputs || []));
    }
    level = next;
  }
  return out.slice(0, max);
}

/** Lo que muestran los widgets conectados, en texto, para dárselo a la IA. */
function contextFrom(list) {
  return list.map((w) => {
    const d = w.data || {};
    let body;
    if (d.kind === 'table') {
      body = [d.columns, ...(d.rows || []).slice(0, 200)].map((r) => r.join(' | ')).join('\n');
    } else if (d.kind === 'user') {
      body = [`Tipo de usuario: ${d.persona}`, ...(d.context || []).map((f) => `Archivo de contexto: ${f.name}`)].join('\n');
    } else if (d.kind === 'timeline') {
      body = d.milestones.map((m) => `${m.date}: ${m.name}`).join('\n');
    } else if (d.kind === 'nebula') {
      body = 'Nebulosa de IA (todavía sin contenido)';
    } else if (d.kind === 'chart') {
      body = d.labels.map((l, i) => `${l}: ${d.values[i]}${d.unit ? ` ${d.unit}` : ''}`).join('\n');
    } else {
      body = [d.value, d.detail].filter(Boolean).join('\n');
    }
    return `### ${d.title || 'Widget'}${d.prompt ? `\n(Pregunta original: ${d.prompt})` : ''}\n${body}`;
  }).join('\n\n');
}

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
        marks: await getMarks(dash.id),
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

    /* ---------- banderas y raya divisoria ---------- */
    const mark = req.query?.mark;
    if (req.method === 'POST' && dash && mark === 'flag') {
      const int = (v) => Math.min(500, Math.max(-500, Math.round(Number(v)) || 0));
      const flag = await addFlag(dash.id, int(req.body?.x), int(req.body?.y));
      if (!flag) return res.status(409).json({ error: 'Ya hay 8 banderas: no quedan colores.' });
      return res.status(201).json({ flag });
    }
    if (req.method === 'POST' && dash && mark === 'divider') {
      // una columna de puntos a la derecha de lo que esté más a la derecha
      const [widgets, marks] = await Promise.all([listWidgets(dash.id), getMarks(dash.id)]);
      const rights = [...widgets.map((w) => w.x + w.w), ...marks.flags.map((f) => f.x)];
      if (!rights.length) return res.status(400).json({ error: 'No hay nada en el lienzo todavía.' });
      const divider = await setDivider(dash.id, Math.max(...rights) + 1);
      if (!divider) return res.status(409).json({ error: 'Ya hay una raya divisoria.' });
      return res.status(201).json({ divider });
    }
    if (req.method === 'DELETE' && dash && mark) {
      if (!(await deleteMark(dash.id, String(mark)))) return res.status(404).json({ error: 'No existe.' });
      return res.status(200).json({ ok: true });
    }

    /* ---------- widgets de IA ---------- */
    const tool = req.query?.widget;
    if (req.method === 'POST' && dash && (tool === 'table' || tool === 'ask' || tool === 'follow')) {
      const prompt = String(req.body?.prompt || '').trim().slice(0, 2000);
      if (!prompt) return res.status(422).json({ error: 'No sirve tu pregunta: no escribiste nada.' });

      const all = await listWidgets(dash.id);
      const inputs = cleanInputs(req.body?.inputs, all, null);
      // el + de un widget usa toda la cadena hacia atrás (de su widget de origen, que no
      // queda conectado, y de lo que se le haya conectado); el resto, solo lo directo
      const about = tool === 'follow' ? cleanInputs(req.body?.about, all, null) : [];
      const context = contextFrom(tool === 'follow'
        ? chainOf([...about, ...inputs], all)
        : all.filter((w) => inputs.includes(w.id)));

      let answer, source = '';
      try {
        if (tool === 'follow') {
          answer = await askFollow({ prompt, context });
        } else if (tool === 'ask') {
          answer = await askShort({ prompt, context });
        } else {
          // tabla con IA: el CSV es opcional; sin archivo, GPT responde con lo que sabe
          const csv = String(req.body?.csv || '');
          if (Buffer.byteLength(csv) > MAX_CSV_BYTES) return res.status(413).json({ error: 'El CSV supera 2 MB.' });
          source = csv.trim() ? String(req.body?.filename || 'datos.csv').slice(0, 120) : '';
          answer = await askVisual({ prompt, csv, filename: source, context });
        }
      } catch (err) {
        if (err instanceof AIError) {
          return res.status(422).json({ error: `${tool === 'table' ? 'No sirve tu tabla' : 'No sirve tu pregunta'}: ${err.message}` });
        }
        throw err;
      }

      const data = { ...answer, prompt, source };
      while (JSON.stringify(data).length > MAX_DATA_CHARS && data.rows?.length > 1) {
        data.rows = data.rows.slice(0, Math.floor(data.rows.length * 0.8));
        data.cut = true;
      }
      const type = tool === 'follow' ? 'ask' : tool; // se ve igual que un widget de la estrella
      const widget = await createWidget(dash.id, type, cleanLayout(req.body?.layout), data, inputs);
      return res.status(201).json({ widget: publicWidget(widget) });
    }

    /* ---------- widgets sin IA: línea de tiempo, usuario y nebulosa ---------- */
    if (req.method === 'POST' && dash && CLEANERS[tool]) {
      const data = CLEANERS[tool](req.body?.data);
      if (!data) return res.status(400).json({ error: 'Datos del widget inválidos.' });
      const widget = await createWidget(dash.id, tool, cleanLayout(req.body?.layout), data);
      return res.status(201).json({ widget: publicWidget(widget) });
    }

    /* ---------- mover / redimensionar / conectar ---------- */
    if (req.method === 'PATCH' && dash) {
      const wid = String(req.body?.widget || '');
      const all = await listWidgets(dash.id);
      const current = all.find((w) => w.id === wid);
      if (!current) return res.status(404).json({ error: 'Widget no encontrado.' });
      const patch = {};
      if (req.body?.x != null) Object.assign(patch, cleanLayout({ ...current, ...req.body }));
      if (req.body?.inputs != null) patch.inputs = cleanInputs(req.body.inputs, all, wid);
      if (req.body?.data != null) {
        const clean = CLEANERS[current.type];
        if (!clean) return res.status(400).json({ error: 'Este widget no se edita así.' });
        patch.data = clean(req.body.data);
        if (!patch.data) return res.status(400).json({ error: 'Datos del widget inválidos.' });
      }
      await updateWidget(dash.id, wid, patch);
      return res.status(200).json({ ok: true, inputs: patch.inputs, data: patch.data });
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
