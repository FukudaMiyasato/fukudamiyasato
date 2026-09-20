/* ============================================================
   /api/works — proxy a Airtable (Vercel Serverless Function)
   ------------------------------------------------------------
   Corre en el servidor, así que el token vive en las Environment
   Variables de Vercel y nunca llega al navegador.

   Variables (Vercel → Settings → Environment Variables):
     AIRTABLE_TOKEN   (obligatoria, secreta)
     AIRTABLE_BASE    (opcional, por defecto la base del sitio)
     AIRTABLE_TABLE   (opcional)
     AIRTABLE_VIEW    (opcional)
     WORKS_CACHE_SECONDS (opcional, default 30 · pon 0 para desactivar)

   Devuelve el mismo shape que data/works.json — { records: [...] } —
   para que el cliente normalice igual venga de donde venga.
   ============================================================ */

const BASE  = process.env.AIRTABLE_BASE  || 'appU39PYosvxt8FfG';
const TABLE = process.env.AIRTABLE_TABLE || 'tblYmNMjQai8IJeeL';
const VIEW  = process.env.AIRTABLE_VIEW  || 'viwoFafbiplokrhWt';

export default async function handler(req, res) {
  const token = process.env.AIRTABLE_TOKEN;

  // Sin token no es un error del sitio: el cliente cae al snapshot local.
  if (!token) {
    return res.status(501).json({
      error: 'AIRTABLE_TOKEN no está configurado en este entorno.',
    });
  }

  try {
    const records = [];
    let offset;

    do {
      const qs = new URLSearchParams({ pageSize: '100' });
      if (VIEW) qs.set('view', VIEW);
      if (offset) qs.set('offset', offset);

      const r = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?${qs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (!r.ok) {
        const detail = await r.text();
        console.error('[api/works] Airtable', r.status, detail);
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
    console.error('[api/works]', err);
    return res.status(502).json({ error: 'No se pudo leer Airtable.' });
  }
}
