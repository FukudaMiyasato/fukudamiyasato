/* ============================================================
   timeline.js — widget "línea de tiempo" con personaje
   ------------------------------------------------------------
   Una línea con un círculo por hito (ordenados por fecha). La cabeza
   del personaje avanza proporcionalmente a los días transcurridos
   entre el hito anterior y el siguiente, y cambia de cara:
     primer 30% del tramo  → durmiendo (con Z Z Z)
     siguiente 40%         → normal
     último 30%            → asustado (con gotas)
     el mismo día de un hito → asustado, salvo el primero (durmiendo)
   Antes del inicio duerme; después del último hito queda asustado.
   ============================================================ */

/* Caras por personaje. Falta el chico asustado: mientras tanto usa su
   cara normal (las gotas de sudor igual se ven). */
export const FACES = {
  m: { normal: '/assets/faces/m_normal.png', sleep: '/assets/faces/m_sleep.png', scared: '/assets/faces/m_normal.png' },
  f: { normal: '/assets/faces/f_normal.png', sleep: '/assets/faces/f_sleep.png', scared: '/assets/faces/f_scared.png' },
};
export const CHARACTERS = Object.keys(FACES);

const pad = (n) => String(n).padStart(2, '0');

/** Hoy, en la zona horaria de quien mira, como AAAA-MM-DD. */
export function todayISO(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const toUTC = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));

export function addDays(iso, n) {
  const d = new Date(toUTC(iso) + n * 864e5);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);

export function defaultTimeline(today = todayISO()) {
  return {
    kind: 'timeline',
    title: 'Línea de tiempo',
    character: 'm',
    milestones: [
      { id: 'h1', name: 'inicio', date: today },
      { id: 'h2', name: 'fin', date: addDays(today, 7) },
    ],
  };
}

/** Dónde va la cabeza (índice fraccional 0…n−1) y con qué cara. */
export function timelineState(milestones, today = todayISO()) {
  const n = milestones.length;
  const first = milestones[0].date, last = milestones[n - 1].date;
  if (today < first) return { pos: 0, mood: 'sleep' };
  if (today > last) return { pos: n - 1, mood: 'scared' };
  const same = milestones.findIndex((m) => m.date === today);
  if (same >= 0) return { pos: same, mood: same === 0 ? 'sleep' : 'scared' };
  for (let i = 0; i < n - 1; i++) {
    const a = milestones[i].date, b = milestones[i + 1].date;
    if (today > a && today < b) {
      const t = daysBetween(a, today) / daysBetween(a, b);
      return { pos: i + t, mood: t < 0.3 ? 'sleep' : t < 0.7 ? 'normal' : 'scared' };
    }
  }
  return { pos: 0, mood: 'normal' };
}

/** "faltan 3 días" · "falta 1 día" · "es hoy" · "hace 2 días" */
export function daysLeftText(date, today = todayISO()) {
  const d = daysBetween(today, date);
  if (d === 0) return 'es hoy';
  if (d === 1) return 'falta 1 día';
  if (d > 1) return `faltan ${d} días`;
  return d === -1 ? 'hace 1 día' : `hace ${-d} días`;
}

/** Tamaño en celdas: crece con cada hito. */
export const timelineSize = (n) => ({ w: Math.max(5, 2 + (n - 1) * 3), h: 3 });

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function timelineHTML(d, today = todayISO()) {
  const ms = d.milestones;
  const n = ms.length;
  const { pos, mood } = timelineState(ms, today);
  const pct = (i) => (n > 1 ? (i / (n - 1)) * 100 : 0);
  const face = (FACES[d.character] || FACES.m)[mood];
  const extra = mood === 'sleep'
    ? '<span class="wtl-zzz" aria-hidden="true"><i>z</i><i>z</i><i>z</i></span>'
    : mood === 'scared' ? '<span class="wtl-drops" aria-hidden="true"><i></i><i></i><i></i></span>' : '';
  const label = { sleep: 'durmiendo', normal: 'tranquilo', scared: 'asustado' }[mood];
  return `
    <div class="wtl" role="img" aria-label="${esc(`${d.title}: ${ms.map((m) => `${m.name} ${m.date}`).join(', ')}`)}">
      <div class="wtl-track">
        <span class="wtl-line"></span>
        ${ms.map((m, i) => `<span class="wtl-dot${m.date <= today ? ' is-past' : ''}" style="left:${pct(i)}%"
            data-tip="${esc(`${m.name} · ${daysLeftText(m.date, today)}`)}" data-tip-light></span>`).join('')}
        <div class="wtl-face mood-${mood}" style="left:${pct(pos)}%" title="${label}">
          <img src="${face}" alt="" draggable="false">${extra}
        </div>
      </div>
    </div>`;
}
