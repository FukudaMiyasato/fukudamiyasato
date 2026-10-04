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

export const DEFAULT_ME = {
  title: 'Jean Carlo Fukuda Miyasato — Fullstack designer centrado en el usuario',
  text: 'Diseño y construyo productos digitales de punta a punta: interfaces, apps y experiencias interactivas. Me muevo entre el diseño y el código para que cada producto se sienta claro, rápido y humano.',
  links: [{ platform: 'email', url: 'mailto:fukudamiyasato@gmail.com' }],
};

/** "Nombre — rol" → { name, role } (acepta —, – o -). */
export function splitTitle(title) {
  const m = String(title || '').match(/^(.*?)\s+[—–-]\s+(.*)$/);
  return m ? { name: m[1].trim(), role: m[2].trim() } : { name: String(title || '').trim(), role: '' };
}

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
/** "2026-03-14" → "mar 2026" */
export function shortDate(iso) {
  const m = String(iso || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${MONTHS[+m[2] - 1] || ''} ${m[1]}`.trim() : '';
}
