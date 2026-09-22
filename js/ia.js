/* ============================================================
   ia.js — la nebulosa espera; cuando llega una transcripción se
   manda a GPT, y lo que devuelve se ejecuta a pantalla completa.
   ============================================================ */

const POLL_MS = 2000;
const STORE   = 'fm.ia.app.v1';

/* El meta viewport (user-scalable=no) ya no alcanza: Safari moderno lo
   ignora por accesibilidad. Sin esto, el pellizco con dos dedos hace zoom
   sobre la nebulosa o la app a pantalla completa. */
document.addEventListener('touchmove', (e) => { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

const stage  = document.getElementById('stage');
const frame  = document.getElementById('app-frame');
const nav    = document.getElementById('nav');

/* ============================================================
   Nebulosa — el giro de cada capa se integra por JS, cuadro a cuadro
   ------------------------------------------------------------
   Antes esto era animation-duration atado a una variable CSS (--spin)
   que hacía *transition*: cambiar animation-duration no acelera con
   fluidez — el navegador recalcula la posición dentro del ciclo con la
   nueva duración en cada frame, y eso se sentía como un salto o una
   pausa justo al llegar una solicitud. Acá se acumula el ángulo/fase de
   cada capa a mano; la velocidad (orbSpin) se acerca sola al objetivo
   (rápido si stage está busy/orbiting, lento si no), así puede cambiar
   sin que la posición salte nunca — nunca se pausa.
   ============================================================ */
const orbLayers = Array.from(document.querySelectorAll('#orb i'));
const ORB_MOTION = [
  { kind: 'rot', baseSec: 13, dir: 1 },
  { kind: 'rot', baseSec: 22, dir: -1 },
  { kind: 'rot', baseSec: 8, dir: 1 },
  { kind: 'drift', baseSec: 19, dir: 1 },
  { kind: 'driftBreathe', baseSec: 11, breatheSec: 6, dir: -1 },
];
const orbPhase = ORB_MOTION.map(() => 0);
let orbSpin = 0.833;   // velocidad actual; arranca en reposo (20% más lenta)
let orbLast = null;

function tickOrb(now) {
  if (orbLast == null) orbLast = now;
  const dt = Math.min((now - orbLast) / 1000, 0.1);
  orbLast = now;

  const target = (stage.classList.contains('busy') || stage.classList.contains('orbiting')) ? 6 : 0.833;
  // se acerca sola al objetivo, sin escalón — más lento que antes (~1.2)
  // para que de lento a rápido se sienta como una rampa, no un salto
  orbSpin += (target - orbSpin) * Math.min(dt * 1.2, 1);

  ORB_MOTION.forEach((m, i) => {
    orbPhase[i] += (dt / m.baseSec) * m.dir * orbSpin;
    const layer = orbLayers[i];
    if (!layer) return;
    const t = orbPhase[i] * Math.PI * 2;
    if (m.kind === 'rot') {
      layer.style.transform = `rotate(${((orbPhase[i] % 1) * 360).toFixed(2)}deg)`;
    } else if (m.kind === 'drift') {
      layer.style.transform =
        `translate(${(Math.sin(t) * 6.5).toFixed(2)}%,${(Math.sin(t * 1.3 + 1) * 5.5).toFixed(2)}%)`;
    } else if (m.kind === 'driftBreathe') {
      const breathe = 1.1 - 0.1 * Math.cos((orbPhase[i] * m.baseSec / m.breatheSec) * Math.PI * 2);
      layer.style.transform =
        `translate(${(Math.sin(t) * 6.5).toFixed(2)}%,${(Math.sin(t * 1.3 + 1) * 5.5).toFixed(2)}%) scale(${breathe.toFixed(3)})`;
    }
  });

  requestAnimationFrame(tickOrb);
}
if (orbLayers.length && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
  requestAnimationFrame(tickOrb);
}

const CLOSE_ANIM_MS  = 760;   // debe cubrir la transición de .app-frame en ia.css
const SHAKE_ANIM_MS  = 620;   // debe coincidir con @keyframes fm-shake en ia.css
const NEBULA_FALLBACK_MS = 4500;  // por si la app nunca avisa que ya puede apagarse

let handledId = null;     // transcripción ya procesada
let shownId   = null;     // app que se está viendo
let busy      = false;
let nebulaFadeTimer = null;

/* ============================================================
   Destellos de reposo
   ------------------------------------------------------------
   El mismo destello que usan los elementos al aparecer dentro de una
   app generada (ver SPARK_SVG en api/ia.js), pero acá orbitando
   siempre, despacio, alrededor del centro de la pantalla mientras la
   nebulosa espera. Al llegar una solicitud aceleran junto con ella
   (mismo múltiplo que --spin en ia.css) y no bajan el ritmo hasta que
   la app está lista; ahí desaparecen del todo y solo vuelven a
   aparecer cuando se regresa a la espera (closeApp).
   ============================================================ */
const idleLayer = document.getElementById('idleSparks');
const IDLE_SPARK_COUNT = 5;
const IDLE_SPEED_BUSY  = 6;
const IDLE_SPEED_SLOW  = 0.8 * 0.85;   // 20% más lento, y otro 15% más sobre eso
const IDLE_REVERSE_COUNT = 2;          // cuántos de los destellos giran al revés del resto

const IDLE_SPARK_SVG = '<svg viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg">' +
  '<defs>' +
    '<radialGradient id="fmIdleCore" cx="50%" cy="50%" r="50%">' +
      '<stop offset="0%" stop-color="#ffd9cf"/>' +
      '<stop offset="20%" stop-color="#ff5a4e"/>' +
      '<stop offset="50%" stop-color="#ff1f3d"/>' +
      '<stop offset="100%" stop-color="rgba(224,16,43,0)"/>' +
    '</radialGradient>' +
    '<linearGradient id="fmIdleRay" x1="0" y1="0" x2="0" y2="1">' +
      '<stop offset="0%" stop-color="rgba(255,31,61,0)"/>' +
      '<stop offset="42%" stop-color="#ff1f3d"/>' +
      '<stop offset="50%" stop-color="#ff8a72"/>' +
      '<stop offset="58%" stop-color="#ff1f3d"/>' +
      '<stop offset="100%" stop-color="rgba(255,31,61,0)"/>' +
    '</linearGradient>' +
  '</defs>' +
  '<g transform="translate(100,100)">' +
    '<rect x="-2" y="-100" width="4" height="200" fill="url(#fmIdleRay)"/>' +
    '<rect x="-100" y="-2" width="200" height="4" fill="url(#fmIdleRay)"/>' +
    '<rect x="-1.2" y="-70" width="2.4" height="140" fill="url(#fmIdleRay)" transform="rotate(45)"/>' +
    '<rect x="-1.2" y="-70" width="2.4" height="140" fill="url(#fmIdleRay)" transform="rotate(-45)"/>' +
    '<circle r="30" fill="url(#fmIdleCore)"/>' +
  '</g>' +
'</svg>';

let idleSparks   = [];
let idleRaf      = null;
let idleStart    = 0;
let idleSpeedMul = 1;

function spawnIdleSparks() {
  if (idleSparks.length || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (let i = 0; i < IDLE_SPARK_COUNT; i++) {
    const el = document.createElement('div');
    el.className = 'idle-spark';
    el.innerHTML = IDLE_SPARK_SVG;
    // cada una a su propio tamaño y ritmo de giro/latido, como las de la entrada
    const size = 40 + Math.random() * 60;
    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.marginLeft = (-size / 2) + 'px';
    el.style.marginTop = (-size / 2) + 'px';
    el.style.animationDuration =
      (0.9 + Math.random() * 0.8).toFixed(2) + 's, ' + (0.9 + Math.random() * 0.7).toFixed(2) + 's';
    idleLayer.appendChild(el);
    // los primeros IDLE_REVERSE_COUNT giran al revés del resto, siempre —
    // no queda librado al azar que por casualidad salgan todos parejo
    const dir = i < IDLE_REVERSE_COUNT ? -1 : 1;
    idleSparks.push({
      el,
      rx: 0.14 + Math.random() * 0.2,   // fracción del lado menor de la pantalla
      ry: 0.09 + Math.random() * 0.16,
      phase: Math.random() * Math.PI * 2,
      speed: dir * (0.1 + Math.random() * 0.08) * IDLE_SPEED_SLOW,
    });
  }
  idleStart = performance.now();
  tickIdle();
}

function tickIdle() {
  const t = (performance.now() - idleStart) / 1000;
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const base = Math.min(innerWidth, innerHeight);
  idleSparks.forEach((s) => {
    const a = s.phase + t * s.speed * idleSpeedMul;
    const x = cx + base * s.rx * Math.cos(a);
    const y = cy + base * s.ry * Math.sin(a);
    s.el.style.transform = `translate(${x.toFixed(1)}px,${y.toFixed(1)}px)`;
  });
  idleRaf = requestAnimationFrame(tickIdle);
}

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
  // los destellos de reposo aceleran junto con la nebulosa mientras se
  // genera, y no bajan el ritmo hasta que la app aparece (showApp los quita)
  idleSpeedMul = on ? IDLE_SPEED_BUSY : 1;
}

/** Mete un flag al principio del <head> para que el ensamblaje de entrada
 *  (api/ia.js) se salte toda la animación: la app ya existía, no hace
 *  falta volver a hacerla orbitar. */
function withEntranceFlag(html, skip) {
  if (!skip) return html;
  const flag = '<script>window.__fmSkipEntrance=true;<\/script>';
  return /<head[^>]*>/i.test(html) ? html.replace(/<head[^>]*>/i, (m) => m + flag) : flag + html;
}

function showApp(entry, { skipEntrance = false } = {}) {
  // la app ya está lista: nunca desaparecen del todo, solo se apagan y
  // siguen orbitando detrás (ver .idle-sparks.behind en ia.css)
  idleLayer.classList.add('behind');
  shownId = entry.id;
  token = entry.token || null;
  frame.srcdoc = withEntranceFlag(entry.html, skipEntrance);   // no hay que escapar nada
  frame.classList.add('show');
  // la nebulosa NO se apaga todavía: sigue girando (más rápido, "orbiting")
  // de fondo mientras la app se arma (las chispitas orbitan, aterrizan...).
  // El fondo del propio iframe es transparente siempre (ver api/ia.js), así
  // que no hace falta esconder nada para que la nebulosa (y los destellos
  // de reposo) se sigan viendo detrás. La propia app avisa por postMessage
  // cuándo ya puede apagarse la nebulosa (ver el listener de 'nebula-fade'
  // más abajo); esto es solo el respaldo por si ese aviso nunca llega
  // (reduced-motion raro, una app rota, etc.) o si se saltó la animación
  // entera (skipEntrance).
  stage.classList.add('orbiting');
  frame.classList.add('orbiting');
  clearTimeout(nebulaFadeTimer);
  nebulaFadeTimer = setTimeout(() => {
    stage.classList.remove('orbiting');
    frame.classList.remove('orbiting');
    stage.classList.add('oculta');
  }, NEBULA_FALLBACK_MS);
}

/* El botón de la esquina es siempre "volver al inicio": no hay botón para
   eliminar la app. Para eso está el shake, más abajo. Al cerrar dejamos que
   la animación de la nebulosa "tragándose" la app termine antes de vaciar
   el iframe, si no se ve un parpadeo en blanco a mitad de la transición. */
function closeApp() {
  clearTimeout(nebulaFadeTimer);
  frame.classList.remove('show');
  frame.classList.remove('orbiting');
  stage.classList.remove('oculta');
  stage.classList.remove('orbiting');
  shownId = null;
  token = null;
  // de vuelta a la espera: brillan de nuevo (spawnIdleSparks no hace nada
  // si ya existían, solo cubre el caso de que nunca se hayan creado)
  idleLayer.classList.remove('behind');
  spawnIdleSparks();
  setTimeout(() => {
    if (shownId === null) frame.srcdoc = '';
  }, CLOSE_ANIM_MS);
}

/** Le avisa al servidor que esta app se descartó, para que desaparezca
 *  también en cualquier otro dispositivo que la tenga abierta — si no,
 *  el shake solo la borraba en este celular. Mejor esfuerzo: si falla
 *  (sin conexión), igual se cierra acá; no bloquea nada. */
function dismissRemote(id) {
  if (!id) return;
  fetch('/api/ia?dismiss=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  }).catch(() => { /* mejor esfuerzo */ });
}

function dismissApp() {
  dismissRemote(shownId);
  markClosed();
  closeApp();
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && frame.classList.contains('show')) {
    dismissApp();
  }
});

/* ============================================================
   Shake para descartar la app cargada
   ------------------------------------------------------------
   Sin botón de eliminar: se agita el celular y vuelve a ser la
   nebulosa. La detección vive AQUÍ, en esta página — nunca dentro
   del iframe de la app generada: ese iframe corre en sandbox sin
   "allow-same-origin", así que tiene un origen opaco, y el navegador
   le bloquea el sensor de movimiento pase lo que pase con el
   permiso. Por eso el permiso hay que pedirlo desde una página real
   del sitio: el botón "Solicitar permisos" en Yo. Una vez concedido
   para el origen, volver a pedirlo aquí (sin necesitar un toque)
   responde al momento, sin mostrar ningún diálogo. */
const SHAKE_THRESHOLD = 18;    // m/s² de variación entre lecturas
const SHAKE_COOLDOWN  = 1200;  // no disparar dos veces seguidas

let lastShakeAt = 0;
let lastAcc = null;
let shakeEnabled = false;

function shakeDetected() {
  const now = Date.now();
  if (now - lastShakeAt <= SHAKE_COOLDOWN) return;
  lastShakeAt = now;
  if (!frame.classList.contains('show')) return;

  if (navigator.vibrate) navigator.vibrate([40, 30, 40]);  // sin soporte en iOS: no hace nada

  frame.classList.add('shaking');
  setTimeout(() => {
    frame.classList.remove('shaking');
    dismissApp();
  }, SHAKE_ANIM_MS);
}

function onDeviceMotion(e) {
  const acc = e.accelerationIncludingGravity || e.acceleration;
  if (!acc || acc.x == null) return;

  const { x, y, z } = acc;
  if (lastAcc) {
    const delta = Math.abs(x - lastAcc.x) + Math.abs(y - lastAcc.y) + Math.abs(z - lastAcc.z);
    if (delta > SHAKE_THRESHOLD) shakeDetected();
  }
  lastAcc = { x, y, z };
}

function enableShake() {
  if (shakeEnabled) return;
  shakeEnabled = true;
  window.addEventListener('devicemotion', onDeviceMotion);
}

function requestShakePermission() {
  if (typeof DeviceMotionEvent === 'undefined') return;
  if (typeof DeviceMotionEvent.requestPermission !== 'function') { enableShake(); return; }
  DeviceMotionEvent.requestPermission()
    .then((state) => { if (state === 'granted') enableShake(); })
    .catch(() => { /* todavía no se concedió: se reintenta con el próximo toque */ });
}

// se pide de una al cargar: si ya se concedió antes (el botón de Yo),
// esto responde solo, sin diálogo, y el shake queda listo sin tocar nada
requestShakePermission();

// respaldo por si esa primera llamada no bastó (primera visita, sin pasar
// por Yo todavía): cualquier toque en esta página lo vuelve a intentar
document.addEventListener('pointerdown', () => {
  if (!shakeEnabled) requestShakePermission();
}, { capture: true });

function flashError(msg) {
  console.error('[ia]', msg);
  stage.classList.add('error');
  setTimeout(() => stage.classList.remove('error'), 1500);
}

/* la propia app avisa cuándo terminó de orbitar y aterrizar: recién ahí
   se apaga la nebulosa (ver el "ensamblaje de entrada" en api/ia.js) */
window.addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow) return;
  if (e.data && e.data.__fm === 'nebula-fade') {
    clearTimeout(nebulaFadeTimer);
    stage.classList.remove('orbiting');
    frame.classList.remove('orbiting');
    stage.classList.add('oculta');
  }
});


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

