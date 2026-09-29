/* ============================================================
   api/_lib/at.js — acceso mínimo a Airtable para las funciones
   de login, permisos y dashboards.
   ============================================================ */

export const BASE = process.env.AIRTABLE_BASE || 'appU39PYosvxt8FfG';

function token() {
  const t = process.env.AIRTABLE_TOKEN;
  if (!t) throw new Error('AIRTABLE_TOKEN no está configurado.');
  return t;
}

export const authHeaders = () => ({ Authorization: `Bearer ${token()}`, 'Content-Type': 'application/json' });

/** fetch a una tabla: at('permisos', '/recXXX', { method: 'PATCH', ... }) */
export function at(table, path = '', init = {}) {
  return fetch(`https://api.airtable.com/v0/${BASE}/${encodeURIComponent(table)}${path}`, {
    ...init,
    headers: { ...authHeaders(), ...init.headers },
  });
}

/** Error legible; si falta la tabla o una columna, dice cuál crear. */
export async function atError(r, table, what, columns) {
  const body = (await r.text()).slice(0, 300);
  let hint = '';
  if (/UNKNOWN_FIELD_NAME/.test(body)) hint = ` — falta una columna en "${table}" (${columns})`;
  else if (r.status === 404 || /TABLE_NOT_FOUND|MODEL_NOT_FOUND/.test(body)) hint = ` — ¿existe la tabla "${table}" con las columnas ${columns}?`;
  return new Error(`Airtable respondió ${r.status} ${what}${hint}`);
}

/** Todos los registros de una tabla (pagina solo). `formula` filtra en Airtable. */
export async function listAll(table, columns, formula) {
  const out = [];
  let offset;
  do {
    const qs = new URLSearchParams({ pageSize: '100' });
    if (formula) qs.set('filterByFormula', formula);
    if (offset) qs.set('offset', offset);
    const r = await at(table, `?${qs}`);
    if (!r.ok) throw await atError(r, table, `leyendo "${table}"`, columns);
    const json = await r.json();
    out.push(...(json.records || []));
    offset = json.offset;
  } while (offset);
  return out;
}

/** Valor de una columna sin importar mayúsculas/espacios en el nombre. */
export function field(fields, name) {
  const k = Object.keys(fields || {}).find((f) => f.trim().toLowerCase() === name);
  return k ? fields[k] : undefined;
}

export const text = (v) => String(v?.name ?? v ?? '').trim();
