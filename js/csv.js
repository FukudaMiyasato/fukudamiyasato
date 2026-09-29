/* ============================================================
   csv.js — parser de CSV para el navegador
   ------------------------------------------------------------
   parseCSV(text) → { delimiter, headers, rows }
   Detecta el separador (coma, punto y coma, tabulación o barra) y
   respeta comillas, comillas escapadas y saltos de línea en campos.
   ============================================================ */

/* ---------- parseo ---------- */

const DELIMS = [',', ';', '\t', '|'];

/** Separador más probable: el que aparece igual de veces en las primeras líneas. */
function sniffDelimiter(text) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 20);
  let best = ',', bestScore = -1;
  for (const d of DELIMS) {
    const counts = lines.map((l) => {
      let n = 0, q = false;
      for (const ch of l) { if (ch === '"') q = !q; else if (ch === d && !q) n++; }
      return n;
    });
    if (!counts[0]) continue;
    const same = counts.filter((c) => c === counts[0]).length;
    const score = same * 1000 + counts[0];
    if (score > bestScore) { bestScore = score; best = d; }
  }
  return best;
}

/** CSV estilo RFC 4180: comillas, comillas dobles escapadas y saltos de línea dentro de campos. */
export function parseCSV(input) {
  const text = String(input || '').replace(/^﻿/, '');
  const delimiter = sniffDelimiter(text);
  const out = [];
  let row = [], cell = '', q = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delimiter) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); out.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); out.push(row); }

  const rows = out.filter((r) => r.some((c) => c.trim() !== ''));
  const raw = rows.shift() || [];
  const width = Math.max(raw.length, ...rows.map((r) => r.length));
  const seen = new Map();
  const headers = Array.from({ length: width }, (_, i) => {
    let h = String(raw[i] ?? '').trim() || `Columna ${i + 1}`;
    const n = (seen.get(h) || 0) + 1;
    seen.set(h, n);
    if (n > 1) h = `${h} (${n})`;
    return h;
  });
  return { delimiter, headers, rows: rows.map((r) => headers.map((_, i) => String(r[i] ?? '').trim())) };
}
