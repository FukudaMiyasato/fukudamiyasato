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

import crypto from 'node:crypto';

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
   Token firmado para las capacidades
   ------------------------------------------------------------
   El navegador llama a ?save=1 sin Authorization, así que el token
   va firmado con HMAC sobre INDEX_AUT: se verifica sin necesidad de
   memoria compartida entre instancias.
   ============================================================ */
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

function hmac(payload) {
  return crypto.createHmac('sha256', process.env.INDEX_AUT || 'sin-secreto')
    .update(payload).digest('base64url');
}

function signToken(appId) {
  const payload = `${appId}.${Date.now() + TOKEN_TTL_MS}`;
  return `${payload}.${hmac(payload)}`;
}

function verifyToken(token) {
  if (typeof token !== 'string') return false;
  const cut = token.lastIndexOf('.');
  if (cut < 1) return false;

  const payload = token.slice(0, cut);
  const sig = Buffer.from(token.slice(cut + 1));
  const expected = Buffer.from(hmac(payload));
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return false;

  return Date.now() < Number(payload.split('.').pop() || 0);
}

/* ============================================================
   Airtable: tabla ia_save, campo de adjuntos `file`
   ============================================================ */
const AT_BASE  = process.env.AIRTABLE_BASE || 'appU39PYosvxt8FfG';
const AT_TABLE = process.env.AIRTABLE_SAVE_TABLE || 'ia_save';
const AT_FIELD = process.env.AIRTABLE_SAVE_FIELD || 'file';

/* Vercel corta los cuerpos en 4.5MB; dejamos margen. */
const MAX_B64 = 3_600_000;

/**
 * Saca el último adjunto de un `fields` de Airtable.
 * La API de contenido devuelve los campos indexados por ID de campo, no
 * por nombre, así que no se puede buscar por AT_FIELD: tomamos el primer
 * array que tenga pinta de adjuntos.
 */
function lastAttachment(fields, prefer) {
  const byName = fields?.[prefer];
  const list = Array.isArray(byName) && byName.length
    ? byName
    : Object.values(fields || {}).find((v) => Array.isArray(v) && v.length && v[0]?.url) || [];
  return list[list.length - 1] || {};
}

async function airtableSave({ filename, contentType, data }) {
  const key = process.env.AIRTABLE_TOKEN;
  if (!key) throw Object.assign(new Error('AIRTABLE_TOKEN no está configurada.'), { code: 501 });
  if (!data) throw Object.assign(new Error('No llegó ningún archivo.'), { code: 400 });
  if (data.length > MAX_B64) {
    throw Object.assign(new Error(`El archivo es muy grande (máx ~${Math.round(MAX_B64 * 0.75 / 1e6)}MB).`), { code: 413 });
  }

  const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  // 1. el registro vacío al que colgar el adjunto
  const mk = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_TABLE)}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ records: [{ fields: {} }], typecast: true }),
  });
  if (!mk.ok) {
    const detail = await mk.text();
    console.error('[api/ia] Airtable crear registro', mk.status, detail.slice(0, 400));
    throw Object.assign(
      new Error(mk.status === 403
        ? 'El token de Airtable no tiene permiso de escritura (data.records:write) sobre esta base.'
        : `Airtable respondió ${mk.status} al crear el registro.`),
      { code: 502 },
    );
  }
  const recordId = (await mk.json()).records[0].id;

  // 2. el adjunto va por la API de contenido, que acepta base64
  const up = await fetch(
    `https://content.airtable.com/v0/${AT_BASE}/${recordId}/${encodeURIComponent(AT_FIELD)}/uploadAttachment`,
    { method: 'POST', headers: auth, body: JSON.stringify({ contentType, file: data, filename }) },
  );
  if (!up.ok) {
    const detail = await up.text();
    console.error('[api/ia] Airtable subir adjunto', up.status, detail.slice(0, 400));
    throw Object.assign(new Error(`Airtable respondió ${up.status} al subir el archivo.`), { code: 502 });
  }

  const saved = await up.json();
  const att = lastAttachment(saved?.fields, AT_FIELD);
  console.log(`[api/ia] guardado en ${AT_TABLE}: ${filename} (${att.size ?? '?'} bytes) -> ${recordId}`);

  return { id: recordId, filename: att.filename || filename, url: att.url || null, size: att.size ?? null };
}

