/* ============================================================
   api/_lib/ai.js — las herramientas de IA del lienzo, con OpenAI
   ------------------------------------------------------------
   askVisual({ prompt, csv?, filename? })   — herramienta "tabla con IA"
     Con CSV, interpreta esos datos; sin CSV, responde con lo que sabe.
     Elige el formato que mejor responde:
       table   → varias filas / columnas
       chart   → gráfico de barras o de líneas (una serie)
       number  → una sola cifra
       text    → un dato corto en palabras
   askShort({ prompt, context? })            — botón de la estrella
     Una respuesta en texto, de un párrafo como máximo.
   askFollow({ prompt, context })            — clic en el + de un widget
     Más libre: un párrafo que interpreta la cadena de widgets conectados
     junto con la pregunta (puede inferir, relacionar o sugerir).

   `context` es el contenido de los widgets conectados (por su conector
   izquierdo): la IA lo usa como fuente principal.
   `voices` son los profesionales conectados (nombre, rol y cómo piensan):
   la respuesta sale con su mirada, sin cambiar el formato pedido.

   Usa siempre OPENAI_API_KEY. Cada función acepta `meter` ({}): al
   terminar trae en meter.tokens los tokens que gastó la llamada (así se
   mide el costo real de cada herramienta en Panel → Configuración).

   Las dos usan salida estructurada (json_schema). Si la pregunta está
   vacía, no tiene sentido o no se puede responder, el modelo devuelve
   ok=false con el motivo — no hay que adivinarlo del texto.
   Variables: OPENAI_API_KEY, OPENAI_MODEL (default gpt-4o).
   ============================================================ */

const MAX_CSV_CHARS = 120_000; // ~30k tokens: deja espacio a la respuesta
const MAX_CONTEXT_CHARS = 150_000; // incluye archivos subidos (widget Archivo)
const MAX_SLICES = 8;
const MAX_ROWS = 200;
const MAX_POINTS = 40;
const MAX_CELL = 300;

export class AIError extends Error {}

const str = (v, max = MAX_CELL) => String(v ?? '').trim().slice(0, max);

async function callOpenAI(system, user, schema, { temperature = 0, meter = null } = {}) {
  const key = String(process.env.OPENAI_API_KEY || '').trim();
  if (!key) throw new Error('No hay API key de OpenAI: carga OPENAI_API_KEY en Vercel.');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || 'gpt-4o',
      temperature,
      response_format: { type: 'json_schema', json_schema: schema },
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    const err = (await res.text()).slice(0, 500);
    console.error('[ai] OpenAI:', res.status, err);
    throw new Error(/insufficient_quota|billing/i.test(err)
      ? 'La API key de OpenAI no tiene saldo.'
      : `OpenAI respondió ${res.status}.`);
  }

  const json = await res.json();
  if (meter) meter.tokens = (meter.tokens || 0) + (json.usage?.total_tokens || 0);
  const msg = json.choices?.[0]?.message;
  if (msg?.refusal) throw new AIError(msg.refusal);
  try { return JSON.parse(msg?.content || ''); } catch { throw new Error('OpenAI devolvió una respuesta ilegible.'); }
}

/** Instrucción extra para responder con la mirada de los profesionales conectados. */
export const withVoices = (system, voices) => (voices
  ? `${system}

MIRADA PROFESIONAL — responde como lo harían estos profesionales, con su forma de pensar, sus
criterios y su tono (si son varios, combina sus miradas y deja ver en qué coinciden o difieren).
No digas que eres una IA ni rompas el formato pedido:
${String(voices).slice(0, 6000)}`
  : system);

/** Bloque de contexto (widgets conectados) para el mensaje del usuario. */
const contextBlock = (context) => (context
  ? `Contexto — contenido de los widgets conectados:\n${String(context).slice(0, MAX_CONTEXT_CHARS)}\n\n`
  : '');

/* ============================================================
   Tabla con IA (visual)
   ============================================================ */

