/* ============================================================
   /api/dash — dashboards y los widgets de su lienzo
   ------------------------------------------------------------
   Cualquiera con acceso al dashboard:
     GET    ?d=<id>                → { dashboard, widgets, canEdit, config, members?, tokens?, prices?, spent? }
                                     spent: tokens gastados en este dashboard (amos)
                                     tokens: saldo (null = sin límite, el amo supremo);
                                     prices: lo que cuesta cada herramienta de IA (con sobrecargo)
   Solo amos:
     GET    ?d=<id>&members=1      → chismosos y si tienen este dashboard activo
     POST   { name, image? }                        → crea un dashboard
     PATCH  ?d=<id>  { name?, image? }              → renombra / cambia el ícono (image: null lo
                                                      quita)
     DELETE ?d=<id>                                 → borra el dashboard y sus widgets
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
     Las tres de IA descuentan su precio en tokens (api/_lib/tokens.js):
     sin saldo → 402 { error, tokens, price }; si la llamada falla, se devuelve.
     Al terminar responden también { tokens } con el saldo que queda.
     POST   ?d=<id>&widget=timeline { data, layout }
                                                    → línea de tiempo (sin IA): hitos + personaje
     POST   ?d=<id>&widget=user { data, layout }
                                                    → usuario (sin IA): tipo + archivos de contexto
     POST   ?d=<id>&widget=nebula { data, layout }  → nebulosa de IA (sin IA por ahora)
     POST   ?d=<id>&widget=expert { data, layout }  → profesional: si se conecta a una pregunta,
                                                      la IA responde con su mirada (data.voices)
     POST   ?d=<id>&widget=journey { data, layout } → panel User journey, vacío
     POST   ?d=<id>&journey=<widgetId> { goal }     → la IA arma el journey con los usuarios
                                                      conectados (varios = uno promedio; solo se
                                                      le conectan usuarios); cuesta tokens ("journey")
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
  listDashboards, publicDash, createDashboard, updateDashboard, deleteDashboard,
  listWidgets, createWidget, updateWidget, deleteWidget,
  getMarks, addFlag, setDivider, deleteMark, addSpent, spentOf,
} from './_lib/dashboards.js';
import { askVisual, askShort, askFollow, askJourney, AIError } from './_lib/ai.js';
import { getConfig, priceOf, prices } from './_lib/config.js';
import { unlimited, balanceOf, charge, refund } from './_lib/tokens.js';

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
const LEGACY_USER = {
  default: ['Usuario', 'm', 30], joven: ['Joven', 'm', 22], papa: ['Papá divorciado', 'm', 42],
  mama: ['Mamá soltera', 'f', 36], familia: ['Familia feliz', 'f', 38], nido: ['Nido vacío', 'f', 58],
  jubilado: ['Jubilado', 'm', 70],
};
const MAX_USER_TEXT = 20_000;   // por texto de contexto
const MAX_USER_TEXTS = 100_000; // entre todos

/** Datos válidos de un widget de usuario: nombre, sexo, edad y contexto
    (textos con su contenido; audios solo nombre y tamaño, por ahora). Los de
    tipo fijo ({ persona }) se pasan al formato nuevo. */
function cleanUser(d) {
  if (!d || typeof d !== 'object') return null;
  const legacy = !d.sex && LEGACY_USER[d.persona];
  let budget = MAX_USER_TEXTS;
  const context = (Array.isArray(d.context) ? d.context : []).slice(0, 10).map((f) => {
    const kind = f?.kind === 'text' ? 'text' : 'audio';
    const item = {
      kind,
      name: String(f?.name ?? '').trim().slice(0, 120),
      size: Math.max(0, Math.round(Number(f?.size) || 0)),
    };
    if (kind === 'text' && typeof f?.text === 'string') {
      item.text = f.text.slice(0, Math.min(MAX_USER_TEXT, budget));
      budget -= item.text.length;
    }
    return item;
  }).filter((f) => f.name);
  const age = Math.round(Number(legacy ? legacy[2] : d.age));
  return {
    kind: 'user',
    name: String(legacy ? legacy[0] : d.name ?? '').trim().slice(0, 40) || 'Usuario',
    sex: (legacy ? legacy[1] : d.sex) === 'f' ? 'f' : 'm',
    age: Number.isFinite(age) ? Math.min(90, Math.max(0, age)) : 30,
    context,
  };
}

/* ---------- profesional ---------- */

