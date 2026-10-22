/* ============================================================
   persona.js — widget "usuario"
   ------------------------------------------------------------
   Un usuario es { kind: 'user', name, sex: 'm'|'f', age: 0–90, context }.
   El avatar es un SVG de busto que se arma con el sexo y la edad: al
   subir la edad pasa de bebé a niño, joven, adulto, mayor y anciano, y
   el pelo se va poniendo gris de a poco. Mismo estilo que las
   ilustraciones de referencia (planas, ojos grandes, mejillas rosadas).

   context: [{ kind: 'text'|'audio', name, size, text? }] — los textos se
   guardan (le sirven a la IA); los audios por ahora solo nombre y tamaño.

   Los usuarios viejos ({ persona: 'papa', … }) se leen con fromLegacy().
   ============================================================ */

export const AGE_MAX = 90;
export const MAX_CONTEXT = 10;
export const MAX_TEXT = 20_000; // caracteres por texto de contexto

const NAMES = {
  m: ['Mateo', 'Santiago', 'Diego', 'Lucas', 'Gabriel', 'Andrés', 'Javier', 'Tomás', 'Carlos', 'Luis', 'Martín', 'Hugo'],
  f: ['Valentina', 'Camila', 'Lucía', 'Sofía', 'Isabella', 'Mariana', 'Daniela', 'Carmen', 'Rosa', 'Elena', 'Julia', 'Paula'],
};

/* los de antes: tipo fijo → sexo y edad parecidos */
const LEGACY = {
  default: { name: 'Usuario', sex: 'm', age: 30 },
  joven: { name: 'Joven', sex: 'm', age: 22 },
  papa: { name: 'Papá divorciado', sex: 'm', age: 42 },
  mama: { name: 'Mamá soltera', sex: 'f', age: 36 },
  familia: { name: 'Familia feliz', sex: 'f', age: 38 },
  nido: { name: 'Nido vacío', sex: 'f', age: 58 },
  jubilado: { name: 'Jubilado', sex: 'm', age: 70 },
};

/** Usuario en el formato nuevo (convierte los de tipo fijo). */
export function fromLegacy(d) {
  if (d?.sex) return d;
  const l = LEGACY[d?.persona] || LEGACY.default;
  return { kind: 'user', name: l.name, sex: l.sex, age: l.age, context: (d?.context || []).map((f) => ({ kind: 'audio', ...f })) };
}

const pick = (list) => list[Math.floor(Math.random() * list.length)];

/** Usuario al azar: sexo, edad y nombre. Conserva el contexto si se le pasa. */
export function randomUser(context = []) {
  const sex = Math.random() < 0.5 ? 'm' : 'f';
  // más adultos que bebés: la mayoría de los usuarios de un proyecto lo son
  const age = Math.random() < 0.15 ? Math.floor(Math.random() * 13) : 14 + Math.floor(Math.random() * (AGE_MAX - 14));
  return { kind: 'user', name: pick(NAMES[sex]), sex, age, context };
}

export const defaultUser = () => randomUser();

/** Al cambiar de sexo: si el nombre era uno de la lista del otro, uno de la del nuevo. */
export function nameForSex(name, sex) {
  const other = NAMES[sex === 'f' ? 'm' : 'f'];
  return other.includes(name) ? pick(NAMES[sex === 'f' ? 'f' : 'm']) : name;
}

export const userSize = () => ({ w: 5, h: 6 });

/** "1 año", "34 años", "Recién nacido". */
export function ageLabel(age) {
  if (age <= 0) return 'Recién nacido';
  return `${age} año${age === 1 ? '' : 's'}`;
}

/** Bebé, niño, joven, adulto, mayor, anciano (en masculino o femenino). */
export function stageOf(age) {
  if (age < 3) return 'baby';
  if (age < 13) return 'child';
  if (age < 26) return 'young';
  if (age < 46) return 'adult';
  if (age < 66) return 'older';
  return 'elder';
}

