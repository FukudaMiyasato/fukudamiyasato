/* ============================================================
   file.js — widget "archivo"
   ------------------------------------------------------------
   Solo guarda información subida: CSV, TSV, Excel (la primera hoja
   pasa a CSV), JSON, TXT y Markdown. No hace nada más: con su + se le
   pregunta a la IA (y puede responder con tablas o gráficos, también de
   pastel) usando el contenido de los archivos.

   data: { kind: 'file', title, files: [{ name, size, type, text, rows? }] }
   ============================================================ */

import { fileSize } from './persona.js';

export const MAX_FILES = 6;
export const MAX_FILE_TEXT = 240_000; // entre todos los archivos (el widget se guarda entero)

export const emptyFile = () => ({ kind: 'file', title: 'Archivo', files: [] });
export const fileWidgetSize = () => ({ w: 9, h: 8 });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const EXT = /\.([a-z0-9]+)$/i;
const TYPE_OF = { csv: 'csv', tsv: 'csv', txt: 'text', md: 'text', markdown: 'text', json: 'json', xlsx: 'xlsx', xls: 'xlsx' };
export const ACCEPT = '.csv,.tsv,.txt,.md,.markdown,.json,.xlsx,.xls';

/** Excel → CSV de la primera hoja (SheetJS, solo cuando hace falta). */
async function excelToCSV(file) {
  const XLSX = await import('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
  const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_csv(sheet);
}

/** Lee los archivos que se pueden usar. Devuelve { ok: [...], skipped: [nombres] }. */
export async function readUploads(fileList, room) {
  const ok = [], skipped = [];
  let left = room;
  for (const f of [...fileList]) {
    const type = TYPE_OF[(f.name.match(EXT)?.[1] || '').toLowerCase()];
    if (!type || left <= 0) { skipped.push(f.name); continue; }
    try {
      let text = type === 'xlsx' ? await excelToCSV(f) : await f.text();
      text = text.replace(/^﻿/, '');
      const cut = text.length > left;
      text = text.slice(0, left);
      left -= text.length;
      const rows = type === 'csv' || type === 'xlsx' ? Math.max(0, text.split('\n').filter((l) => l.trim()).length - 1) : null;
      ok.push({ name: f.name.slice(0, 120), size: f.size, type, text, ...(rows != null ? { rows } : {}), ...(cut ? { cut: true } : {}) });
    } catch {
      skipped.push(f.name);
    }
  }
  return { ok, skipped };
}

export const textLeft = (d) => MAX_FILE_TEXT - (d.files || []).reduce((n, f) => n + (f.text?.length || 0), 0);

const TYPE_LABEL = { csv: 'CSV', xlsx: 'Excel', json: 'JSON', text: 'Texto' };

export const FILE_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 3.5H7a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8.5z"/><path d="M14 3.5v5h5"/><path d="M8.5 13h7M8.5 16.5h5"/></svg>`;

export function fileHTML(d, { canEdit = false } = {}) {
  const files = d.files || [];
  const list = files.map((f) => `
    <li class="wf-item">
      <span class="wf-type wf-type--${f.type}">${TYPE_LABEL[f.type] || 'Archivo'}</span>
      <span class="wf-name">${esc(f.name)}</span>
      <small>${f.rows != null ? `${f.rows.toLocaleString('es')} filas · ` : ''}${fileSize(f.size)}${f.cut ? ' · recortado' : ''}</small>
    </li>`).join('');
  return `
    <header class="whead wf-head">
      <span class="whead-ico wf-ico">${FILE_ICON}</span>
      <h3>${esc(d.title || 'Archivo')}</h3>
      <small>${files.length ? `${files.length} archivo${files.length === 1 ? '' : 's'}` : 'vacío'}</small>
    </header>
    <div class="wbody wf-body">
      ${files.length ? `<ul class="wf-list">${list}</ul>` : ''}
      ${canEdit ? `<p class="wf-drop">${files.length
        ? 'Usa el <b>+</b> para preguntarle a la IA: «un pastel de ventas por región»'
        : 'Arrastra aquí un CSV, Excel, JSON o texto<br><small>o selecciónalo para subirlo desde su bloque</small>'}</p>` : ''}
    </div>`;
}
