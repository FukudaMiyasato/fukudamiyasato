/* ============================================================
   api/_lib/context.js — widgets en texto, para dárselos a la IA
   ------------------------------------------------------------
   Lo usan /api/dash (lo conectado a una pregunta, al journey, al
   Researcher) y /api/ask (un dashboard entero).
   ============================================================ */

/** Lo que muestran los widgets conectados, en texto, para dárselo a la IA. */
export function contextFrom(list) {
  return list.map((w) => {
    const d = w.data || {};
    let body;
    if (d.kind === 'table') {
      body = [d.columns, ...(d.rows || []).slice(0, 200)].map((r) => r.join(' | ')).join('\n');
    } else if (d.kind === 'user') {
      body = [
        d.sex ? `${d.sex === 'f' ? 'Mujer' : 'Hombre'} de ${d.age} años` : `Tipo de usuario: ${d.persona}`,
        ...(d.context || []).map((f) => (f.kind === 'text' && f.text
          ? `Texto «${f.name}»:\n${f.text.slice(0, 4000)}`
          : `Audio de contexto: ${f.name} (sin transcribir)`)),
      ].join('\n');
    } else if (d.kind === 'timeline') {
      body = d.milestones.map((m) => `${m.date}: ${m.name}`).join('\n');
    } else if (d.kind === 'journey') {
      body = [
        d.goal ? `Objetivo: ${d.goal}` : '', d.persona ? `Usuario: ${d.persona}` : '',
        d.entries?.length ? `Puntos de entrada: ${d.entries.map((e) => `${e.name} (${e.channel})`).join(', ')}` : '',
        ...(d.stages || []).map((x, i) => `${i + 1}. ${x.name} — hace: ${x.doing}; piensa: ${x.thinking}; siente: ${x.emotion} (${x.feeling}); dolor: ${x.pain}; oportunidad: ${x.opportunity}`),
      ].filter(Boolean).join('\n') || 'User journey vacío';
    } else if (d.kind === 'expert') {
      body = `Celebridad: ${d.name} (${d.role}). ${d.prompt}`;
    } else if (d.kind === 'label' || d.kind === 'note') {
      body = d.text;
    } else if (d.kind === 'group') {
      body = `Grupo «${d.title}»`;
    } else if (d.kind === 'finding') {
      body = `${d.summary}\nFuentes: ${(d.sources || []).map((x) => x.url).join(' · ')}`;
    } else if (d.kind === 'pro') {
      body = `${d.name}: ${d.thought || ''}`;
    } else if (d.kind === 'file') {
      body = (d.files || []).map((f) => `Archivo «${f.name}» (${f.type === 'xlsx' ? 'Excel, como CSV' : f.type}${f.rows != null ? `, ${f.rows} filas` : ''}${f.cut ? ', recortado' : ''}):\n\`\`\`\n${f.text}\n\`\`\``).join('\n\n') || 'Archivo vacío';
    } else if (d.kind === 'enaho') {
      body = enahoText(d);
    } else if (d.kind === 'nebula') {
      body = 'Nebulosa de IA (todavía sin contenido)';
    } else if (d.kind === 'chart') {
      body = d.labels.map((l, i) => `${l}: ${d.values[i]}${d.unit ? ` ${d.unit}` : ''}`).join('\n');
    } else {
      body = [d.value, d.detail].filter(Boolean).join('\n');
    }
    return `### ${d.title || d.name || 'Widget'}${d.prompt ? `\n(Pregunta original: ${d.prompt})` : ''}\n${body}`;
  }).join('\n\n');
}

const soles = (v) => (v == null ? '—' : `S/ ${Math.round(v)}`);
const pct = (v) => (v == null ? '—' : `${Math.round(v)}%`);

/** Perfil ENAHO en texto: el cruce elegido, su muestra y los indicadores. */
function enahoText(d) {
  const p = d.profile;
  if (!p) return 'Perfil ENAHO sin calcular todavía.';
  const head = `Perfil de la ENAHO (${p.source || 'INEI'}${p.example ? ', DATOS DE EJEMPLO, no reales' : ''}): ${p.label}. Muestra: ${p.n || 0} personas${p.hh ? ` en ${p.hh} hogares` : ''}${p.n < 30 ? ' (muy baja: solo referencia)' : p.n < 50 ? ' (baja: con cuidado)' : ''}.`;
  const s = p.stats;
  if (!s) return `${head}\nNo hay casos en la encuesta para este cruce.`;
  return [
    head,
    `Hogar: ${s.tam ?? '—'} personas; gasto mensual ${soles(s.gh)} (${soles(s.gpc)} por persona); ingreso mensual ${soles(s.ih)} (${soles(s.ipc)} por persona).`,
    `Trabaja el ${pct(s.ocu)}; ingreso laboral de quienes trabajan: ${soles(s.il)} al mes. Pobreza: ${pct(s.pobre)} (extrema: ${pct(s.pobext)}).`,
    `Educación: ${(p.edu || []).map(([n, v]) => `${n} ${pct(v)}`).join(', ')}; secundaria completa o más: ${pct(s.sec)}.`,
    `Seguro de salud: ${pct(s.seguro)} (SIS ${pct(s.sis)}, EsSalud ${pct(s.essalud)}).`,
    `Usó internet el último mes: ${pct(s.internet)} (a diario: ${pct(s.diario)} de quienes lo usan). Celular propio: ${pct(s.celular)}. Internet en el hogar: ${pct(s.intcasa)} (fijo: ${pct(s.intfija)}).`,
    p.uses?.length ? `Para qué usa internet (de quienes lo usan): ${p.uses.map(([n, v]) => `${n} ${pct(v)}`).join(', ')}.` : '',
    'La ENAHO no mide redes sociales específicas (Facebook, TikTok, WhatsApp…), solo para qué se usa internet.',
  ].filter(Boolean).join('\n');
}
