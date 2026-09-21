/* ============================================================
   ia.js — la nebulosa espera; cuando llega una transcripción se
   manda a GPT, y lo que devuelve se ejecuta a pantalla completa.
   ============================================================ */

const POLL_MS = 2000;
const STORE   = 'fm.ia.app.v1';

const stage  = document.getElementById('stage');
const frame  = document.getElementById('app-frame');
const nav    = document.getElementById('nav');

const CLOSE_ANIM_MS = 760;  // debe cubrir la transición de .app-frame en ia.css

let handledId = null;     // transcripción ya procesada
let shownId   = null;     // app que se está viendo
let busy      = false;

/* ---------------- lo guardado ---------------- */
function load() {
  try { return JSON.parse(localStorage.getItem(STORE)) || null; } catch { return null; }
}
function save(entry) {
  try { localStorage.setItem(STORE, JSON.stringify(entry)); } catch { /* modo privado */ }
}
function markClosed() {
  const s = load();
  if (s) save({ ...s, closed: true });
}

/* ---------------- pantalla ---------------- */
function setBusy(on) {
  busy = on;
  stage.classList.toggle('busy', on);
}

function showApp(entry) {
  shownId = entry.id;
  token = entry.token || null;
  frame.srcdoc = entry.html;           // asignado como propiedad: no hay que escapar nada
  frame.classList.add('show');
  stage.classList.add('oculta');
}

/* El botón de la esquina es siempre "volver al inicio": no hay botón para
   eliminar la app. Para eso está el shake, más abajo. Al cerrar dejamos que
   la animación de la nebulosa "tragándose" la app termine antes de vaciar
   el iframe, si no se ve un parpadeo en blanco a mitad de la transición. */
function closeApp() {
  frame.classList.remove('show');
  stage.classList.remove('oculta');
  shownId = null;
  token = null;
  setTimeout(() => {
    if (shownId === null) frame.srcdoc = '';
  }, CLOSE_ANIM_MS);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && frame.classList.contains('show')) {
    markClosed();
    closeApp();
  }
});

/* ============================================================
   Shake para descartar la app cargada
   ------------------------------------------------------------
   Sin botón de eliminar: se agita el celular y vuelve a ser la
   nebulosa. En iOS hace falta permiso explícito, y solo se puede
   pedir tras un gesto del usuario — se pide con el primer toque.
   ============================================================ */
const SHAKE_THRESHOLD = 18;    // m/s² de variación entre lecturas
const SHAKE_COOLDOWN  = 1200;  // no disparar dos veces seguidas

let lastShakeAt = 0;
let lastAcc = null;

function onDeviceMotion(e) {
  const acc = e.accelerationIncludingGravity || e.acceleration;
  if (!acc || acc.x == null) return;

  const { x, y, z } = acc;
  if (lastAcc) {
    const delta = Math.abs(x - lastAcc.x) + Math.abs(y - lastAcc.y) + Math.abs(z - lastAcc.z);
    const now = Date.now();
    if (delta > SHAKE_THRESHOLD && now - lastShakeAt > SHAKE_COOLDOWN) {
      lastShakeAt = now;
      if (frame.classList.contains('show')) {
        markClosed();
        closeApp();
      }
    }
  }
  lastAcc = { x, y, z };
}

function enableShake() {
  window.addEventListener('devicemotion', onDeviceMotion);
}

if (typeof DeviceMotionEvent !== 'undefined' && typeof DeviceMotionEvent.requestPermission === 'function') {
  const askPermission = () => {
    document.removeEventListener('click', askPermission);
    document.removeEventListener('touchend', askPermission);
    DeviceMotionEvent.requestPermission().then((state) => {
      if (state === 'granted') enableShake();
    }).catch(() => { /* el usuario dijo que no */ });
  };
  document.addEventListener('click', askPermission, { once: true });
  document.addEventListener('touchend', askPermission, { once: true });
} else if (typeof DeviceMotionEvent !== 'undefined') {
  enableShake();
}

function flashError(msg) {
  console.error('[ia]', msg);
  stage.classList.add('error');
  setTimeout(() => stage.classList.remove('error'), 1500);
}


/* ============================================================
   Puente de capacidades
   ------------------------------------------------------------
   La app vive en un iframe de origen opaco: no puede llamar a
   /api/ia ni pedir el micrófono. Nos pide las cosas por
   postMessage y las hacemos nosotros, que sí estamos en el
   dominio. Solo se atiende a nuestro propio iframe.
   ============================================================ */

let token = null;         // firmado por el servidor, va con cada guardado
let recorder = null;      // MediaRecorder en curso

/** Blob -> base64, por trozos para no reventar la pila. */
async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function guardar({ blob, text, filename, contentType }) {
  if (!token) throw new Error('Esta app no tiene permiso para guardar.');

  const file = blob instanceof Blob
    ? blob
    : new Blob([String(text ?? '')], { type: contentType || 'text/plain' });

  const res = await fetch('/api/ia?save=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      token,
      filename: filename || `archivo-${Date.now()}`,
      contentType: contentType || file.type || 'application/octet-stream',
      data: await toBase64(file),
    }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  console.log(`[ia] guardado: ${json.filename}`, json.url);
  return json;
}

