/* ============================================================
   ia.js — escucha /api/ia y avisa cuando llega una transcripción
   ============================================================ */

const POLL_MS = 2000;

const dot     = document.getElementById('dot');
const status  = document.getElementById('status');
const log     = document.getElementById('log');
const muteBtn = document.getElementById('mute');

let lastId = null;
let started = false;      // el primer sondeo no alerta lo que ya estaba
let alerting = true;
let fails = 0;

muteBtn.addEventListener('click', () => {
  alerting = !alerting;
  muteBtn.textContent = alerting ? 'Alert activado' : 'Alert silenciado';
  muteBtn.classList.toggle('off', !alerting);
});

function setState(cls, txt) {
  dot.className = `dot ${cls}`;
  status.textContent = txt;
}

/** Lo que mostramos: el JSON formateado si lo era, si no el crudo. */
const bodyOf = (e) => e.pretty ?? e.raw ?? '(cuerpo vacío)';

function push(entry) {
  const el = document.createElement('article');
  el.className = 'entry';
  const hora = new Date(entry.at).toLocaleTimeString('es-ES');

  el.innerHTML = `
    <time></time>
    <pre class="payload"></pre>
    <details class="meta"><summary>headers</summary><pre></pre></details>`;

  el.querySelector('time').textContent =
    `${hora} · ${entry.contentType || 'sin content-type'} · ${entry.bytes ?? 0} bytes`;
  // textContent en todo: el payload se ve literal, nunca se ejecuta
  el.querySelector('.payload').textContent = bodyOf(entry);
  el.querySelector('.meta pre').textContent = JSON.stringify(entry.headers ?? {}, null, 2);

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
      const first = !started;
      lastId = latest.id;
      push(latest);
      if (alerting) {
        const cuerpo = bodyOf(latest);
        const cabecera = first ? 'Último payload recibido' : 'Payload recibido';
        alert(`${cabecera}\n${latest.contentType || 'sin content-type'} · ${latest.bytes ?? 0} bytes\n\n` +
              (cuerpo.length > 2000 ? `${cuerpo.slice(0, 2000)}\n\n… (cortado, el resto está en la página)` : cuerpo));
      }
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
