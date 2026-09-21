/* ============================================================
   /api/ia — recibe el webhook de transcripciones
   ------------------------------------------------------------
   POST  con header `Authorization` == process.env.INDEX_AUT
         y body JSON { "transcription": "..." }
   GET   devuelve la última recibida, para que la página la muestre.

   ⚠ La última transcripción se guarda EN MEMORIA de la función, no en
     una base. Sirve para probar: si Vercel levanta otra instancia (o la
     apaga por inactividad), el GET puede devolver null aunque el POST
     haya entrado bien. El POST siempre queda en los logs de Vercel.
     Para que sobreviva de verdad hay que guardarlo en algún lado
     (Airtable, Vercel KV, etc.) — ver el README.

   ⚠ El GET es público: quien tenga la URL puede leer la última
     transcripción. Para una prueba va bien; si va a llevar contenido
     sensible hay que ponerle autenticación.
   ============================================================ */

let latest = null;          // { id, text, at, meta }

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
  // acepta el valor pelado o con prefijo Bearer
  const bare = raw.replace(/^Bearer\s+/i, '').trim();
  return safeEqual(raw, expected) || safeEqual(bare, expected);
}

function parseBody(req) {
  let b = req.body;

  // algunos emisores mandan el cuerpo crudo (Buffer) o como string
  if (b && typeof b === 'object' && typeof b.byteLength === 'number') b = b.toString('utf8');

  if (typeof b === 'string') {
    const raw = b.trim();
    if (!raw) return {};

    try { return JSON.parse(raw); } catch { /* seguimos probando */ }

    // form-urlencoded: transcription=hola&otro=1
    if (raw.includes('=') && !raw.includes('\n')) {
      try { return Object.fromEntries(new URLSearchParams(raw)); } catch { /* nada */ }
    }

    // multipart: sacamos el campo por su name
    const mp = raw.match(/name="?(transcription|transcripcion|transcript|text|texto)"?[\s\S]*?\r?\n\r?\n([\s\S]*?)\r?\n--/i);
    if (mp) return { transcription: mp[2] };

    // texto plano suelto: lo tomamos tal cual
    return { transcription: raw };
  }

  return b && typeof b === 'object' ? b : {};
}

/* Busca una clave en todo el objeto, no solo en el primer nivel:
   así funciona con { data: { transcription } }, { payload: {...} }, etc. */
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

/* Mapa de claves recibidas, para poder depurar desde la respuesta. */
function shape(obj, depth = 0) {
  if (obj == null) return String(obj);
  if (Array.isArray(obj)) return depth > 2 ? '[…]' : [shape(obj[0], depth + 1)];
  if (typeof obj !== 'object') return typeof obj;
  if (depth > 2) return '{…}';
  return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, shape(v, depth + 1)]));
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

  const body = parseBody(req);

  // primero el nombre exacto, en cualquier nivel; después, alias razonables
  const text =
    searchKeys(body, ['transcription', 'transcripcion', 'transcripción']) ||
    searchKeys(body, ['transcript', 'texto', 'text', 'message', 'content']);

  if (!text) {
    const dump = (() => { try { return JSON.stringify(body); } catch { return String(body); } })();
    console.warn(
      `[api/ia] POST sin transcription · content-type=${req.headers['content-type'] || '(ninguno)'} · body=${dump.slice(0, 2000)}`,
    );
    return res.status(400).json({
      error: 'No encontré el campo `transcription` con texto.',
      ayuda: 'Manda { "transcription": "..." } como JSON. También lo busco anidado y acepto transcript/text/texto/message/content.',
      recibido: {
        contentType: req.headers['content-type'] || null,
        claves: shape(body),
        muestra: dump.slice(0, 400),
      },
    });
  }

  latest = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    text,
    at: new Date().toISOString(),
  };

  // queda en los logs de Vercel aunque el GET caiga en otra instancia
  console.log(`[api/ia] transcription (${text.length} chars): ${text.slice(0, 300)}`);

  return res.status(200).json({ ok: true, id: latest.id, chars: text.length });
}
