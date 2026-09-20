/* ============================================================
   yo.js — perfil; los links salen de la tabla `yo` de Airtable
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

const BRAND = {
  github:    '<svg viewBox="0 0 24 24"><path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.8 0-.8 0-.8 1.2.1 1.9 1.3 1.9 1.3 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C16.9 4.7 18 5 18 5c.6 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5z"/></svg>',
  linkedin:  '<svg viewBox="0 0 24 24"><path d="M4.98 3.5A2.5 2.5 0 1 1 0 3.5a2.5 2.5 0 0 1 4.98 0zM.2 8.4h4.6V24H.2zM8.3 8.4h4.4v2.1h.1c.6-1.1 2.1-2.3 4.3-2.3 4.6 0 5.4 3 5.4 6.9V24h-4.6v-7.9c0-1.9 0-4.3-2.6-4.3s-3 2-3 4.2V24H8.3z"/></svg>',
  instagram: '<svg viewBox="0 0 24 24"><path d="M12 2.2c3.2 0 3.6 0 4.9.1 1.2.1 1.8.2 2.2.4.6.2 1 .5 1.4.9.4.4.7.8.9 1.4.2.4.4 1 .4 2.2.1 1.3.1 1.7.1 4.9s0 3.6-.1 4.9c-.1 1.2-.2 1.8-.4 2.2-.2.6-.5 1-.9 1.4-.4.4-.8.7-1.4.9-.4.2-1 .4-2.2.4-1.3.1-1.7.1-4.9.1s-3.6 0-4.9-.1c-1.2-.1-1.8-.2-2.2-.4-.6-.2-1-.5-1.4-.9-.4-.4-.7-.8-.9-1.4-.2-.4-.4-1-.4-2.2C2.2 15.6 2.2 15.2 2.2 12s0-3.6.1-4.9c.1-1.2.2-1.8.4-2.2.2-.6.5-1 .9-1.4.4-.4.8-.7 1.4-.9.4-.2 1-.4 2.2-.4C8.4 2.2 8.8 2.2 12 2.2zm0 3.1A6.7 6.7 0 1 0 18.7 12 6.7 6.7 0 0 0 12 5.3zm0 11A4.3 4.3 0 1 1 16.3 12 4.3 4.3 0 0 1 12 16.3zM19.1 5a1.6 1.6 0 1 1-1.6-1.6A1.6 1.6 0 0 1 19.1 5z"/></svg>',
  x:         '<svg viewBox="0 0 24 24"><path d="M17.5 3h3.3l-7.2 8.3L22 21h-6.6l-5.2-6.7L4.3 21H1l7.7-8.8L1.6 3h6.8l4.7 6.2zm-1.2 16h1.8L7.8 4.8H5.9z"/></svg>',
  behance:   '<svg viewBox="0 0 24 24"><path d="M7.4 5.5c1.2 0 2.1.3 2.7.8.6.5.9 1.3.9 2.3 0 .6-.1 1.1-.4 1.5-.3.4-.7.7-1.2.9.7.2 1.2.6 1.6 1.1.3.5.5 1.1.5 1.9 0 .6-.1 1.1-.3 1.6-.2.4-.5.8-.9 1.1-.4.3-.9.5-1.4.7-.5.1-1.1.2-1.7.2H0V5.5zM7 10.3c.5 0 .9-.1 1.2-.4.3-.2.5-.6.5-1.2 0-.3 0-.6-.2-.8-.1-.2-.3-.3-.4-.4-.2-.1-.4-.2-.6-.2H2.9v3zm.2 5.1c.3 0 .6 0 .8-.1.2-.1.5-.2.6-.3.2-.1.3-.3.4-.6.1-.2.2-.5.2-.9 0-.7-.2-1.2-.6-1.5-.4-.3-.9-.4-1.5-.4H2.9v3.8zM16.4 15.4c.4.4 1 .6 1.7.6.5 0 1-.1 1.4-.4.4-.3.6-.6.7-.9h2.2c-.4 1.1-.9 1.9-1.6 2.3-.7.5-1.6.7-2.7.7-.7 0-1.4-.1-2-.4-.6-.2-1.1-.6-1.5-1-.4-.4-.7-1-.9-1.6-.2-.6-.3-1.3-.3-2s.1-1.4.4-2c.2-.6.6-1.1 1-1.6.4-.4.9-.8 1.5-1 .6-.2 1.2-.4 1.9-.4.8 0 1.5.2 2.1.5.6.3 1.1.7 1.4 1.2.4.5.6 1.1.8 1.7.2.6.2 1.3.2 2h-6.8c0 .8.3 1.5.7 1.9zm2.9-5.2c-.3-.4-.8-.6-1.5-.6-.4 0-.8.1-1.1.2-.3.2-.5.3-.7.5-.2.2-.3.5-.3.7-.1.2-.1.5-.1.6h4.2c-.1-.6-.3-1.1-.5-1.4zM15 6.4h5.3v1.3H15z"/></svg>',
  youtube:   '<svg viewBox="0 0 24 24"><path d="M23.5 6.5a3 3 0 0 0-2.1-2.1C19.5 3.9 12 3.9 12 3.9s-7.5 0-9.4.5A3 3 0 0 0 .5 6.5C0 8.4 0 12 0 12s0 3.6.5 5.5a3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1C24 15.6 24 12 24 12s0-3.6-.5-5.5zM9.5 15.6V8.4l6.3 3.6z"/></svg>',
  dribbble:  '<svg viewBox="0 0 24 24"><path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.6 0 12 0zm7.9 5.5a10.2 10.2 0 0 1 2.3 6.4c-.3-.1-3.6-.7-6.9-.3l-.5-1.2c3.4-1.4 4.8-3.4 5.1-4.9zM12 1.8c2.6 0 5 1 6.7 2.6-.2.4-1.5 2.3-4.8 3.5A50 50 0 0 0 10.3 2c.6-.1 1.1-.2 1.7-.2zM8.3 2.7a58 58 0 0 1 3.6 5.7c-4.5 1.2-8.5 1.2-8.9 1.2A10.3 10.3 0 0 1 8.3 2.7zM1.8 12v-.3c.4 0 5.1.1 9.9-1.4l.6 1.1-.4.1c-5 1.6-7.6 6-7.8 6.4A10.1 10.1 0 0 1 1.8 12zm10.2 10.2c-2.3 0-4.5-.8-6.2-2.1.2-.4 2-3.9 7.5-5.8a42 42 0 0 1 2.2 7.6c-1.1.4-2.3.6-3.5.3zm5.2-1.2a44 44 0 0 0-2-7.3c3.1-.5 5.8.3 6.1.4a10.2 10.2 0 0 1-4.1 6.9z"/></svg>',
  web:       '<svg viewBox="0 0 24 24"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm6.9 6h-3a15.7 15.7 0 0 0-1.4-3.6A8 8 0 0 1 18.9 8zM12 4c.8 1.1 1.4 2.5 1.8 4h-3.6c.4-1.5 1-2.9 1.8-4zM4.3 14a8 8 0 0 1 0-4h3.4a17 17 0 0 0 0 4H4.3zm.8 2h3a15.7 15.7 0 0 0 1.4 3.6A8 8 0 0 1 5.1 16zm3-8h-3a8 8 0 0 1 4.4-3.6A15.7 15.7 0 0 0 8.1 8zM12 20c-.8-1.1-1.4-2.5-1.8-4h3.6c-.4 1.5-1 2.9-1.8 4zm2.2-6H9.8a15 15 0 0 1 0-4h4.4a15 15 0 0 1 0 4zm.3 5.6a15.7 15.7 0 0 0 1.4-3.6h3a8 8 0 0 1-4.4 3.6zm1.8-5.6a17 17 0 0 0 0-4h3.4a8 8 0 0 1 0 4h-3.4z"/></svg>',
};

/* De qué marca es un link, mirando el dominio. */
function iconFromUrl(url) {
  const host = (() => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } })();
  const map = {
    'github.com': 'github', 'linkedin.com': 'linkedin', 'instagram.com': 'instagram',
    'x.com': 'x', 'twitter.com': 'x', 'behance.net': 'behance',
    'youtube.com': 'youtube', 'youtu.be': 'youtube', 'dribbble.com': 'dribbble',
  };
  return map[host] || map[host.split('.').slice(-2).join('.')] || 'web';
}

