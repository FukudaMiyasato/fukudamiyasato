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
     POST   ?d=<id>&import=1[&keep=1] { widgets: [{ id, type, x, y, w, h, data, inputs }] }
                                                    → { created, ids: { idViejo: idNuevo } }. Con keep
                                                      (deshacer un borrado) quedan en su mismo lugar y
                                                      pueden conectarse a widgets que ya están
                                                    → agrega widgets de una plantilla o de otro
                                                      dashboard (exportado): se validan como
                                                      cualquier widget, se ponen a la derecha de lo
                                                      que ya hay y se reconectan entre sí
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
     POST   ?d=<id>&widget=expert { data, layout }  → celebridad: si se conecta a una pregunta,
                                                      la IA responde con su mirada (data.voices)
     POST   ?d=<id>&widget=journey { data, layout } → panel User journey, vacío
     POST   ?d=<id>&widget=pro { data, layout }     → profesional (por ahora, Researcher)
     POST   ?d=<id>&research=<proId> { question | similar: widgetId, filters?, slots: [{ x, y, w, h }] }
                                                    → similar: busca soluciones parecidas a ese widget
                                                      (conectado al Researcher), con filtros opcionales.
                                                      Lo ya investigado se repite sin tokens (cached)
                                                    → el Researcher busca en la web y deja hasta 5
                                                      hallazgos con fuentes, conectados a él, en los
                                                      lugares libres que manda el navegador; cuesta
                                                      tokens ("research")
     POST   ?d=<id>&journey=<widgetId> { goal }     → la IA arma el journey con los usuarios
                                                      conectados por la izquierda (usuarios o grupos
                                                      con usuarios; varios = uno promedio); cuesta
                                                      tokens ("journey")
     POST   ?d=<id>&fit=<journeyId>&sol=<widgetId>  → nodo superior del journey: la IA ve si esa
                                                      solución encaja en alguna etapa. Sí → la deja
                                                      conectada (tops) con su impacto y qué podría
                                                      fallar por etapa; no → { compatible: false, reason }
                                                      y no queda conectada; cuesta tokens ("fit").
                                                      Hasta 3 soluciones, cada una con su color; la
                                                      cuarta suelta a la más antigua (replaced). Cada resultado se guarda
                                                      (fitCache): si el journey y la solución no
                                                      cambiaron, se repite sin gastar tokens (cached)
     POST   ?d=<id>&mark=flag { x, y }              → bandera (color al azar, sin repetir; máx. 8)
     POST   ?d=<id>&mark=divider                    → raya divisoria una columna a la derecha
                                                      de lo más a la derecha (solo una)
     DELETE ?d=<id>&mark=<flagId|divider>           → quita una bandera o la raya
     PATCH  ?d=<id>&mark=<flagId|divider> { x, y }  → mueve una bandera (la raya, solo x)
     PATCH  ?d=<id>  { widget, x?, y?, w?, h?, inputs?, data? }
                                                    → mueve / redimensiona / conecta;
                                                      `data` solo en líneas de tiempo y usuarios
     DELETE ?d=<id>&widget=<widgetId>               → borra el widget
   ============================================================ */

import crypto from 'node:crypto';
import { currentUser, canSeeDashboard, forgetDashboard, isAmo, listPerms } from './_lib/auth.js';
import {
  listDashboards, publicDash, createDashboard, updateDashboard, deleteDashboard,
  listWidgets, createWidget, updateWidget, deleteWidget,
  getMarks, addFlag, setDivider, deleteMark, moveMark, addSpent, spentOf,
} from './_lib/dashboards.js';
import { askVisual, askShort, askFollow, askJourney, askJourneyFit, askResearch, AIError } from './_lib/ai.js';
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

const publicWidget = (w) => ({ id: w.id, type: w.type, x: w.x, y: w.y, w: w.w, h: w.h, data: w.data, inputs: w.inputs || [], ...(w.tops?.length ? { tops: w.tops } : {}) });

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

/* ---------- celebridad (widget "expert") ---------- */

/** Un experto: nombre, rol y cómo piensa (prompt). El preset solo elige su dibujo. */
function cleanExpert(d) {
  if (!d || typeof d !== 'object') return null;
  const age = Math.round(Number(d.age));
  return {
    kind: 'expert',
    preset: /^[a-z]{2,20}$/.test(String(d.preset)) ? String(d.preset) : 'custom',
    name: String(d.name ?? '').trim().slice(0, 40) || 'Celebridad',
    role: String(d.role ?? '').trim().slice(0, 40) || 'Celebridad',
    prompt: String(d.prompt ?? '').slice(0, 2000),
    sex: d.sex === 'm' ? 'm' : 'f',
    age: Number.isFinite(age) ? Math.min(90, Math.max(18, age)) : 35,
  };
}

