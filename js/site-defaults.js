/* ============================================================
   site-defaults.js — valores por defecto de la portada
   ------------------------------------------------------------
   Lo usan la portada (js/home.js) y el panel (js/admin.js).
   ============================================================ */

/* segundos de un proyecto sin videos (o de una imagen) */
export const DEFAULT_DURATION = 8;

export const CONTACT_EMAIL = 'fukuda.miyasato@gmail.com';

/* etiquetas que puede llevar un proyecto (checkbox en el panel) */
export const TAGS = [
  { key: 'real', label: 'Testimonio real', admin: 'Testimonio real' },
  { key: 'ai', label: 'Generado con IA', admin: 'Video generado con IA' },
];

/* Si todavía no hay ningún proyecto en el panel, la portada muestra este. */
export const DEMO_PROJECTS = [
  {
    id: 'demo-abc',
    name: 'ABC',
    year: '2026',
    did: 'Diseño y tecnología para crear experiencias que conectan a las personas.',
    tags: [],
    videos: [{ type: 'video', url: '/assets/portfolio/abc.mp4' }],
  },
];
