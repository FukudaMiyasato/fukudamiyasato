/* ============================================================
   /api/upload — subir los videos del portafolio a Vercel Blob
   ------------------------------------------------------------
   El archivo va directo del navegador a Vercel Blob (así no hay límite
   de 4,5 MB de las funciones); aquí solo se firma el permiso, y solo
   para el amo supremo.
     GET  → { configured, env }   ¿hay Blob? y en qué variable está el token
            (solo amo supremo; nunca devuelve el token)
     POST → handleUpload de @vercel/blob (lo llama upload() del navegador)

   El token: Vercel lo agrega al conectar un Blob store al proyecto
   (Storage → Blob → Connect). Por defecto se llama BLOB_READ_WRITE_TOKEN;
   si al conectarlo se le puso otro prefijo (p. ej. FUKU_READ_WRITE_TOKEN),
   igual se encuentra: se busca la variable cuyo valor es un token de Blob.
   Recuerda: las variables solo llegan a los despliegues NUEVOS.
   ============================================================ */

import { handleUpload } from '@vercel/blob/client';
import { currentUser } from './_lib/auth.js';

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB
const TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** { name, token } del token de Blob, o null. */
function blobToken() {
  const direct = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  if (direct) return { name: 'BLOB_READ_WRITE_TOKEN', token: direct };
  for (const [name, value] of Object.entries(process.env)) {
    if (/READ_WRITE_TOKEN$/.test(name) && /^vercel_blob_rw_/.test(String(value || ''))) return { name, token: value };
  }
  return null;
}

const MISSING = 'Este despliegue no tiene Vercel Blob: en Vercel → Storage → tu Blob store → Connect Project, marca Production y vuelve a desplegar. Mientras, pega un link al video.';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const blob = blobToken();

  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (user?.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });
    return res.status(200).json({ configured: Boolean(blob), env: blob?.name || null });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  if (!blob) return res.status(503).json({ error: MISSING });

  try {
    // pedir el permiso es lo único que necesita sesión; el aviso de "terminó" lo manda Vercel
    if (req.body?.type === 'blob.generate-client-token') {
      const user = await currentUser(req);
      if (user?.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });
    }
    const json = await handleUpload({
      body: req.body,
      request: req,
      token: blob.token,
      onBeforeGenerateToken: async () => ({
        allowedContentTypes: TYPES,
        maximumSizeInBytes: MAX_BYTES,
        addRandomSuffix: true,
      }),
    });
    return res.status(200).json(json);
  } catch (err) {
    console.error('[api/upload]', err);
    return res.status(400).json({ error: err.message });
  }
}
