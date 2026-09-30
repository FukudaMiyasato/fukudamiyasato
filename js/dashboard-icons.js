/* ============================================================
   dashboard-icons.js — íconos de los dashboards (trazo, 24x24)
   La clave es el campo `icon` de api/_lib/dashboards.js.
   ============================================================ */

const svg = (inner) =>
  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const ICONS = {
  // saxofón: boquilla, tudel, cuerpo, curva y campana
  sax: svg(`
    <path d="M8.9 7l-.8 8.6c-.1 3.5 2.2 5.6 5 5.6 3 0 5.1-2.2 5.4-5.2l.7-5 2.4-2.6h-7l1.7 2.4-.5 4.9c-.2 1.6-1.2 2.7-2.7 2.7s-2.3-1.2-2.2-2.7L10.9 7z"/>
    <path d="M9.9 7c0-2.2-1.9-3.4-4.5-3.2L2.8 3.4"/>
    <circle cx="9.7" cy="10.2" r=".55" fill="currentColor" stroke="none"/>
    <circle cx="9.5" cy="12.6" r=".55" fill="currentColor" stroke="none"/>
    <circle cx="9.3" cy="15" r=".55" fill="currentColor" stroke="none"/>`),

  chart: svg(`<path d="M4 20h16"/><path d="M7 16v-5"/><path d="M12 16V7"/><path d="M17 16v-8"/>`),
  music: svg(`<path d="M9 18V6l11-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>`),
  folder: svg(`<path d="M3.5 7.5a2 2 0 0 1 2-2h4l2 2.5h7a2 2 0 0 1 2 2v7.5a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>`),
  star: svg(`<path d="M12 3.8l2.5 5.1 5.6.8-4 4 1 5.5-5.1-2.7-5.1 2.7 1-5.5-4-4 5.6-.8z"/>`),
  briefcase: svg(`<rect x="2.5" y="7" width="19" height="13" rx="2.5"/><path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7"/><path d="M2.5 12.5h19"/>`),
  globe: svg(`<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z"/>`),
  heart: svg(`<path d="M12 20s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.2a4.3 4.3 0 0 1 7.5 2.6C19.5 15.4 12 20 12 20z"/>`),
  cart: svg(`<path d="M3 4h2.2l2.2 11h10.4l2-7.5H6.4"/><circle cx="9" cy="19" r="1.4"/><circle cx="17" cy="19" r="1.4"/>`),
  users: svg(`<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c0-3.2 2.7-5.3 6-5.3s6 2.1 6 5.3"/><path d="M15.5 5.6a3.2 3.2 0 0 1 0 6"/><path d="M17.5 14.5c2 .6 3.5 2.3 3.5 5"/>`),

  // genérico, por si un dashboard no trae ícono conocido
  grid: svg(`<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>`),
};

export const iconFor = (key) => ICONS[key] || ICONS.grid;

const escHTML = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Iniciales del título: "Ventas 2026" → "V2", "jazz" → "JA". */
export function initials(name) {
  const words = String(name || '').trim().split(/[\s\-_]+/).filter(Boolean);
  const s = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
  return s.toUpperCase();
}

/** Ícono de un dashboard: el subido, uno del set (los fijos) o, por defecto, sus iniciales. */
export function dashIconHTML(d) {
  if (d.image) return `<img src="${escHTML(d.image)}" alt="">`;
  if (d.icon && ICONS[d.icon]) return ICONS[d.icon];
  return `<span class="mono" aria-hidden="true">${escHTML(initials(d.name))}</span>`;
}

/* ---------- herramientas del dock (admin) ---------- */

export const TOOL_ICONS = {
  // línea de tiempo: dos hitos unidos por una barra
  timeline: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="5" y="10.9" width="14" height="2.2" rx="1.1" fill="currentColor"/>
    <circle cx="5" cy="12" r="3.3" fill="currentColor"/><circle cx="19" cy="12" r="3.3" fill="currentColor"/>
  </svg>`,

  // pregúntale a la IA: estrella roja de cuatro puntas
  ask: `<svg viewBox="0 0 24 24" aria-hidden="true">
    <path d="M12 3.2c.75 4.7 3.3 7.3 8.3 8.8-5 1.5-7.55 4.1-8.3 8.8-.75-4.7-3.3-7.3-8.3-8.8 5-1.5 7.55-4.1 8.3-8.8z"
      fill="#ff1f3d" stroke="#ff1f3d" stroke-width="1.4" stroke-linejoin="round"/>
  </svg>`,

  // actualizar (el único botón de los chismosos)
  refresh: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M19.5 9.5A8 8 0 0 0 5.2 7.2"/><path d="M19.8 4.5v5h-5"/>
    <path d="M4.5 14.5a8 8 0 0 0 14.3 2.3"/><path d="M4.2 19.5v-5h5"/>
  </svg>`,

  // tabla con IA: rejilla 2x2 + destello rojo arriba a la derecha
  table: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M13.2 5.5H6.2a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-6.8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M11.7 5.5v15M4.2 13h15" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
    <path d="M18.2 1.8c.35 1.9 1.1 2.65 3 3-1.9.35-2.65 1.1-3 3-.35-1.9-1.1-2.65-3-3 1.9-.35 2.65-1.1 3-3z" fill="#ff1f3d" stroke="#ff1f3d" stroke-width="1" stroke-linejoin="round"/>
  </svg>`,
};

/* archivo ya adjunto (en el modal de la IA) */
export const ATTACHED_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><path d="M9 14.5l2 2 4-4.5"/>
</svg>`;
