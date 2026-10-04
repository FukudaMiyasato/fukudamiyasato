/* ============================================================
   socials.js — redes de la página Yo (solo íconos)
   ------------------------------------------------------------
   Las claves coinciden con api/_lib/site.js → SOCIALS. Las usan
   la página Yo y el panel (selector al editar los links).
   ============================================================ */

const S = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const SOCIALS = [
  { key: 'instagram', label: 'Instagram', icon: S('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="4"/><circle cx="17.3" cy="6.7" r=".6" fill="currentColor"/>') },
  { key: 'linkedin', label: 'LinkedIn', icon: S('<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 10.5v6M8 7.6v.01M11.5 16.5v-6M11.5 13c0-1.6 1-2.6 2.4-2.6s2.1.9 2.1 2.6v3.5"/>') },
  { key: 'github', label: 'GitHub', icon: S('<path d="M9 19c-4 1.3-4-2-5.5-2.5M14.5 21v-3.2a2.8 2.8 0 0 0-.8-2.2c2.7-.3 5.5-1.3 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.3 4.3 0 0 0-.1-3.2s-1-.3-3.4 1.3a11.6 11.6 0 0 0-6 0C6 2.9 5 3.2 5 3.2a4.3 4.3 0 0 0-.1 3.2 4.6 4.6 0 0 0-1.3 3.2c0 4.6 2.8 5.7 5.5 6a2.8 2.8 0 0 0-.8 2.2V21"/>') },
  { key: 'x', label: 'X', icon: S('<path d="M4.5 4.5l15 15M19.5 4.5l-15 15" stroke-width="2"/>') },
  { key: 'behance', label: 'Behance', icon: S('<path d="M3.5 7h5a2.5 2.5 0 0 1 0 5h-5zM3.5 12h5.5a2.75 2.75 0 0 1 0 5.5H3.5zM3.5 7v10.5M14.5 14h6.5a3.3 3.3 0 0 0-6.5-.9 3.4 3.4 0 0 0 5.8 3.2M15 8h5"/>') },
  { key: 'dribbble', label: 'Dribbble', icon: S('<circle cx="12" cy="12" r="8.5"/><path d="M8.6 4.2c3.3 4 5.4 8.9 6.6 15.4M3.6 10.6c5.3.3 10.2-.9 14-4.1M5.8 18c3-3.6 7.7-5.3 14.6-3.9"/>') },
  { key: 'youtube', label: 'YouTube', icon: S('<rect x="2.8" y="5.5" width="18.4" height="13" rx="4"/><path d="M10.2 9.3v5.4l4.6-2.7z" fill="currentColor"/>') },
  { key: 'tiktok', label: 'TikTok', icon: S('<path d="M13.5 3.5v11.2a3.3 3.3 0 1 1-3.3-3.3M13.5 3.5c.4 2.6 2.2 4.4 4.8 4.7"/>') },
  { key: 'email', label: 'Correo', icon: S('<rect x="3" y="5.5" width="18" height="13" rx="2.5"/><path d="M3.8 7l8.2 6 8.2-6"/>') },
  { key: 'web', label: 'Web', icon: S('<circle cx="12" cy="12" r="8.4"/><path d="M3.6 12h16.8M12 3.6c2.1 2.3 3.2 5.3 3.2 8.4s-1.1 6.1-3.2 8.4c-2.1-2.3-3.2-5.3-3.2-8.4S9.9 5.9 12 3.6z"/>') },
];

export const socialOf = (key) => SOCIALS.find((s) => s.key === key) || SOCIALS[SOCIALS.length - 1];