async function listar(limit) {
  const res = await fetch(`/api/ia?files=1&limit=${Number(limit) || 20}`, { cache: 'no-store' });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  return json.files;
}

async function grabarInicio() {
  if (recorder) throw new Error('Ya hay una grabación en curso.');
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('Este navegador no da acceso al micrófono.');

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    throw new Error(err.name === 'NotAllowedError'
      ? 'No diste permiso para usar el micrófono.'
      : `No se pudo abrir el micrófono: ${err.message}`);
  }

  const chunks = [];
  const mr = new MediaRecorder(stream);
  mr.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  mr.start();
  recorder = { mr, stream, chunks, desde: Date.now() };
  return { ok: true };
}

function grabarFin({ save = true, filename } = {}) {
  if (!recorder) return Promise.reject(new Error('No hay ninguna grabación en curso.'));

  const { mr, stream, chunks, desde } = recorder;
  recorder = null;

  return new Promise((resolve, reject) => {
    mr.onstop = async () => {
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      const seconds = Math.round((Date.now() - desde) / 100) / 10;

      if (!save) return resolve({ seconds, url: URL.createObjectURL(blob), size: blob.size });
      try {
        const guardado = await guardar({
          blob,
          filename: filename || `grabacion-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.webm`,
          contentType: blob.type,
        });
        resolve({ ...guardado, seconds });
      } catch (err) {
        reject(err);
      }
    };
    mr.stop();
  });
}

const ACCIONES = {
  save:        (p) => guardar(p),
  list:        (p) => listar(p?.limit),
  'rec-start': () => grabarInicio(),
  'rec-stop':  (p) => grabarFin(p),
};

window.addEventListener('message', async (e) => {
  // solo nuestro propio iframe: el origen es opaco, así que comparamos la ventana
  if (e.source !== frame.contentWindow) return;

  const msg = e.data;
  if (!msg || msg.__fm !== 'req' || !ACCIONES[msg.action]) return;

  const responder = (extra) =>
    frame.contentWindow?.postMessage({ __fm: 'res', rid: msg.rid, ...extra }, '*');

  try {
    responder({ result: await ACCIONES[msg.action](msg.payload) });
  } catch (err) {
    console.error(`[ia] ${msg.action}:`, err.message);
    responder({ error: err.message });
  }
});

/* ---------------- generar ---------------- */
async function generate(id, prompt) {
  setBusy(true);
  try {
    const res = await fetch('/api/ia?generate=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    if (!json.app?.html) throw new Error('respuesta sin código');

    const entry = { id: json.app.id, html: json.app.html, token: json.app.token, prompt, at: json.app.at, closed: false };
    save(entry);
    showApp(entry);
    console.log(`[ia] app lista (${entry.html.length} chars) para: ${prompt}`);
  } catch (err) {
    flashError(`no se pudo generar la app: ${err.message}`);
  } finally {
    setBusy(false);
  }
}

/** Trae el código de una app que el servidor ya tenía hecha. */
async function adopt(appId, prompt) {
  try {
    const res = await fetch('/api/ia?app=1', { cache: 'no-store' });
    const { app } = await res.json();
    if (!app?.html || app.id !== appId) return false;

    const entry = { id: app.id, html: app.html, token: app.token, prompt: app.prompt || prompt, at: app.at, closed: false };
    save(entry);
    showApp(entry);
    return true;
  } catch {
    return false;
  }
}

/* ---------------- sondeo ---------------- */
async function poll() {
  if (busy) return;

  let data;
  try {
    const res = await fetch('/api/ia', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
  } catch {
    return;                       // sin conexión: la nebulosa sigue girando
  }

  const { latest, app } = data;
  if (!latest?.text) return;

  if (latest.id === handledId) return;
  handledId = latest.id;

  console.log(latest.text);

  // si el servidor ya la generó (otra pestaña, otro dispositivo), la tomamos
  if (app?.id === latest.id && await adopt(app.id, latest.text)) return;

  generate(latest.id, latest.text);
}

/* ---------------- arranque ---------------- */
const saved = load();
if (saved?.html && !saved.closed) {
  showApp(saved);
  handledId = saved.id;
  // el token dura 24h: al volver pedimos uno fresco para la misma app
  fetch('/api/ia?app=1', { cache: 'no-store' })
    .then((r) => r.json())
    .then(({ app }) => { if (app?.id === saved.id && app.token) { token = app.token; save({ ...saved, token: app.token }); } })
    .catch(() => { /* seguimos con el que había */ });
} else if (saved?.id) {
  handledId = saved.id;           // ya la vimos y la cerramos: no regenerar
}

poll();
setInterval(poll, POLL_MS);