/** Un experto: nombre, rol y cómo piensa (prompt). El preset solo elige su dibujo. */
function cleanExpert(d) {
  if (!d || typeof d !== 'object') return null;
  const age = Math.round(Number(d.age));
  return {
    kind: 'expert',
    preset: /^[a-z]{2,20}$/.test(String(d.preset)) ? String(d.preset) : 'custom',
    name: String(d.name ?? '').trim().slice(0, 40) || 'Profesional',
    role: String(d.role ?? '').trim().slice(0, 40) || 'Profesional',
    prompt: String(d.prompt ?? '').slice(0, 2000),
    sex: d.sex === 'm' ? 'm' : 'f',
    age: Number.isFinite(age) ? Math.min(90, Math.max(18, age)) : 35,
  };
}

/** Los profesionales conectados no son contexto: le dan su mirada a la IA. */
function voicesOf(list) {
  const experts = list.filter((w) => w.data?.kind === 'expert');
  return {
    rest: list.filter((w) => w.data?.kind !== 'expert'),
    names: experts.map((w) => w.data.name),
    voices: experts.map((w) => `- ${w.data.name} (${w.data.role}): ${w.data.prompt || 'usa su experiencia en ese rol.'}`).join('\n'),
  };
}

/* ---------- panel user journey ---------- */
const txt = (v, max) => String(v ?? '').trim().slice(0, max);

/** El panel: objetivo + lo que generó la IA (se guarda tal cual, recortado). */
function cleanJourney(d) {
  if (!d || typeof d !== 'object') return null;
  const arr = (v, n) => (Array.isArray(v) ? v.slice(0, n) : []);
  return {
    kind: 'journey',
    title: txt(d.title, 60) || 'User journey',
    goal: txt(d.goal, 300),
    persona: txt(d.persona, 200),
    users: arr(d.users, 6).map((u) => ({ name: txt(u?.name, 40) || 'Usuario', sex: u?.sex === 'f' ? 'f' : 'm', age: Math.min(90, Math.max(0, Math.round(Number(u?.age) || 0))) })),
    voices: arr(d.voices, 6).map((v) => txt(v, 40)).filter(Boolean),
    entries: arr(d.entries, 6).map((e) => ({ name: txt(e?.name, 40), channel: txt(e?.channel, 30), detail: txt(e?.detail, 140) })).filter((e) => e.name),
    stages: arr(d.stages, 8).map((x) => ({
      name: txt(x?.name, 40), doing: txt(x?.doing, 160), thinking: txt(x?.thinking, 160),
      feeling: Math.max(-2, Math.min(2, Math.round(Number(x?.feeling) || 0))),
      emotion: txt(x?.emotion, 30), pain: txt(x?.pain, 160), opportunity: txt(x?.opportunity, 160),
    })).filter((x) => x.name),
  };
}

/** Un usuario en texto para la IA: sus textos de contexto (los audios solo se nombran). */
const userContext = (d) => (d.context || []).map((f) => (f.kind === 'text' && f.text
  ? `Texto «${f.name}»:\n${f.text.slice(0, 6000)}`
  : `Audio «${f.name}» (sin transcribir)`)).join('\n\n');

/* ---------- archivo ---------- */
const MAX_FILE_TEXT = 240_000;
const FILE_TYPES = ['csv', 'xlsx', 'json', 'text'];

/** Archivos subidos: nombre, tipo y su texto (entre todos, hasta MAX_FILE_TEXT). */
function cleanFile(d) {
  if (!d || typeof d !== 'object') return null;
  let budget = MAX_FILE_TEXT;
  const files = (Array.isArray(d.files) ? d.files : []).slice(0, 6).map((f) => {
    const text = String(f?.text ?? '').slice(0, Math.max(0, budget));
    budget -= text.length;
    const rows = Number.isFinite(Number(f?.rows)) && f?.rows != null ? Math.max(0, Math.round(Number(f.rows))) : null;
    return {
      name: txt(f?.name, 120), size: Math.max(0, Math.round(Number(f?.size) || 0)),
      type: FILE_TYPES.includes(f?.type) ? f.type : 'text', text,
      ...(rows != null ? { rows } : {}), ...(f?.cut || text.length < String(f?.text ?? '').length ? { cut: true } : {}),
    };
  }).filter((f) => f.name);
  return { kind: 'file', title: txt(d.title, 60) || 'Archivo', files };
}

/* ---------- nebulosa de IA ---------- */
const cleanNebula = () => ({ kind: 'nebula', title: 'Nebulosa de IA' });

