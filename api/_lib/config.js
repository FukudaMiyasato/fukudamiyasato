/* ============================================================
   api/_lib/config.js — configuración global (solo amo supremo)
   ------------------------------------------------------------
   Vive en Redis bajo fm:config y aplica a todos los dashboards.
     fisheye    -20…20  intensidad del ojo de pez (0 = sin efecto,
                        negativo = al revés: el centro se achica)
     surcharge  0…500   % de sobrecargo: lo que el usuario ve y paga es
                        el costo de la herramienta + este porcentaje
     costs      { table, ask, follow }  tokens que cuesta cada herramienta
                        de IA (se pueden medir con una llamada real)
     usdPen     S/ por US$ (tipo de cambio)
     usdPerM    US$ por millón de tokens de OpenAI (precio promedio)
                        → con estos dos, S/ asignados se pasan a tokens
   La IA usa siempre OPENAI_API_KEY.
   ============================================================ */

import { getJSON, setJSON } from './store.js';

const KEY = 'fm:config';

/* Herramientas que gastan tokens (las del lienzo que llaman a OpenAI). */
export const TOOLS = {
  table: { label: 'Tabla con IA', note: 'Tabla, gráfico, cifra o texto, con o sin CSV' },
  ask: { label: 'Pregúntale a la IA', note: 'La estrella: un párrafo como máximo' },
  follow: { label: 'Pregunta desde un conector', note: 'El + de un widget: usa lo conectado como contexto' },
};

export const DEFAULTS = {
  fisheye: 7,
  surcharge: 10,
  costs: { table: 2500, ask: 900, follow: 1500 },
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

export const hasAiKey = () => Boolean(String(process.env.OPENAI_API_KEY || '').trim());

export async function getConfig() {
  const saved = await getJSON(KEY, {});
  return { ...DEFAULTS, ...saved, costs: { ...DEFAULTS.costs, ...(saved.costs || {}) } };
}

export async function setConfig(patch) {
  const cur = await getConfig();
  const next = { ...cur, ...patch, costs: { ...cur.costs, ...(patch.costs || {}) } };
  delete next.aiKey; // ya no hay segunda API key
  await setJSON(KEY, next);
  return next;
}

/** Lo que paga el usuario por usar una herramienta: costo + sobrecargo, redondeado hacia arriba. */
export const priceOf = (cfg, tool) => Math.ceil((cfg.costs[tool] || 0) * (1 + (cfg.surcharge || 0) / 100));

/** Precios de todas las herramientas (con sobrecargo). */
export const prices = (cfg) => Object.fromEntries(Object.keys(TOOLS).map((t) => [t, priceOf(cfg, t)]));

/** S/ → tokens con el tipo de cambio y el precio por millón. */
export const solesToTokens = (cfg, soles) => Math.floor((soles / cfg.usdPen / cfg.usdPerM) * 1e6);