const STAGE_LABEL = {
  m: { baby: 'Bebé', child: 'Niño', young: 'Joven', adult: 'Adulto', older: 'Mayor', elder: 'Anciano' },
  f: { baby: 'Bebé', child: 'Niña', young: 'Joven', adult: 'Adulta', older: 'Mayor', elder: 'Anciana' },
};
export const stageLabel = (sex, age) => STAGE_LABEL[sex === 'f' ? 'f' : 'm'][stageOf(age)];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** 12 KB · 1,4 MB */
export function fileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1048576).toLocaleString('es', { maximumFractionDigits: 1 })} MB`;
}

/* ============================================================
   Avatar (SVG 200×200, de busto para arriba)
   ============================================================ */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`;
}
const darker = (c, t = 0.18) => mix(c, '#000000', t);

const SKIN = '#f6c9a7';
const SKIN_SHADE = '#eab08c';

/** Color del pelo: el de su edad, y canas de a poco desde los 42. */
function hairColor(sex, age) {
  const st = stageOf(age);
  const base = st === 'baby' ? '#c98a5e' : st === 'child' ? (sex === 'f' ? '#5a3524' : '#9b5e36') : '#4b2c20';
  const g = clamp((age - 42) / 38, 0, 1);
  return g < 0.5 ? mix(base, '#8f8b8c', g * 2) : mix('#8f8b8c', '#ebe8e4', (g - 0.5) * 2);
}

/* proporciones: los chicos tienen la cabeza más grande y los hombros más angostos */
function shape(sex, st) {
  if (st === 'baby') return { hx: 46, hy: 44, cy: 94, ty: 142, sw: 50, r: 34, eye: 6.6 };
  if (st === 'child') return { hx: 42, hy: 45, cy: 88, ty: 142, sw: 50, r: 30, eye: 6.2 };
  return { hx: 37, hy: 43, cy: 84, ty: 144, sw: sex === 'f' ? 56 : 62, r: 28, eye: 5.6 };
}

/* ropa: [color principal, color de adentro o null, estilo] — como en la referencia */
const CLOTHES = {
  m: {
    baby: ['#bcd8f5', null, 'bib'],
    child: ['#2a5bb8', null, 'hoodie'],
    young: ['#2a5bc4', '#fbf7f2', 'open'],
    adult: ['#2f3640', null, 'crew'],
    older: ['#6f8a65', null, 'shirt'],
    elder: ['#6e4532', '#f1e3cf', 'sweater'],
  },
  f: {
    baby: ['#f6a3b7', null, 'frill'],
    child: ['#fbefe6', '#e3475f', 'overall'],
    young: ['#b29bd6', null, 'crew'],
    adult: ['#f07f6a', '#f8ebde', 'open'],
    older: ['#a993cf', '#d9ccf1', 'open'],
    elder: ['#b4848a', '#f3e5d3', 'cardigan'],
  },
};

