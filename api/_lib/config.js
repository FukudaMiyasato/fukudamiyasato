/* ============================================================
   api/_lib/config.js — configuración global (solo amo supremo)
   ------------------------------------------------------------
   Vive en Redis bajo fm:config y aplica a todos los dashboards.
     fisheye    -20…20  intensidad del ojo de pez (0 = sin efecto,
                        negativo = al revés: el centro se achica)
     surcharge  0…500   % de sobrecargo: lo que el usuario ve y paga es
                        el costo de la herramienta + este porcentaje
     costs      { table, ask, follow, journey, research }  tokens que cuesta cada herramienta
                        de IA (se pueden medir con una llamada real)
     usdPen     S/ por US$ (tipo de cambio)
     usdPerM    US$ por millón de tokens de OpenAI (precio promedio)
                        → con estos dos, S/ asignados se pasan a tokens
     aiApi      'fuku' | 'lvl'  qué API key de OpenAI usa toda la IA
                        (las keys viven en Vercel, nunca en Redis):
                          fuku → OPENAI_API_KEY · lvl → OPENAI_API_KEY_LVL
   ============================================================ */

import { getJSON, setJSON } from './store.js';

const KEY = 'fm:config';

/* Herramientas que gastan tokens (las del lienzo que llaman a OpenAI). */
export const TOOLS = {
  table: { label: 'Tabla con IA', note: 'Tabla, gráfico, cifra o texto, con o sin CSV' },
  ask: { label: 'Pregúntale a la IA', note: 'La estrella: un párrafo como máximo' },
  follow: { label: 'Pregunta desde un conector', note: 'El + de un widget: usa lo conectado como contexto' },
  journey: { label: 'Panel User journey', note: 'Genera el journey de los usuarios conectados' },
  research: { label: 'Researcher', note: 'Investiga en la web y devuelve hallazgos con fuentes' },
  fit: { label: 'Solución en el journey', note: 'Ve en qué etapas impacta una solución y qué podría fallar' },
  api: { label: 'API de preguntas', note: '/api/ask: elige el dashboard y responde con su contenido' },
};

/* API keys de OpenAI que se pueden elegir en Panel → Configuración. */
export const AI_APIS = {
  fuku: { label: 'FUKU', env: 'OPENAI_API_KEY' },
  lvl: { label: 'LVL', env: 'OPENAI_API_KEY_LVL' },
};

export const DEFAULTS = {
  aiApi: 'fuku',
  fisheye: 7,
  surcharge: 10,
  costs: { table: 2500, ask: 900, follow: 1500, journey: 4000, research: 12000, fit: 1800, api: 3000 },
  usdPen: 3.75,
  usdPerM: 5,
};
export const RANGES = {
  fisheye: [-20, 20],
  surcharge: [0, 500],
  cost: [0, 1_000_000],
  usdPen: [0.5, 20],
  usdPerM: [0.01, 200],
};
export const FISHEYE_RANGE = RANGES.fisheye;

const envKey = (api) => String(process.env[AI_APIS[api]?.env] || '').trim();

/** Qué keys están cargadas en Vercel (sin revelarlas). */
export const aiApis = () => Object.fromEntries(Object.entries(AI_APIS)
  .map(([id, a]) => [id, { ...a, loaded: Boolean(envKey(id)) }]));

/* La elección se lee de Redis: se recuerda unos segundos para no
   consultarla en cada llamada a OpenAI. */
let picked = null;
const PICK_TTL_MS = 10_000;

/** La API key de OpenAI elegida en Configuración → { api, label, env, key }. */
export async function openaiKey() {
  if (!picked || Date.now() - picked.at > PICK_TTL_MS) {
    const { aiApi } = await getConfig().catch(() => DEFAULTS);
    picked = { api: AI_APIS[aiApi] ? aiApi : DEFAULTS.aiApi, at: Date.now() };
  }
  const { api } = picked;
  return { api, ...AI_APIS[api], key: envKey(api) };
}

export async function getConfig() {
  const saved = await getJSON(KEY, {});
  return { ...DEFAULTS, ...saved, costs: { ...DEFAULTS.costs, ...(saved.costs || {}) } };
}

export async function setConfig(patch) {
  const cur = await getConfig();
  const next = { ...cur, ...patch, costs: { ...cur.costs, ...(patch.costs || {}) } };
  delete next.aiKey; // campo viejo: la elección ahora es aiApi
  await setJSON(KEY, next);
  picked = null;
  return next;
}

/** Lo que paga el usuario por usar una herramienta: costo + sobrecargo, redondeado hacia arriba. */
export const priceOf = (cfg, tool) => Math.ceil((cfg.costs[tool] || 0) * (1 + (cfg.surcharge || 0) / 100));

/** Precios de todas las herramientas (con sobrecargo). */
export const prices = (cfg) => Object.fromEntries(Object.keys(TOOLS).map((t) => [t, priceOf(cfg, t)]));

/** S/ → tokens con el tipo de cambio y el precio por millón. */
export const solesToTokens = (cfg, soles) => Math.floor((soles / cfg.usdPen / cfg.usdPerM) * 1e6);
