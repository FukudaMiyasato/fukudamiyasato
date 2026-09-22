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
   POST /api/ia?test=1           { key, text } -> simula el webhook, para
                                 probar desde /test/sendOrder/ sin exponer
                                 INDEX_AUT en el navegador
   POST /api/ia?dismiss=1        { id } -> se borró con el shake: que
                                 desaparezca también en cualquier otro
                                 dispositivo que la tenga abierta

   El POST de generación NO lleva Authorization a propósito: lo llama el
   navegador. Para que no sea un generador abierto (y no se te vaya el
   crédito de OpenAI), solo acepta el id de la transcripción que está
   guardada ahora mismo, y cachea el resultado: un mensaje = una llamada.

   Variables de entorno:
     INDEX_AUT        secreto del webhook
     OPENAI_API_KEY   la key de OpenAI
     OPENAI_MODEL     opcional, por defecto gpt-4o
     TEST_ORDER_KEY   clave para /test/sendOrder/ (aparte de INDEX_AUT:
                      así la página de prueba no conoce el secreto real
                      del webhook, solo esta)
   ============================================================ */

import crypto from 'node:crypto';

export const config = { api: { bodyParser: false } };
export const maxDuration = 60;          // generar puede tardar

let latest = null;      // última transcripción
let app = null;         // { id, at, prompt, html }
let inflight = null;    // { id, promise } para no generar dos veces a la vez
let dismissedId = null; // último id borrado con el shake, para avisarle a los demás dispositivos

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

/* Tabla para FM.saveForm: un registro por envío, sin adjuntos. Columnas
   esperadas: "formulario" (texto) y "respuestas" (texto largo, JSON). */
const AT_FORMS_TABLE = process.env.AIRTABLE_FORMS_TABLE || 'ia_forms';

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

/** Guarda las respuestas de un formulario como un registro nuevo, sin
 *  adjuntos: la tabla es genérica (mismas dos columnas para cualquier
 *  formulario), así no hace falta crear columnas nuevas por cada uno. */
async function airtableSaveForm({ name, fields }) {
  const key = process.env.AIRTABLE_TOKEN;
  if (!key) throw Object.assign(new Error('AIRTABLE_TOKEN no está configurada.'), { code: 501 });

  const auth = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const record = {
    fields: {
      formulario: String(name || 'Formulario').slice(0, 200),
      respuestas: JSON.stringify(fields ?? {}, null, 2).slice(0, 90000),
    },
  };

  const r = await fetch(`https://api.airtable.com/v0/${AT_BASE}/${encodeURIComponent(AT_FORMS_TABLE)}`, {
    method: 'POST',
    headers: auth,
    body: JSON.stringify({ records: [record], typecast: true }),
  });
  if (!r.ok) {
    const detail = await r.text();
    console.error('[api/ia] Airtable guardar formulario', r.status, detail.slice(0, 400));
    throw Object.assign(
      new Error(r.status === 403
        ? `El token de Airtable no tiene permiso de escritura sobre la tabla "${AT_FORMS_TABLE}".`
        : r.status === 404
        ? `No existe la tabla "${AT_FORMS_TABLE}" en la base. Créala con las columnas "formulario" (texto) y "respuestas" (texto largo).`
        : `Airtable respondió ${r.status} al guardar el formulario.`),
      { code: 502 },
    );
  }

  const saved = (await r.json()).records[0];
  console.log(`[api/ia] formulario guardado en ${AT_FORMS_TABLE}: ${record.fields.formulario} -> ${saved.id}`);
  return { id: saved.id, name: saved.fields.formulario, fields, createdTime: saved.createdTime };
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
    saveForm:  function(name, fields){ return call('save-form', { name: name, fields: fields || {} }); },
    listFiles: function(limit){ return call('list', { limit: limit || 20 }); },
    record: {
      start: function(){ return call('rec-start', {}); },
      stop:  function(opts){ return call('rec-stop', opts || {}); }
    }
  };
})();<\/script>`;

/* El shake se detecta en la página contenedora (js/ia.js), no aquí: el
   iframe de la app corre en sandbox sin "allow-same-origin" (origen
   opaco), y el navegador le bloquea el sensor de movimiento sin importar
   el permiso que se le pida. Ver ia.js para el porqué. */

/* ============================================================
   Estilos base — solo bordes neón rojo, sin fondos
   ------------------------------------------------------------
   Se inyectan antes que nada en el <head>, así el modelo no tiene
   que inventarse una paleta ni un tema: botones, inputs y demás ya
   salen vestidos con contorno rojo y glow, sin relleno. Las reglas
   del modelo, que van después, pueden sobreescribirlas si hace falta.

   Tres niveles de intensidad de glow, de más a menos fuerte:
     botones (círculo perfecto) > labels (píldora, .fm-label*) > inputs
   ============================================================ */
const NEON_CSS = `<style id="fm-base">
:root{
  --fm-bg:#0a0a0c;--fm-line:rgba(255,31,61,.45);
  --fm-red:#e0102b;--fm-red-hot:#ff1f3d;
  --fm-glow:rgba(255,31,61,.65);--fm-glow-soft:rgba(255,31,61,.3);
}
*{box-sizing:border-box;background-color:transparent;}
html,body{margin:0;background:var(--fm-bg);color:var(--fm-red-hot);min-height:100%;
  font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  text-shadow:0 0 14px var(--fm-glow);
  transition:background-color .6s ease;}