/** Las celebridades conectadas no son contexto: le dan su mirada a la IA. */
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
const JOURNEY_ROWS = ['doing', 'thinking', 'pain', 'opportunity'];
const MAX_SOLUTIONS = 3;
const SOL_COLORS = ['#ffd166', '#4dd4ff', '#ff6ad5']; // un brillo distinto por solución

/** Resultado de la IA para una solución, como se guarda. */
const cleanFit = (f) => ({
  compatible: Boolean(f?.compatible),
  reason: txt(f?.reason, 400),
  impacts: (Array.isArray(f?.impacts) ? f.impacts : []).slice(0, 8)
    .map((i) => ({ stage: Math.max(0, Math.round(Number(i?.stage) || 0)), impact: txt(i?.impact, 220), risk: txt(i?.risk, 220) })),
});
const FIT_CACHE_MAX = 16;
function cleanFitCache(c) {
  if (!c || typeof c !== 'object') return {};
  return Object.fromEntries(Object.entries(c).filter(([k]) => /^[0-9a-f]{40}$/.test(k)).slice(-FIT_CACHE_MAX).map(([k, v]) => [k, cleanFit(v)]));
}
/** Clave del resultado: las etapas del journey + lo que dice la solución. Si nada cambió, es la misma. */
const fitKey = (journey, sol) => crypto.createHash('sha1')
  .update(JSON.stringify((journey.stages || []).map((x) => [x.name, x.doing, x.thinking, x.feeling, x.emotion, x.pain, x.opportunity])))
  .update('|')
  .update(contextFrom([sol]))
  .digest('hex');

/** Lo que está entero dentro de un grupo (como en el lienzo). */
const insideOf = (g, all) => all.filter((w) => w !== g && w.x >= g.x && w.y >= g.y && w.x + w.w <= g.x + g.w && w.y + w.h <= g.y + g.h);
/** Usuarios conectados a un widget: directos o dentro de un grupo conectado. */
const usersOf = (panel, all) => [...new Set(all.filter((w) => (panel.inputs || []).includes(w.id))
  .flatMap((w) => (w.data?.kind === 'group' ? insideOf(w, all) : [w])))]
  .filter((w) => w.data?.kind === 'user' && w.data.sex);

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
      // lo que agregó una persona soltando un post-it en una fila
      adds: arr(x?.adds, 12).map((a) => ({
        row: JOURNEY_ROWS.includes(a?.row) ? a.row : 'opportunity',
        text: txt(a?.text, 240),
        by: { name: txt(a?.by?.name, 60), picture: /^https:\/\//.test(a?.by?.picture || '') ? String(a.by.picture).slice(0, 500) : '' },
      })).filter((a) => a.text),
    })).filter((x) => x.name),
    // resultados guardados de cada solución analizada (clave: journey + solución)
    fitCache: cleanFitCache(d.fitCache),
    // soluciones conectadas arriba que encajan: dónde impactan y qué podría fallar
    solutions: arr(d.solutions, MAX_SOLUTIONS).map((s) => ({
      id: txt(s?.id, 40), title: txt(s?.title, 60) || 'Solución',
      color: SOL_COLORS.includes(s?.color) ? s.color : SOL_COLORS[0],
      impacts: arr(s?.impacts, 8).map((i) => ({ stage: Math.max(0, Math.round(Number(i?.stage) || 0)), impact: txt(i?.impact, 220), risk: txt(i?.risk, 220) })),
    })).filter((s) => s.id && s.impacts.length),
  };
}

/** Un usuario en texto para la IA: sus textos de contexto (los audios solo se nombran). */
const userContext = (d) => (d.context || []).map((f) => (f.kind === 'text' && f.text
  ? `Texto «${f.name}»:\n${f.text.slice(0, 6000)}`
  : `Audio «${f.name}» (sin transcribir)`)).join('\n\n');

/* ---------- profesionales (Researcher) y sus hallazgos ---------- */
const PRO_ROLES = ['researcher'];

