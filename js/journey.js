/* ============================================================
   journey.js — panel "User journey"
   ------------------------------------------------------------
   Los paneles son widgets más grandes. Este arma el recorrido de un
   usuario: arriba los puntos de entrada y debajo las etapas (qué hace,
   qué piensa, cómo se siente, dolores y oportunidades), con la curva de
   emociones. Lo genera la IA con los usuarios conectados (si son varios,
   un usuario promedio) y el objetivo que define qué flujo pintar.

   data: { kind: 'journey', title, goal, persona, users: [{ name, sex, age }],
           voices: [nombre], entries: [{ name, channel, detail }],
           stages: [{ name, doing, thinking, feeling: -2…2, emotion, pain, opportunity }] }
   ============================================================ */

import { avatarSVG } from './persona.js';

export const emptyJourney = () => ({ kind: 'journey', title: 'User journey', goal: '', persona: '', users: [], voices: [], entries: [], stages: [] });

export function journeySize(d) {
  const n = d.stages?.length || 0;
  if (!n) return { w: 18, h: 10 };
  return { w: Math.min(48, Math.max(26, n * 6 + 4)), h: 19 };
}

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* -2 … 2: de muy mal a muy bien */
const FEEL_COLOR = { '-2': '#ff5a6a', '-1': '#ff9a5a', 0: '#ffd166', 1: '#a3e05c', 2: '#3ecf8e' };
const feel = (v) => Math.max(-2, Math.min(2, Math.round(Number(v) || 0)));

/** Carita de la emoción: la boca se curva según el sentimiento. */
export function faceSVG(v) {
  const f = feel(v);
  const c = FEEL_COLOR[f];
  const bend = f * 2.6; // + sonrisa, − tristeza
  return `<svg viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="16" cy="16" r="14" fill="${c}"/>
    <circle cx="16" cy="16" r="14" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="1.5"/>
    <circle cx="11.2" cy="13" r="1.9" fill="#1d1d22"/><circle cx="20.8" cy="13" r="1.9" fill="#1d1d22"/>
    <path d="M10.5 ${20.5 - bend / 2}Q16 ${20.5 + bend} 21.5 ${20.5 - bend / 2}" fill="none" stroke="#1d1d22" stroke-width="2" stroke-linecap="round"/>
  </svg>`;
}

const CHANNEL_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h12"/><path d="M13 7l5 5-5 5"/></svg>`;

/** `linked`: usuarios conectados ahora mismo ({ name, sex, age }), para el estado vacío. */
export function journeyHTML(d, { linked = [], generating = false } = {}) {
  const users = d.stages?.length ? d.users || [] : linked;
  const avatars = users.slice(0, 4).map((u) => `<span class="jr-av" title="${esc(u.name)}">${avatarSVG(u)}</span>`).join('');
  const sub = d.stages?.length
    ? (users.length > 1 ? `Promedio de ${users.map((u) => u.name).join(' y ')}` : users[0]?.name || '')
    : '';
  const head = `
    <header class="whead jr-head">
      <span class="jr-avs">${avatars}</span>
      <div class="jr-titles">
        <h3>${esc(d.title || 'User journey')}</h3>
        <small>${esc([d.goal && `Objetivo: ${d.goal}`, sub, d.voices?.length && `con la mirada de ${d.voices.join(' y ')}`].filter(Boolean).join(' · ') || 'Panel')}</small>
      </div>
    </header>`;

  if (generating) {
    return `${head}<div class="wbody jr-body jr-empty"><span class="spinner" aria-hidden="true"></span><b>Armando el journey…</b>
      <small>${users.length > 1 ? 'Combinando a los usuarios conectados en uno promedio' : 'Leyendo al usuario conectado'}</small></div>`;
  }

  if (!d.stages?.length) {
    return `${head}<div class="wbody jr-body jr-empty">
      <b>${linked.length ? `${linked.length === 1 ? 'Usuario conectado' : `${linked.length} usuarios conectados`}: ${esc(linked.map((u) => u.name).join(', '))}` : 'Conecta uno o más usuarios'}</b>
      <small>${linked.length
        ? 'Selecciona el panel, escribe el objetivo y genera el journey.'
        : 'Arrastra el + de un usuario hasta el conector izquierdo de este panel. Con dos o más, el journey sale de un usuario promedio.'}</small>
    </div>`;
  }

  const n = d.stages.length;
  const entries = (d.entries || []).map((e) => `
    <li class="jr-entry"><span class="jr-entry-ico">${CHANNEL_ICON}</span>
      <span><b>${esc(e.name)}</b>${e.channel ? `<small>${esc(e.channel)}</small>` : ''}${e.detail ? `<em>${esc(e.detail)}</em>` : ''}</span></li>`).join('');

  // la curva: un punto por etapa (centro de su columna), de 15% (bien) a 85% (mal)
  const pts = d.stages.map((s, i) => [((i + 0.5) / n) * 100, 50 - feel(s.feeling) * 17.5]);
  const path = pts.map(([x, y], i) => {
    if (!i) return `M${x} ${y}`;
    const [px, py] = pts[i - 1];
    const mx = (px + x) / 2;
    return `C${mx} ${py} ${mx} ${y} ${x} ${y}`;
  }).join('');
  const faces = d.stages.map((s, i) => `
    <span class="jr-face" style="left:${pts[i][0]}%;top:${pts[i][1]}%">${faceSVG(s.feeling)}<small>${esc(s.emotion)}</small></span>`).join('');

  const row = (label, key, cls = '') => `
    <div class="jr-label">${label}</div>
    ${d.stages.map((s) => `<div class="jr-cell ${cls}">${esc(s[key])}</div>`).join('')}`;

  return `${head}
    <div class="wbody jr-body">
      ${entries ? `<section class="jr-sec"><h4>Puntos de entrada</h4><ul class="jr-entries">${entries}</ul></section>` : ''}
      <section class="jr-sec">
        <h4>Journey${d.persona ? ` <small>· ${esc(d.persona)}</small>` : ''}</h4>
        <div class="jr-grid" style="--n:${n}">
          <div class="jr-label"></div>
          ${d.stages.map((s, i) => `<div class="jr-stage"><i>${i + 1}</i>${esc(s.name)}</div>`).join('')}
          ${row('Hace', 'doing')}
          <div class="jr-label">Siente</div>
          <div class="jr-curve">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
              <line x1="0" y1="50" x2="100" y2="50" class="jr-zero"/>
              <path d="${path}" class="jr-line"/>
            </svg>
            ${faces}
          </div>
          ${row('Piensa', 'thinking', 'jr-quote')}
          ${row('Dolor', 'pain', 'jr-pain')}
          ${row('Oportunidad', 'opportunity', 'jr-opp')}
        </div>
      </section>
    </div>`;
}
