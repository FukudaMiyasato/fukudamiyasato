/* ============================================================
   /api/ia — webhook de transcripciones + generador de mini-apps
   ------------------------------------------------------------
   POST /api/ia                  webhook (multipart/form-data)
        header Authorization == process.env.INDEX_AUT
        campos: transcription, recordedAt, client

   GET  /api/ia                  estado: última transcripción + metadata
                                 de la app generada
   GET  /api/ia?app=1            el código de la app generada
   POST /api/ia?generate=1       { id } -> genera la app con GPT

   El POST de generación NO lleva Authorization a propósito: lo llama el
   navegador. Para que no sea un generador abierto (y no se te vaya el
   crédito de OpenAI), solo acepta el id de la transcripción que está
   guardada ahora mismo, y cachea el resultado: un mensaje = una llamada.

   Variables de entorno:
     INDEX_AUT        secreto del webhook
     OPENAI_API_KEY   la key de OpenAI
     OPENAI_MODEL     opcional, por defecto gpt-4o
   ============================================================ */

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;          // generar puede tardar

let latest = null;      // última transcripción
let app = null;         // { id, at, prompt, html }
let inflight = null;    // { id, promise } para no generar dos veces a la vez

/* ---------------- auth ---------------- */
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

/* ---------------- cuerpo ---------------- */
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

/** Corta un multipart/form-data en sus campos. */
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
    if (!part || part.trimEnd() === '--') continue;

    const sep = part.includes('\r\n\r\n') ? '\r\n\r\n' : '\n\n';
    const at = part.indexOf(sep);
    if (at === -1) continue;

    const head = part.slice(0, at);
    const value = part.slice(at + sep.length).replace(/\r?\n$/, '');

    const nameM = head.match(/name="([^"]*)"/i) || head.match(/name=([^;\r\n]+)/i);
    if (!nameM) continue;
    const name = nameM[1].trim();

    const fileM = head.match(/filename="([^"]*)"/i);
    if (fileM) files.push({ name, filename: fileM[1], bytes: Buffer.byteLength(value, 'utf8') });
    else fields[name] = value;
  }
  return { fields, files };
}

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

function extract(raw, contentType) {
  const ct = (contentType || '').toLowerCase();

  if (ct.includes('multipart/form-data') || /^--\S+\r?\n/.test(raw.slice(0, 300))) {
    const mp = parseMultipart(raw, contentType);
    if (mp) {
      const key = Object.keys(mp.fields).find((k) => TEXT_KEYS.includes(k.toLowerCase().trim()));
      return { text: key ? mp.fields[key].trim() : '', fields: mp.fields, formato: 'multipart' };
    }
  }
  try {
    const json = JSON.parse(raw);
    const fields = json && typeof json === 'object' && !Array.isArray(json) ? json : { body: json };
    return { text: searchKeys(json, TEXT_KEYS), fields, formato: 'json' };
  } catch { /* no era JSON */ }

  if (ct.includes('x-www-form-urlencoded')) {
    try {
      const fields = Object.fromEntries(new URLSearchParams(raw));
      const key = Object.keys(fields).find((k) => TEXT_KEYS.includes(k.toLowerCase().trim()));
      return { text: key ? fields[key].trim() : '', fields, formato: 'urlencoded' };
    } catch { /* nada */ }
  }
  return { text: raw.trim(), fields: {}, formato: 'texto' };
}

/* ============================================================
   GPT: convierte la instrucción hablada en una mini-app
   ============================================================ */
const SYSTEM = `Eres un generador de mini-aplicaciones web.
Recibes una instrucción dicha en voz alta y devuelves UNA sola página HTML
completa y autocontenida que la implemente de verdad y funcione.

Reglas estrictas:
- Devuelve SOLO el código HTML. Nada de explicaciones, ni vallas de markdown.
- Un único archivo: el CSS en <style> y el JS en <script>. Sin dependencias
  externas, sin CDN, sin fuentes remotas, sin imágenes remotas.
- La página corre dentro de un iframe aislado: NO uses localStorage,
  sessionStorage, cookies, fetch ni window.parent. Fallarían.
- Diseño: fondo oscuro #0a0a0c, texto claro, acentos rojos #e0102b,
  tipografía del sistema, esquinas suaves. Tiene que verse bien a pantalla
  completa y también en móvil.
- Es una app usable, no una maqueta: los botones hacen lo que dicen.
- Si la instrucción es ambigua o muy corta, elige la interpretación más
  simple y útil, y hazla completa.`;

