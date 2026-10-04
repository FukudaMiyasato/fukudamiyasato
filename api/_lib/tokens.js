/* ============================================================
   api/_lib/tokens.js — saldo de tokens de cada usuario
   ------------------------------------------------------------
   El amo supremo asigna soles en Panel → Permisos; se pasan a tokens
   (api/_lib/config.js → solesToTokens) y se suman al saldo. Cada vez
   que alguien usa una herramienta de IA del lienzo se descuenta su
   precio (costo + sobrecargo). Sin saldo suficiente, no se llama a
   OpenAI. El amo supremo no tiene límite: la API es suya.

   Por correo, en Redis (contadores atómicos):
     fm:tokens:<correo>   tokens que le quedan
     fm:soles:<correo>    S/ asignados en total, en céntimos
   ============================================================ */

import { incrBy, getNum, del } from './store.js';
import { normEmail } from './auth.js';

const tokensKey = (email) => `fm:tokens:${normEmail(email)}`;
const solesKey = (email) => `fm:soles:${normEmail(email)}`;

export const unlimited = (user) => user?.role === 'supremo';

export const balanceOf = (email) => getNum(tokensKey(email));
export const solesOf = async (email) => (await getNum(solesKey(email))) / 100;

/** Suma S/ (negativo = quitar) y sus tokens. El saldo nunca baja de 0. */
export async function assignSoles(email, soles, tokens) {
  await incrBy(solesKey(email), Math.round(soles * 100));
  let bal = await incrBy(tokensKey(email), tokens);
  if (bal < 0) bal = await incrBy(tokensKey(email), -bal);
  return bal;
}

/** Reserva `n` tokens antes de llamar a OpenAI. false (sin tocar nada) si no alcanzan. */
export async function charge(email, n) {
  if (n <= 0) return true;
  const bal = await incrBy(tokensKey(email), -n);
  if (bal < 0) { await incrBy(tokensKey(email), n); return false; }
  return true;
}

/** Devuelve lo reservado (la llamada falló). */
export const refund = (email, n) => (n > 0 ? incrBy(tokensKey(email), n) : null);

/** Al quitar a alguien, se borra su saldo. */
export async function forgetTokens(email) {
  await del(tokensKey(email));
  await del(solesKey(email));
}
