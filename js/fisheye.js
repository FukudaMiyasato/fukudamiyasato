/* ============================================================
   fisheye.js — el ojo de pez del lienzo
   ------------------------------------------------------------
   Lo usan el dashboard y la vista previa de Configuración, así los
   dos se ven igual. Los widgets crecen, se separan y se inclinan en 3D
   (lensTransform); los puntos se agrandan y se separan (drawDots).
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

/* Grados que se inclina un widget en el borde de la pantalla por cada
   unidad de intensidad: con la normal (0.07) son ~14°. */
const TILT_PER_AMOUNT = 200;
const PERSPECTIVE = 900; // px: más chico = perspectiva más marcada

/** Transform de algo cuyo centro en pantalla es (cx, cy), como si estuviera
    pegado a una superficie curva vista con lente:
    · crece hacia el centro y se corre hacia afuera en la misma proporción
      (así los vecinos no se enciman);
    · se inclina en 3D: de frente al centro y cada vez más de costado hacia
      los bordes. Con intensidad negativa, al revés (superficie cóncava). */
export function lensTransform(cx, cy, w, h, amount) {
  const s = zoomAt(lens(clamp(cx, -w, 2 * w), clamp(cy, -h, 2 * h), w, h), amount);
  const dx = (cx - w / 2) * (s - 1), dy = (cy - h / 2) * (s - 1);
  const nx = clamp((cx - w / 2) / (w / 2), -1.4, 1.4), ny = clamp((cy - h / 2) / (h / 2), -1.4, 1.4);
  const tilt = amount * TILT_PER_AMOUNT;
  const ry = nx * tilt, rx = -ny * tilt;
  return `perspective(${PERSPECTIVE}px) translate(${dx.toFixed(1)}px, ${dy.toFixed(1)}px) `
    + `rotateY(${ry.toFixed(2)}deg) rotateX(${rx.toFixed(2)}deg) scale(${s.toFixed(4)})`;
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