function torso(s, sex, st) {
  const { ty, sw, r } = s;
  const [main, inner, style] = CLOTHES[sex][st];
  const L = 100 - sw, R = 100 + sw;
  const body = `M${L} 200V${ty + r}Q${L} ${ty} ${L + r} ${ty}H${R - r}Q${R} ${ty} ${R} ${ty + r}V200Z`;
  let out = `<path d="${body}" fill="${main}"/>`;
  // sombra suave bajo el cuello
  out += `<ellipse cx="100" cy="${ty + 4}" rx="${sw * 0.42}" ry="7" fill="${darker(main, 0.12)}"/>`;
  const neckHole = (rx, fill) => `<ellipse cx="100" cy="${ty + 1}" rx="${rx}" ry="${rx * 0.55}" fill="${fill}"/>`;

  if (style === 'open' || style === 'cardigan') {
    out += `<path d="M${100 - 15} ${ty}H${100 + 15}V200H${100 - 15}Z" fill="${inner}"/>`;
    // solapas
    out += `<path d="M${100 - 15} ${ty}L${100 - 26} ${ty}L${100 - 6} ${ty + 34}L${100 - 15} 200Z" fill="${darker(main, 0.1)}"/>`;
    out += `<path d="M${100 + 15} ${ty}L${100 + 26} ${ty}L${100 + 6} ${ty + 34}L${100 + 15} 200Z" fill="${darker(main, 0.1)}"/>`;
    if (style === 'cardigan') {
      for (const y of [ty + 34, ty + 46]) out += `<circle cx="${100 + 18}" cy="${y}" r="2" fill="${darker(main, 0.3)}"/>`;
    }
  } else if (style === 'shirt') {
    out += `<path d="M100 ${ty + 2}L${100 - 16} ${ty - 2}L${100 - 10} ${ty + 16}Z" fill="${darker(main, 0.14)}"/>`;
    out += `<path d="M100 ${ty + 2}L${100 + 16} ${ty - 2}L${100 + 10} ${ty + 16}Z" fill="${darker(main, 0.14)}"/>`;
    out += `<path d="M100 ${ty + 6}V200" stroke="${darker(main, 0.2)}" stroke-width="1.6"/>`;
    out += `<rect x="${100 + 20}" y="${ty + 22}" width="16" height="14" rx="2" fill="none" stroke="${darker(main, 0.2)}" stroke-width="1.6"/>`;
  } else if (style === 'sweater') {
    out += `<path d="M${100 - 16} ${ty - 2}L100 ${ty + 14}L${100 + 16} ${ty - 2}L${100 + 10} ${ty - 6}H${100 - 10}Z" fill="${inner}"/>`;
    out += `<path d="M${100 - 22} ${ty + 2}Q100 ${ty + 26} ${100 + 22} ${ty + 2}" fill="none" stroke="${darker(main, 0.22)}" stroke-width="3"/>`;
  } else if (style === 'hoodie') {
    out += `<path d="M${100 - 30} ${ty + 2}Q100 ${ty + 30} ${100 + 30} ${ty + 2}" fill="none" stroke="${darker(main, 0.22)}" stroke-width="7" stroke-linecap="round"/>`;
    out += `<path d="M${100 - 8} ${ty + 14}V${ty + 34}M${100 + 8} ${ty + 14}V${ty + 34}" stroke="#f4f4f4" stroke-width="2.4" stroke-linecap="round"/>`;
  } else if (style === 'overall') {
    out += `<path d="M${100 - 24} ${ty + 20}H${100 + 24}V200H${100 - 24}Z" fill="${inner}"/>`;
    out += `<path d="M${100 - 24} ${ty + 22}L${100 - 30} ${ty}M${100 + 24} ${ty + 22}L${100 + 30} ${ty}" stroke="${inner}" stroke-width="7" stroke-linecap="round"/>`;
    out += `<circle cx="${100 - 16}" cy="${ty + 28}" r="2.6" fill="#f4f4f4"/><circle cx="${100 + 16}" cy="${ty + 28}" r="2.6" fill="#f4f4f4"/>`;
  } else if (style === 'bib') {
    out += `<ellipse cx="100" cy="${ty + 22}" rx="22" ry="18" fill="#fbfbfb"/>`;
    // osito del babero
    out += `<circle cx="93" cy="${ty + 18}" r="3" fill="#9cc2ea"/><circle cx="107" cy="${ty + 18}" r="3" fill="#9cc2ea"/><circle cx="100" cy="${ty + 24}" r="6.5" fill="#9cc2ea"/>`;
  } else if (style === 'frill') {
    for (const dx of [-14, 0, 14]) out += `<circle cx="${100 + dx}" cy="${ty + 6}" r="8" fill="#fff5f1"/>`;
  } else {
    out += `<path d="M${100 - 15} ${ty + 1}Q100 ${ty + 14} ${100 + 15} ${ty + 1}" fill="none" stroke="${darker(main, 0.25)}" stroke-width="3" stroke-linecap="round"/>`;
  }
  return { out, neckHole: style === 'bib' || style === 'frill' ? '' : neckHole(13, SKIN_SHADE) };
}

