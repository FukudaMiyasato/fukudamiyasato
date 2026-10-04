/* ============================================================
   /api/upload — subir videos e imágenes del portafolio a Vercel Blob
   ------------------------------------------------------------
   El archivo va directo del navegador a Vercel Blob (así no hay límite
   de 4,5 MB de las funciones); aquí solo se firma el permiso, y solo
   para el amo supremo. Necesita BLOB_READ_WRITE_TOKEN, que Vercel agrega
   solo al crear un Blob store: Storage → Create → Blob → conectar.
   ============================================================ */

import { handleUpload } from '@vercel/blob/client';
import { currentUser } from './_lib/auth.js';

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB
const TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return res.status(503).json({ error: 'Falta Vercel Blob: créalo en Vercel → Storage → Blob, conéctalo al proyecto y vuelve a desplegar. Mientras, pega un link al video o imagen.' });
  }

  try {
    // pedir el permiso es lo único que necesita sesión; el aviso de "terminó" lo manda Vercel
    if (req.body?.type === 'blob.generate-client-token') {
      const user = await currentUser(req);
      if (user?.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });
    }
    const json = await handleUpload({
      body: req.body,
      request: req,
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
