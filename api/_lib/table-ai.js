/* ============================================================
   api/_lib/table-ai.js — CSV + pregunta → respuesta visual, con OpenAI
   ------------------------------------------------------------
   La IA interpreta los datos y elige el formato que mejor responde:
     table   → varias filas / columnas
     number  → una sola cifra ("¿cuántas soluciones hay?" → 42)
     text    → una respuesta corta en palabras
   Usa salida estructurada (json_schema): el modelo responde
   { ok, error, kind, title, value, detail, columns, rows }. Si la
   pregunta está vacía, no tiene sentido o no se puede resolver con el
   CSV, responde ok=false con el motivo — no hay que adivinarlo.
   Variables: OPENAI_API_KEY (obligatoria), OPENAI_MODEL (default gpt-4o).
   ============================================================ */

const MAX_CSV_CHARS = 120_000; // ~30k tokens: deja espacio a la respuesta
const MAX_ROWS = 200;
const MAX_CELL = 300;

const SYSTEM = `Eres un analista de datos. Recibes el contenido de un archivo CSV y una pregunta o pedido del usuario.
Interpreta los datos (puedes filtrar, ordenar, agrupar, contar, sumar, promediar, comparar o calcular porcentajes)
y responde con el formato que mejor se entienda de un vistazo, en "kind":

- "number": cuando la respuesta es UNA cifra (¿cuántos…?, ¿cuál es el total…?, ¿qué porcentaje…?).
  "value" = la cifra formateada (ej. "1.234", "38%", "S/ 12.500"); "detail" = una frase corta que la explica.
- "text": cuando la respuesta es un dato corto en palabras (¿quién…?, ¿cuál…?, ¿qué día…?).
  "value" = la respuesta (máx. 120 caracteres); "detail" = una frase de contexto, opcional.
- "table": cuando hacen falta varias filas o columnas (rankings, desgloses, listados, comparaciones).
  "columns" = encabezados; "rows" = filas como listas de textos del mismo largo que columns; máximo ${MAX_ROWS} filas.

En todos los casos "title" es un título corto (máx. 60 caracteres) en el idioma de la pregunta, y los
campos que no usa ese formato van vacíos ("" o []). Números legibles (miles separados, 2 decimales como máximo).
Nunca inventes datos.

Responde ok=false, con un motivo breve y amable en español en "error" (y el resto vacío), cuando:
- la pregunta está vacía, es un saludo o no tiene sentido;
- pide datos que no están en el CSV o que no se pueden calcular con ellos;
- el archivo no contiene datos tabulares.`;

const SCHEMA = {
  name: 'respuesta',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'error', 'kind', 'title', 'value', 'detail', 'columns', 'rows'],
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      kind: { type: 'string', enum: ['table', 'number', 'text'] },
      title: { type: 'string' },
      value: { type: 'string' },
      detail: { type: 'string' },
      columns: { type: 'array', items: { type: 'string' } },
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    },
  },
};

export class TableError extends Error {}

/** Devuelve { kind, title, value?, detail?, columns?, rows?, truncated }
    o lanza TableError (pregunta que no sirve) / Error (falla técnica). */
export async function tableFromCsv({ csv, filename, prompt }) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('OPENAI_API_KEY no está configurada.');
  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  let body = String(csv || '').replace(/^﻿/, '');
  let truncated = false;
  if (body.length > MAX_CSV_CHARS) {
    body = body.slice(0, body.lastIndexOf('\n', MAX_CSV_CHARS));
    truncated = true;
  }

  const user = [
    `Pedido: ${prompt}`,
    `Archivo: ${filename}`,
    truncated ? `(El archivo es grande: solo se incluyen sus primeras ${body.split('\n').length} líneas.)` : '',
    'CSV:',
    '```',
    body,
    '```',
  ].filter(Boolean).join('\n');

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      response_format: { type: 'json_schema', json_schema: SCHEMA },
      messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
    }),
  });
  if (!res.ok) {
    console.error('[table-ai] OpenAI', res.status, (await res.text()).slice(0, 500));
    throw new Error(`OpenAI respondió ${res.status}.`);
  }

  const msg = (await res.json()).choices?.[0]?.message;
  if (msg?.refusal) throw new TableError(msg.refusal);
  let out;
  try { out = JSON.parse(msg?.content || ''); } catch { throw new Error('OpenAI devolvió una respuesta ilegible.'); }

  if (!out.ok) throw new TableError(out.error || 'La pregunta no se puede resolver con este archivo.');
  const title = String(out.title || 'Respuesta').slice(0, 80);

  if (out.kind === 'number' || out.kind === 'text') {
    const value = String(out.value || '').trim().slice(0, 200);
    if (!value) throw new TableError('No salió ninguna respuesta.');
    return { kind: out.kind, title, value, detail: String(out.detail || '').slice(0, MAX_CELL), truncated };
  }

  const columns = (out.columns || []).map((c) => String(c).slice(0, MAX_CELL));
  if (!columns.length) throw new TableError('No salió ninguna columna.');
  const rows = (out.rows || []).slice(0, MAX_ROWS).map((r) =>
    columns.map((_, i) => String(r?.[i] ?? '').slice(0, MAX_CELL)));

  return { kind: 'table', title, columns, rows, truncated };
}
