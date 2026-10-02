/* ============================================================
   app-platforms.js — plataformas de los links de cada app
   ------------------------------------------------------------
   Las usan la página Apps (íconos-link en cada tarjeta) y el panel
   (selector al editar una app). Las claves coinciden con
   api/_lib/site.js → PLATFORMS.
   ============================================================ */

export const PLATFORMS = [
  {
    key: 'apple',
    label: 'App Store',
    solid: true,
    icon: '<path d="M16.3 12.6c0-2.3 1.9-3.4 2-3.5-1.1-1.6-2.8-1.8-3.4-1.8-1.4-.1-2.8.9-3.5.9-.7 0-1.8-.8-3-.8-1.5 0-3 .9-3.8 2.3-1.6 2.8-.4 7 1.2 9.3.8 1.1 1.7 2.4 2.9 2.3 1.2 0 1.6-.7 3-.7s1.8.7 3 .7c1.3 0 2.1-1.1 2.8-2.3.9-1.3 1.3-2.6 1.3-2.7 0 0-2.5-1-2.5-3.7zM14.1 5.5c.6-.8 1-1.9.9-3-.9 0-2 .6-2.7 1.4-.6.7-1.1 1.8-.9 2.9 1 .1 2-.5 2.7-1.3z"/>',
  },
  {
    key: 'android',
    label: 'Google Play',
    icon: '<path d="M5 10.5h14v6.2a1.8 1.8 0 0 1-1.8 1.8H6.8A1.8 1.8 0 0 1 5 16.7z"/><path d="M5 10.5a7 7 0 0 1 14 0"/><path d="M8 7.2 6.8 5.2"/><path d="m16 7.2 1.2-2"/><path d="M9.3 8.2h.01"/><path d="M14.7 8.2h.01"/><path d="M9 18.5v2.2"/><path d="M15 18.5v2.2"/>',
  },
  {
    key: 'itchio',
    label: 'itch.io',
    icon: '<path d="M7 7h10a4 4 0 0 1 4 4v3.5a3 3 0 0 1-5.4 1.8L14.5 15h-5l-1.1 1.3A3 3 0 0 1 3 14.5V11a4 4 0 0 1 4-4z"/><path d="M8 10v3M6.5 11.5h3"/><path d="M15.5 11h.01M17.5 13h.01"/>',
  },
  {
    key: 'steam',
    label: 'Steam',
    icon: '<rect x="2.6" y="4" width="18.8" height="12.4" rx="2"/><path d="M8.4 20.4h7.2"/><path d="M12 16.4v4"/>',
  },
  {
    key: 'web',
    label: 'Web',
    icon: '<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8"/><path d="M12 3.6c2.1 2.3 3.2 5.3 3.2 8.4s-1.1 6.1-3.2 8.4c-2.1-2.3-3.2-5.3-3.2-8.4S9.9 5.9 12 3.6z"/>',
  },
  {
    key: 'other',
    label: 'Otro',
    icon: '<path d="M10 13.5a4 4 0 0 0 5.7.4l2.6-2.6a4 4 0 0 0-5.7-5.7l-1.5 1.5"/><path d="M14 10.5a4 4 0 0 0-5.7-.4l-2.6 2.6a4 4 0 0 0 5.7 5.7l1.5-1.5"/>',
  },
];

export const platformOf = (key) => PLATFORMS.find((p) => p.key === key) || PLATFORMS[PLATFORMS.length - 1];

/** SVG del ícono (trazo o relleno con currentColor). */
export function platformIcon(key) {
  const p = platformOf(key);
  return p.solid
    ? `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">${p.icon}</svg>`
    : `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${p.icon}</svg>`;
}
