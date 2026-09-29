/* ============================================================
   fisheye.js — el ojo de pez del lienzo
   ------------------------------------------------------------
   Lo usan el dashboard y la vista previa de Configuración, así los
   dos se ven igual. `amount` es la intensidad en fracción:
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

/** Transform de algo cuyo centro en pantalla es (cx, cy): crece y se corre
    hacia afuera en la misma proporción, así los vecinos no se enciman. */
export function lensTransform(cx, cy, w, h, amount) {
  const s = zoomAt(lens(clamp(cx, -w, 2 * w), clamp(cy, -h, 2 * h), w, h), amount);
  const dx = (cx - w / 2) * (s - 1), dy = (cy - h / 2) * (s - 1);
  return `translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) scale(${s.toFixed(4)})`;
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
