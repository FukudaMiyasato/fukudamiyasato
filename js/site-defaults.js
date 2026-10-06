/* ============================================================
   site-defaults.js — lo que se ve cuando algo no está cargado
   ------------------------------------------------------------
   Lo usan la portada (js/home.js), Yo (js/yo.js) y el panel
   (placeholders del editor). Todo lo del portafolio es opcional:
   lo que falte de un proyecto se completa con PROJECT_DEFAULTS.
   ============================================================ */

export const DEFAULT_DURATION = 8; // segundos por proyecto

export const PROJECT_DEFAULTS = {
  category: 'Proyecto',
  title: 'Sin título',
  text: '',
  tags: [],
  link: '',
  date: '',
  media: null, // sin video ni imagen: nube de color con el mismo tramado
};

/* Si todavía no hay ningún proyecto en el panel, la portada muestra este. */
export const DEMO_PROJECTS = [
  {
    id: 'demo-abc',
    media: { type: 'video', url: '/assets/portfolio/abc.mp4', poster: '/assets/portfolio/abc.jpg' },
    category: 'Experiencia interactiva',
    title: 'Ideas que cobran vida',
    text: 'Diseño y tecnología para crear experiencias que conectan a las personas.',
    tags: ['Diseño', 'Prototipado', 'Creative tech'],
    link: '',
    date: '',
  },
];

/* Yo: un título grande y frases que se alternan cada PHRASE_MS. */
export const DEFAULT_ME = {
  title: 'FUKU',
  phrases: ['fullstack user centricity designer', 'indie game developer'],
};
export const PHRASE_MS = 5000;

/** "Nombre — rol" → { name, role } (acepta —, – o -). */
export function splitTitle(title) {
  const m = String(title || '').match(/^(.*?)\s+[—–-]\s+(.*)$/);
  return m ? { name: m[1].trim(), role: m[2].trim() } : { name: String(title || '').trim(), role: '' };
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "2026" → "2026" · "2026-03" → "mar 2026" · "2026-03-14" → "14 mar 2026" */
export function shortDate(iso) {
  const m = String(iso || '').match(/^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?/);
  if (!m) return '';
  const [, y, mo, d] = m;
  return [d ? Number(d) : '', mo ? MONTHS[+mo - 1] : '', y].filter(Boolean).join(' ');
}