/* contorno de la cara: arriba sigue la línea del flequillo (fy) */
function faceWithFringe(s, top) {
  const { hx, hy, cy } = s;
  const L = 100 - hx, y0 = cy + 2;
  return `M${L} ${y0}${top}A${hx} ${hy} 0 0 1 ${L} ${y0}Z`;
}
const fringeFlat = (s, fy) => `C${100 - s.hx} ${fy - 4} ${100 - s.hx * 0.6} ${fy} 100 ${fy}C${100 + s.hx * 0.6} ${fy} ${100 + s.hx} ${fy - 4} ${100 + s.hx} ${s.cy + 2}`;
const fringeSide = (s, fy) => `C${100 - s.hx} ${fy + 8} ${100 - s.hx * 0.5} ${fy + 10} ${100 - 4} ${fy + 2}C${100 + s.hx * 0.3} ${fy - 8} ${100 + s.hx} ${fy - 6} ${100 + s.hx} ${s.cy + 2}`;
const fringeCenter = (s, fy) => `C${100 - s.hx} ${fy + 14} ${100 - s.hx * 0.4} ${fy + 2} 100 ${fy - 2}C${100 + s.hx * 0.4} ${fy + 2} ${100 + s.hx} ${fy + 14} ${100 + s.hx} ${s.cy + 2}`;

/** Pelo de atrás (va detrás del cuerpo) y pelo de adelante + forma de la cara. */
function hair(s, sex, st, color) {
  const { hx, hy, cy } = s;
  const top = cy - hy;
  const fullFace = `<ellipse cx="100" cy="${cy}" rx="${hx}" ry="${hy}" fill="${SKIN}"/>`;
  const cap = (ex = 4, ey = 4, dy = -5) => `<ellipse cx="100" cy="${cy + dy}" rx="${hx + ex}" ry="${hy + ey}" fill="${color}"/>`;
  const face = (fr) => `<path d="${faceWithFringe(s, fr)}" fill="${SKIN}"/>`;
  let back = '', front = '', over = '';

  if (st === 'baby') {
    front = fullFace;
    over = `<path d="M${100 - 10} ${top + 6}C${100 - 6} ${top - 8} ${100 + 10} ${top - 8} ${100 + 8} ${top + 4}C${100 + 4} ${top - 2} ${100 - 2} ${top} 100 ${top + 8}Z" fill="${color}"/>`;
    if (sex === 'f') {
      const bx = 100 - 16, by = top + 4;
      over += `<path d="M${bx} ${by}L${bx - 14} ${by - 9}V${by + 9}Z M${bx} ${by}L${bx + 14} ${by - 9}V${by + 9}Z" fill="#f58aa6" stroke="#f58aa6" stroke-width="3" stroke-linejoin="round"/><circle cx="${bx}" cy="${by}" r="4.5" fill="#ef6f92"/>`;
    }
    return { back, front, over };
  }

  if (sex === 'm') {
    if (st === 'elder') {
      front = fullFace;
      over = `<path d="M${100 - hx - 2} ${cy - 2}C${100 - hx - 4} ${cy - 22} ${100 - hx + 8} ${cy - 32} ${100 - hx + 14} ${cy - 30}C${100 - hx + 8} ${cy - 18} ${100 - hx + 6} ${cy - 8} ${100 - hx + 4} ${cy + 2}Z" fill="${color}"/>`
        + `<path d="M${100 + hx + 2} ${cy - 2}C${100 + hx + 4} ${cy - 22} ${100 + hx - 8} ${cy - 32} ${100 + hx - 14} ${cy - 30}C${100 + hx - 8} ${cy - 18} ${100 + hx - 6} ${cy - 8} ${100 + hx - 4} ${cy + 2}Z" fill="${color}"/>`
        + `<path d="M${100 - 16} ${top + 4}Q100 ${top - 4} ${100 + 16} ${top + 4}" fill="none" stroke="${color}" stroke-width="5" stroke-linecap="round"/>`;
    } else {
      const fy = { child: cy - hy * 0.3, young: cy - hy * 0.38, adult: cy - hy * 0.45, older: cy - hy * 0.55 }[st];
      front = cap(st === 'child' ? 5 : 3, st === 'young' ? 6 : 3) + face(fringeSide(s, fy));
      if (st === 'young' || st === 'child') {
        // mechones arriba
        over = `<path d="M${100 - 22} ${top + 2}Q${100 - 14} ${top - 14} ${100 - 2} ${top - 2}Q${100 + 6} ${top - 16} ${100 + 18} ${top}Q${100 + 28} ${top - 8} ${100 + 30} ${top + 8}Z" fill="${color}"/>`;
      }
    }
  } else {
    if (st === 'child') {
      front = cap(4, 4) + face(fringeFlat(s, cy - hy * 0.32));
      for (const k of [-1, 1]) {
        back += `<circle cx="${100 + k * (hx + 13)}" cy="${cy - 2}" r="14" fill="${color}"/>`;
        over += `<circle cx="${100 + k * (hx + 1)}" cy="${cy - 10}" r="4" fill="#ef4e6b"/>`;
      }
    } else if (st === 'elder') {
      // rulos cortos
      const puffs = [[-30, -30], [-14, -40], [4, -42], [20, -38], [32, -26], [-38, -12], [40, -10], [-40, 6], [42, 8]];
      back = puffs.map(([x, y]) => `<circle cx="${100 + x}" cy="${cy + y}" r="15" fill="${color}"/>`).join('');
      front = cap(4, 4) + face(fringeSide(s, cy - hy * 0.5));
    } else {
      const fy = cy - hy * (st === 'older' ? 0.48 : 0.42);
      const len = { young: 76, adult: 56, older: 28 }[st];
      const w = hx + (st === 'older' ? 10 : 14);
      const bottom = cy + hy * 0.4 + len;
      back = `<path d="M${100 - w} ${cy}C${100 - w} ${top - 6} ${100 + w} ${top - 6} ${100 + w} ${cy}V${bottom - 10}Q${100 + w - 8} ${bottom + 4} ${100 + w - 22} ${bottom - 4}Q100 ${bottom + 6} ${100 - w + 22} ${bottom - 4}Q${100 - w + 8} ${bottom + 4} ${100 - w} ${bottom - 10}Z" fill="${color}"/>`;
      front = cap(5, 4) + face(st === 'older' ? fringeSide(s, fy) : fringeCenter(s, fy));
      if (st !== 'older') {
        // mechones a los lados de la cara
        for (const k of [-1, 1]) {
          const x = 100 + k * (hx + 1);
          over += `<path d="M${x} ${cy - hy * 0.4}C${x + k * 10} ${cy} ${x + k * 6} ${cy + hy * 0.6} ${x - k * 4} ${cy + hy * 0.9}C${x - k * 2} ${cy + hy * 0.4} ${x - k * 6} ${cy} ${x - k * 7} ${cy - hy * 0.3}Z" fill="${color}"/>`;
        }
      }
    }
  }
  return { back, front, over };
}

