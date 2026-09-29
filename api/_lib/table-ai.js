/* ============================================================
   api/_lib/table-ai.js — CSV + pedido → tabla, con OpenAI
   ------------------------------------------------------------
   Usa salida estructurada (json_schema): el modelo responde
   { ok, error, title, columns, rows }. Si el pedido está vacío, no
   tiene sentido o no se puede resolver con el CSV, responde ok=false
   con el motivo — no hay que adivinarlo del texto.
   Variables: OPENAI_API_KEY (obligatoria), OPENAI_MODEL (default gpt-4o).
   ============================================================ */

const MAX_CSV_CHARS = 120_000; // ~30k tokens: deja espacio a la respuesta
const MAX_ROWS = 200;
const MAX_CELL = 300;

const SYSTEM = `Eres un analista de datos. Recibes el contenido de un archivo CSV y un pedido del usuario.
Tu trabajo es devolver UNA tabla que responda el pedido usando únicamente los datos del CSV:
puedes seleccionar columnas, filtrar, ordenar, agrupar, contar, sumar, promediar o calcular porcentajes.

Responde ok=false, con un motivo breve y amable en español en "error" (y title, columns y rows vacíos), cuando:
- el pedido está vacío, es un saludo o no tiene sentido;
- no pide algo que se pueda mostrar como una tabla;
- pide datos que no están en el CSV o que no se pueden calcular con ellos;
- el archivo no contiene datos tabulares.

Si ok=true:
- "title": título corto de la tabla (máx. 60 caracteres), en el idioma del pedido;
- "columns": los encabezados;
- "rows": cada fila como lista de textos, con la misma cantidad de valores que columns;
- como máximo ${MAX_ROWS} filas;
- números legibles (separador de miles, 2 decimales como máximo);
- nunca inventes datos; "error" va vacío.`;

const SCHEMA = {
  name: 'tabla',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['ok', 'error', 'title', 'columns', 'rows'],
    properties: {
      ok: { type: 'boolean' },
      error: { type: 'string' },
      title: { type: 'string' },
      columns: { type: 'array', items: { type: 'string' } },
      rows: { type: 'array', items: { type: 'array', items: { type: 'string' } } },
    },
  },
};

export class TableError extends Error {}

/** Devuelve { title, columns, rows, truncated } o lanza TableError (pedido inválido) / Error (falla técnica). */
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

  if (!out.ok) throw new TableError(out.error || 'El pedido no se puede resolver con este archivo.');
  const columns = (out.columns || []).map((c) => String(c).slice(0, MAX_CELL));
  if (!columns.length) throw new TableError('No salió ninguna columna.');
  const rows = (out.rows || []).slice(0, MAX_ROWS).map((r) =>
    columns.map((_, i) => String(r?.[i] ?? '').slice(0, MAX_CELL)));

  return { title: String(out.title || 'Tabla').slice(0, 80), columns, rows, truncated };
}
