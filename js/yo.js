/* ============================================================
   yo.js — perfil; los links salen de la tabla `yo` de Airtable
   ------------------------------------------------------------
   Solo se muestran los links que estén en esa tabla. Cada uno es un
   cuadro de 60x60 con la imagen de la columna `img`; si el registro
   no trae imagen, se usa una por defecto.
   ============================================================ */

import { CONFIG } from './config.js';

const me = CONFIG.me;

document.getElementById('me-name').textContent = me.name;
document.getElementById('me-role').textContent = me.role;
document.getElementById('me-desc').textContent = me.description;
document.getElementById('me-loc').textContent = me.location;

const mail = document.getElementById('me-mail');
mail.textContent = me.email;
mail.href = `mailto:${me.email}`;

/* Imagen por defecto cuando el registro no trae `img`. */
const FALLBACK_IMG = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(`
<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24"
     fill="none" stroke="#7a7a88" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
  <path d="M10 13.5a4 4 0 0 0 5.7.4l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5"/>
  <path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5"/>
</svg>`.trim())}`;

const norm = (s) => String(s ?? '').trim().toLowerCase();

function pickField(fields, aliases) {
  const keys = Object.keys(fields);
  for (const a of aliases) {
    const hit = keys.find((k) => norm(k) === a);
    if (hit !== undefined) return fields[hit];
  }
  for (const a of aliases) {
    const hit = keys.find((k) => norm(k).includes(a));
    if (hit !== undefined) return fields[hit];
  }
  return undefined;
}

function truthy(v) {
  if (v === true) return true;
  if (typeof v === 'number') return v > 0;
  return ['visible', 'true', 'yes', 'si', 'sí', '1', 'ok', 'activo', 'active'].includes(norm(v));
}

const text = (v) => {
  if (v == null) return '';
  if (Array.isArray(v)) return String(v[0]?.name ?? v[0] ?? '').trim();
  if (typeof v === 'object') return String(v.name ?? '').trim();
  return String(v).trim();
};

/** Attachment de Airtable (el PNG que subes), o una url suelta. */
function toImage(v) {
  if (!v) return '';
  if (Array.isArray(v)) {
    const a = v[0];
    if (!a) return '';
    if (typeof a === 'string') return a;
    return a?.thumbnails?.large?.url || a?.url || '';
  }
  if (typeof v === 'object') return v.url || '';
  const s = String(v).trim();
  return /^https?:\/\/|^data:/.test(s) ? s : '';
}

function labelFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    return host.charAt(0).toUpperCase() + host.slice(1);
  } catch { return 'Link'; }
}

async function loadLinks() {
  const res = await fetch(CONFIG.meApi, { cache: 'no-store' });
  if (!res.ok) throw new Error(`api ${res.status}`);
  const { records = [] } = await res.json();

  const rows = records.map((r) => {
    const f = r.fields || {};
    return {
      url: text(pickField(f, ['url', 'link', 'enlace', 'vinculo', 'vínculo'])),
      img: toImage(pickField(f, ['img', 'image', 'imagen', 'icon', 'icono', 'ícono', 'logo', 'foto'])),
      name: text(pickField(f, ['name', 'nombre', 'label', 'red', 'titulo', 'título'])),
      visibleRaw: pickField(f, ['visible', 'activo', 'active', 'publicado']),
    };
  }).filter((l) => /^https?:\/\/|^mailto:/.test(l.url));

  /* Si la columna `visible` todavía no existe en la tabla, no filtramos. */
  const hasVisible = rows.some((l) => l.visibleRaw !== undefined);
  return hasVisible ? rows.filter((l) => truthy(l.visibleRaw)) : rows;
}

function render(links) {
  const nav = document.getElementById('socials');
  nav.innerHTML = links.map((l) => {
    const alt = l.name || labelFromUrl(l.url);
    return `
    <a class="social" href="${l.url}" aria-label="${alt}" title="${alt}"
       ${l.url.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}>
      <img src="${l.img || FALLBACK_IMG}" alt="${alt}" loading="lazy"
           onerror="this.onerror=null;this.src='${FALLBACK_IMG}'">
    </a>`;
  }).join('');
}

try {
  render(await loadLinks());
} catch (err) {
  console.info(`[yo] no se pudieron leer los links de Airtable (${err.message})`);
  render([]);          // solo salen los de Airtable: si no hay, no hay nada
}

/* ============================================================
   Permiso de movimiento — para que el shake funcione en IA
   ------------------------------------------------------------
   En iOS, DeviceMotionEvent.requestPermission() solo se puede pedir
   dentro de un gesto del usuario. En la página de IA la app llega
   sola (disparada por voz), así que casi nunca hay un gesto propio
   ahí para pedirlo a tiempo. Este botón resuelve eso de antemano:
   una vez concedido, el permiso queda para todo el sitio (mismo
   origen), así que al llegar a IA el shake ya funciona.
   ============================================================ */
const perm     = document.getElementById('perm');
const permBtn  = document.getElementById('perm-btn');
const permNote = document.getElementById('perm-note');

const needsMotionPermission = typeof DeviceMotionEvent !== 'undefined'
  && typeof DeviceMotionEvent.requestPermission === 'function';

if (needsMotionPermission) {
  perm.hidden = false;

  permBtn.addEventListener('click', async () => {
    permBtn.disabled = true;
    permNote.className = 'perm-note';
    permNote.textContent = '';
    try {
      const state = await DeviceMotionEvent.requestPermission();
      if (state === 'granted') {
        permNote.textContent = 'Listo. Ya puedes agitar el celular en IA para cerrar una app.';
        permNote.classList.add('ok');
      } else {
        permNote.textContent = 'No diste el permiso. Actívalo en Ajustes → Safari → Movimiento y orientación.';
        permNote.classList.add('err');
      }
    } catch (err) {
      permNote.textContent = `No se pudo pedir el permiso: ${err.message}`;
      permNote.classList.add('err');
    } finally {
      permBtn.disabled = false;
    }
  });
}
// en Android y en navegadores de escritorio no hace falta pedir nada:
// el botón se queda oculto y el shake ya está listo por su cuenta.