/** Quita las vallas de markdown si el modelo las mete igual. */
function cleanHtml(out) {
  let s = String(out || '').trim();
  const fence = s.match(/^```(?:html)?\s*\n([\s\S]*?)\n?```$/i);
  if (fence) s = fence[1].trim();
  if (!/<[a-z!]/i.test(s)) return '';
  if (!/<html/i.test(s)) {
    s = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"></head><body>${s}</body></html>`;
  }
  return s;
}

async function generate(text) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw Object.assign(new Error('OPENAI_API_KEY no está configurada.'), { code: 501 });

  const model = process.env.OPENAI_MODEL || 'gpt-4o';

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text();
    console.error('[api/ia] OpenAI', res.status, detail.slice(0, 600));
    throw Object.assign(new Error(`OpenAI respondió ${res.status}`), { code: 502 });
  }

  const json = await res.json();
  const html = cleanHtml(json.choices?.[0]?.message?.content);
  if (!html) throw Object.assign(new Error('El modelo no devolvió HTML usable.'), { code: 502 });

  console.log(`[api/ia] app generada (${model}, ${html.length} chars) para: ${text.slice(0, 160)}`);
  return html;
}

/* ============================================================
   Handler
   ============================================================ */
export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  /* ---------- lectura ---------- */
  if (req.method === 'GET') {
    /* Diagnóstico: qué variables ve la función. Nunca devuelve valores,
       solo si existen y de qué largo son. */
    if (req.query?.diag) {
      const key = process.env.OPENAI_API_KEY || '';
      return res.status(200).json({
        entorno: process.env.VERCEL_ENV || '(local)',
        region: process.env.VERCEL_REGION || null,
        INDEX_AUT: { configurada: Boolean(process.env.INDEX_AUT), largo: (process.env.INDEX_AUT || '').length },
        OPENAI_API_KEY: {
          configurada: Boolean(key),
          largo: key.length,
          empiezaEnSk: key.startsWith('sk-'),
          espaciosSobrantes: key !== key.trim(),
        },
        OPENAI_MODEL: process.env.OPENAI_MODEL || '(por defecto: gpt-4o)',
        hayTranscripcion: Boolean(latest?.text),
        hayApp: Boolean(app?.html),
      });
    }

    if (req.query?.app) {
      return res.status(200).json({ app });
    }
    return res.status(200).json({
      latest,
      app: app ? { id: app.id, at: app.at, prompt: app.prompt, chars: app.html.length } : null,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  /* ---------- generación, disparada por el navegador ---------- */
  if (req.query?.generate) {
    if (!latest || !latest.text) {
      return res.status(409).json({ error: 'No hay ninguna transcripción guardada.' });
    }

    let body = {};
    try { body = JSON.parse(await readRaw(req)) || {}; } catch { /* sin body */ }

    // solo la transcripción vigente: así nadie puede mandar prompts sueltos
    if (body.id !== latest.id) {
      return res.status(409).json({ error: 'Ese id ya no es el vigente.', vigente: latest.id });
    }

    if (app && app.id === latest.id) {
      return res.status(200).json({ app, cache: true });      // ya estaba hecha
    }

    if (inflight && inflight.id === latest.id) {
      try {
        await inflight.promise;
        return res.status(200).json({ app, cache: true });
      } catch { /* cae al intento de abajo */ }
    }

    const id = latest.id;
    const prompt = latest.text;
    inflight = { id, promise: generate(prompt) };

    try {
      const html = await inflight.promise;
      app = { id, at: new Date().toISOString(), prompt, html };
      return res.status(200).json({ app });
    } catch (err) {
      console.error('[api/ia] fallo generando:', err.message);
      return res.status(err.code || 500).json({ error: err.message });
    } finally {
      inflight = null;
    }
  }

  /* ---------- webhook ---------- */
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
  const { text, fields, formato } = extract(raw, contentType);

  const recordedAt = Number(fields.recordedAt ?? fields.recordedat);

  latest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: new Date().toISOString(),
    text,
    client: fields.client ?? null,
    recordedAt: Number.isFinite(recordedAt) && recordedAt > 0 ? new Date(recordedAt).toISOString() : null,
    formato,
    bytes: Buffer.byteLength(raw, 'utf8'),
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