const FORMATS = `Responde con el formato que mejor se entienda de un vistazo, en "kind":

- "number": cuando la respuesta es UNA cifra (¿cuántos…?, ¿cuál es el total…?, ¿qué porcentaje…?).
  "value" = la cifra formateada (ej. "1.234", "38%", "S/ 12.500"); "detail" = una frase corta que la explica.
- "text": cuando la respuesta es un dato corto en palabras (¿quién…?, ¿cuál…?, ¿qué día…?).
  "value" = la respuesta (máx. 120 caracteres); "detail" = una frase de contexto, opcional.
- "chart": cuando conviene VER una comparación, una evolución o un reparto de UNA sola medida.
  "chartType" = "bar" para comparar categorías, "line" para evolución en el tiempo, "pie" para
  partes de un todo (torta / pastel / dona / "qué porcentaje de…", máx. ${MAX_SLICES} porciones: junta el resto en
  "Otros"; valores positivos). Si el pedido nombra un tipo de gráfico, usa ese;
  "labels" = las etiquetas del eje X (máx. ${MAX_POINTS}); "values" = un número por etiqueta, en el mismo orden;
  "unit" = la unidad corta de los valores (ej. "entradas", "S/", "%"), o "".
- "table": cuando hacen falta varias filas o columnas (rankings, desgloses, listados, comparaciones de varias medidas).
  "columns" = encabezados; "rows" = filas como listas de textos del mismo largo que columns; máximo ${MAX_ROWS} filas.

En todos los casos "title" es un título corto (máx. 60 caracteres) en el idioma de la pregunta, y los
campos que no usa ese formato van vacíos ("", [] o "bar"). Números legibles (miles separados, 2 decimales como máximo).`;

const SYSTEM_CSV = `Eres un analista de datos. Recibes el contenido de un archivo CSV y una pregunta o pedido del usuario.
Interpreta los datos (puedes filtrar, ordenar, agrupar, contar, sumar, promediar, comparar o calcular porcentajes).
${FORMATS}
Nunca inventes datos: todo sale del CSV.

Responde ok=false, con un motivo breve y amable en español en "error" (y el resto vacío), cuando:
- la pregunta está vacía, es un saludo o no tiene sentido;
- pide datos que no están en el CSV o que no se pueden calcular con ellos;
- el archivo no contiene datos tabulares.`;

const SYSTEM_CONTEXT = `Eres un analista de datos. Recibes el contenido de otros widgets de un dashboard (tablas, gráficos,
cifras o textos que ya se generaron) y una pregunta o pedido del usuario sobre ellos.
Usa ese contenido como fuente principal: puedes cruzarlo, compararlo, resumirlo o calcular a partir de él.
Solo complementa con conocimiento general si el pedido lo necesita, y dilo en "detail".
${FORMATS}

Responde ok=false, con un motivo breve y amable en español en "error" (y el resto vacío), cuando:
- la pregunta está vacía, es un saludo o no tiene sentido;
- no tiene relación con el contenido conectado ni se puede responder con él;
- no se puede mostrar como tabla, gráfico, cifra o dato corto.`;

const SYSTEM_FREE = `Eres un analista de datos. Recibes una pregunta o pedido del usuario, sin archivo adjunto:
respóndelo con tu conocimiento general.
${FORMATS}
Si las cifras son aproximadas o pueden estar desactualizadas, dilo en "detail" o en el título (ej. "aprox.", "datos de 2023").

Responde ok=false, con un motivo breve y amable en español en "error" (y el resto vacío), cuando:
- la pregunta está vacía, es un saludo o no tiene sentido;
- no se puede responder sin datos que no tienes (datos privados, en tiempo real o de un archivo que no se adjuntó);
- no se puede mostrar como tabla, gráfico, cifra o dato corto.`;

