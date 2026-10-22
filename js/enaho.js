/* ============================================================
   enaho.js — widget "ENAHO" (perfil con datos del INEI, sin IA)
   ------------------------------------------------------------
   Lee /data/enaho/<año>.json (lo arma scripts/enaho/enaho.py una vez
   por año) y muestra el perfil del cruce elegido: departamento, área,
   edad y sexo. Cambiar un filtro solo busca otra fila del JSON: es
   instantáneo y no gasta tokens.

   data: { kind: 'enaho', title, year, filters: { dep, area, age, sex },
           follow,   // true: edad y sexo salen del Usuario conectado
           place,    // 'auto' (de las notas del usuario) | 'manual'
           profile } // lo que se ve, ya calculado (para la IA: contextFrom)

   La ENAHO mide uso de internet y celular, pero NO redes sociales
   específicas: el widget lo dice siempre.
   ============================================================ */

export const ENAHO_YEAR = 2025;
export const LOW_SAMPLE = 50;   // menos casos: aviso
export const MIN_SAMPLE = 30;   // menos casos: aviso fuerte

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const nf = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('es-PE', { maximumFractionDigits: 1 });
const pct = (v) => (v == null ? '—' : `${nf.format(v)}%`);
const soles = (v) => (v == null ? '—' : `S/ ${nf.format(v)}`);

export const emptyEnaho = () => ({
  kind: 'enaho', title: 'ENAHO', year: ENAHO_YEAR,
  filters: { dep: '00', area: 't', age: 't', sex: 't' }, follow: true, place: 'auto', profile: null,
});
export const enahoSize = () => ({ w: 13, h: 20 });

/* ---------- datos: un solo fetch por año ---------- */
const loaded = new Map();
export function loadEnaho(year = ENAHO_YEAR) {
  if (!loaded.has(year)) {
    loaded.set(year, fetch(`/data/enaho/${year}.json`).then((r) => {
      if (!r.ok) throw new Error(`No está la ENAHO ${year}.`);
      return r.json();
    }).catch((err) => { loaded.delete(year); throw err; }));
  }
  return loaded.get(year);
}

const nameIn = (list, key) => list.find(([k]) => k === key)?.[1] || '';

/** Rango de edad de la ENAHO para una edad (menores de 12: no hay). */
export function bandOf(age) {
  if (age < 12) return null;
  return age < 18 ? '12-17' : age < 25 ? '18-24' : age < 35 ? '25-34' : age < 45 ? '35-44' : age < 60 ? '45-59' : '60+';
}

/* ---------- ubicación desde las notas del usuario ---------- */
const fold = (s) => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
// ciudades y nombres que aparecen en las notas → departamento (LM = Lima Metropolitana)
const PLACES = [
  ['01', 'amazonas', 'chachapoyas', 'bagua'], ['02', 'ancash', 'huaraz', 'chimbote'], ['03', 'apurimac', 'abancay', 'andahuaylas'],
  ['04', 'arequipa'], ['05', 'ayacucho', 'huamanga'], ['06', 'cajamarca', 'jaen'], ['07', 'callao'],
  ['08', 'cusco', 'cuzco'], ['09', 'huancavelica'], ['10', 'huanuco', 'tingo maria'], ['11', 'ica', 'chincha', 'pisco'],
  ['12', 'junin', 'huancayo', 'satipo'], ['13', 'la libertad', 'trujillo'], ['14', 'lambayeque', 'chiclayo'],
  ['LM', 'lima metropolitana', 'lima', 'san juan de lurigancho', 'villa el salvador', 'villa maria del triunfo', 'comas', 'san juan de miraflores', 'carabayllo', 'puente piedra', 'ate vitarte', 'independencia', 'los olivos'],
  ['16', 'loreto', 'iquitos'], ['17', 'madre de dios', 'puerto maldonado'], ['18', 'moquegua', 'ilo'], ['19', 'pasco'],
  ['20', 'piura', 'sullana'], ['21', 'puno', 'juliaca'], ['22', 'san martin', 'tarapoto', 'moyobamba'], ['23', 'tacna'],
  ['24', 'tumbes'], ['25', 'ucayali', 'pucallpa'],
];
const RURAL = /\b(rural|campo|chacra|caserio|comunidad campesina|comunidad nativa|centro poblado|anexo)\b/;
const URBAN = /\b(urbana?|ciudad|asentamiento humano|aa\.? ?hh|urbanizacion)\b/;

