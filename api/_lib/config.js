/* ============================================================
   api/_lib/config.js — configuración global de los dashboards
   ------------------------------------------------------------
   La cambia solo el amo supremo (panel → Configuración) y aplica a
   todos los dashboards. Vive en Redis bajo fm:config.
     fisheye  -20…20  intensidad del ojo de pez (0 = sin efecto,
                      negativo = al revés: el centro se achica)
   ============================================================ */

import { getJSON, setJSON } from './store.js';

const KEY = 'fm:config';
export const DEFAULTS = { fisheye: 7 };
export const FISHEYE_RANGE = [-20, 20];

export async function getConfig() {
  return { ...DEFAULTS, ...(await getJSON(KEY, {})) };
}

export async function setConfig(patch) {
  const next = { ...(await getConfig()), ...patch };
  await setJSON(KEY, next);
  return next;
}
