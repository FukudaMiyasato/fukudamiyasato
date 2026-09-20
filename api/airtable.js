/* ============================================================
   /api/airtable?t=<fuente> — proxy a Airtable (Vercel)
   ------------------------------------------------------------
   Corre en el servidor: el token vive en las Environment Variables
   de Vercel y nunca llega al navegador.

   Fuentes permitidas (allowlist — no es un proxy abierto a la base):
     ?t=works   → aplicativos          (tabla del sitio)
     ?t=people  → responsables del to-do (todo_amos)
     ?t=me      → links de la sección Yo (yo)

   Variables:
     AIRTABLE_TOKEN        (obligatoria, secreta)
     AIRTABLE_BASE         (opcional)
     AIRTABLE_TABLE/VIEW   (opcional, solo para works)
     WORKS_CACHE_SECONDS   (opcional, default 30 · 0 desactiva el cache)
   ============================================================ */

const BASE = process.env.AIRTABLE_BASE || 'appU39PYosvxt8FfG';

const SOURCES = {
  works: {
    table: process.env.AIRTABLE_TABLE || 'tblYmNMjQai8IJeeL',
    view:  process.env.AIRTABLE_VIEW  || 'viwoFafbiplokrhWt',
  },
  people: { table: 'todo_amos' },
  me:     { table: 'yo' },
};

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;

  const key = String(req.query?.t || 'works');
  const src = SOURCES[key];
  if (!src) {
    return res.status(400).json({ error: `Fuente desconocida: ${key}` });
  }

  // Sin token no es un error del sitio: el cliente cae a sus defaults.
  if (!token) {
    return res.status(501).json({ error: 'AIRTABLE_TOKEN no está configurado.' });
  }

  try {
    const records = [];
    let offset;

    do {
      const qs = new URLSearchParams({ pageSize: '100' });
      if (src.view) qs.set('view', src.view);
      if (offset) qs.set('offset', offset);

      const r = await fetch(
        `https://api.airtable.com/v0/${BASE}/${encodeURIComponent(src.table)}?${qs}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (!r.ok) {
        console.error('[api/airtable]', key, r.status, await r.text());
        return res.status(502).json({ error: `Airtable respondió ${r.status}` });
      }

      const json = await r.json();
      records.push(...(json.records || []));
      offset = json.offset;
    } while (offset);

    const ttl = Number(process.env.WORKS_CACHE_SECONDS ?? 30);
    res.setHeader(
      'Cache-Control',
      ttl > 0 ? `public, s-maxage=${ttl}, stale-while-revalidate=300` : 'no-store',
    );

    return res.status(200).json({ pulledAt: new Date().toISOString(), records });
  } catch (err) {
    console.error('[api/airtable]', key, err);
    return res.status(502).json({ error: 'No se pudo leer Airtable.' });
  }
}
