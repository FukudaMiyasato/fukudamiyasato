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

  // genérico, por si un dashboard no trae ícono conocido
  grid: svg(`<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>`),
};

export const iconFor = (key) => ICONS[key] || ICONS.grid;