async function airtableList(limit = 20) {
  const key = process.env.AIRTABLE_TOKEN;
  if (!key) throw Object.assign(new Error('AIRTABLE_TOKEN no está configurada.'), { code: 501 });

  const qs = new URLSearchParams({ pageSize: String(Math.min(limit, 50)) });
  const r = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_TABLE)}?${qs}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  if (!r.ok) throw Object.assign(new Error(`Airtable respondió ${r.status}`), { code: 502 });

  const { records = [] } = await r.json();
  return records.map((rec) => {
    const att = lastAttachment(rec.fields, AT_FIELD);
    return {
      id: rec.id,
      createdTime: rec.createdTime,
      filename: att.filename || null,
      url: att.url || null,
      size: att.size ?? null,
      type: att.type || null,
    };
  }).filter((f) => f.url);
}

/* ============================================================
   El SDK que se inyecta en cada app generada
   ------------------------------------------------------------
   La app corre en un iframe de origen opaco: no puede llamar a
   /api/ia. Habla con la página padre por postMessage y es la
   página la que hace la llamada autenticada.
   ============================================================ */
const SDK = `<script>(function(){
  var seq = 0, pend = {};
  addEventListener('message', function(e){
    var d = e.data;
    if (!d || d.__fm !== 'res' || !pend[d.rid]) return;
    var p = pend[d.rid]; delete pend[d.rid];
    if (d.error) p.rej(new Error(d.error)); else p.res(d.result);
  });
  function call(action, payload){
    return new Promise(function(res, rej){
      var rid = ++seq;
      pend[rid] = { res: res, rej: rej };
      parent.postMessage({ __fm:'req', rid: rid, action: action, payload: payload }, '*');
      setTimeout(function(){
        if (pend[rid]) { delete pend[rid]; rej(new Error('La operación tardó demasiado')); }
      }, 120000);
    });
  }
  window.FM = {
    saveFile:  function(blob, filename){ return call('save', { blob: blob, filename: filename }); },
    saveText:  function(text, filename){ return call('save', { text: String(text), filename: filename || 'nota.txt', contentType: 'text/plain' }); },
    saveJSON:  function(obj, filename){ return call('save', { text: JSON.stringify(obj, null, 2), filename: filename || 'datos.json', contentType: 'application/json' }); },
    listFiles: function(limit){ return call('list', { limit: limit || 20 }); },
    record: {
      start: function(){ return call('rec-start', {}); },
      stop:  function(opts){ return call('rec-stop', opts || {}); }
    }
  };
})();<\/script>`;

/* ============================================================
   Estilos base — rojo/negro con efectos neón
   ------------------------------------------------------------
   Se inyectan antes que nada en el <head>, así el modelo no tiene
   que inventarse una paleta ni un tema: botones, inputs y demás ya
   salen vestidos. Las reglas del modelo, que van después, pueden
   sobreescribirlas si hace falta.
   ============================================================ */
const NEON_CSS = `<style id="fm-base">
:root{
  --fm-bg:#0a0a0c;--fm-panel:#141418;--fm-panel-2:#1b1b21;--fm-line:#26262e;
  --fm-red:#e0102b;--fm-red-hot:#ff1f3d;--fm-red-deep:#8c0518;
  --fm-glow:rgba(224,16,43,.45);--fm-text:#f2f2f4;--fm-text-dim:#9a9aa6;
}
*{box-sizing:border-box;}
html,body{margin:0;background:var(--fm-bg);color:var(--fm-text);min-height:100%;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;}
::selection{background:var(--fm-red);color:#fff;}
button,.fm-btn,input[type=button],input[type=submit]{
  font:inherit;color:#fff;cursor:pointer;border-radius:10px;padding:.6em 1.1em;
  background:linear-gradient(160deg,var(--fm-red) 0%,var(--fm-red-deep) 100%);
  border:1px solid var(--fm-red-hot);box-shadow:0 0 0 0 var(--fm-glow);
  transition:box-shadow .25s ease,transform .25s ease,filter .25s ease;}
button:hover,.fm-btn:hover,input[type=button]:hover,input[type=submit]:hover{
  box-shadow:0 0 18px 2px var(--fm-glow);transform:translateY(-1px);}
button:active,.fm-btn:active{transform:translateY(0) scale(.97);}
button:disabled,.fm-btn:disabled{opacity:.4;cursor:not-allowed;box-shadow:none;transform:none;}
input,select,textarea{
  font:inherit;color:var(--fm-text);background:var(--fm-panel);
  border:1px solid var(--fm-line);border-radius:8px;padding:.55em .8em;}
input:focus,select:focus,textarea:focus{
  outline:none;border-color:var(--fm-red-hot);box-shadow:0 0 0 3px var(--fm-glow);}
a{color:var(--fm-red-hot);}
.fm-panel,.card,.panel{background:var(--fm-panel-2);border:1px solid var(--fm-line);border-radius:14px;}
.fm-neon,.glow{text-shadow:0 0 12px var(--fm-glow);}
</style>`;

