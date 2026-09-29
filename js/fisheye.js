/* ============================================================
   fisheye.js — el ojo de pez del lienzo
   ------------------------------------------------------------
   Lo usan el dashboard y la vista previa de Configuración, así los
   dos se ven igual. Una sola función define la lente, en coordenadas
   de pantalla (no depende de por dónde vaya el lienzo):

     warp(p) = centro + (p − centro) · zoomAt(lens(p))

   · Los puntos del fondo (canvas) se dibujan en warp(p) — drawDots.
   · El HTML de encima (tarjetas, tablas, líneas) se deforma con un
     filtro SVG feDisplacementMap cuyo mapa es la inversa de warp
     (buildLensFilter): cada píxel que se ve en q muestra lo que hay en
     unwarp(q). Es una deformación no lineal real: los bordes rectos se
     curvan igual que la rejilla, no son rectángulos inclinados.
   · El filtro no mueve dónde el navegador detecta los clics: para eso
     está unwarp(), que pasa de lo que ves a dónde está el elemento.

   `amount` es la intensidad en fracción:
     0.07  → lo del centro 7% más grande y lo de los bordes 7% más chico
     0     → sin efecto
     -0.07 → al revés: el centro se achica y los bordes crecen
   ============================================================ */

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const DEFAULT = 0.07; // la intensidad "normal"; los puntos se calibran con ella

/** 1 al centro de la pantalla → 0 en las esquinas. */
export function lens(sx, sy, w, h) {
  const dx = (sx - w / 2) / (w / 2), dy = (sy - h / 2) / (h / 2);
  return clamp(1 - (dx * dx + dy * dy) / 2, 0, 1);
}

/** Escala en un punto de lens() = f. */
export const zoomAt = (f, amount) => 1 - amount + 2 * amount * f;

/** Hacia dónde se ve un punto p de la pantalla (x, y en px) con la lente. */
export function warp(x, y, w, h, amount) {
  const s = zoomAt(lens(x, y, w, h), amount);
  return { x: w / 2 + (x - w / 2) * s, y: h / 2 + (y - h / 2) * s };
}

/** Inversa de warp: qué punto de la pantalla "real" se ve en q.
    La lente es radial: p está sobre el rayo centro→q, p = centro + t·(q − centro),
    con t·zoomAt(lens(p)) = 1. Se toma la primera raíz de t (barrido + bisección):
    siempre converge, incluso en las esquinas con la intensidad máxima. */
export function unwarp(qx, qy, w, h, amount) {
  const cx = w / 2, cy = h / 2, vx = qx - cx, vy = qy - cy;
  if (!amount || (!vx && !vy)) return { x: qx, y: qy };
  const g = (t) => t * zoomAt(lens(cx + t * vx, cy + t * vy, w, h), amount) - 1;
  let lo = 0, hi = 0, best = 0, bestG = -Infinity;
  for (let t = 0.05; t <= 3; t += 0.05) {
    const v = g(t);
    if (v >= 0) { lo = t - 0.05; hi = t; break; }
    if (v > bestG) { bestG = v; best = t; }
  }
  // sin raíz: ese punto quedó "doblado" fuera de la lente; se usa el borde
  if (!hi) return { x: cx + best * vx, y: cy + best * vy };
  for (let i = 0; i < 18; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) >= 0) hi = mid; else lo = mid;
  }
  const t = (lo + hi) / 2;
  return { x: cx + t * vx, y: cy + t * vy };
}

/* El mapa se calcula a menor resolución y el filtro lo estira (el campo es
   suave, así que no se nota). 8 bits por canal: con la intensidad máxima el
   paso queda por debajo de 1 px. */
const MAP_STEP = 3;

/** Arma (o actualiza) el filtro <filter> para una capa de w×h px con esa
    intensidad. Devuelve false si no hay nada que deformar (amount ≈ 0). */
