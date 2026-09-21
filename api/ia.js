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
  if (typeof b === 'string') {
    try { b = JSON.parse(b); } catch { return { transcription: b }; }
  }
  return b && typeof b === 'object' ? b : {};
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
  const raw = body.transcription ?? body.transcripcion ?? body.text ?? body.texto;
  const text = typeof raw === 'string' ? raw.trim() : '';

  if (!text) {
    return res.status(400).json({
      error: 'Falta el campo `transcription` con texto.',
      recibido: Object.keys(body),
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
