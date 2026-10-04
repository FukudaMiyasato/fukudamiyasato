/* ============================================================
   api/_lib/store.js — base de datos del login y los dashboards
   ------------------------------------------------------------
   Redis de Upstash por su API REST (sin paquetes). Se crea desde
   Vercel → Storage → Upstash for Redis; al conectarlo al proyecto,
   Vercel agrega solo las variables:
     KV_REST_API_URL + KV_REST_API_TOKEN
     (o UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN)

   Cada cosa es un documento JSON bajo una clave:
     fm:perms              [{ id, email, role, dashboards }]
     fm:dashboards         [{ id, name, icon }]
     fm:widgets:<dashId>   [{ id, type, x, y, w, h, data }]
     fm:tokens:<correo>    saldo de tokens (entero) · fm:soles:<correo> S/ asignados, en céntimos
   ============================================================ */

import crypto from 'node:crypto';

const URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export const hasStore = () => Boolean(URL && TOKEN);

async function redis(...command) {
  if (!hasStore()) {
    throw new Error('Falta la base de datos: conecta "Upstash for Redis" en Vercel → Storage y vuelve a desplegar.');
  }
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(command),
  });
  const json = await r.json().catch(() => ({}));
  if (!r.ok || json.error) throw new Error(`Redis: ${json.error || r.status}`);
  return json.result;
}

/** Sin base conectada, leer devuelve el valor por defecto: así el admin
    igual puede entrar; lo que falla (con un mensaje claro) es guardar. */
export async function getJSON(key, fallback) {
  if (!hasStore()) return fallback;
  const raw = await redis('GET', key);
  if (raw == null) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

export const setJSON = (key, value) => redis('SET', key, JSON.stringify(value));
export const del = (key) => redis('DEL', key);

/** Suma (o resta, con n negativo) a un contador entero y devuelve el nuevo valor.
    Es atómico en Redis: dos usos a la vez no pisan el saldo. */
export const incrBy = async (key, n) => Number(await redis('INCRBY', key, Math.round(n)));

/** Contador entero (0 si no existe o no hay base). */
export async function getNum(key) {
  if (!hasStore()) return 0;
  return Number(await redis('GET', key)) || 0;
}

/** id corto y aleatorio para permisos y widgets */
export const newId = () => crypto.randomBytes(8).toString('hex');
