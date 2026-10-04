/* ============================================================
   dither.js — fondo con tramado para videos e imágenes (WebGL)
   ------------------------------------------------------------
   Pinta la fuente (video, imagen o, si no hay, una nube de color
   generada) en un <canvas> a pantalla completa con:
     · mosaico: celdas de `cell` px que toman el color de su centro
     · trama ordenada (Bayer 4×4) que posteriza cada celda
     · damero: la mitad de las celdas más oscuras (el "tramado")
     · costuras suaves cada 12 celdas, grano que se mueve y viñeta
   Cambiar de fuente no corta: las celdas pasan de una a otra en
   orden de trama (disolución pixelada).
   Sin WebGL devuelve null y quien lo use muestra el video tal cual.
   ============================================================ */

const VERT = `
attribute vec2 p;
void main() { gl_Position = vec4(p, 0.0, 1.0); }`;

const FRAG = `
precision mediump float;
uniform vec2 res;          // px del canvas
uniform float cell;        // px por celda
uniform float time;
uniform float mixT;        // 0 = fuente A · 1 = fuente B
uniform float strength;    // 0…1: cuánto se nota el tramado
uniform float dim;         // 0…1: oscurecer (p. ej. detrás de texto)
uniform sampler2D texA;
uniform sampler2D texB;
uniform vec3 infoA;        // (ancho, alto, ¿hay fuente?) de A
uniform vec3 infoB;

float bayer4(vec2 c) {
  vec2 m = mod(c, 4.0);
  int i = int(m.x + m.y * 4.0);
  float b = 0.0;
  if (i == 0) b = 0.0;  else if (i == 1) b = 8.0;  else if (i == 2) b = 2.0;  else if (i == 3) b = 10.0;
  else if (i == 4) b = 12.0; else if (i == 5) b = 4.0;  else if (i == 6) b = 14.0; else if (i == 7) b = 6.0;
  else if (i == 8) b = 3.0;  else if (i == 9) b = 11.0; else if (i == 10) b = 1.0; else if (i == 11) b = 9.0;
  else if (i == 12) b = 15.0; else if (i == 13) b = 7.0; else if (i == 14) b = 13.0; else b = 5.0;
  return b / 16.0;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

// "cover": la fuente llena el canvas sin deformarse
vec2 cover(vec2 uv, vec3 info) {
  float ra = res.x / res.y, rt = info.x / max(info.y, 1.0);
  vec2 s = ra > rt ? vec2(1.0, rt / ra) : vec2(ra / rt, 1.0);
  return (uv - 0.5) * s + 0.5;
}

// sin fuente: nube cálida que se mueve lento
vec3 cloud(vec2 uv) {
  float t = time * 0.06;
  float a = sin(uv.x * 3.1 + t * 2.0) + sin(uv.y * 2.3 - t * 1.4) + sin((uv.x + uv.y) * 4.0 + t);
  vec3 c1 = vec3(1.0, 0.45, 0.16), c2 = vec3(0.42, 0.07, 0.1), c3 = vec3(0.04, 0.03, 0.04);
  return mix(mix(c3, c2, smoothstep(-0.6, 1.4, a)), c1, smoothstep(1.4, 2.8, a) * 0.85);
}

vec3 sampleSrc(sampler2D tex, vec3 info, vec2 uv) {
  if (info.z < 0.5) return cloud(uv);
  vec2 st = cover(uv, info);
  // uv ya va de arriba hacia abajo, igual que las filas de la textura: no se voltea otra vez
  return texture2D(tex, st).rgb;
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec2 cid = floor(frag / cell);
  vec2 uv = (cid + 0.5) * cell / res;          // centro de la celda
  uv.y = 1.0 - uv.y;

  // disolución pixelada entre A y B
  float th = bayer4(cid) * 0.7 + hash(cid) * 0.3;
  bool useB = mixT > th;
  vec3 c = useB ? sampleSrc(texB, infoB, uv) : sampleSrc(texA, infoA, uv);

  // un poco más de contraste y color
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(l), c, 1.0 + 0.5 * strength);
  c = (c - 0.5) * (1.0 + 0.2 * strength) + 0.5;

  // trama ordenada: posteriza cada celda en 5 niveles
  vec3 q = floor(clamp(c, 0.0, 1.0) * 5.0 + bayer4(cid)) / 5.0;
  c = mix(c, q, 0.55 * strength);

  // damero: una celda sí y otra no se oscurece (más en las zonas oscuras)
  float chk = mod(cid.x + cid.y, 2.0);
  c *= 1.0 - chk * mix(0.7, 0.38, l) * strength;

  // borde fino de cada celda y costuras cada 12 celdas
  vec2 f = fract(frag / cell);
  float edge = step(f.x, 0.08) + step(f.y, 0.08);
  c *= 1.0 - min(edge, 1.0) * 0.18 * strength;
  vec2 big = mod(cid, 12.0);
  float seam = (big.x < 0.5 ? 1.0 : 0.0) + (big.y < 0.5 ? 1.0 : 0.0);
  c *= 1.0 - min(seam, 1.0) * 0.1 * strength;

  // grano y viñeta
  c += (hash(frag + fract(time) * 91.0) - 0.5) * 0.05;
  vec2 v = gl_FragCoord.xy / res - 0.5;
  c *= 1.0 - dot(v, v) * 0.9;
  c *= 1.0 - dim;

  gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

/**
 * @param {HTMLCanvasElement} canvas
 * @param {{ cell?: number, strength?: number, dim?: number, onTaint?: (el) => void }} opts
 *   cell en px CSS · onTaint: la fuente no se puede pintar (otro dominio sin CORS)
 * @returns {null | { setSource(el|null, {instant?}), setDim(n), destroy() }}
 */
export function createDither(canvas, { cell = 11, strength = 1, dim = 0, onTaint = null } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  if (!gl) return null;

  let prog;
  try {
    prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  } catch (err) {
    console.warn('[dither] sin shader:', err.message);
    return null;
  }
  gl.useProgram(prog);

  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

  const U = (n) => gl.getUniformLocation(prog, n);
  const u = {
    res: U('res'), cell: U('cell'), time: U('time'), mixT: U('mixT'), strength: U('strength'), dim: U('dim'),
    texA: U('texA'), texB: U('texB'), infoA: U('infoA'), infoB: U('infoB'),
  };

  const makeTex = () => {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 255]));
    return t;
  };
  // dos "ranuras": la que se ve (A) y la que entra (B)
  const slots = [{ tex: makeTex(), el: null }, { tex: makeTex(), el: null }];
  let cur = 0;              // índice de la ranura A
  let mixT = 0, mixFrom = 0, mixing = false;
  let dimNow = dim, dimTo = dim;
  const t0 = performance.now();
  let raf = 0, alive = true;

  const sizeOf = (el) => (el instanceof HTMLVideoElement ? [el.videoWidth, el.videoHeight] : [el.naturalWidth, el.naturalHeight]);
  const ready = (el) => {
    if (!el) return false;
    if (el instanceof HTMLVideoElement) return el.readyState >= 2 && el.videoWidth > 0;
    return el.complete && el.naturalWidth > 0;
  };

  function upload(slot, unit) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, slot.tex);
    if (!ready(slot.el)) return [1, 1, 0];
    // las imágenes no cambian: se suben una sola vez
    if (slot.el instanceof HTMLVideoElement || !slot.uploaded) {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, slot.el);
        slot.uploaded = true;
      } catch { // p. ej. un video de otro dominio sin CORS
        if (!slot.tainted) { slot.tainted = true; onTaint?.(slot.el); }
        return [1, 1, 0];
      }
    }
    const [w, h] = sizeOf(slot.el);
    return [w, h, 1];
  }

  function resize() {
    const dpr = Math.min(devicePixelRatio || 1, 1.5);
    const w = Math.round(canvas.clientWidth * dpr), h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return dpr;
  }

  function frame(now) {
    if (!alive) return;
    raf = requestAnimationFrame(frame);
    if (document.hidden) return;
    const dpr = resize();
    gl.viewport(0, 0, canvas.width, canvas.height);

    if (mixing) {
      mixT = Math.min(1, (now - mixFrom) / 900);
      if (mixT >= 1) { // B pasa a ser A
        mixing = false; mixT = 0;
        slots[cur].el = null; slots[cur].uploaded = false;
        cur = 1 - cur;
      }
    }
    dimNow += (dimTo - dimNow) * 0.08;

    const a = upload(slots[cur], 0);
    const b = mixing ? upload(slots[1 - cur], 1) : [1, 1, 0];
    gl.uniform1i(u.texA, 0);
    gl.uniform1i(u.texB, 1);
    gl.uniform3f(u.infoA, ...a);
    gl.uniform3f(u.infoB, ...b);
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.cell, Math.max(4, cell * dpr));
    gl.uniform1f(u.time, (now - t0) / 1000);
    gl.uniform1f(u.mixT, mixing ? mixT : 0);
    gl.uniform1f(u.strength, strength);
    gl.uniform1f(u.dim, dimNow);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }
  raf = requestAnimationFrame(frame);

  return {
    /** Nueva fuente (video/imagen/null = nube). Entra con disolución pixelada. */
    setSource(el, { instant = false } = {}) {
      if (instant || (!slots[cur].el && !mixing && slots[cur].first !== false)) {
        slots[cur].el = el; slots[cur].uploaded = false; slots[cur].first = false; slots[cur].tainted = false;
        return;
      }
      if (mixing) { // ya había una entrando: esa queda como la actual
        slots[cur].el = null; cur = 1 - cur;
      }
      const next = slots[1 - cur];
      next.el = el; next.uploaded = false; next.tainted = false;
      mixing = true; mixFrom = performance.now(); mixT = 0;
    },
    setDim(n) { dimTo = n; },
    destroy() { alive = false; cancelAnimationFrame(raf); },
  };
}