/** Resultado de una investigación, como se guarda (para repetirla sin tokens). */
const cleanResearch = (r) => ({
  mode: r?.mode === 'answer' ? 'answer' : 'list',
  thought: txt(r?.thought, 160),
  confidence: ['alta', 'media', 'baja'].includes(r?.confidence) ? r.confidence : 'media',
  items: (Array.isArray(r?.items) ? r.items : []).slice(0, 5).map((it) => ({
    title: txt(it?.title, 60), summary: txt(it?.summary, 700),
    sources: (Array.isArray(it?.sources) ? it.sources : []).slice(0, 4)
      .map((x) => ({ url: String(x?.url ?? '').slice(0, 500), title: txt(x?.title, 140) })).filter((x) => /^https?:\/\//.test(x.url)),
  })).filter((it) => it.title && it.sources.length),
});

function cleanPro(d) {
  if (!d || typeof d !== 'object') return null;
  const cache = d.cache && typeof d.cache === 'object' ? d.cache : {};
  return {
    kind: 'pro',
    role: PRO_ROLES.includes(d.role) ? d.role : 'researcher',
    name: txt(d.name, 40) || 'Researcher',
    thought: txt(d.thought, 160),
    history: (Array.isArray(d.history) ? d.history : []).slice(-12).map((h) => ({ q: txt(h?.q, 300), n: Math.max(0, Math.min(5, Math.round(Number(h?.n) || 0))) })).filter((h) => h.q),
    // investigaciones ya hechas: misma pregunta (o misma solución + filtros) → mismo resultado, sin tokens
    cache: Object.fromEntries(Object.entries(cache).filter(([k]) => /^[0-9a-f]{40}$/.test(k)).slice(-10).map(([k, v]) => [k, cleanResearch(v)])),
  };
}

/** Pregunta del Researcher para buscar soluciones parecidas a un widget. */
function similarQuestion(sol, filters) {
  const d = sol.data || {};
  const title = d.title || d.name || 'esta solución';
  const what = String(d.value || d.summary || d.text || '').slice(0, 900);
  return `¿Qué soluciones parecidas a «${title}» existen de verdad (programas, productos, campañas o estudios)?`
    + (what ? ` En qué consiste: ${what}` : '') + (filters ? ` Filtros: ${filters}.` : '');
}
/** Clave de una investigación: lo que se preguntó (o la solución y sus filtros). */
const researchKey = (question, sol, filters) => crypto.createHash('sha1')
  .update(sol ? `similar|${contextFrom([sol])}|${String(filters || '').trim().toLowerCase()}` : `q|${question.trim().toLowerCase()}`)
  .digest('hex');

function cleanFinding(d) {
  if (!d || typeof d !== 'object') return null;
  return {
    kind: 'finding',
    title: txt(d.title, 60) || 'Hallazgo',
    summary: txt(d.summary, 700),
    question: txt(d.question, 300),
    by: txt(d.by, 40),
    confidence: ['alta', 'media', 'baja'].includes(d.confidence) ? d.confidence : 'media',
    sources: (Array.isArray(d.sources) ? d.sources : []).slice(0, 4)
      .map((s) => ({ url: String(s?.url ?? '').slice(0, 500), title: txt(s?.title, 140) }))
      .filter((s) => /^https?:\/\//.test(s.url)),
  };
}

/* ---------- respuestas de IA (tabla con IA, pregunta): para importar ---------- */
const CHART_TYPES = ['bar', 'line', 'pie'];
function cleanAnswer(d) {
  if (!d || typeof d !== 'object') return null;
  const base = {
    title: txt(d.title, 80) || 'Respuesta', prompt: txt(d.prompt, 2000), source: txt(d.source, 120),
    ...(Array.isArray(d.voices) && d.voices.length ? { voices: d.voices.slice(0, 6).map((v) => txt(v, 40)) } : {}),
  };
  if (d.kind === 'number' || d.kind === 'text') {
    const value = txt(d.value, 800);
    return value ? { ...base, kind: d.kind, value, detail: txt(d.detail, 300) } : null;
  }
  if (d.kind === 'chart') {
    const n = Math.min(d.labels?.length || 0, d.values?.length || 0, 40);
    const values = (d.values || []).slice(0, n).map(Number);
    if (!n || values.some((v) => !Number.isFinite(v))) return null;
    return { ...base, kind: 'chart', chartType: CHART_TYPES.includes(d.chartType) ? d.chartType : 'bar', labels: d.labels.slice(0, n).map((l) => txt(l, 60)), values, unit: txt(d.unit, 20), detail: txt(d.detail, 300) };
  }
  if (d.kind === 'table') {
    const columns = (Array.isArray(d.columns) ? d.columns : []).slice(0, 20).map((c) => txt(c, 300));
    if (!columns.length) return null;
    const rows = (Array.isArray(d.rows) ? d.rows : []).slice(0, 200).map((r) => columns.map((_, i) => txt(r?.[i], 300)));
    return { ...base, kind: 'table', columns, rows };
  }
  return null;
}

/* ---------- post-it ---------- */
const NOTE_COLORS = ['#ffd84d', '#ff9ec4', '#9be7a2', '#9fd3ff', '#ffb36b'];
const cleanNote = (d) => (d && typeof d === 'object'
  ? { kind: 'note', text: String(d.text ?? '').slice(0, 400), color: NOTE_COLORS.includes(d.color) ? d.color : NOTE_COLORS[0] }
  : null);

/* ---------- texto y grupo ---------- */
const LABEL_STYLES = ['title', 'subtitle', 'body'];
const cleanLabel = (d) => (d && typeof d === 'object'
  ? { kind: 'label', text: String(d.text ?? '').slice(0, 600) || ' ', style: LABEL_STYLES.includes(d.style) ? d.style : 'title' }
  : null);
const cleanGroup = (d) => (d && typeof d === 'object'
  ? { kind: 'group', title: txt(d.title, 60) || 'Grupo', color: /^#[0-9a-f]{6}$/i.test(d.color) ? d.color : '#ff3b4f' }
  : null);

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

const CLEANERS = { timeline: cleanTimeline, user: cleanUser, expert: cleanExpert, journey: cleanJourney, file: cleanFile, pro: cleanPro, finding: cleanFinding, label: cleanLabel, group: cleanGroup, note: cleanNote, nebula: cleanNebula };

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
      body = `Celebridad: ${d.name} (${d.role}). ${d.prompt}`;
    } else if (d.kind === 'label' || d.kind === 'note') {
      body = d.text;
    } else if (d.kind === 'group') {
      body = `Grupo «${d.title}»`;
    } else if (d.kind === 'finding') {
      body = `${d.summary}\nFuentes: ${(d.sources || []).map((x) => x.url).join(' · ')}`;
    } else if (d.kind === 'pro') {
      body = `${d.name}: ${d.thought || ''}`;
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
    if (req.method === 'PATCH' && dash && mark) {
      const int = (v) => Math.min(500, Math.max(-500, Math.round(Number(v)) || 0));
      if (!(await moveMark(dash.id, String(mark), int(req.body?.x), int(req.body?.y)))) return res.status(404).json({ error: 'No existe.' });
      return res.status(200).json({ ok: true });
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
      const users = usersOf(panel, all);
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
        ...out, goal, solutions: [], // las etapas cambian: las soluciones se vuelven a conectar
        users: users.map((w) => ({ name: w.data.name, sex: w.data.sex, age: w.data.age })),
      });
      await updateWidget(dash.id, panel.id, { data });
      const spent = await addSpent(dash.id, cost);
      return res.status(200).json({ data, tokens: unlimited(user) ? null : await balanceOf(user.email), spent });
    }

    /* ---------- importar widgets (plantilla o exportado) ---------- */
    if (req.method === 'POST' && dash && req.query?.import) {
      const items = (Array.isArray(req.body?.widgets) ? req.body.widgets : []).slice(0, 200);
      const clean = items.map((w) => {
        const type = String(w?.type || '');
        const data = type === 'table' || type === 'ask' ? cleanAnswer(w?.data) : CLEANERS[type]?.(w?.data);
        return data ? {
          key: String(w.id ?? ''), type, layout: cleanLayout(w), data,
          inputs: Array.isArray(w.inputs) ? w.inputs.map(String) : [], tops: Array.isArray(w.tops) ? w.tops.map(String) : [],
          // plantillas: resultados ya calculados de soluciones (para conectarlas sin gastar tokens)
          presets: (type === 'journey' && Array.isArray(w.data?.fitPresets) ? w.data.fitPresets
            : type === 'pro' && Array.isArray(w.data?.researchPresets) ? w.data.researchPresets : []).slice(0, 8),
        } : null;
      }).filter(Boolean);
      if (!clean.length) return res.status(400).json({ error: 'El archivo no tiene widgets válidos.' });
      // a la derecha de lo que ya hay, para no pisar nada
      const existing = await listWidgets(dash.id);
      const keep = Boolean(req.query?.keep);
      const there = new Set(existing.map((w) => w.id));
      const minX = Math.min(...clean.map((w) => w.layout.x));
      const dx = existing.length && !keep ? Math.max(...existing.map((w) => w.x + w.w)) + 6 - minX : 0;
      const ids = new Map();
      for (const w of clean) w.layout.x = Math.min(500, w.layout.x + dx);
      // primero sin conexiones (para conocer los ids nuevos), después se reconectan
      for (const w of clean) ids.set(w.key, (await createWidget(dash.id, w.type, w.layout, w.data, [])).id);
      for (const w of clean) {
        // con keep, una conexión a un widget que ya está en el dashboard se respeta
        const remap = (k) => ids.get(k) || (keep && there.has(k) ? k : null);
        const inputs = w.inputs.map(remap).filter(Boolean);
        const tops = w.tops.map(remap).filter(Boolean);
        // las soluciones del journey guardan el id del widget: se pasan a los nuevos
        if (w.type === 'journey' && (w.data.solutions?.length || w.presets.length)) {
          w.data.solutions = (w.data.solutions || []).map((s) => ({ ...s, id: ids.get(s.id) })).filter((s) => s.id);
          for (const p of w.presets) {
            const sol = clean.find((x) => x.key === String(p?.sol));
            if (sol) w.data.fitCache = { ...w.data.fitCache, [fitKey(w.data, { type: sol.type, data: sol.data })]: cleanFit(p) };
          }
          await updateWidget(dash.id, ids.get(w.key), { data: w.data });
        }
        if (w.type === 'pro' && w.presets.length) {
          for (const p of w.presets) {
            const sol = clean.find((x) => x.key === String(p?.similar));
            const key = sol ? researchKey('', { type: sol.type, data: sol.data }, p.filters) : p?.question ? researchKey(String(p.question), null) : null;
            if (key) w.data.cache = { ...w.data.cache, [key]: cleanResearch(p.result) };
          }
          await updateWidget(dash.id, ids.get(w.key), { data: w.data });
        }
        if (inputs.length || tops.length) await updateWidget(dash.id, ids.get(w.key), { inputs, ...(tops.length ? { tops } : {}) });
      }
      return res.status(201).json({ created: clean.length, ids: Object.fromEntries(ids) });
    }

    /* ---------- journey: ¿esta solución encaja? ---------- */
    if (req.method === 'POST' && dash && req.query?.fit) {
      const all = await listWidgets(dash.id);
      const panel = all.find((w) => w.id === String(req.query.fit) && w.type === 'journey');
      const sol = all.find((w) => w.id === String(req.query.sol || ''));
      if (!panel || !sol) return res.status(404).json({ error: 'No encontrado.' });
      if (!panel.data?.stages?.length) return res.status(422).json({ error: 'Primero genera el journey.' });
      if (['user', 'group'].includes(sol.data?.kind)) return res.status(400).json({ error: 'Arriba solo se conectan soluciones.' });

      // ¿ya se analizó esta misma solución con este mismo journey? → igual, sin tokens
      const key = fitKey(panel.data, sol);
      let out = panel.data.fitCache?.[key];
      const cached = Boolean(out);
      let spent;
      if (!cached) {
        const cost = priceOf(await getConfig(), 'fit');
        const price = unlimited(user) ? 0 : cost;
        if (price && !(await charge(user.email, price))) {
          return res.status(402).json({ error: `No te quedan tokens: esto cuesta ${price.toLocaleString('es-PE')}.`, tokens: await balanceOf(user.email), price });
        }
        try {
          out = cleanFit(await askJourneyFit({ journey: panel.data, solution: contextFrom([sol]) }));
        } catch (err) {
          if (price) await refund(user.email, price);
          if (err instanceof AIError) return res.status(422).json({ error: err.message });
          throw err;
        }
        spent = await addSpent(dash.id, cost);
      }
      const tokens = unlimited(user) ? null : await balanceOf(user.email);
      const fitCache = { ...(panel.data.fitCache || {}), [key]: out };
      if (!out.compatible) {
        // la que estaba conectada se queda
        const data = cleanJourney({ ...panel.data, fitCache });
        await updateWidget(dash.id, panel.id, { data });
        return res.status(200).json({ compatible: false, reason: out.reason, tops: panel.tops || [], cached, tokens, spent });
      }
      // hasta 3: la cuarta suelta a la más antigua
      let tops = (panel.tops || []).filter((i) => i !== sol.id);
      const replaced = tops.length >= MAX_SOLUTIONS ? tops.slice(0, tops.length - MAX_SOLUTIONS + 1) : [];
      tops = [...tops.filter((i) => !replaced.includes(i)), sol.id];
      const kept = (panel.data.solutions || []).filter((x) => tops.includes(x.id) && x.id !== sol.id);
      const color = SOL_COLORS.find((c) => !kept.some((x) => x.color === c)) || SOL_COLORS[0];
      const title = sol.data?.title || sol.data?.name || sol.data?.text || 'Solución';
      const data = cleanJourney({ ...panel.data, fitCache, solutions: [...kept, { id: sol.id, title, color, impacts: out.impacts }] });
      await updateWidget(dash.id, panel.id, { data, tops });
      return res.status(200).json({ compatible: true, data, tops, replaced, cached, tokens, spent });
    }

    /* ---------- Researcher: investigar y dejar hallazgos ---------- */
    if (req.method === 'POST' && dash && req.query?.research) {
      const all = await listWidgets(dash.id);
      const pro = all.find((w) => w.id === String(req.query.research) && w.type === 'pro');
      if (!pro) return res.status(404).json({ error: 'Profesional no encontrado.' });
      const filters = txt(req.body?.filters, 300);
      const similar = req.body?.similar ? all.find((w) => w.id === String(req.body.similar) && (pro.inputs || []).includes(w.id)) : null;
      if (req.body?.similar && !similar) return res.status(400).json({ error: 'Esa solución no está conectada al Researcher.' });
      const question = similar ? similarQuestion(similar, filters) : txt(req.body?.question, 300);
      if (!question) return res.status(422).json({ error: 'Escribe una pregunta.' });
      const shown = similar ? `Soluciones parecidas a «${similar.data?.title || similar.data?.name || 'la solución'}»${filters ? ` (${filters})` : ''}` : question;
      const slots = (Array.isArray(req.body?.slots) ? req.body.slots : []).slice(0, 5).map(cleanLayout);
      if (!slots.length) return res.status(400).json({ error: 'No hay lugar en el lienzo.' });

      const key = researchKey(question, similar, filters);
      let out = pro.data.cache?.[key];
      const cached = Boolean(out?.items?.length);
      let spent;
      if (!cached) {
        const cost = priceOf(await getConfig(), 'research');
        const price = unlimited(user) ? 0 : cost;
        if (price && !(await charge(user.email, price))) {
          return res.status(402).json({
            error: `No te quedan tokens: investigar cuesta ${price.toLocaleString('es-PE')}.`,
            tokens: await balanceOf(user.email), price,
          });
        }
        // lo conectado al Researcher le dice de qué trata el proyecto
        const context = contextFrom(all.filter((w) => (pro.inputs || []).includes(w.id)));
        try {
          out = cleanResearch(await askResearch({ question, context }));
        } catch (err) {
          if (price) await refund(user.email, price);
          if (err instanceof AIError) return res.status(422).json({ error: err.message });
          throw err;
        }
        spent = await addSpent(dash.id, cost);
      }

      const created = [];
      for (const [i, it] of out.items.slice(0, slots.length).entries()) {
        const data = cleanFinding({ ...it, question: shown, by: pro.data.name, confidence: out.confidence });
        created.push(await createWidget(dash.id, 'finding', slots[i], data, [pro.id]));
      }
      const proData = cleanPro({
        ...pro.data,
        thought: out.thought || pro.data.thought,
        history: [...(pro.data.history || []), { q: shown, n: created.length }],
        cache: { ...(pro.data.cache || {}), [key]: out },
      });
      await updateWidget(dash.id, pro.id, { data: proData });
      return res.status(201).json({
        widgets: created.map(publicWidget), pro: proData, mode: out.mode, cached,
        tokens: unlimited(user) ? null : await balanceOf(user.email), spent,
      });
    }

    /* ---------- widgets sin IA: línea de tiempo, usuario, celebridad, profesionales, paneles y nebulosa ---------- */
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
      // nodo superior (solo journey): soluciones; quitar una se hace aquí, conectarla por ?fit=
      if (req.body?.tops != null && current.type === 'journey') {
        patch.tops = cleanInputs(req.body.tops, all, wid).filter((i) => !['user', 'group'].includes(all.find((w) => w.id === i)?.data?.kind));
      }
      if (req.body?.inputs != null) {
        patch.inputs = cleanInputs(req.body.inputs, all, wid);
        // al user journey solo se le conectan usuarios
        if (current.type === 'journey') patch.inputs = patch.inputs.filter((i) => ['user', 'group'].includes(all.find((w) => w.id === i)?.data?.kind));
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
