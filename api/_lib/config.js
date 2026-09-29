/* ============================================================
   api/_lib/config.js — configuración global de los dashboards
   ------------------------------------------------------------
   La cambia solo el amo supremo (panel → Configuración) y aplica a
   todos los dashboards. Vive en Redis bajo fm:config.
     fisheye  -20…20  intensidad del ojo de pez (0 = sin efecto,
                      negativo = al revés: el centro se achica)
     aiKey    'yo' | 'lvl'  qué API key de OpenAI se usa primero:
                      yo  = OPENAI_API_KEY · lvl = OPENAI_API_KEY2
                      (si la primera falla por saldo, se prueba la otra)
   ============================================================ */

import { getJSON, setJSON } from './store.js';

const KEY = 'fm:config';
export const DEFAULTS = { fisheye: 7, aiKey: 'yo' };
export const FISHEYE_RANGE = [-20, 20];
export const AI_KEYS = {
  yo: { label: 'YO', env: 'OPENAI_API_KEY' },
  lvl: { label: 'LVL', env: 'OPENAI_API_KEY2' },
};

/** Qué keys están cargadas en Vercel (sin revelar su valor). */
export const aiKeysStatus = () =>
  Object.fromEntries(Object.entries(AI_KEYS).map(([k, v]) => [k, Boolean(String(process.env[v.env] || '').trim())]));

export async function getConfig() {
  return { ...DEFAULTS, ...(await getJSON(KEY, {})) };
}

export async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await setJSON(KEY, next);
  return next;
}