const VISUAL_SCHEMA = {
  name: 'respuesta',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'error', 'kind', 'title', 'value', 'detail', 'columns', 'rows', 'chartType', 'labels', 'values', 'unit'],
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      kind: { type: 'string', enum: ['table', 'chart', 'number', 'text'] },
      title: { type: 'string' },
      value: { type: 'string' },
      detail: { type: 'string' },
      columns: { type: 'array', items: { type: 'string' } },
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
      chartType: { type: 'string', enum: ['bar', 'line', 'pie'] },
      labels: { type: 'array', items: { type: 'string' } },
      values: { type: 'array', items: { type: 'number' } },
      unit: { type: 'string' },
    },
  },
};

/** Devuelve { kind, title, … , truncated, fromFile } o lanza AIError (pregunta que no sirve) / Error (falla técnica). */
export async function askVisual({ prompt, csv = '', filename = '', context = '', voices = '', meter = null }) {
  let body = String(csv || '').replace(/^﻿/, '');
  const fromFile = Boolean(body.trim());
  let truncated = false;
  if (body.length > MAX_CSV_CHARS) {
    body = body.slice(0, body.lastIndexOf('\n', MAX_CSV_CHARS));
    truncated = true;
  }

  const user = contextBlock(context) + (fromFile
    ? [
      `Pedido: ${prompt}`,
      `Archivo: ${filename}`,
      truncated ? `(El archivo es grande: solo se incluyen sus primeras ${body.split('\n').length} líneas.)` : '',
      'CSV:', '```', body, '```',
    ].filter(Boolean).join('\n')
    : `Pedido: ${prompt}`);

  const system = fromFile ? SYSTEM_CSV : context ? SYSTEM_CONTEXT : SYSTEM_FREE;
  const out = await callOpenAI(withVoices(system, voices), user, VISUAL_SCHEMA, { meter });
  return shapeVisual(out, { truncated, fromFile });
}

/** Respuesta del esquema visual → datos del widget (o AIError si no sirve). */
function shapeVisual(out, base = {}, { textMax = 200 } = {}) {
  if (!out.ok) throw new AIError(out.error || 'La pregunta no se puede responder.');
  base = { title: str(out.title || 'Respuesta', 80), ...base };

  if (out.kind === 'number' || out.kind === 'text') {
    const value = str(out.value, out.kind === 'text' ? textMax : 200);
    if (!value) throw new AIError('No salió ninguna respuesta.');
    return { ...base, kind: out.kind, value, detail: str(out.detail) };
  }

  if (out.kind === 'chart') {
    const pie = out.chartType === 'pie';
    const n = Math.min(out.labels?.length || 0, out.values?.length || 0, pie ? MAX_SLICES + 1 : MAX_POINTS);
    let labels = out.labels.slice(0, n).map((l) => str(l, 60));
    let values = out.values.slice(0, n).map(Number);
    if (!n || values.some((v) => !Number.isFinite(v))) throw new AIError('No salieron datos para el gráfico.');
    if (pie) {
      // la torta solo con porciones positivas
      const keep = values.map((v, i) => (v > 0 ? i : -1)).filter((i) => i >= 0);
      labels = keep.map((i) => labels[i]);
      values = keep.map((i) => values[i]);
      if (!values.length) throw new AIError('No salieron porciones para el gráfico.');
    }
    const chartType = pie ? 'pie' : out.chartType === 'line' ? 'line' : 'bar';
    return { ...base, kind: 'chart', chartType, labels, values, unit: str(out.unit, 20), detail: str(out.detail) };
  }

  const columns = (out.columns || []).map((c) => str(c));
  if (!columns.length) throw new AIError('No salió ninguna columna.');
  const rows = (out.rows || []).slice(0, MAX_ROWS).map((r) => columns.map((_, i) => str(r?.[i])));
  return { ...base, kind: 'table', columns, rows };
}

/* ============================================================
   Botón de la estrella: pregunta → un párrafo como máximo
   ============================================================ */