async function guardarForm({ name, fields }) {
  if (!token) throw new Error('Esta app no tiene permiso para guardar.');

  const res = await fetch('/api/ia?saveForm=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, name, fields }),
  });

  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
  console.log(`[ia] formulario guardado: ${json.name}`, json.id);
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
  'save-form': (p) => guardarForm(p),
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

  const { latest, app, dismissedId } = data;

  // la que tengo abierta se borró desde otro dispositivo (o desde acá mismo,
  // por las dudas): se cierra también en esta pantalla
  if (shownId && dismissedId === shownId) {
    markClosed();
    closeApp();
    return;
  }

  // ya hay una app en pantalla: no se crea otra encima. Sigue vigente
  // como "sin procesar" (no se toca handledId) — en cuanto se cierre con
  // el shake, el siguiente sondeo la recoge y recién ahí se genera.
  if (frame.classList.contains('show')) return;

  if (!latest?.text) return;

  if (latest.id === handledId) return;
  handledId = latest.id;

  console.log(latest.text);

  // si el servidor ya la generó (otra pestaña, otro dispositivo), la tomamos
  if (app?.id === latest.id && await adopt(app.id, latest.text)) return;

  generate(latest.id, latest.text);
}

/* ---------------- arranque ---------------- */
/* Antes de retomar lo que quedó en localStorage hay que preguntarle al
   servidor si sigue vigente: si el shake la borró desde el celular
   mientras esta pestaña estaba cerrada (o sin mirar), el localStorage de
   ESTA pestaña nunca se enteró — nadie le avisó — y sin este chequeo
   mostraría la app vieja igual, aunque ya no exista en ningún otro lado. */