export function buildLensFilter(filter, w, h, amount) {
  if (!w || !h || Math.abs(amount) < 0.001) return false;
  const mw = Math.max(2, Math.ceil(w / MAP_STEP)), mh = Math.max(2, Math.ceil(h / MAP_STEP));
  const dx = new Float32Array(mw * mh), dy = new Float32Array(mw * mh);
  let max = 0;
  for (let j = 0; j < mh; j++) {
    for (let i = 0; i < mw; i++) {
      const qx = (i + 0.5) * (w / mw), qy = (j + 0.5) * (h / mh);
      const p = unwarp(qx, qy, w, h, amount);
      const k = j * mw + i;
      dx[k] = p.x - qx;
      dy[k] = p.y - qy;
      max = Math.max(max, Math.abs(dx[k]), Math.abs(dy[k]));
    }
  }
  if (max < 0.5) return false;

  // feDisplacementMap: lo que se ve en (x, y) sale de (x + scale·(R−½), y + scale·(G−½))
  const scale = 2 * max + 2;
  const c = document.createElement('canvas');
  c.width = mw;
  c.height = mh;
  const g = c.getContext('2d');
  const img = g.createImageData(mw, mh);
  for (let k = 0; k < mw * mh; k++) {
    img.data[k * 4] = Math.round((dx[k] / scale + 0.5) * 255);
    img.data[k * 4 + 1] = Math.round((dy[k] / scale + 0.5) * 255);
    img.data[k * 4 + 2] = 128;
    img.data[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);

  const NS = 'http://www.w3.org/2000/svg';
  filter.setAttribute('filterUnits', 'userSpaceOnUse');
  filter.setAttribute('primitiveUnits', 'userSpaceOnUse');
  filter.setAttribute('color-interpolation-filters', 'sRGB'); // el mapa se lee tal cual
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h })) filter.setAttribute(k, v);
  let map = filter.querySelector('feImage'), disp = filter.querySelector('feDisplacementMap');
  if (!map) {
    map = document.createElementNS(NS, 'feImage');
    map.setAttribute('result', 'lensmap');
    map.setAttribute('preserveAspectRatio', 'none');
    disp = document.createElementNS(NS, 'feDisplacementMap');
    disp.setAttribute('in', 'SourceGraphic');
    disp.setAttribute('in2', 'lensmap');
    disp.setAttribute('xChannelSelector', 'R');
    disp.setAttribute('yChannelSelector', 'G');
    filter.append(map, disp);
  }
  for (const [k, v] of Object.entries({ x: 0, y: 0, width: w, height: h })) map.setAttribute(k, v);
  const url = c.toDataURL('image/png');
  map.setAttribute('href', url);
  map.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', url); // Safari
  disp.setAttribute('scale', scale.toFixed(2));
  return true;
}

/** Rejilla de puntos con la lente, en un canvas de w×h (px CSS). */
export function drawDots(ctx, w, h, { panX = 0, panY = 0, grid = 32, amount = DEFAULT } = {}) {
  const t = amount / DEFAULT; // 1 = intensidad normal, 0 = puntos parejos
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#e8e8ee';
  const ox = ((panX % grid) + grid) % grid, oy = ((panY % grid) + grid) % grid;
  for (let y = oy - grid; y <= h + grid; y += grid) {
    for (let x = ox - grid; x <= w + grid; x += grid) {
      const f = lens(x, y, w, h);
      const s = zoomAt(f, amount);
      const px = w / 2 + (x - w / 2) * s, py = h / 2 + (y - h / 2) * s;
      ctx.globalAlpha = clamp(0.17 + 0.2 * (f - 0.5) * t, 0.03, 0.6);
      ctx.beginPath();
      ctx.arc(px, py, clamp(1.15 + 0.7 * (f - 0.5) * t, 0.4, 3), 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
}

/** Ajusta el canvas a su tamaño en pantalla (nítido en retina) y devuelve { w, h }. */
export function fitCanvas(canvas) {
  const w = canvas.clientWidth, h = canvas.clientHeight, dpr = devicePixelRatio || 1;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  canvas.getContext('2d').setTransform(dpr, 0, 0, dpr, 0, 0);
  return { w, h };
}