const CLEANERS = { timeline: cleanTimeline, user: cleanUser, expert: cleanExpert, journey: cleanJourney, file: cleanFile, nebula: cleanNebula };

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
      body = [
        d.sex ? `${d.sex === 'f' ? 'Mujer' : 'Hombre'} de ${d.age} años` : `Tipo de usuario: ${d.persona}`,
        ...(d.context || []).map((f) => (f.kind === 'text' && f.text
          ? `Texto «${f.name}»:\n${f.text.slice(0, 4000)}`
          : `Audio de contexto: ${f.name} (sin transcribir)`)),
      ].join('\n');
    } else if (d.kind === 'timeline') {
      body = d.milestones.map((m) => `${m.date}: ${m.name}`).join('\n');
    } else if (d.kind === 'journey') {
      body = [
        d.goal ? `Objetivo: ${d.goal}` : '', d.persona ? `Usuario: ${d.persona}` : '',
        d.entries?.length ? `Puntos de entrada: ${d.entries.map((e) => `${e.name} (${e.channel})`).join(', ')}` : '',
        ...(d.stages || []).map((x, i) => `${i + 1}. ${x.name} — hace: ${x.doing}; piensa: ${x.thinking}; siente: ${x.emotion} (${x.feeling}); dolor: ${x.pain}; oportunidad: ${x.opportunity}`),
      ].filter(Boolean).join('\n') || 'User journey vacío';
    } else if (d.kind === 'expert') {
      body = `Profesional: ${d.name} (${d.role}). ${d.prompt}`;
    } else if (d.kind === 'file') {
      body = (d.files || []).map((f) => `Archivo «${f.name}» (${f.type === 'xlsx' ? 'Excel, como CSV' : f.type}${f.rows != null ? `, ${f.rows} filas` : ''}${f.cut ? ', recortado' : ''}):\n\`\`\`\n${f.text}\n\`\`\``).join('\n\n') || 'Archivo vacío';
    } else if (d.kind === 'nebula') {
      body = 'Nebulosa de IA (todavía sin contenido)';
    } else if (d.kind === 'chart') {
      body = d.labels.map((l, i) => `${l}: ${d.values[i]}${d.unit ? ` ${d.unit}` : ''}`).join('\n');
    } else {
      body = [d.value, d.detail].filter(Boolean).join('\n');
    }
    return `### ${d.title || d.name || 'Widget'}${d.prompt ? `\n(Pregunta original: ${d.prompt})` : ''}\n${body}`;
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
      const config = await getConfig();
      return res.status(200).json({
        dashboard: publicDash(dash),
        widgets: widgets.map(publicWidget),
        marks: await getMarks(dash.id),
        canEdit,
        config: { fisheye: config.fisheye },
        tokens: canEdit ? (unlimited(user) ? null : await balanceOf(user.email)) : undefined,
        prices: canEdit ? prices(config) : undefined,
        members: canEdit ? chismosos.filter((p) => p.dashboards.includes(dash.id)).length : undefined,
        spent: canEdit ? await spentOf(dash.id) : undefined,
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
      const { rest, names, voices } = voicesOf(tool === 'follow'
        ? chainOf([...about, ...inputs], all)
        : all.filter((w) => inputs.includes(w.id)));
      const context = contextFrom(rest);

      // tokens: se reservan antes de llamar a OpenAI (el amo supremo no paga, pero igual
      // cuenta en el gasto del dashboard)
      const cost = priceOf(await getConfig(), tool);
      const price = unlimited(user) ? 0 : cost;
      if (price && !(await charge(user.email, price))) {
        return res.status(402).json({
          error: `No te quedan tokens: esta herramienta cuesta ${price.toLocaleString('es-PE')}.`,
          tokens: await balanceOf(user.email), price,
        });
      }

      let answer, source = '';
      try {
        if (tool === 'follow') {
          answer = await askFollow({ prompt, context, voices });
        } else if (tool === 'ask') {
          answer = await askShort({ prompt, context, voices });
        } else {
          // tabla con IA: el CSV es opcional; sin archivo, GPT responde con lo que sabe
          const csv = String(req.body?.csv || '');
          if (Buffer.byteLength(csv) > MAX_CSV_BYTES) {
            if (price) await refund(user.email, price);
            return res.status(413).json({ error: 'El CSV supera 2 MB.' });
          }
          source = csv.trim() ? String(req.body?.filename || 'datos.csv').slice(0, 120) : '';
          answer = await askVisual({ prompt, csv, filename: source, context, voices });
        }
      } catch (err) {
        if (price) await refund(user.email, price); // no hubo respuesta útil: no se cobra
        if (err instanceof AIError) {
          return res.status(422).json({ error: `${tool === 'table' ? 'No sirve tu tabla' : 'No sirve tu pregunta'}: ${err.message}` });
        }
        throw err;
      }

      const data = { ...answer, prompt, source, ...(names.length ? { voices: names } : {}) };
      while (JSON.stringify(data).length > MAX_DATA_CHARS && data.rows?.length > 1) {
        data.rows = data.rows.slice(0, Math.floor(data.rows.length * 0.8));
        data.cut = true;
      }
      // el + responde texto (se ve como la estrella) o algo visual (como la tabla con IA)
      const type = tool === 'follow' ? (answer.kind === 'text' ? 'ask' : 'table') : tool;
      const widget = await createWidget(dash.id, type, cleanLayout(req.body?.layout), data, inputs);
      const spent = await addSpent(dash.id, cost);
      return res.status(201).json({ widget: publicWidget(widget), tokens: unlimited(user) ? null : await balanceOf(user.email), spent });
    }

    /* ---------- panel User journey: generar ---------- */
    if (req.method === 'POST' && dash && req.query?.journey) {
      const all = await listWidgets(dash.id);
      const panel = all.find((w) => w.id === String(req.query.journey) && w.type === 'journey');
      if (!panel) return res.status(404).json({ error: 'Panel no encontrado.' });
      const linked = all.filter((w) => (panel.inputs || []).includes(w.id));
      const users = linked.filter((w) => w.data?.kind === 'user' && w.data.sex);
      if (!users.length) return res.status(422).json({ error: 'Conecta al menos un usuario al panel.' });
      const goal = txt(req.body?.goal, 300);

      const cost = priceOf(await getConfig(), 'journey');
      const price = unlimited(user) ? 0 : cost;
      if (price && !(await charge(user.email, price))) {
        return res.status(402).json({
          error: `No te quedan tokens: el journey cuesta ${price.toLocaleString('es-PE')}.`,
          tokens: await balanceOf(user.email), price,
        });
      }
      let out;
      try {
        out = await askJourney({
          goal,
          users: users.map((w) => ({ name: w.data.name, sex: w.data.sex, age: w.data.age, context: userContext(w.data) })),
        });
      } catch (err) {
        if (price) await refund(user.email, price);
        if (err instanceof AIError) return res.status(422).json({ error: `No salió el journey: ${err.message}` });
        throw err;
      }
      const data = cleanJourney({
        ...out, goal,
        users: users.map((w) => ({ name: w.data.name, sex: w.data.sex, age: w.data.age })),
      });
      await updateWidget(dash.id, panel.id, { data });
      const spent = await addSpent(dash.id, cost);
      return res.status(200).json({ data, tokens: unlimited(user) ? null : await balanceOf(user.email), spent });
    }

    /* ---------- widgets sin IA: línea de tiempo, usuario, profesional, paneles y nebulosa ---------- */
    if (req.method === 'POST' && dash && CLEANERS[tool]) {
      const data = CLEANERS[tool](req.body?.data);
      if (!data) return res.status(400).json({ error: 'Datos del widget inválidos.' });
      const widget = await createWidget(dash.id, tool, cleanLayout(req.body?.layout), data);
      return res.status(201).json({ widget: publicWidget(widget) });
    }

    /* ---------- editar el dashboard: nombre e ícono ---------- */
    if (req.method === 'PATCH' && dash && !req.body?.widget) {
      const patch = {};
      if (req.body?.name != null) {
        patch.name = String(req.body.name).trim().slice(0, 60);
        if (!patch.name) return res.status(400).json({ error: 'Ponle un título.' });
      }
      if (req.body && 'image' in req.body) {
        const image = req.body.image ? String(req.body.image) : null;
        if (image && (!IMAGE_RE.test(image) || image.length > MAX_IMAGE_CHARS)) {
          return res.status(400).json({ error: 'El ícono debe ser una imagen PNG, JPG o WebP chica.' });
        }
        patch.image = image;
      }
      await updateDashboard(dash.id, patch);
      return res.status(200).json({ dashboard: publicDash({ ...dash, ...patch }) });
    }

    /* ---------- mover / redimensionar / conectar ---------- */
    if (req.method === 'PATCH' && dash) {
      const wid = String(req.body?.widget || '');
      const all = await listWidgets(dash.id);
      const current = all.find((w) => w.id === wid);
      if (!current) return res.status(404).json({ error: 'Widget no encontrado.' });
      const patch = {};
      if (req.body?.x != null) Object.assign(patch, cleanLayout({ ...current, ...req.body }));
      if (req.body?.inputs != null) {
        patch.inputs = cleanInputs(req.body.inputs, all, wid);
        // al user journey solo se le conectan usuarios
        if (current.type === 'journey') patch.inputs = patch.inputs.filter((i) => all.find((w) => w.id === i)?.data?.kind === 'user');
      }
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