function face(s, sex, st, age, hairC) {
  const { hx, hy, cy, eye } = s;
  const ey = cy + hy * 0.1, ex = hx * 0.42;
  let out = '';
  // mejillas
  for (const k of [-1, 1]) out += `<ellipse cx="${100 + k * hx * 0.6}" cy="${ey + 13}" rx="7.5" ry="4.5" fill="#f4a09c" opacity=".5"/>`;
  // ojos
  for (const k of [-1, 1]) {
    out += `<circle cx="${100 + k * ex}" cy="${ey}" r="${eye}" fill="#1d1d22"/><circle cx="${100 + k * ex + eye * 0.32}" cy="${ey - eye * 0.36}" r="${eye * 0.3}" fill="#fff"/>`;
  }
  // cejas (desde niño)
  if (st !== 'baby') {
    const bc = darker(hairC, 0.15);
    for (const k of [-1, 1]) out += `<path d="M${100 + k * (ex - 6)} ${ey - 11}Q${100 + k * ex} ${ey - 14} ${100 + k * (ex + 6)} ${ey - 11}" fill="none" stroke="${bc}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  // arrugas (desde los 55)
  if (age >= 55) {
    for (const k of [-1, 1]) out += `<path d="M${100 + k * (ex + eye + 3)} ${ey - 2}l${k * 4} -2M${100 + k * (ex + eye + 3)} ${ey + 2}l${k * 4} 2" stroke="${SKIN_SHADE}" stroke-width="1.5" stroke-linecap="round"/>`;
    if (age >= 70) out += `<path d="M${100 - 10} ${cy - hy * 0.5}q10 -3 20 0" fill="none" stroke="${SKIN_SHADE}" stroke-width="1.5" stroke-linecap="round"/>`;
  }
  // boca: el bebé se ríe con la boca abierta
  const my = cy + hy * 0.5;
  if (st === 'baby') {
    out += `<path d="M${100 - 9} ${my - 3}Q100 ${my + 12} ${100 + 9} ${my - 3}Z" fill="#b23a48"/><ellipse cx="100" cy="${my + 3.5}" rx="4.5" ry="2.6" fill="#f07c8a"/>`;
  } else {
    out += `<path d="M${100 - 6} ${my}Q100 ${my + 5} ${100 + 6} ${my}" fill="none" stroke="#c0605a" stroke-width="2.2" stroke-linecap="round"/>`;
  }
  // barba: hombres de 26 a 55
  if (sex === 'm' && age >= 26 && age < 56) {
    const bx = hx * 0.92, top = cy + hy * 0.18;
    out += `<path d="M${100 - bx} ${top}C${100 - bx} ${cy + hy + 8} ${100 + bx} ${cy + hy + 8} ${100 + bx} ${top}C${100 + bx * 0.6} ${top + 8} ${100 + 12} ${my - 8} 100 ${my - 7}C${100 - 12} ${my - 8} ${100 - bx * 0.6} ${top + 8} ${100 - bx} ${top}Z" fill="${hairC}"/>`;
    out += `<path d="M${100 - 7} ${my + 1}Q100 ${my + 6} ${100 + 7} ${my + 1}" fill="#c0605a"/>`;
  }
  // lentes: desde los 66
  if (age >= 66) {
    out += `<g fill="none" stroke="#2a1d17" stroke-width="2.4"><circle cx="${100 - ex}" cy="${ey}" r="10.5"/><circle cx="${100 + ex}" cy="${ey}" r="10.5"/><path d="M${100 - ex + 10.5} ${ey}Q100 ${ey - 4} ${100 + ex - 10.5} ${ey}M${100 - ex - 10.5} ${ey - 2}L${100 - hx} ${ey - 4}M${100 + ex + 10.5} ${ey - 2}L${100 + hx} ${ey - 4}"/></g>`;
  }
  return out;
}

/** SVG del avatar. sex 'm'|'f', age 0–90. */
export function avatarSVG({ sex = 'm', age = 30 } = {}) {
  sex = sex === 'f' ? 'f' : 'm';
  age = clamp(Math.round(Number(age) || 0), 0, AGE_MAX);
  const st = stageOf(age);
  const s = shape(sex, st);
  const hc = hairColor(sex, age);
  const h = hair(s, sex, st, hc);
  const t = torso(s, sex, st);
  const ears = [-1, 1].map((k) => `<circle cx="${100 + k * s.hx}" cy="${s.cy + 6}" r="${st === 'baby' ? 9 : 8}" fill="${SKIN}"/><circle cx="${100 + k * s.hx}" cy="${s.cy + 6}" r="4" fill="${SKIN_SHADE}"/>`).join('');
  const neck = `<rect x="88" y="${s.cy + s.hy - 14}" width="24" height="${s.ty - (s.cy + s.hy - 14) + 2}" fill="${SKIN_SHADE}"/>`;
  return `<svg class="avatar" viewBox="0 0 200 200" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    ${h.back}${t.out}${t.neckHole}${st === 'baby' ? '' : neck}${ears}${h.front}${face(s, sex, st, age, hc)}${h.over}
  </svg>`;
}

/* ============================================================
   Widget
   ============================================================ */

export function userHTML(raw) {
  const d = fromLegacy(raw);
  const n = d.context?.length || 0;
  return `
    <div class="wuser" role="img" aria-label="${esc(d.name)}, ${esc(ageLabel(d.age))}${n ? `, ${n} de contexto` : ''}">
      <span class="wuser-av">${avatarSVG(d)}</span>
      <b>${esc(d.name)}</b>
      <small>${esc(stageLabel(d.sex, d.age))} · ${esc(ageLabel(d.age))}</small>
      ${n ? `<span class="wuser-ctx" title="${n} de contexto">${n}</span>` : ''}
    </div>`;
}
