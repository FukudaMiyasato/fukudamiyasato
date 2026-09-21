/* ============================================================
   /api/ia — recibe el webhook y guarda LO QUE SEA que llegue
   ------------------------------------------------------------
   POST  con header `Authorization` == process.env.INDEX_AUT.
         No se interpreta el body: se guarda crudo y se loguea.
   GET   devuelve lo último recibido, para que la página lo muestre.

   ⚠ Se guarda en memoria de la función, no en una base. Si Vercel
     levanta otra instancia, el GET puede devolver null aunque el POST
     haya entrado bien — el POST siempre queda en los logs de Vercel.

   ⚠ El GET es público: quien tenga la URL puede leer el último payload.
     El header Authorization NO se incluye nunca en la respuesta.
   ============================================================ */

/* Queremos el cuerpo tal cual viene, sin que el runtime lo interprete. */
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

/** El cuerpo como string, venga como venga. */
async function readRaw(req) {
  // si el runtime igual lo parseó, lo usamos
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

/** Nunca devolvemos el Authorization ni cookies. */
function safeHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers || {})) {
    const key = k.toLowerCase();
    if (key === 'authorization' || key === 'cookie' || key === 'proxy-authorization') continue;
    out[k] = Array.isArray(v) ? v.join(', ') : v;
  }
  return out;
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

  // si resulta ser JSON, lo dejamos también formateado; si no, da igual
  let pretty = null;
  try { pretty = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* no era JSON */ }

  latest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    contentType,
    bytes: Buffer.byteLength(raw, 'utf8'),
    raw,
    pretty,
    headers: safeHeaders(req.headers),
  };

  console.log('[api/ia] ───────── payload recibido ─────────');
  console.log('[api/ia] content-type:', contentType, '· bytes:', latest.bytes);
  console.log('[api/ia] headers:', JSON.stringify(latest.headers));
  console.log('[api/ia] body:', raw.slice(0, 4000));
  console.log('[api/ia] ──────────────────────────────────');

  return res.status(200).json({ ok: true, id: latest.id, bytes: latest.bytes });
}
