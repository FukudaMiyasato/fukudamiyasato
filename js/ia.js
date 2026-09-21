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

function push(entry) {
  const el = document.createElement('article');
  el.className = 'entry';
  const hora = new Date(entry.at).toLocaleTimeString('es-ES');
  el.innerHTML = `<time>${hora}</time><p></p>`;
  el.querySelector('p').textContent = entry.text;   // textContent: nada de HTML inyectado
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
      if (!first && alerting) alert(latest.text);
      if (first && alerting) alert(`Última transcripción recibida:\n\n${latest.text}`);
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