/** { dep?, area? } que se adivinan de los textos (la primera mención gana). */
export function placeFrom(texts) {
  const t = ` ${fold(texts.join('\n'))} `;
  let dep = null, at = Infinity;
  for (const [code, ...names] of PLACES) {
    for (const n of names) {
      const i = t.search(new RegExp(`[^a-z]${n}[^a-z]`));
      if (i >= 0 && i < at) { at = i; dep = code; }
    }
  }
  const area = RURAL.test(t) ? 'r' : URBAN.test(t) ? 'u' : null;
  return { dep, area };
}

/* ---------- perfil del cruce ---------- */

/** El cruce de esos filtros, con nombres; null si no hay casos. */
export function profileOf(table, f) {
  const row = table.cells[[f.dep, f.area, f.age, f.sex].join('|')];
  const fl = table.filters;
  const where = [nameIn(fl.dep, f.dep), f.area === 't' ? '' : f.area === 'u' ? 'área urbana' : 'área rural'].filter(Boolean).join(', ');
  const who = `${f.sex === 'f' ? 'Mujeres' : f.sex === 'm' ? 'Hombres' : 'Personas'} de ${nameIn(fl.age, f.age)}`;
  const base = {
    label: `${who} · ${where || 'Perú'}`,
    source: `ENAHO ${table.year} · INEI`,
    edition: table.edition, example: Boolean(table.example),
  };
  if (!row) return { ...base, n: 0, hh: 0 };
  const v = Object.fromEntries(table.fields.map((k, i) => [k, row[i]]));
  return {
    ...base,
    n: v.n, hh: v.hh, pop: v.pop,
    stats: {
      gpc: v.gpc, gh: v.gh, ipc: v.ipc, ih: v.ih, il: v.il, ocu: v.ocu, pobre: v.pobre, pobext: v.pobext, tam: v.tam,
      sec: v.sec, seguro: v.seguro, sis: v.sis, essalud: v.essalud,
      internet: v.internet, celular: v.celular, intcasa: v.intcasa, intfija: v.intfija, diario: v.diario,
    },
    edu: table.edu.map((name, i) => [name, v[`edu${i}`]]),
    uses: table.uses.map((name, i) => [name, v[table.fields.filter((k) => k.startsWith('uso'))[i]]])
      .filter(([, x]) => x != null).sort((a, b) => b[1] - a[1]),
  };
}

const lower = (s) => s.charAt(0).toLowerCase() + s.slice(1);

/** Párrafo genérico del perfil (sin IA). */
export function describe(p) {
  if (!p?.stats) return 'No hay casos en la encuesta para esta combinación de filtros. Prueba con un filtro más amplio.';
  const s = p.stats;
  const out = [];
  out.push(`Viven en hogares de ${nf1.format(s.tam)} personas que gastan unos ${soles(s.gh)} al mes (${soles(s.gpc)} por persona) y reciben ${soles(s.ih)}.`);
  if (s.pobre != null) out.push(`El ${pct(s.pobre)} está en pobreza${s.pobext >= 1 ? ` (${pct(s.pobext)} en pobreza extrema)` : ''}.`);
  if (s.sec != null) out.push(`El ${pct(s.sec)} terminó la secundaria.`);
  if (s.seguro != null) out.push(`El ${pct(s.seguro)} tiene seguro de salud${s.sis > s.essalud ? `, casi siempre el SIS (${pct(s.sis)})` : `, sobre todo EsSalud (${pct(s.essalud)})`}.`);
  if (s.internet != null) {
    const top = (p.uses || []).slice(0, 2).map(([n]) => lower(n.replace(/ \(.*\)/, '')));
    out.push(`El ${pct(s.internet)} usó internet el último mes${top.length ? `, sobre todo para ${top.join(' y ')}` : ''}; el ${pct(s.celular)} tiene celular propio.`);
  }
  return out.join(' ');
}