const SYSTEM_SHORT = `Respondes preguntas de forma clara y directa, en el idioma de la pregunta.
- "answer": la respuesta en UN párrafo como máximo (máx. 600 caracteres). Sin rodeos, saludos ni listas.
  Si te pasan contenido de widgets conectados, úsalo como fuente principal.
- "title": 2 a 6 palabras que resuman de qué trata la pregunta.
- "detail": un dato de contexto muy corto si ayuda (ej. "aprox.", "a 2024"), o "".
Si una cifra puede estar desactualizada, dilo en "detail".
Responde ok=false, con un motivo breve y amable en español en "error" (y el resto vacío), cuando la pregunta está
vacía, es solo un saludo, no tiene sentido o necesita datos que no tienes (privados o en tiempo real).`;

const SHORT_SCHEMA = {
  name: 'respuesta_corta',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'error', 'title', 'answer', 'detail'],
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      title: { type: 'string' },
      answer: { type: 'string' },
      detail: { type: 'string' },
    },
  },
};

/** Devuelve { kind: 'text', title, value, detail } o lanza AIError / Error. */
export async function askShort({ prompt, context = '', voices = '', meter = null }) {
  const out = await callOpenAI(withVoices(SYSTEM_SHORT, voices), contextBlock(context) + prompt, SHORT_SCHEMA, { temperature: voices ? 0.6 : 0, meter });
  if (!out.ok) throw new AIError(out.error || 'No se puede responder eso.');
  const value = str(out.answer, 700);
  if (!value) throw new AIError('No salió ninguna respuesta.');
  return { kind: 'text', title: str(out.title || 'Respuesta', 80), value, detail: str(out.detail) };
}

/* ============================================================
   Clic en el + de un widget: un párrafo, más libre
   ============================================================ */

const SYSTEM_FOLLOW = `Eres un analista que lee un tablero de trabajo. Recibes el contenido de una cadena de widgets
conectados (tablas, gráficos, cifras, textos, usuarios, líneas de tiempo, archivos subidos con sus datos; los
primeros están conectados directamente y los siguientes, antes en la cadena) y un pedido del usuario.
Tienes libertad: puedes interpretar, relacionar los widgets entre sí, inferir, resumir, comparar, calcular
(filtrar, agrupar, contar, sumar, promediar, porcentajes) o proponer ideas. Usa el contenido conectado como
base y, si no alcanza, complétalo con conocimiento general (dilo en "detail"). Nunca inventes datos de un archivo.

Elige el formato en "kind":
- Si el pedido pide un gráfico (pastel/torta, barras, líneas…), una tabla, un ranking o una cifra, o si se entiende
  mejor así, usa ese formato visual (reglas abajo).
- Si no, "text": "value" = la respuesta en UN párrafo (máx. 700 caracteres), sin listas ni saludos.
${FORMATS}
Aquí "text" puede ser un párrafo de hasta 700 caracteres (no solo un dato corto).
Responde ok=false (con un motivo breve en español en "error") SOLO si el pedido está vacío o no se entiende,
o si pide datos que no están en lo conectado y no se pueden saber.`;

/** Devuelve datos de widget (text, number, chart o table) o lanza AIError / Error. */
export async function askFollow({ prompt, context = '', voices = '', meter = null }) {
  const out = await callOpenAI(withVoices(SYSTEM_FOLLOW, voices), contextBlock(context) + `Pedido: ${prompt}`, VISUAL_SCHEMA, { temperature: 0.3, meter });
  return shapeVisual(out, {}, { textMax: 800 });
}

/* ============================================================
   Panel "User journey": puntos de entrada + etapas con emociones
   ============================================================ */