/** Mete el SDK y los estilos base dentro del <head> de lo que devolvió el modelo. */
function injectSdk(html) {
  const inject = NEON_CSS + SDK;
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + inject);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => `${m}<head>${inject}</head>`);
  return inject + html;
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
  sessionStorage, cookies, fetch, XMLHttpRequest ni window.parent
  directamente. Fallarían.

DISEÑO — ya viene puesto, no lo reconstruyas
Antes de tu HTML se inyecta una hoja de estilos base: fondo oscuro
(--fm-bg #0a0a0c), texto claro, botones e inputs ya vestidos con el tema
rojo/negro y efectos neón (glow en hover/focus con --fm-glow). Los
elementos normales (button, input, select, textarea, a) ya salen bien.
- NO definas tu propia paleta de colores ni reconstruyas el estilo de
  botones e inputs desde cero: usa las etiquetas normales, o las clases
  .fm-btn / .fm-panel / .card / .panel / .fm-neon si te hacen falta.
- Tu <style> es solo para el layout propio de la app (posiciones,
  tamaños, espaciados, grids) y detalles muy específicos que la base no
  cubre. Cuanto menos CSS de tema escribas, mejor.
- Tiene que verse bien a pantalla completa y también en móvil.
- Es una app usable, no una maqueta: los botones hacen lo que dicen.
- Si la instrucción es ambigua o muy corta, elige la interpretación más
  simple y útil, y hazla completa.

CAPACIDADES YA DISPONIBLES — el objeto global FM
Ya existe en la página. NO lo reimplementes, no lo redefinas y no escribas
tu propio código de guardado, subida ni grabación: usa estas funciones.
Todas devuelven una promesa y lanzan Error si algo falla, así que
envuélvelas en try/catch y muestra el error en pantalla.

  await FM.saveFile(blob, 'nombre.ext')
      Guarda un Blob o File. Devuelve { id, filename, url, size }.
      La url es pública y sirve para reproducir o descargar lo guardado.

  await FM.saveText(texto, 'nota.txt')
  await FM.saveJSON(objeto, 'datos.json')
      Lo mismo para texto y para datos estructurados.

  await FM.listFiles(20)
      Lo guardado antes, lo más reciente primero:
      [{ id, filename, url, size, type, createdTime }].
      Úsalo para mostrar un historial o volver a reproducir algo.

  await FM.record.start()
      Empieza a grabar audio del micrófono. El permiso lo pide la página
      contenedora, tú no tienes que hacer nada.

  const r = await FM.record.stop({ save: true, filename: 'grabacion.webm' })
      Detiene la grabación. Con save:true la sube y devuelve
      { id, filename, url, size, seconds }. Con save:false solo devuelve
      { seconds, url } con una url local para reproducirla.

Reglas de uso:
- Cualquier cosa que implique GUARDAR (una grabadora, notas, una lista que
  persista, exportar datos) se hace con FM.saveFile / saveText / saveJSON.
- Cualquier cosa que implique GRABAR AUDIO se hace con FM.record.
- Si la app guarda algo, muestra siempre el resultado: un aviso de
  guardado y, cuando tenga sentido, la lista de FM.listFiles().
- Si la app NO necesita guardar nada (una calculadora, un contador, un
  temporizador), ignora FM por completo y guarda el estado en variables
  normales de JavaScript.`;

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

/**
 * ¿Puede escribir el token en ia_save? Crea un registro vacío y lo borra.
 * No deja rastro, y es lo único que distingue un scope faltante de un
 * token viejo guardado en Vercel.
 */
async function airtableProbe() {
  const key = process.env.AIRTABLE_TOKEN;
  const out = { base: AT_BASE, tabla: AT_TABLE, campo: AT_FIELD };

  if (!key) return { ...out, error: 'AIRTABLE_TOKEN no está configurada.' };
  const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };

  // quién es este token
  try {
    const who = await fetch('https://api.airtable.com/v0/meta/whoami', { headers: auth });
    const j = await who.json().catch(() => ({}));
    out.token = who.ok ? { id: j.id || null, scopes: j.scopes || '(no los expone)' } : `whoami ${who.status}`;
  } catch (err) {
    out.token = `whoami falló: ${err.message}`;
  }

  // ¿los campos que esperamos existen?
  try {
    const r = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_TABLE)}?pageSize=1`, { headers: auth });
    if (!r.ok) {
      out.lectura = { ok: false, detalle: `${r.status} ${(await r.text()).slice(0, 200)}` };
      return out;
    }
    const { records = [] } = await r.json();
    out.lectura = { ok: true, registros: records.length, campos: Object.keys(records[0]?.fields || {}) };
  } catch (err) {
    out.lectura = { ok: false, detalle: err.message };
    return out;
  }

  // crear y borrar
  let id = null;
  try {
    const mk = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_TABLE)}`, {
      method: 'POST', headers: auth, body: JSON.stringify({ records: [{ fields: {} }], typecast: true }),
    });
    if (!mk.ok) {
      out.escritura = { ok: false, detalle: `${mk.status} ${(await mk.text()).slice(0, 300)}` };
      return out;
    }
    id = (await mk.json()).records[0].id;
    out.escritura = { ok: true, registroDePrueba: id };
  } catch (err) {
    out.escritura = { ok: false, detalle: err.message };
    return out;
  }

  // el paso que de verdad usa la app: colgar un adjunto en el campo `file`
  try {
    const up = await fetch(
      `https://content.airtable.com/v0/${AT_BASE}/${id}/${encodeURIComponent(AT_FIELD)}/uploadAttachment`,
      {
        method: 'POST',
        headers: auth,
        body: JSON.stringify({
          contentType: 'text/plain',
          file: Buffer.from('prueba de adjunto').toString('base64'),
          filename: 'prueba.txt',
        }),
      },
    );
    if (!up.ok) {
      out.adjunto = { ok: false, detalle: `${up.status} ${(await up.text()).slice(0, 300)}` };
    } else {
      const body = await up.json();
      const att = lastAttachment(body?.fields, AT_FIELD);
      out.adjunto = {
        ok: Boolean(att.url),
        filename: att.filename || null,
        size: att.size ?? null,
        tieneUrl: Boolean(att.url),
        clavesDevueltas: Object.keys(body?.fields || {}),
      };
    }
  } catch (err) {
    out.adjunto = { ok: false, detalle: err.message };
  }

  try {
    const del = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_TABLE)}/${id}`, {
      method: 'DELETE', headers: auth,
    });
    out.limpieza = del.ok ? 'registro de prueba borrado' : `no se pudo borrar (${del.status}) — bórralo a mano: ${id}`;
  } catch (err) {
    out.limpieza = `no se pudo borrar: ${err.message} — bórralo a mano: ${id}`;
  }

  return out;
}

/** ¿Existe el modelo configurado para esta cuenta? Solo lectura. */
async function modelOk(key) {
  const model = process.env.OPENAI_MODEL || 'gpt-4o';
  if (!key) return { model, ok: false, motivo: 'sin key' };
  try {
    const r = await fetch(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${key}` },
    });
    if (r.ok) return { model, ok: true };
    return { model, ok: false, motivo: `OpenAI ${r.status}` };
  } catch (err) {
    return { model, ok: false, motivo: err.message };
  }
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
  const html = injectSdk(cleanHtml(json.choices?.[0]?.message?.content));
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
        // ?diag=models comprueba contra OpenAI que el modelo existe para
        // esta cuenta. Es una llamada de solo lectura, no gasta tokens.
        modeloDisponible: req.query.diag === 'models' ? await modelOk(key) : null,
        // ?diag=write crea un registro vacío en ia_save y lo borra: es la
        // única forma de saber de verdad si el token puede escribir.
        airtable: req.query.diag === 'write' ? await airtableProbe() : null,
      });
    }

    if (req.query?.files) {
      try {
        return res.status(200).json({ files: await airtableList(Number(req.query.limit) || 20) });
      } catch (err) {
        return res.status(err.code || 500).json({ error: err.message });
      }
    }

    if (req.query?.app) {
      return res.status(200).json({ app: app ? { ...app, token: signToken(app.id) } : null });
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
      return res.status(200).json({ app: { ...app, token: signToken(app.id) }, cache: true });
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
      return res.status(200).json({ app: { ...app, token: signToken(id) } });
    } catch (err) {
      console.error('[api/ia] fallo generando:', err.message);
      return res.status(err.code || 500).json({ error: err.message });
    } finally {
      inflight = null;
    }
  }

  /* ---------- capacidades: guardar un archivo ---------- */
  if (req.query?.save) {
    let body = {};
    try { body = JSON.parse(await readRaw(req)) || {}; } catch { /* sin body */ }

    if (!verifyToken(body.token)) {
      return res.status(401).json({ error: 'Token de la app inválido o vencido.' });
    }
    try {
      const saved = await airtableSave({
        filename: String(body.filename || 'archivo').slice(0, 120),
        contentType: String(body.contentType || 'application/octet-stream').slice(0, 120),
        data: body.data,
      });
      return res.status(200).json(saved);
    } catch (err) {
      console.error('[api/ia] fallo guardando:', err.message);
      return res.status(err.code || 500).json({ error: err.message });
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