function labelFromUrl(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '').split('.')[0];
    return host.charAt(0).toUpperCase() + host.slice(1);
  } catch { return 'Link'; }
}

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

async function loadLinks() {
  const res = await fetch(CONFIG.meApi, { cache: 'no-store' });
  if (!res.ok) throw new Error(`api ${res.status}`);
  const { records = [] } = await res.json();

  const rows = records.map((r) => {
    const f = r.fields || {};
    return {
      url:   text(pickField(f, ['url', 'link', 'enlace', 'vinculo', 'vínculo'])),
      label: text(pickField(f, ['name', 'nombre', 'label', 'red', 'titulo', 'título'])),
      icon:  norm(text(pickField(f, ['icon', 'icono', 'ícono']))),
      visibleRaw: pickField(f, ['visible', 'activo', 'active', 'publicado']),
    };
  }).filter((l) => /^https?:\/\/|^mailto:/.test(l.url));

  /* Si la columna `visible` todavía no existe en la tabla, no filtramos. */
  const hasVisible = rows.some((l) => l.visibleRaw !== undefined);
  const list = hasVisible ? rows.filter((l) => truthy(l.visibleRaw)) : rows;

  if (!list.length) throw new Error('sin links usables');

  return list.map((l) => ({
    url: l.url,
    label: l.label || labelFromUrl(l.url),
    icon: BRAND[l.icon] ? l.icon : iconFromUrl(l.url),
  }));
}

function render(links) {
  document.getElementById('socials').innerHTML = links.map((l) => `
    <a class="social" href="${l.url}"
       ${l.url.startsWith('http') ? 'target="_blank" rel="noopener noreferrer"' : ''}>
      ${BRAND[l.icon] || BRAND.web}<span>${l.label}</span>
    </a>`).join('');
}

try {
  render(await loadLinks());
} catch (err) {
  console.info(`[yo] links desde Airtable no disponibles (${err.message}), uso los de config.js`);
  render(me.links);
}