const SYSTEM_JOURNEY = `Eres investigadora UX y diseñadora de servicios. Armas un user journey realista a partir de
uno o más usuarios (sexo, edad y su contexto: notas, entrevistas, textos) y un objetivo que dice qué flujo
recorrer. Escribe en el idioma del objetivo (español si no hay objetivo).
- Si hay VARIOS usuarios, crea UN usuario promedio que combine sus rasgos (edad intermedia, lo que comparten,
  lo que más pesa del contexto de cada uno) y arma un solo journey para él. Descríbelo en "persona".
- Si hay uno, "persona" lo describe en una frase.
- "entries": 2 a 5 puntos de entrada al flujo (dónde o cómo llega: búsqueda, recomendación, redes, tienda…).
  "name" corto, "channel" el canal (web, app, presencial, WhatsApp…), "detail" una frase.
- "stages": 4 a 7 etapas en orden. "name" de 1 a 3 palabras. "doing": qué hace (máx. 90 caracteres).
  "thinking": lo que piensa, en primera persona y entre comillas (máx. 90). "feeling": entero de -2 (muy mal)
  a 2 (muy bien). "emotion": una palabra (ej. curioso, frustrado, aliviado). "pain": el dolor principal o "".
  "opportunity": una idea concreta para mejorar esa etapa.
- Usa el contexto de los usuarios: sus palabras, problemas y edad deben notarse. No inventes datos duros.
- "title": 2 a 5 palabras con el flujo (ej. "Compra del primer seguro").
Responde ok=false (con el motivo breve en español en "error") solo si el objetivo no tiene sentido.`;

const JOURNEY_SCHEMA = {
  name: 'user_journey',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'error', 'title', 'persona', 'entries', 'stages'],
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      title: { type: 'string' },
      persona: { type: 'string' },
      entries: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false, required: ['name', 'channel', 'detail'],
          properties: { name: { type: 'string' }, channel: { type: 'string' }, detail: { type: 'string' } },
        },
      },
      stages: {
        type: 'array',
        items: {
          type: 'object', additionalProperties: false,
          required: ['name', 'doing', 'thinking', 'feeling', 'emotion', 'pain', 'opportunity'],
          properties: {
            name: { type: 'string' }, doing: { type: 'string' }, thinking: { type: 'string' },
            feeling: { type: 'integer' }, emotion: { type: 'string' }, pain: { type: 'string' }, opportunity: { type: 'string' },
          },
        },
      },
    },
  },
};

/** users: [{ name, sex, age, context }] (context en texto). Devuelve { title, persona, entries, stages }. */
export async function askJourney({ goal = '', users = [], context = '', voices = '', meter = null }) {
  const people = users.map((u, i) => [
    `Usuario ${i + 1}: ${u.name}, ${u.sex === 'f' ? 'mujer' : 'hombre'} de ${u.age} años.`,
    u.context ? `Su contexto:\n${u.context}` : '(sin contexto adjunto)',
  ].join('\n')).join('\n\n');
  const user = [
    goal ? `Objetivo / flujo a recorrer: ${goal}` : 'Objetivo: no se indicó; elige el flujo más relevante para este usuario.',
    users.length > 1 ? `Hay ${users.length} usuarios: arma UN usuario promedio.` : '',
    people,
    context ? `\nOtros widgets conectados:\n${String(context).slice(0, MAX_CONTEXT_CHARS / 2)}` : '',
  ].filter(Boolean).join('\n\n').slice(0, MAX_CONTEXT_CHARS);

  const out = await callOpenAI(withVoices(SYSTEM_JOURNEY, voices), user, JOURNEY_SCHEMA, { temperature: 0.6, meter });
  if (!out.ok) throw new AIError(out.error || 'No se pudo armar el journey.');
  const stages = (out.stages || []).slice(0, 8).map((s) => ({
    name: str(s.name, 40), doing: str(s.doing, 160), thinking: str(s.thinking, 160),
    feeling: Math.max(-2, Math.min(2, Math.round(Number(s.feeling) || 0))),
    emotion: str(s.emotion, 30), pain: str(s.pain, 160), opportunity: str(s.opportunity, 160),
  })).filter((s) => s.name);
  if (stages.length < 2) throw new AIError('No salieron etapas suficientes.');
  const entries = (out.entries || []).slice(0, 6).map((e) => ({ name: str(e.name, 40), channel: str(e.channel, 30), detail: str(e.detail, 140) })).filter((e) => e.name);
  return { title: str(out.title || 'User journey', 60), persona: str(out.persona, 200), entries, stages };
}
