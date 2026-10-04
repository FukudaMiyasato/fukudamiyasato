/* ============================================================
   yo.js — página Yo: título, texto y redes (solo íconos)
   ------------------------------------------------------------
   Todo se edita en el panel → YO (/api/site?t=me). Si nunca se
   guardó, se usan los de js/site-defaults.js. El título "Nombre —
   rol" se parte en dos líneas. De fondo, el mismo tramado de la
   portada sobre una nube de color, más oscuro.
   ============================================================ */

import { createDither } from './dither.js';
import { DEFAULT_ME, splitTitle } from './site-defaults.js';
import { socialOf } from './socials.js';

const $ = (id) => document.getElementById(id);

const dither = createDither($('stage'), { cell: 11, strength: 0.9, dim: 0.45 });
if (!dither) $('stage').hidden = true;

function render(me) {
  const { name, role } = splitTitle(me.title);
  const h = $('me-title');
  h.innerHTML = '<span class="name"></span><span class="role"></span>';
  h.querySelector('.name').textContent = name;
  h.querySelector('.role').textContent = role;
  if (!role) h.querySelector('.role').remove();
  $('me-text').textContent = me.text || '';
  document.title = `${name || 'Yo'} — FUKU`;

  $('me-links').replaceChildren(...(me.links || []).map((l) => {
    const s = socialOf(l.platform);
    const a = document.createElement('a');
    a.href = l.url;
    a.title = s.label;
    a.setAttribute('aria-label', s.label);
    a.innerHTML = s.icon;
    if (/^https?:/i.test(l.url)) { a.target = '_blank'; a.rel = 'noopener noreferrer'; }
    return a;
  }));
}

let me = DEFAULT_ME;
try {
  const r = await fetch('/api/site?t=me', { cache: 'no-store' });
  const d = r.ok ? await r.json() : null;
  if (d?.me) me = { ...DEFAULT_ME, ...d.me };
} catch { /* sin API: los de por defecto */ }
render(me);
