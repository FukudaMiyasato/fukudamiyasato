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

   `context` es el contenido de los widgets conectados (por su conector
   izquierdo): la IA lo usa como fuente principal.

   API keys: se usa primero la que el amo supremo eligió en Configuración
   (YO = OPENAI_API_KEY, LVL = OPENAI_API_KEY2). Si falla por saldo, key
   inválida o límite de uso, se reintenta solo con la otra.

   Las dos usan salida estructurada (json_schema). Si la pregunta está
   vacía, no tiene sentido o no se puede responder, el modelo devuelve
   ok=false con el motivo — no hay que adivinarlo del texto.
   Variables: OPENAI_API_KEY y/o OPENAI_API_KEY2, OPENAI_MODEL (default gpt-4o).
   ============================================================ */

import { getConfig, AI_KEYS } from './config.js';

const MAX_CSV_CHARS = 120_000; // ~30k tokens: deja espacio a la respuesta
const MAX_CONTEXT_CHARS = 60_000;
const MAX_ROWS = 200;
const MAX_POINTS = 40;
const MAX_CELL = 300;

export class AIError extends Error {}

const str = (v, max = MAX_CELL) => String(v ?? '').trim().slice(0, max);

/* Errores por los que vale la pena probar con la otra key:
   401 key inválida · 402/403 facturación · 429 sin saldo o límite de uso. */
const RETRY_WITH_OTHER_KEY = new Set([401, 402, 403, 429]);

/** Las keys cargadas, la elegida en Configuración primero. */
async function keysInOrder() {
  const { aiKey } = await getConfig();
  const order = [aiKey, ...Object.keys(AI_KEYS).filter((k) => k !== aiKey)];
  return order
    .map((k) => ({ name: AI_KEYS[k].label, key: String(process.env[AI_KEYS[k].env] || '').trim() }))
    .filter((k) => k.key);
}

async function callOpenAI(system, user, schema) {
  const keys = await keysInOrder();
  if (!keys.length) throw new Error('No hay API key de OpenAI: carga OPENAI_API_KEY u OPENAI_API_KEY2 en Vercel.');

  let res, lastErr = '';
  for (const { name, key } of keys) {
    res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o',
        temperature: 0,
        response_format: { type: 'json_schema', json_schema: schema },
        messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      }),
    });
    if (res.ok) break;
    lastErr = (await res.text()).slice(0, 500);
    console.error(`[ai] OpenAI con la key ${name}:`, res.status, lastErr);
    if (!RETRY_WITH_OTHER_KEY.has(res.status)) break;
  }
  if (!res.ok) {
    const noMoney = /insufficient_quota|billing/i.test(lastErr);
    throw new Error(noMoney
      ? 'Las API keys de OpenAI no tienen saldo.'
      : `OpenAI respondió ${res.status}.`);
  }

  const msg = (await res.json()).choices?.[0]?.message;
  if (msg?.refusal) throw new AIError(msg.refusal);
  try { return JSON.parse(msg?.content || ''); } catch { throw new Error('OpenAI devolvió una respuesta ilegible.'); }
}

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
- "chart": cuando conviene VER una comparación o una evolución de UNA sola medida.
  "chartType" = "bar" para comparar categorías, "line" para evolución en el tiempo;
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
      chartType: { type: 'string', enum: ['bar', 'line'] },
      labels: { type: 'array', items: { type: 'string' } },
      values: { type: 'array', items: { type: 'number' } },
      unit: { type: 'string' },
    },
  },
};

/** Devuelve { kind, title, … , truncated, fromFile } o lanza AIError (pregunta que no sirve) / Error (falla técnica). */
export async function askVisual({ prompt, csv = '', filename = '', context = '' }) {
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
  const out = await callOpenAI(system, user, VISUAL_SCHEMA);
  if (!out.ok) throw new AIError(out.error || 'La pregunta no se puede responder.');
  const title = str(out.title || 'Respuesta', 80);
  const base = { title, truncated, fromFile };

  if (out.kind === 'number' || out.kind === 'text') {
    const value = str(out.value, 200);
    if (!value) throw new AIError('No salió ninguna respuesta.');
    return { ...base, kind: out.kind, value, detail: str(out.detail) };
  }

  if (out.kind === 'chart') {
    const n = Math.min(out.labels?.length || 0, out.values?.length || 0, MAX_POINTS);
    const labels = out.labels.slice(0, n).map((l) => str(l, 60));
    const values = out.values.slice(0, n).map(Number);
    if (!n || values.some((v) => !Number.isFinite(v))) throw new AIError('No salieron datos para el gráfico.');
    return { ...base, kind: 'chart', chartType: out.chartType === 'line' ? 'line' : 'bar', labels, values, unit: str(out.unit, 20), detail: str(out.detail) };
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
export async function askShort({ prompt, context = '' }) {
  const out = await callOpenAI(SYSTEM_SHORT, contextBlock(context) + prompt, SHORT_SCHEMA);
  if (!out.ok) throw new AIError(out.error || 'No se puede responder eso.');
  const value = str(out.answer, 700);
  if (!value) throw new AIError('No salió ninguna respuesta.');
  return { kind: 'text', title: str(out.title || 'Respuesta', 80), value, detail: str(out.detail) };
}
