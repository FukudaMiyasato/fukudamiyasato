/* ============================================================
   /api/upload — subir los videos del portafolio a Vercel Blob
   ------------------------------------------------------------
   El archivo va directo del navegador a Vercel Blob (así no hay límite
   de 4,5 MB de las funciones); aquí solo se firma el permiso, y solo
   para el amo supremo.
     GET  → { configured, mode, deploy, seen }
            mode: 'oidc' | 'token' — cómo se autentica (el navegador usa
            uploadPresigned o upload según esto); deploy = entorno del
            despliegue; seen = NOMBRES de variables de Blob (diagnóstico;
            solo amo supremo, nunca devuelve valores)
     POST → firma la subida (lo llama el navegador)

   Dos formas de autenticarse con Blob, según cómo se conectó el store:
     oidc  — la de los stores nuevos: BLOB_STORE_ID + una credencial OIDC
             que Vercel renueva sola (sin token fijo). Se firma con
             handleUploadPresigned + issueSignedToken.
     token — la clásica: BLOB_READ_WRITE_TOKEN (o un prefijo propio, p. ej.
             FUKU_READ_WRITE_TOKEN). Se firma con handleUpload.
   Si están las dos, se usa la del token fijo. Recuerda: las variables solo
   llegan a los despliegues NUEVOS. El store debe ser Public (los videos se
   reproducen con su link directo).
   ============================================================ */

import { issueSignedToken } from '@vercel/blob';
import { handleUpload, handleUploadPresigned } from '@vercel/blob/client';
import { currentUser } from './_lib/auth.js';

const MAX_BYTES = 200 * 1024 * 1024; // 200 MB
const TYPES = ['video/mp4', 'video/webm', 'video/quicktime', 'image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** { name, token } del token fijo de Blob, o null. */
function staticToken() {
  const direct = String(process.env.BLOB_READ_WRITE_TOKEN || '').trim();
  if (direct) return { name: 'BLOB_READ_WRITE_TOKEN', token: direct };
  for (const [name, value] of Object.entries(process.env)) {
    if (/READ_WRITE_TOKEN$/.test(name) && /^vercel_blob_rw_/.test(String(value || ''))) return { name, token: value };
  }
  return null;
}

/** id del store para OIDC (BLOB_STORE_ID, o con prefijo propio: *_STORE_ID que empiece con store_). */
function storeId() {
  const direct = String(process.env.BLOB_STORE_ID || '').trim();
  if (direct) return direct;
  for (const [name, value] of Object.entries(process.env)) {
    if (/_STORE_ID$/.test(name) && /^store_/.test(String(value || ''))) return value;
  }
  return '';
}

/** Credencial OIDC de esta invocación, si viene en el header. Si no, @vercel/blob
    la busca sola (@vercel/oidc: contexto de la request o VERCEL_OIDC_TOKEN). */
const oidcOf = (req) => String(req.headers?.['x-vercel-oidc-token'] || '').trim() || undefined;

function modeOf() {
  if (staticToken()) return 'token';
  if (storeId()) return 'oidc';
  return null;
}

const MISSING = 'Este despliegue no tiene Vercel Blob: en Vercel → Storage → tu Blob store → Connect Project, marca Production y vuelve a desplegar. Mientras, pega un link al video.';

async function requireSupremo(req) {
  const user = await currentUser(req);
  if (user?.role !== 'supremo') throw Object.assign(new Error('Solo el amo supremo.'), { status: 403 });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const mode = modeOf();

  if (req.method === 'GET') {
    const user = await currentUser(req);
    if (user?.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });
    const seen = Object.keys(process.env).filter((k) => /BLOB|READ_WRITE_TOKEN|STORE_ID|OIDC/i.test(k)).sort();
    return res.status(200).json({
      configured: Boolean(mode),
      mode,
      env: mode === 'token' ? staticToken().name : mode === 'oidc' ? 'BLOB_STORE_ID + OIDC' : null,
      deploy: process.env.VERCEL_ENV || 'local',
      seen,
      oidcHeader: Boolean(req.headers?.['x-vercel-oidc-token']),
    });
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }
  if (!mode) return res.status(503).json({ error: MISSING });

  try {
    if (mode === 'token') {
      // pedir el permiso es lo único que necesita sesión; el aviso de "terminó" lo manda Vercel
      if (req.body?.type === 'blob.generate-client-token') await requireSupremo(req);
      const json = await handleUpload({
        body: req.body,
        request: req,
        token: staticToken().token,
        onBeforeGenerateToken: async () => ({
          allowedContentTypes: TYPES,
          maximumSizeInBytes: MAX_BYTES,
          addRandomSuffix: true,
        }),
      });
      return res.status(200).json(json);
    }

    // OIDC: URL de subida prefirmada, válida por 30 min y solo para ese archivo
    const json = await handleUploadPresigned({
      body: req.body,
      request: req,
      getSignedToken: async (pathname) => {
        await requireSupremo(req);
        const token = await issueSignedToken({
          pathname,
          operations: ['put'],
          allowedContentTypes: TYPES,
          maximumSizeInBytes: MAX_BYTES,
          validUntil: Date.now() + 60 * 60 * 1000,
          storeId: storeId(),
          oidcToken: oidcOf(req),
        });
        return {
          token,
          urlOptions: {
            allowedContentTypes: TYPES,
            maximumSizeInBytes: MAX_BYTES,
            addRandomSuffix: true,
            validUntil: Date.now() + 30 * 60 * 1000,
          },
        };
      },
    });
    return res.status(200).json(json);
  } catch (err) {
    if (err.status === 403) return res.status(403).json({ error: err.message });
    console.error('[api/upload]', err);
    return res.status(400).json({ error: err.message });
  }
}
