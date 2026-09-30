/* ============================================================
   persona.js — widget "usuario"
   ------------------------------------------------------------
   Muestra un tipo de usuario (imagen + nombre). Empieza como el
   usuario por defecto; en su bloque de información se elige uno de
   los predefinidos y se le suben archivos de contexto (por ahora la
   subida es simulada: solo se guarda nombre y tamaño).
   ============================================================ */

export const PERSONAS = [
  { id: 'default', name: 'Usuario', img: '/assets/users/default.png' },
  { id: 'joven', name: 'Joven', img: '/assets/users/joven.png' },
  { id: 'papa', name: 'Papá divorciado', img: '/assets/users/papa.png' },
  { id: 'mama', name: 'Mamá soltera', img: '/assets/users/mama.png' },
  { id: 'familia', name: 'Familia feliz', img: '/assets/users/familia.png' },
  { id: 'nido', name: 'Nido vacío', img: '/assets/users/nido.png' },
  { id: 'jubilado', name: 'Jubilado', img: '/assets/users/jubilado.png' },
];

export const personaOf = (id) => PERSONAS.find((p) => p.id === id) || PERSONAS[0];

export const defaultUser = () => ({ kind: 'user', persona: 'default', context: [] });

export const userSize = () => ({ w: 5, h: 5 });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 12 KB · 1,4 MB */
export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
}

export function userHTML(d) {
  const p = personaOf(d.persona);
  const n = d.context?.length || 0;
  return `
    <div class="wuser" role="img" aria-label="${esc(p.name)}${n ? `, ${n} archivo${n === 1 ? '' : 's'} de contexto` : ''}">
      <img src="${p.img}" alt="" draggable="false">
      <b>${esc(p.name)}</b>
      ${n ? `<span class="wuser-ctx" title="${n} archivo${n === 1 ? '' : 's'} de contexto">${n}</span>` : ''}
    </div>`;
}
