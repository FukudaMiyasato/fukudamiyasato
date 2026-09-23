/* ============================================================
   mic.js — portón de clave, y después: mantener presionado graba,
   soltar manda el audio a Whisper y deja el texto como la
   transcripción vigente (lo mismo que el webhook real, o
   /test/sendOrder/, pero grabado acá con el dedo). El botón de
   borrar hace lo mismo que el shake en IA: descarta la app vigente
   para todos los dispositivos que la tengan abierta.
   ============================================================ */

const KEY_STORE = 'fm.mic.key.v1';

const gate       = document.getElementById('mic-gate');
const gateForm   = document.getElementById('mic-gate-form');
const gateKeyEl  = document.getElementById('mic-gate-key');
const gateSubmit = document.getElementById('mic-gate-submit');
const gateNote   = document.getElementById('mic-gate-note');

const app      = document.getElementById('mic-app');
const micBtn   = document.getElementById('mic-btn');
const clearBtn = document.getElementById('mic-clear');
const note     = document.getElementById('mic-note');

let verifiedKey = null;   // solo se guarda acá una vez que el servidor la confirmó

function setNote(text, isError = false) {
  note.textContent = text;
  note.classList.toggle('err', isError);
}
function setGateNote(text, isError = false) {
  gateNote.textContent = text;
  gateNote.classList.toggle('err', isError);
}

/** Le pregunta al servidor si la clave es correcta — no gasta Whisper. */
async function checkKey(key) {
  const res = await fetch('/api/ia?micAuth=1', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
}

function unlock(key) {
  verifiedKey = key;
  try { sessionStorage.setItem(KEY_STORE, key); } catch { /* modo privado */ }
  gate.hidden = true;
  app.hidden = false;
}

/* ---------------- portón ---------------- */
gateForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const key = gateKeyEl.value.trim();
  if (!key) return;

  gateSubmit.disabled = true;
  setGateNote('Comprobando…');
  try {
    await checkKey(key);
    unlock(key);
  } catch (err) {
    setGateNote(err.message, true);
    gateKeyEl.select();
  } finally {
    gateSubmit.disabled = false;
  }
});

// si ya se había entrado antes en esta pestaña, lo confirma solo (sin que
// haga falta escribir la clave de nuevo) — pero la página sigue oculta
// hasta que el servidor la confirme: nada de mostrarla optimistamente
(async function tryStoredKey() {
  let saved = null;
  try { saved = sessionStorage.getItem(KEY_STORE); } catch { /* modo privado */ }
  if (!saved) return;

  setGateNote('Comprobando…');
  try {
    await checkKey(saved);
    unlock(saved);
  } catch {
    setGateNote('');   // la clave guardada ya no sirve: que la escriba de nuevo
  }
})();

/* ---------------- grabar ---------------- */
let recorder = null;
let chunks = [];

/** Blob -> base64, por trozos para no reventar la pila (igual que en ia.js). */
async function toBase64(blob) {
  const buf = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function startRecording() {
  if (recorder) return;
  if (!navigator.mediaDevices?.getUserMedia) {
    setNote('Este navegador no da acceso al micrófono.', true);
    return;
  }

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch (err) {
    setNote(err.name === 'NotAllowedError'
      ? 'No diste permiso para usar el micrófono.'
      : `No se pudo abrir el micrófono: ${err.message}`, true);
    return;
  }

  chunks = [];
  recorder = new MediaRecorder(stream);
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.addEventListener('stop', () => stream.getTracks().forEach((t) => t.stop()), { once: true });
  recorder.start();
  micBtn.classList.add('recording');
  setNote('Grabando… soltá para enviar.');
}

async function sendRecording(blob) {
  if (!blob.size) { setNote('No se grabó nada.'); return; }

  setNote('Transcribiendo…');
  micBtn.disabled = true;

  try {
    const data = await toBase64(blob);
    const res = await fetch('/api/ia?mic=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: verifiedKey, data, contentType: blob.type, filename: 'orden.webm' }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    setNote(`"${json.text}" — enviado, generando en IA.`);
  } catch (err) {
    setNote(err.message, true);
  } finally {
    micBtn.disabled = false;
  }
}

function stopRecording() {
  if (!recorder || recorder.state === 'inactive') return;
  micBtn.classList.remove('recording');

  const r = recorder;
  recorder = null;

  r.addEventListener('stop', () => {
    sendRecording(new Blob(chunks, { type: r.mimeType || 'audio/webm' }));
  }, { once: true });
  r.stop();
}

// mantener presionado = grabar; soltar (o que el dedo/mouse se vaya del
// botón) = mandar. Pointer events cubre touch y mouse por igual.
micBtn.addEventListener('pointerdown', (e) => { e.preventDefault(); startRecording(); });
micBtn.addEventListener('pointerup', stopRecording);
micBtn.addEventListener('pointerleave', stopRecording);
micBtn.addEventListener('pointercancel', stopRecording);
micBtn.addEventListener('contextmenu', (e) => e.preventDefault());   // nada de menú por mantener presionado

/** Borrar = lo mismo que el shake en IA: descarta la app vigente en
 *  todos los dispositivos que la tengan abierta. */
clearBtn.addEventListener('click', async () => {
  clearBtn.disabled = true;
  const prevNote = note.textContent;
  try {
    const res = await fetch('/api/ia', { cache: 'no-store' });
    const data = await res.json();
    if (!data?.app?.id) {
      setNote('No hay ninguna app para borrar.');
      return;
    }
    await fetch('/api/ia?dismiss=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: data.app.id }),
    });
    setNote('Listo, se borró.');
  } catch (err) {
    setNote(`No se pudo borrar: ${err.message}`, true);
  } finally {
    clearBtn.disabled = false;
    setTimeout(() => { if (note.textContent !== prevNote) setNote('Mantené presionado para grabar'); }, 2200);
  }
});