/** Aviso según cuántas personas de la muestra hay en el cruce ('' = suficientes). */
export function sampleNote(n) {
  if (!n) return 'sin casos';
  if (n < MIN_SAMPLE) return 'muestra muy baja: solo como referencia';
  if (n < LOW_SAMPLE) return 'muestra baja: tómalo con cuidado';
  return '';
}

/* ---------- tarjeta ---------- */
export const ENAHO_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="9" r="4.5"/><circle cx="16.5" cy="15.5" r="4.5"/><path d="M8 4.5v4.5h4.5"/></svg>`;

/** Círculo con un porcentaje (anillo) o un monto (sin anillo). */
function ring(label, value, { money = false, tone = '' } = {}) {
  const r = 26, c = 2 * Math.PI * r;
  const p = money || value == null ? 0 : Math.max(0, Math.min(100, value));
  return `<figure class="wen-ring${tone ? ` wen-ring--${tone}` : ''}${money ? ' wen-ring--money' : ''}">
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <circle class="wen-track" cx="32" cy="32" r="${r}"/>
      ${money ? '' : `<circle class="wen-fill" cx="32" cy="32" r="${r}" stroke-dasharray="${(c * p) / 100} ${c}" transform="rotate(-90 32 32)"/>`}
    </svg>
    <b>${money ? `<small>S/</small>${value == null ? '—' : nf.format(value)}` : pct(value)}</b>
    <figcaption>${esc(label)}</figcaption>
  </figure>`;
}

export function enahoHTML(d, { loading = false, linked = null } = {}) {
  const p = d.profile;
  const s = p?.stats;
  const note = p ? sampleNote(p.n) : '';
  return `
    <header class="whead wen-head">
      <span class="whead-ico wen-ico">${ENAHO_ICON}</span>
      <h3>${esc(d.title || 'ENAHO')}</h3>
      <small>${esc(p?.source || `ENAHO ${d.year} · INEI`)}</small>
    </header>
    <div class="wbody wen-body">
      ${p ? `<p class="wen-who">${esc(p.label)}${linked ? `<small>con la edad y el sexo de ${esc(linked)}</small>` : ''}</p>` : ''}
      ${p?.example ? '<p class="wen-warn wen-warn--example">Datos de EJEMPLO: no son de la ENAHO real.</p>' : ''}
      ${s ? `<div class="wen-rings">
        ${ring('Gasto por persona al mes', s.gpc, { money: true })}
        ${ring('Ingreso del hogar al mes', s.ih, { money: true })}
        ${ring('En pobreza', s.pobre, { tone: 'warn' })}
        ${ring('Usa internet', s.internet, { tone: 'net' })}
        ${ring('Celular propio', s.celular, { tone: 'net' })}
        ${ring('Con seguro de salud', s.seguro, { tone: 'ok' })}
        ${ring('Secundaria completa', s.sec)}
        ${ring('Internet en casa', s.intcasa, { tone: 'net' })}
      </div>` : ''}
      <p class="wen-desc">${loading && !p ? 'Cargando la ENAHO…' : esc(describe(p))}</p>
      ${p?.uses?.length ? `<div class="wen-uses"><p>Para qué usa internet</p>${p.uses.slice(0, 5).map(([n, v]) => `
        <span class="wen-use"><i style="width:${Math.max(2, v)}%"></i><em>${esc(n)}</em><b>${pct(v)}</b></span>`).join('')}</div>` : ''}
      <p class="wen-foot">
        <span>Muestra: <b>${p ? nf.format(p.n) : '—'}</b> personas${p?.hh ? ` · ${nf.format(p.hh)} hogares` : ''}</span>
        ${note ? `<span class="wen-warn">⚠ ${esc(note)}</span>` : ''}
        <span class="wen-nosocial">No mide redes sociales específicas (Facebook, TikTok, WhatsApp…), solo para qué se usa internet.</span>
      </p>
    </div>`;
}
