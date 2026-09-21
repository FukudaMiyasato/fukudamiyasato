/* ============================================================
   ia.js — escucha /api/ia y saca por consola cada transcripción
   ============================================================ */

const POLL_MS = 2000;

const dot    = document.getElementById('dot');
const status = document.getElementById('status');
const log    = document.getElementById('log');

let lastId = null;
let started = false;      // el primer sondeo no reporta lo que ya estaba
let fails = 0;

function setState(cls, txt) {
  dot.className = `dot ${cls}`;
  status.textContent = txt;
}

function push(entry) {
  const el = document.createElement('article');
  el.className = 'entry' + (entry.text ? '' : ' sin-texto');

  const hora = new Date(entry.at).toLocaleTimeString('es-ES');
  const grabado = entry.recordedAt
    ? new Date(entry.recordedAt).toLocaleString('es-ES')
    : null;

  const meta = [hora, entry.client, grabado && `grabado ${grabado}`]
    .filter(Boolean).join(' · ');

  el.innerHTML = `
    <time></time>
    <p class="texto"></p>
    <details class="meta"><summary>payload</summary><pre></pre></details>`;

  el.querySelector('time').textContent = meta;
  // textContent: lo que llegue se ve literal, nunca se ejecuta
  el.querySelector('.texto').textContent =
    entry.text || '(sin campo transcription — mira el payload)';
  el.querySelector('.meta pre').textContent =
    JSON.stringify({ formato: entry.formato, bytes: entry.bytes, campos: entry.fields,
                     archivos: entry.files, raw: entry.raw }, null, 2);

  log.prepend(el);
  document.getElementById('empty')?.remove();
}

async function poll() {
  try {
    const res = await fetch('/api/ia', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const { latest } = await res.json();

    fails = 0;
    setState('on', 'Escuchando /api/ia');

    if (latest && latest.id !== lastId) {
      lastId = latest.id;
      push(latest);
      if (started && latest.text) console.log(latest.text);
    }
    started = true;
  } catch (err) {
    fails++;
    started = true;
    setState('off', fails > 2 ? `Sin conexión con /api/ia (${err.message})` : 'Reintentando…');
  }
}

setState('wait', 'Conectando…');
poll();
setInterval(poll, POLL_MS);
