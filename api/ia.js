/* ============================================================
   /api/ia — recibe el webhook y extrae la transcripción
   ------------------------------------------------------------
   El emisor manda multipart/form-data con estos campos:
     transcription  el texto
     recordedAt     epoch en milisegundos
     client         de dónde viene

   POST  con header `Authorization` == process.env.INDEX_AUT
   GET   devuelve lo último recibido, para que la página lo muestre

   ⚠ Se guarda en memoria de la función, no en una base. Si Vercel
     levanta otra instancia, el GET puede devolver null aunque el POST
     haya entrado bien — el POST siempre queda en los logs de Vercel.

   ⚠ El GET es público. El header Authorization no se guarda ni se
     devuelve nunca.
   ============================================================ */

/* Necesitamos el cuerpo crudo para poder cortar el multipart. */
export const config = { api: { bodyParser: false } };

let latest = null;

/** Comparación en tiempo constante, para no filtrar el secreto. */
function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(req, expected) {
  const raw = (req.headers.authorization || '').trim();
  if (!raw) return false;
  const bare = raw.replace(/^Bearer\s+/i, '').trim();
  return safeEqual(raw, expected) || safeEqual(bare, expected);
}

async function readRaw(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    if (typeof req.body === 'string') return req.body;
    if (Buffer.isBuffer(req.body)) return req.body.toString('utf8');
    try { return JSON.stringify(req.body); } catch { return String(req.body); }
  }
  try {
    const chunks = [];
    for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
    return Buffer.concat(chunks).toString('utf8');
  } catch (err) {
    return `(no se pudo leer el cuerpo: ${err.message})`;
  }
}

/**
 * Corta un multipart/form-data en sus campos.
 * El boundary sale del content-type; si no viene, se deduce de la
 * primera línea del cuerpo, que siempre es `--<boundary>`.
 */
function parseMultipart(raw, contentType) {
  const m = (contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  let boundary = m ? (m[1] || m[2]).trim() : null;

  if (!boundary) {
    const first = raw.slice(0, 300).match(/^--(\S+?)\r?\n/);
    if (first) boundary = first[1].replace(/--$/, '');
  }
  if (!boundary) return null;

  const fields = {};
  const files = [];

  for (const chunk of raw.split(`--${boundary}`)) {
    const part = chunk.replace(/^\r?\n/, '');
    if (!part || part.trimEnd() === '--') continue;          // preámbulo y cierre

    const sep = part.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const at = part.indexOf(sep);
    if (at === -1) continue;

    const head = part.slice(0, at);
    const value = part.slice(at + sep.length).replace(/\r?\n$/, '');  // el salto antes del siguiente boundary

    const nameM = head.match(/name="([^"]*)"/i) || head.match(/name=([^;\r\n]+)/i);
    if (!nameM) continue;
    const name = nameM[1].trim();

    const fileM = head.match(/filename="([^"]*)"/i);
    if (fileM) files.push({ name, filename: fileM[1], bytes: Buffer.byteLength(value, 'utf8') });
    else fields[name] = value;
  }

  return { fields, files };
}

/** Busca una clave en cualquier nivel de un objeto. */
function searchKeys(obj, keys, depth = 0) {
  if (obj == null || depth > 4) return '';
  if (Array.isArray(obj)) {
    for (const v of obj) { const r = searchKeys(v, keys, depth + 1); if (r) return r; }
    return '';
  }
  if (typeof obj !== 'object') return '';
  for (const [k, v] of Object.entries(obj)) {
    if (keys.includes(k.toLowerCase().trim()) && typeof v === 'string' && v.trim()) return v.trim();
  }
  for (const v of Object.values(obj)) {
    const r = searchKeys(v, keys, depth + 1);
    if (r) return r;
  }
  return '';
}

const TEXT_KEYS = ['transcription', 'transcripcion', 'transcripción', 'transcript', 'texto', 'text'];

/** Saca la transcripción venga como venga: multipart, JSON o texto suelto. */
function extract(raw, contentType) {
  const ct = (contentType || '').toLowerCase();

  if (ct.includes('multipart/form-data') || /^--\S+\r?\n/.test(raw.slice(0, 300))) {
    const mp = parseMultipart(raw, contentType);
    if (mp) {
      const key = Object.keys(mp.fields).find((k) => TEXT_KEYS.includes(k.toLowerCase().trim()));
      return { text: key ? mp.fields[key].trim() : '', fields: mp.fields, files: mp.files, formato: 'multipart' };
    }
  }

  try {
    const json = JSON.parse(raw);
    const text = searchKeys(json, TEXT_KEYS);
    const fields = json && typeof json === 'object' && !Array.isArray(json) ? json : { body: json };
    return { text, fields, files: [], formato: 'json' };
  } catch { /* no era JSON */ }

  if (ct.includes('x-www-form-urlencoded')) {
    try {
      const fields = Object.fromEntries(new URLSearchParams(raw));
      const key = Object.keys(fields).find((k) => TEXT_KEYS.includes(k.toLowerCase().trim()));
      return { text: key ? fields[key].trim() : '', fields, files: [], formato: 'urlencoded' };
    } catch { /* nada */ }
  }

  return { text: raw.trim(), fields: {}, files: [], formato: 'texto' };
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'GET') {
    return res.status(200).json({ latest });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  const expected = process.env.INDEX_AUT;
  if (!expected) {
    console.error('[api/ia] falta la variable INDEX_AUT');
    return res.status(501).json({ error: 'INDEX_AUT no está configurado en este entorno.' });
  }

  if (!authorized(req, expected)) {
    console.warn('[api/ia] POST rechazado: Authorization inválido');
    return res.status(401).json({ error: 'Authorization inválido' });
  }

  const raw = await readRaw(req);
  const contentType = req.headers['content-type'] || null;
  const { text, fields, files, formato } = extract(raw, contentType);

  const recordedAt = Number(fields.recordedAt ?? fields.recordedat);

  latest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    text,
    client: fields.client ?? null,
    recordedAt: Number.isFinite(recordedAt) && recordedAt > 0
      ? new Date(recordedAt).toISOString()
      : null,
    fields,
    files,
    formato,
    bytes: Buffer.byteLength(raw, 'utf8'),
    // el crudo solo cuando no se pudo sacar el texto, para poder depurar
    raw: text ? null : raw.slice(0, 4000),
  };

  if (text) {
    console.log(`[api/ia] transcription (${formato}, ${text.length} chars): ${text}`);
  } else {
    console.warn(`[api/ia] sin texto · formato=${formato} · content-type=${contentType} · campos=${Object.keys(fields)}`);
    console.warn(`[api/ia] body: ${raw.slice(0, 2000)}`);
  }

  return res.status(200).json({ ok: true, id: latest.id, chars: text.length, formato });
}
