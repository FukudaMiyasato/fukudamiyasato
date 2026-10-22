/* ============================================================
   pro.js — widget "profesional" y sus hallazgos
   ------------------------------------------------------------
   Los profesionales trabajan de verdad: el Researcher (por ahora el
   único) busca en la web lo que le preguntas y deja hallazgos con sus
   fuentes como widgets en el mapa (hasta 5 si la pregunta pide varias
   cosas). En su tarjeta muestra un pensamiento sobre la investigación.

   pro:     { kind: 'pro', role, name, thought, history: [{ q, n }] }
   finding: { kind: 'finding', title, summary, question, by, confidence,
              sources: [{ url, title }] }
   Para sumar otro profesional: una entrada en PROS (+ su rol en
   api/dash.js → PRO_ROLES y su flujo en api/_lib/ai.js).
   ============================================================ */

import { avatarSVG } from './persona.js';

export const PROS = [
  {
    role: 'researcher', name: 'Researcher', note: 'Busca en la web y trae hallazgos con fuentes',
    sex: 'f', age: 33, look: { outfit: ['#2f6f73', '#f3efe6', 'open'], glasses: true },
    thoughts: [
      '¿Qué sabemos y qué estamos suponiendo?',
      'Antes de opinar, busquemos evidencia.',
      '¿Quién más ya resolvió este problema?',
      'Los datos dicen una cosa; las personas, otra.',
      '¿De dónde sale ese número?',
      'Lo que no está medido, todavía es una hipótesis.',
    ],
  },
];

export const proOf = (role) => PROS.find((p) => p.role === role) || PROS[0];

export function newPro(role = 'researcher') {
  const p = proOf(role);
  return { kind: 'pro', role: p.role, name: p.name, thought: p.thoughts[Math.floor(Math.random() * p.thoughts.length)], history: [] };
}

export const proSize = () => ({ w: 7, h: 7 });
export const findingSize = () => ({ w: 10, h: 8 });

export const proAvatar = (d) => { const p = proOf(d.role); return avatarSVG({ sex: p.sex, age: p.age, look: p.look }); };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const host = (url) => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; } };

export const PRO_BADGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5 5"/></svg>`;

export function proHTML(d, { busy = false } = {}) {
  return `
    <div class="wpro" role="img" aria-label="${esc(d.name)}${d.thought ? `: ${esc(d.thought)}` : ''}">
      <span class="wpro-badge" title="Profesional">${PRO_BADGE}</span>
      <p class="wpro-thought${busy ? ' is-busy' : ''}">${busy ? '<i></i><i></i><i></i>' : esc(d.thought || '…')}</p>
      <span class="wuser-av">${proAvatar(d)}</span>
      <b>${esc(d.name)}</b>
      <small>Profesional · ${d.history?.length ? `${d.history.length} investigación${d.history.length === 1 ? '' : 'es'}` : 'pregúntale algo'}</small>
    </div>`;
}

const CONF = { alta: 'Confianza alta', media: 'Confianza media', baja: 'Confianza baja' };

export function findingHTML(d) {
  return `
    <header class="whead wfind-head" title="${esc(d.question)}">
      <span class="wfind-ico">${PRO_BADGE}</span>
      <h3>${esc(d.title)}</h3>
      <small class="wfind-conf wfind-conf--${d.confidence}">${CONF[d.confidence] || ''}</small>
    </header>
    <div class="wbody wfind-body">
      <p class="wfind-sum">${esc(d.summary)}</p>
      ${d.sources?.length ? `<ul class="wfind-src">${d.sources.map((s) => `
        <li><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer" title="${esc(s.title)}">${esc(host(s.url))}</a></li>`).join('')}</ul>` : ''}
    </div>`;
}
