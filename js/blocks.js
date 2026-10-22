/* ============================================================
   blocks.js — widgets de armado: Texto y Grupo
   ------------------------------------------------------------
   Texto: solo un texto en el lienzo (título, subtítulo o párrafo),
          sin tarjeta.
          { kind: 'label', text, style: 'title'|'subtitle'|'body' }
   Grupo: un marco con nombre que agrupa widgets. Va detrás de todo; al
          moverlo se mueven con él los widgets que están dentro. Se crea
          desde la herramienta o con «Agrupar» en una selección múltiple.
          { kind: 'group', title, color }
   Post-it: una nota corta de color. Soltada sobre una fila del user
          journey queda dentro del journey, con la cara de quien la puso.
          { kind: 'note', text, color }
   ============================================================ */

export const LABEL_STYLES = [
  { id: 'title', name: 'Título' },
  { id: 'subtitle', name: 'Subtítulo' },
  { id: 'body', name: 'Párrafo' },
];
export const NOTE_COLORS = ['#ffd84d', '#ff9ec4', '#9be7a2', '#9fd3ff', '#ffb36b'];
export const newNote = () => ({ kind: 'note', text: '', color: NOTE_COLORS[0] });
export const noteSize = () => ({ w: 5, h: 5 });
export function noteHTML(d) {
  return `<div class="wnote" style="--n:${d.color}">${d.text ? esc(d.text).replace(/\n/g, '<br>') : '<span class="wnote-ph">Escribe algo…</span>'}</div>`;
}

export const GROUP_COLORS = ['#ff3b4f', '#ff9f1c', '#ffd60a', '#2ecc71', '#22d3ee', '#3b82f6', '#a855f7', '#9a9aa6'];

export const newLabel = () => ({ kind: 'label', text: 'Escribe aquí', style: 'title' });
export const labelSize = (style = 'title') => (style === 'title' ? { w: 16, h: 3 } : style === 'subtitle' ? { w: 14, h: 2 } : { w: 12, h: 4 });
export const newGroup = (title = 'Grupo') => ({ kind: 'group', title, color: GROUP_COLORS[0] });
export const groupSize = () => ({ w: 20, h: 14 });

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function labelHTML(d) {
  return `<div class="wlabel wlabel--${d.style}">${esc(d.text).replace(/\n/g, '<br>')}</div>`;
}

export function groupHTML(d) {
  return `<div class="wgroup" style="--g:${d.color}"><span class="wgroup-head">${esc(d.title)}</span></div>`;
}
