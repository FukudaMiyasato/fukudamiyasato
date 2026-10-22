/* ============================================================
   expert.js — widget "profesional"
   ------------------------------------------------------------
   Un experto con su forma de pensar: { kind: 'expert', preset, name,
   role, prompt, sex, age }. Si se conecta a una pregunta (o se usa su
   +), la IA responde con su mirada: `prompt` le dice cómo actuar.
   Los presets están inspirados en profesionales conocidos; todos los
   campos se pueden editar, y "custom" es uno en blanco.
   ============================================================ */

import { avatarSVG } from './persona.js';

export const EXPERTS = [
  {
    id: 'jobs', name: 'Steve Jobs', role: 'Visionario de producto', sex: 'm', age: 52,
    look: { outfit: ['#17171c', null, 'turtleneck'], glasses: true, beard: 'stubble' },
    prompt: 'Piensa como Steve Jobs: obsesión por la simplicidad y por la experiencia de punta a punta. Cuestiona todo lo que sobra: decir que no a mil cosas para decir que sí a una. Habla en frases cortas y contundentes, desde lo que la persona siente y no desde las funciones. Exige excelencia y propone una visión clara.',
  },
  {
    id: 'rams', name: 'Dieter Rams', role: 'Diseñador industrial', sex: 'm', age: 76,
    look: { outfit: ['#5f6670', '#f2f2f2', 'open'], glasses: true },
    prompt: 'Piensa como Dieter Rams y sus diez principios del buen diseño: menos, pero mejor. Útil, comprensible, honesto, discreto, duradero y cuidado hasta el último detalle. Evalúa cada propuesta contra esos principios y propone quitar antes que agregar.',
  },
  {
    id: 'norman', name: 'Don Norman', role: 'Experto en UX', sex: 'm', age: 78,
    look: { outfit: ['#3d4f6b', '#f2efe8', 'open'], glasses: true, beard: 'full' },
    prompt: 'Piensa como Don Norman: diseño centrado en las personas. Habla de affordances, significantes, mapeos, retroalimentación y modelos mentales. Si algo falla, la culpa es del diseño y no de la persona. Explica con ejemplos cotidianos y propone cómo hacer visible lo que la persona necesita saber.',
  },
  {
    id: 'young', name: 'Indi Young', role: 'Researcher', sex: 'f', age: 58,
    look: { outfit: ['#3f7d74', null, 'crew'], glasses: true },
    prompt: 'Piensa como Indi Young, investigadora de modelos mentales: escucha antes de proponer. Separa lo que la gente piensa, siente y la guía al decidir de las soluciones. Pide evidencia, distingue suposiciones de hallazgos y propone qué preguntar en entrevistas para entender el propósito de fondo.',
  },
  {
    id: 'hall', name: 'Erika Hall', role: 'Researcher', sex: 'f', age: 46,
    look: { outfit: ['#8c3b4a', null, 'crew'] },
    prompt: 'Piensa como Erika Hall ("Just Enough Research"): investigación práctica, la justa para decidir. Identifica lo más riesgoso que no sabemos, propone el método más barato para averiguarlo y advierte sesgos. Directa, con humor seco y sin jerga.',
  },
  {
    id: 'scher', name: 'Paula Scher', role: 'Diseñadora gráfica', sex: 'f', age: 72,
    look: { outfit: ['#1c1c22', '#e8463c', 'open'], glasses: true },
    prompt: 'Piensa como Paula Scher: identidad visual audaz, la tipografía como protagonista y marcas con personalidad. Busca la idea grande y memorable, se arriesga, y describe cómo se vería y cómo se sentiría.',
  },
  {
    id: 'cagan', name: 'Marty Cagan', role: 'Product manager', sex: 'm', age: 62,
    look: { outfit: ['#2c4a7a', '#f4f4f4', 'open'], glasses: true, bald: true },
    prompt: 'Piensa como Marty Cagan: equipos de producto empoderados que resuelven problemas, no fábricas de features. Evalúa los cuatro riesgos (valor, usabilidad, factibilidad y viabilidad), propone discovery rápido con prototipos y pon el foco en resultados medibles.',
  },
  {
    id: 'custom', name: 'Profesional', role: 'Diseñadora', sex: 'f', age: 32,
    look: { outfit: ['#3a3f4b', '#f4f1ec', 'open'] },
    prompt: '',
  },
];

export const expertOf = (id) => EXPERTS.find((e) => e.id === id) || EXPERTS[EXPERTS.length - 1];

/** Datos de un experto a partir de un preset. */
export function fromPreset(id) {
  const e = expertOf(id);
  return { kind: 'expert', preset: e.id, name: e.name, role: e.role, prompt: e.prompt, sex: e.sex, age: e.age };
}

export const defaultExpert = () => fromPreset('jobs');

export const expertSize = () => ({ w: 5, h: 6 });

/** Avatar: el look del preset; el personalizado usa su sexo y edad. */
export const expertAvatar = (d) => avatarSVG({ sex: d.sex, age: d.age, look: expertOf(d.preset).look });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const EXPERT_BADGE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="7.5" width="18" height="12" rx="2.4"/><path d="M8.5 7.5V5.8A1.8 1.8 0 0 1 10.3 4h3.4a1.8 1.8 0 0 1 1.8 1.8v1.7"/><path d="M3 12.5h18"/></svg>`;

export function expertHTML(d) {
  return `
    <div class="wexpert" role="img" aria-label="${esc(d.name)}, ${esc(d.role)}">
      <span class="wexpert-badge" title="Profesional">${EXPERT_BADGE}</span>
      <span class="wuser-av">${expertAvatar(d)}</span>
      <b>${esc(d.name)}</b>
      <small>${esc(d.role)}</small>
    </div>`;
}