async function boot() {
  const saved = load();

  let data = null;
  try {
    const res = await fetch('/api/ia', { cache: 'no-store' });
    if (res.ok) data = await res.json();
  } catch { /* sin conexión: seguimos con lo que había en caché, mejor que nada */ }

  if (saved?.html && !saved.closed) {
    if (data && data.dismissedId === saved.id) {
      // se borró en otro dispositivo mientras esta pestaña no miraba
      markClosed();
      handledId = saved.id;
    } else {
      // ya existía: no hace falta que las luces vuelvan a orbitar de nuevo
      showApp(saved, { skipEntrance: true });
      handledId = saved.id;
      // el token dura 24h: si el servidor ya nos lo dio en el estado general, listo
      if (data?.app?.id === saved.id && data.app.token) {
        token = data.app.token;
        save({ ...saved, token: data.app.token });
      } else {
        fetch('/api/ia?app=1', { cache: 'no-store' })
          .then((r) => r.json())
          .then(({ app }) => { if (app?.id === saved.id && app.token) { token = app.token; save({ ...saved, token: app.token }); } })
          .catch(() => { /* seguimos con el que había */ });
      }
    }
  } else if (saved?.id) {
    handledId = saved.id;           // ya la vimos y la cerramos: no regenerar
  }

  // si no se retomó ninguna app, la nebulosa arranca en espera: que orbiten
  if (!frame.classList.contains('show')) spawnIdleSparks();

  poll();
  setInterval(poll, POLL_MS);
}

boot();