/* mientras las chispitas orbitan, esto se queda transparente para que se
   vea la nebulosa de fondo (si no, el fondo opaco de la propia app la tapa) */
html.fm-orbiting,body.fm-orbiting{background:transparent;}
::selection{background:var(--fm-red);color:#000;}
h1,h2,h3,h4,h5,h6{text-shadow:0 0 22px var(--fm-glow);}

/* botones: círculo perfecto por defecto — caja cuadrada + radio al máximo,
   sin padding (el contenido se centra solo). Es el glow más fuerte de los
   tres. --fm-btn-size lo puede agrandar un botón puntual si el texto no
   entra; nunca hay que volverlo rectangular ni agregarle padding. */
button,.fm-btn,input[type=button],input[type=submit]{
  font:inherit;color:var(--fm-red-hot);cursor:pointer;
  width:var(--fm-btn-size,4.6em);height:var(--fm-btn-size,4.6em);
  padding:0;margin:0;border-radius:50%;
  display:inline-flex;align-items:center;justify-content:center;
  text-align:center;line-height:1.1;
  background:transparent;border:1px solid var(--fm-red-hot);
  text-shadow:0 0 10px var(--fm-glow);
  box-shadow:0 0 16px -1px var(--fm-glow),0 0 38px 3px var(--fm-glow-soft);
  transition:box-shadow .25s ease,transform .25s ease,border-color .25s ease,color .25s ease;}
button:hover,.fm-btn:hover,input[type=button]:hover,input[type=submit]:hover{
  box-shadow:0 0 30px 2px var(--fm-glow),0 0 54px 8px var(--fm-glow-soft);border-color:#fff;color:#fff;transform:translateY(-1px);}
button:active,.fm-btn:active{transform:translateY(0) scale(.97);}
button:disabled,.fm-btn:disabled{opacity:.35;cursor:not-allowed;box-shadow:none;transform:none;}

/* inputs: sin caja, solo la línea inferior — el glow más suave de los
   tres, confinado abajo con blur + spread negativo (un box-shadow normal
   rodearía el rectángulo entero). */
input,select,textarea{
  font:inherit;color:var(--fm-red-hot);background:transparent;
  border:none;border-bottom:1px solid var(--fm-red-hot);border-radius:0;
  padding:.55em .2em;
  box-shadow:0 5px 10px -6px var(--fm-glow),0 10px 20px -9px var(--fm-glow-soft);}
input:focus,select:focus,textarea:focus{
  outline:none;border-color:#fff;
  box-shadow:0 6px 16px -5px var(--fm-glow),0 12px 28px -8px var(--fm-glow-soft);}
input::placeholder,textarea::placeholder{color:var(--fm-line);}

a{color:var(--fm-red-hot);text-shadow:0 0 10px var(--fm-glow);}
.fm-panel,.card,.panel{background:transparent;border:1px solid var(--fm-line);border-radius:14px;
  box-shadow:0 0 22px -5px var(--fm-glow);}
.fm-neon,.glow{text-shadow:0 0 18px var(--fm-glow);}

/* labels: NO el <label> de formulario — una píldora redonda para mostrar
   texto corto (un valor, un estado, el título de un campo). Glow a medio
   camino entre el botón (fuerte) y el input (suave). Si hay varias
   juntas, exactamente una lleva .fm-label-main (más ancha) y el resto
   .fm-label. */
.fm-label,.fm-label-main{
  display:inline-flex;align-items:center;justify-content:center;
  padding:.5em 1.2em;border-radius:999px;white-space:nowrap;
  border:1px solid var(--fm-red-hot);color:var(--fm-red-hot);
  text-shadow:0 0 12px var(--fm-glow);
  box-shadow:0 0 13px -2px var(--fm-glow),0 0 28px 0 var(--fm-glow-soft);}
.fm-label-main{min-width:60%;padding-left:1.6em;padding-right:1.6em;}

/* flotación sutil en reposo, una vez que el elemento ya se acomodó —
   cada uno con su propio ritmo (duración, retraso y altura), así no
   flotan parejo: el JS de abajo pone los tres al azar por elemento */
.fm-float{
  animation-name:fm-float;
  animation-duration:var(--fm-float-dur,5s);
  animation-delay:var(--fm-float-delay,0s);
  animation-timing-function:ease-in-out;
  animation-iteration-count:infinite;
}
@keyframes fm-float{
  0%,100%{translate:0 0;}
  50%    {translate:0 var(--fm-float-y,-6px);}
}
@media (prefers-reduced-motion: reduce){
  .fm-float{animation:none;}
}

/* el destello al aterrizar: un chispazo rojo, nunca blanco */
.fm-flash{animation:fm-flash .45s ease-out both;}
@keyframes fm-flash{
  0%   {box-shadow:0 0 0 0 rgba(255,90,78,0);filter:brightness(1);}
  12%  {box-shadow:0 0 55px 18px rgba(255,90,78,.95),0 0 110px 40px rgba(255,20,50,.7);filter:brightness(1.9);}
  100% {box-shadow:0 0 0 0 rgba(255,90,78,0);filter:brightness(1);}
}

/* la chispita que orbita en vez de cada elemento: gira, late, y revienta
   (puesto todo inline desde el JS, por eso no hay clase acá) */
@keyframes fm-spark-spin{to{rotate:360deg;}}
@keyframes fm-spark-pulse{0%,100%{scale:.55;}50%{scale:1.4;}}
@keyframes fm-spark-burst{
  0%   {opacity:1;scale:1;}
  45%  {opacity:1;scale:2.3;}
  100% {opacity:0;scale:2.7;}
}
</style>`;

/* ============================================================
   Ensamblaje de entrada — chispitas en órbita, no formas
   ------------------------------------------------------------
   1. Todo arranca invisible (opacity 0). La nebulosa de fondo sigue
      ahí, girando más rápido — y esta vez de verdad SE VE: mientras
      dura esto, el fondo de la página (html/body) se queda
      transparente (clase .fm-orbiting), porque si no el fondo opaco
      de la propia app tapa la nebulosa aunque ella siga girando.
   2. CADA elemento (con borde o no: botones, textos, títulos, todo)
      tiene su propia chispita — un SVG de destello rojo, aparte del
      elemento real — que entra desde bien afuera de la pantalla,
      llega a su órbita y ahí se queda dando vueltas en una elipse
      alrededor del centro, girando sobre sí misma y latiendo (crece
      y se achica) todo el tiempo que está en movimiento, cada una a
      su propia velocidad. El elemento real se queda invisible
      mientras tanto: la chispita ocupa su lugar visualmente.
   3. No todas las chispitas aterrizan juntas: cada una viaja a la
      posición real de su elemento en un momento propio, separado por
      un par de segundos al azar del resto. Al llegar: revienta en un
      destello y desaparece, y en ese mismo instante aparece el
      elemento real (con su propio flash).
   4. Recién cuando casi todas ya aparecieron (unos segundos después de
      que "se creó" la app) se avisa al padre para que apague la
      nebulosa — y esa transición es lenta, no un corte (ver ia.css).
   5. Por último, cada uno empieza a flotar con su propio ritmo.
   Si la app ya existía (se está retomando, no creando de nuevo) se
   salta todo esto: lo marca `window.__fmSkipEntrance`, puesto por
   ia.js antes de que corra este script.
   Las chispitas son elementos aparte, `position:fixed`, así que nunca
   tocan el layout real de la app.
   ============================================================ */
const ASSEMBLE_JS = `<script>(function(){
  var ORBIT_MS       = 1900;   // cuánto orbitan antes de que empiecen a aterrizar
  var ENTER_MS       = 420;    // cuánto tarda en llegar desde afuera hasta su órbita
  var LAND_MS        = 750;    // duración del viaje a su posición real
  var LAND_SPREAD_MS = 2600;   // separación al azar entre una conversión y la siguiente
  var NEBULA_STAY_MS = 900;    // cuánto se queda la nebulosa después de que ya aterrizaron todas

  if (window.__fmSkipEntrance || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    parent.postMessage({ __fm: 'nebula-fade' }, '*');
    return;
  }

  var SPARK_SVG = '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
    '<defs>' +
      '<radialGradient id="fmSparkCore" cx="50%" cy="50%" r="50%">' +
        '<stop offset="0%" stop-color="#ffd9cf"/>' +
        '<stop offset="20%" stop-color="#ff5a4e"/>' +
        '<stop offset="50%" stop-color="#ff1f3d"/>' +
        '<stop offset="100%" stop-color="rgba(224,16,43,0)"/>' +
      '</radialGradient>' +
      '<linearGradient id="fmSparkRay" x1="0" y1="0" x2="0" y2="1">' +
        '<stop offset="0%" stop-color="rgba(255,31,61,0)"/>' +
        '<stop offset="42%" stop-color="#ff1f3d"/>' +
        '<stop offset="50%" stop-color="#ff8a72"/>' +
        '<stop offset="58%" stop-color="#ff1f3d"/>' +
        '<stop offset="100%" stop-color="rgba(255,31,61,0)"/>' +
      '</linearGradient>' +
    '</defs>' +
    '<g transform="translate(100,100)">' +
      '<rect x="-2" y="-100" width="4" height="200" fill="url(#fmSparkRay)"/>' +
      '<rect x="-100" y="-2" width="200" height="4" fill="url(#fmSparkRay)"/>' +
      '<rect x="-1.2" y="-70" width="2.4" height="140" fill="url(#fmSparkRay)" transform="rotate(45)"/>' +
      '<rect x="-1.2" y="-70" width="2.4" height="140" fill="url(#fmSparkRay)" transform="rotate(-45)"/>' +
      '<circle r="30" fill="url(#fmSparkCore)"/>' +
    '</g>' +
  '</svg>';

  function floatify(el){
    el.style.setProperty('--fm-float-dur', (3.4 + Math.random() * 2.8).toFixed(2) + 's');
    el.style.setProperty('--fm-float-delay', (Math.random() * 2.6).toFixed(2) + 's');
    el.style.setProperty('--fm-float-y', '-' + (4 + Math.random() * 6).toFixed(1) + 'px');
    el.classList.add('fm-float');
  }

  function run(){
    document.documentElement.classList.add('fm-orbiting');
    document.body.classList.add('fm-orbiting');

    var all = Array.prototype.slice.call(document.querySelectorAll(
      'div, p, h1, h2, h3, h4, h5, h6, span, label, li, a, button, input, select, textarea'
    )).slice(0, 60);

    function endOrbitBg(){
      document.documentElement.classList.remove('fm-orbiting');
      document.body.classList.remove('fm-orbiting');
    }

    if (!all.length) { endOrbitBg(); parent.postMessage({ __fm: 'nebula-fade' }, '*'); return; }

    var cx = innerWidth / 2, cy = innerHeight / 2;
    var orbiters = [];

    all.forEach(function(el){
      var r = el.getBoundingClientRect();
      if (!r.width || !r.height) return;
      var rx = Math.min(innerWidth, innerHeight) * (0.26 + Math.random() * 0.32);
      orbiters.push({
        el: el, targetX: r.left + r.width / 2, targetY: r.top + r.height / 2,
        rx: rx, ry: rx * (0.45 + Math.random() * 0.35),
        // rápido, y cada chispita a una velocidad bien distinta
        speed: (Math.random() < 0.5 ? -1 : 1) * (Math.PI * 2 / (0.9 + Math.random() * 1.3)),
        phase: Math.random() * Math.PI * 2,
        size: 78 + Math.random() * 64,
        entered: false,
        landing: false,
      });
    });

    if (!orbiters.length) { endOrbitBg(); parent.postMessage({ __fm: 'nebula-fade' }, '*'); return; }

    // ---- estado inicial: el elemento real, invisible ----
    orbiters.forEach(function(o){ o.el.style.transition = 'none'; o.el.style.opacity = '0'; });

    // ---- una chispita por elemento, aparte del layout: entra desde
    // bien afuera de la pantalla y viaja hasta su punto de órbita ----
    orbiters.forEach(function(o, i){
      var wrap = document.createElement('div');
      wrap.style.cssText =
        'position:fixed;left:0;top:0;width:' + o.size + 'px;height:' + o.size + 'px;' +
        'margin-left:-' + (o.size / 2) + 'px;margin-top:-' + (o.size / 2) + 'px;' +
        'pointer-events:none;z-index:2147483647;opacity:0;';
      var spin = document.createElement('div');
      spin.style.cssText =
        'width:100%;height:100%;' +
        'filter:drop-shadow(0 0 16px rgba(255,31,61,.95)) drop-shadow(0 0 34px rgba(255,20,50,.6));' +
        'animation:fm-spark-spin ' + (0.7 + Math.random() * 0.6).toFixed(2) + 's linear infinite,' +
        'fm-spark-pulse ' + (0.6 + Math.random() * 0.5).toFixed(2) + 's ease-in-out infinite;';
      spin.innerHTML = SPARK_SVG;
      wrap.appendChild(spin);
      document.body.appendChild(wrap);
      o.spark = wrap;

      // punto de entrada: bien afuera de la pantalla, en línea con su
      // propia órbita — y el punto donde arranca a orbitar de verdad
      var outX = cx + o.rx * 2.6 * Math.cos(o.phase), outY = cy + o.ry * 2.6 * Math.sin(o.phase);
      var inX = cx + o.rx * Math.cos(o.phase), inY = cy + o.ry * Math.sin(o.phase);
      wrap.style.transform = 'translate(' + outX.toFixed(1) + 'px,' + outY.toFixed(1) + 'px)';
      void wrap.offsetWidth;   // fuerza el layout con el punto de partida ya pintado

      var delay = i * 35;
      wrap.style.transition =
        'transform ' + (ENTER_MS / 1000) + 's cubic-bezier(.22,1,.36,1) ' + delay + 'ms, ' +
        'opacity .7s ease ' + delay + 'ms';   // fade de 0 a 1 bien suave: nada de aparición brusca
      wrap.style.opacity = '1';
      wrap.style.transform = 'translate(' + inX.toFixed(1) + 'px,' + inY.toFixed(1) + 'px)';

      wrap.addEventListener('transitionend', function entered(ev){
        if (ev.propertyName !== 'transform') return;
        wrap.removeEventListener('transitionend', entered);
        wrap.style.transition = 'none';
        o.entered = true;   // recién ahora el tick de abajo la mueve
      });
    });

    // ---- fase 1: ya en órbita, girando y latiendo mientras se trasladan ----
    var start = performance.now(), raf;
    function tick(now){
      var t = (now - start) / 1000;
      orbiters.forEach(function(o){
        if (!o.entered || o.landing) return;   // viajando desde afuera, o ya aterrizando
        var a = o.phase + t * o.speed;
        var x = cx + o.rx * Math.cos(a), y = cy + o.ry * Math.sin(a);
        o.spark.style.transform = 'translate(' + x.toFixed(1) + 'px,' + y.toFixed(1) + 'px)';
      });
      raf = requestAnimationFrame(tick);
    }
    raf = requestAnimationFrame(tick);

    // ---- fase 2: recién ahora empiezan a aparecer los elementos — pero no
    // todas de una: cada chispita aterriza en un momento propio, separado
    // por un par de segundos al azar de la anterior. La nebulosa recién se
    // entera de que puede apagarse más adelante (ver más abajo), así se
    // queda un rato visible mientras esto termina de pasar ----
    setTimeout(function(){
      var pending = orbiters.length;

      orbiters.forEach(function(o, i){
        var extra = Math.random() * LAND_SPREAD_MS;   // el "algunos segundos" de separación
        setTimeout(function(){
          o.landing = true;
          var delay = i * 40;
          o.spark.style.transition = 'transform ' + (LAND_MS / 1000) + 's cubic-bezier(.22,1,.36,1) ' + delay + 'ms';
          o.spark.style.transform = 'translate(' + o.targetX.toFixed(1) + 'px,' + o.targetY.toFixed(1) + 'px)';

          o.spark.addEventListener('transitionend', function land(ev){
            if (ev.propertyName !== 'transform') return;
            o.spark.removeEventListener('transitionend', land);
            // ---- la chispita revienta, y el elemento real aparece de golpe ----
            // (el giro/latido de arriba está puesto inline, así que hay que
            // pisarlo con otra inline: una clase no le gana a un inline)
            o.spark.firstChild.style.animation = 'fm-spark-burst .35s ease-out both';
            setTimeout(function(){ o.spark.remove(); }, 380);

            o.el.style.transition = 'none';
            o.el.style.opacity = '1';
            o.el.classList.add('fm-flash');
            o.el.addEventListener('animationend', function flashDone(){
              o.el.removeEventListener('animationend', flashDone);
              o.el.classList.remove('fm-flash');
              floatify(o.el);
            });
          });

          pending--;
          if (pending <= 0) cancelAnimationFrame(raf);
        }, extra);
      });

      // recién ahora, con casi todas ya aparecidas, se avisa a la nebulosa —
      // y en ia.css su propia transición de apagado es lenta, no un corte
      setTimeout(function(){
        parent.postMessage({ __fm: 'nebula-fade' }, '*');
        endOrbitBg();
      }, LAND_SPREAD_MS + NEBULA_STAY_MS);
    }, ORBIT_MS);
  }

  if (document.readyState === 'complete') setTimeout(run, 30);
  else addEventListener('load', function(){ setTimeout(run, 30); });
})();<\/script>`;

/** Mete el SDK, los estilos base y el ensamblaje de entrada dentro del <head>. */
function injectSdk(html) {
  const inject = NEON_CSS + SDK + ASSEMBLE_JS;
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
Antes de tu HTML se inyecta una hoja de estilos base: fondo casi negro
(--fm-bg #0a0a0c) y todo lo demás sin relleno — nada de paneles ni
botones con fondo de color. Los controles ya salen vestidos en tres
niveles de intensidad de glow, de más a menos fuerte:
- Botones (button, .fm-btn, input[type=button|submit]): círculo
  perfecto — caja cuadrada, radio al 100%, sin padding. Es el glow más
  intenso. Si el texto no entra, ajusta el font-size inline (más corto
  = más grande, más largo = más chico) o sube la variable --fm-btn-size
  en ese botón puntual para agrandar la caja. Nunca lo vuelvas
  rectangular ni le agregues padding.
- Labels (clases .fm-label / .fm-label-main — NO el <label> de
  formulario): píldora redonda para mostrar texto corto, un valor o el
  título de un campo. Glow intermedio. Úsalas solo si la app necesita
  destacar un texto así; si hay varias juntas, exactamente una lleva
  .fm-label-main (más ancha) y el resto .fm-label.
- input/select/textarea: sin caja, solo una línea inferior con el glow
  más suave de los tres. No les agregues tu propio borde ni fondo.
- Genera solo los componentes que la instrucción realmente pide: no
  fuerces un botón, un input o un label si la app no los necesita.
- NO definas tu propia paleta de colores ni le pongas fondo a botones,
  tarjetas ni contenedores: todo es transparente sobre el fondo oscuro,
  delineado en rojo neón. Usa las etiquetas normales, o las clases
  .fm-panel / .card / .panel / .fm-neon si te hacen falta.
- Tu <style> es solo para el layout propio de la app (posiciones,
  tamaños, espaciados, grids) y detalles muy específicos que la base no
  cubre. Cuanto menos CSS de tema escribas, mejor.
- NO pongas un título ni un encabezado grande que repita o describa la
  app (nada de "<h1>Calculadora de X</h1>" a modo de rótulo arriba de
  todo): ve directo a la interfaz funcional. Un texto o etiqueta corta
  junto a un control específico sí vale, si hace falta para usarlo.
- La aparición de cada elemento y una flotación sutil en reposo ya están
  animadas automáticamente (no las reimplementes ni les pongas tu propia
  animación de entrada, ni animation o transition sobre transform a nivel
  de página: pisarían la que ya corre). Tu CSS puede animar cosas propias
  de la interacción (un botón que se presiona, un contador que cambia),
  no la entrada de los elementos.
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

  await FM.saveForm('Nombre del formulario', { pregunta1: 'valor1', pregunta2: 'valor2' })
      Guarda las respuestas de un formulario como un registro nuevo en
      Airtable — no como archivo. Primer argumento: un nombre corto para
      identificar qué formulario es. Segundo: un objeto plano, una clave
      por pregunta. Devuelve { id, name, fields, createdTime }.

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
  normales de JavaScript.
- Si la instrucción pide crear un FORMULARIO (preguntar varios datos y
  guardarlos), sigue esta estructura:
    1. Un input por cada dato que haya que pedir, con su label corto al
       lado si hace falta (.fm-label-main para el dato principal, .fm-label
       para el resto).
    2. Un único botón circular al final para enviar (p.ej. "Enviar").
    3. Al tocarlo: deshabilita el botón y muestra un estado de carga breve
       (el propio botón puede decir "..." o atenuarse) mientras se guarda.
    4. Al terminar: reemplaza el formulario por una confirmación clara
       (p.ej. un .fm-label-main con "Listo ✓"), no lo dejes ahí tal cual.
       Si falla, muestra el error y deja reintentar.
    5. Guarda las respuestas con FM.saveForm(nombreDelFormulario, campos) —
       nunca con FM.saveJSON ni con fetch propio.`;

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
   Generación falsa, para /test/sendOrder/ → "Probar gratis"
   ------------------------------------------------------------
   Mismo código, mismo <head> inyectado (SDK, estilos, ensamblaje y
   flotación) que una app real — así sirve para probar la animación
   de punta a punta — pero sin tocar OpenAI: cero tokens gastados.
   El retraso de ~2s imita el tiempo real de generación.
   ============================================================ */
const MOCK_HTML = `<!DOCTYPE html><html lang="es"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:20px;height:100vh;margin:0;padding:24px;box-sizing:border-box;text-align:center">
  <label for="mock-input">Prueba de animación</label>
  <input id="mock-input" type="text" placeholder="Escribe algo...">
  <button type="button">Probar</button>
</body></html>`;

function mockGenerate() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(injectSdk(MOCK_HTML)), 2000);
  });
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
      dismissedId,
    });
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido' });
  }

  /* ---------- se borró con el shake: avisarle a los demás dispositivos ---------- */
  if (req.query?.dismiss) {
    let body = {};
    try { body = JSON.parse(await readRaw(req)) || {}; } catch { /* sin body */ }

    const id = String(body.id || '');
    if (id) {
      dismissedId = id;
      if (app && app.id === id) app = null;
    }
    return res.status(200).json({ ok: true });
  }

  /* ---------- ruta de prueba: manda texto como si fuera el webhook ---------- */
  if (req.query?.test) {
    const expected = process.env.TEST_ORDER_KEY;
    if (!expected) {
      return res.status(501).json({ error: 'TEST_ORDER_KEY no está configurada en este entorno.' });
    }

    let body = {};
    try { body = JSON.parse(await readRaw(req)) || {}; } catch { /* sin body */ }

    if (!safeEqual(String(body.key || ''), expected)) {
      return res.status(401).json({ error: 'Clave inválida.' });
    }

    const text = String(body.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Falta el texto.' });

    const mock = Boolean(body.mock);

    latest = {
      id: `test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      at: new Date().toISOString(),
      text,
      client: 'test/sendOrder',
      recordedAt: null,
      formato: 'test',
      bytes: Buffer.byteLength(text, 'utf8'),
      raw: null,
      mock,   // "Probar gratis": el ?generate=1 de abajo no toca OpenAI
    };

    console.log(`[api/ia] orden de prueba${mock ? ' (mock)' : ''} (${text.length} chars): ${text}`);
    return res.status(200).json({ ok: true, id: latest.id });
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
    inflight = { id, promise: latest.mock ? mockGenerate() : generate(prompt) };

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

  /* ---------- capacidades: guardar un formulario (registro, sin adjunto) ---------- */
  if (req.query?.saveForm) {
    let body = {};
    try { body = JSON.parse(await readRaw(req)) || {}; } catch { /* sin body */ }

    if (!verifyToken(body.token)) {
      return res.status(401).json({ error: 'Token de la app inválido o vencido.' });
    }
    try {
      const saved = await airtableSaveForm({ name: body.name, fields: body.fields });
      return res.status(200).json(saved);
    } catch (err) {
      console.error('[api/ia] fallo guardando formulario:', err.message);
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
