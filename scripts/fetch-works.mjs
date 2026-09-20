#!/usr/bin/env node
/* ============================================================
   Regenera data/works.json desde Airtable sin exponer el token.

     AIRTABLE_TOKEN=pat... npm run works:pull

   Útil si prefieres no poner el token en js/config.js: corres esto
   cada vez que actualizas la tabla y haces commit del snapshot.
   ============================================================ */

import { writeFile } from 'node:fs/promises';

const TOKEN = process.env.AIRTABLE_TOKEN;
const BASE  = process.env.AIRTABLE_BASE  || 'appU39PYosvxt8FfG';
const TABLE = process.env.AIRTABLE_TABLE || 'tblYmNMjQai8IJeeL';
const VIEW  = process.env.AIRTABLE_VIEW  || 'viwoFafbiplokrhWt';

if (!TOKEN) {
  console.error('Falta AIRTABLE_TOKEN.\n  AIRTABLE_TOKEN=pat... npm run works:pull');
  process.exit(1);
}

const records = [];
let offset;

do {
  const qs = new URLSearchParams({ pageSize: '100', view: VIEW });
  if (offset) qs.set('offset', offset);

  const res = await fetch(`https://api.airtable.com/v0/${BASE}/${TABLE}?${qs}`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  if (!res.ok) {
    console.error(`Airtable respondió ${res.status}: ${await res.text()}`);
    process.exit(1);
  }
  const json = await res.json();
  records.push(...json.records);
  offset = json.offset;
} while (offset);

await writeFile(
  new URL('../data/works.json', import.meta.url),
  JSON.stringify({ pulledAt: new Date().toISOString(), records }, null, 2),
);

console.log(`✓ data/works.json — ${records.length} registros`);
