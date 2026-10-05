/* ============================================================
   home.js — portada: portafolio con video de fondo
   ------------------------------------------------------------
   Los proyectos salen de /api/site?t=portfolio (el amo supremo los
   carga en el panel → Portafolio). Cada uno se muestra N segundos
   (general o propio del proyecto) y pasa al siguiente:
     · el fondo cambia con disolución pixelada (js/dither.js)
     · la tarjeta cambia con un fundido en cascada
     · la línea entre el número y la categoría es la barra de tiempo
   Se pausa con el mouse (o el foco) sobre la tarjeta, con la pestaña
   oculta o con la barra espaciadora. Flechas ← → o deslizar: cambiar.
   Si no hay proyectos (o la API no responde) se ve el de ejemplo.
   Videos de YouTube: WebGL no puede leerlos (iframe de otro dominio),
   así que se ven con su reproductor de fondo y el damero en CSS
   encima (capa #stage-yt).
   ============================================================ */

import { createDither } from './dither.js';
import { DEMO_PROJECTS, PROJECT_DEFAULTS, DEFAULT_DURATION, shortDate } from './site-defaults.js';
import { youtubeId, youtubeEmbed, youtubeCommand } from './youtube.js';

const $ = (id) => document.getElementById(id);
const card = $('pcard');
const pad2 = (n) => String(n).padStart(2, '0');

let projects = [];
let duration = DEFAULT_DURATION;
let index = 0;
let elapsed = 0;          // ms del proyecto actual
let userPaused = false;
let hovering = false;
let sound = false;
const media = new Map();  // id → elemento <video>/<img>/<iframe> ya creado (precarga)
const ytLayer = $('stage-yt');
let onYoutube = false;    // el proyecto actual es de YouTube (se ve su reproductor, no el canvas)


const ytOf = (p) => (p.media?.type === 'youtube' ? p.media.id || youtubeId(p.media.url) : '');

/* ---------- fondo ---------- */
const fallback = $('stage-media');
let dither = createDither($('stage'), { cell: 11, onTaint: useFallback });
if (!dither) useFallback();

/** Sin WebGL (o con un video que no deja pintarse): el video tal cual con un damero CSS. */
function useFallback() {
  dither?.destroy();
  dither = null;
  $('stage').hidden = true;
  fallback.hidden = false;
  const el = media.get(projects[index]?.id);
  if (!(el instanceof HTMLIFrameElement)) fallback.replaceChildren(...(el ? [el] : []));
}

function mediaFor(p) {
  if (!p.media?.url) return null;
  if (media.has(p.id)) return media.get(p.id);
  let el;
  const yt = ytOf(p);
  if (yt) {
    el = document.createElement('iframe');
    el.src = youtubeEmbed(yt);
    el.title = p.title || 'Video';
    el.tabIndex = -1;
    el.allow = 'autoplay; encrypted-media; picture-in-picture';
    el.referrerPolicy = 'strict-origin-when-cross-origin';
    // al cargar: en silencio (si no, el navegador no deja que arranque solo) y play
    el.addEventListener('load', () => setTimeout(() => {
      if (!el.classList.contains('is-on')) return youtubeCommand(el, 'pauseVideo');
      youtubeCommand(el, sound ? 'unMute' : 'mute');
      youtubeCommand(el, 'playVideo');
    }, 400));
    ytLayer.append(el);
    media.set(p.id, el);
    return el;
  }
  if (p.media.type === 'video') {
    el = document.createElement('video');
    Object.assign(el, { muted: true, loop: true, playsInline: true, preload: 'auto' });
    el.setAttribute('playsinline', '');
    if (p.media.poster) el.poster = p.media.poster;
  } else {
    el = document.createElement('img');
    el.decoding = 'async';
    el.alt = '';
  }
  // los de otro dominio (Vercel Blob) necesitan CORS para poder pintarse en WebGL
  if (new URL(p.media.url, location.href).origin !== location.origin) el.crossOrigin = 'anonymous';
  el.src = p.media.url;
  media.set(p.id, el);
  return el;
}

function showMedia(p, first) {
  for (const [id, el] of media) {
    if (id === p.id) continue;
    if (el instanceof HTMLVideoElement) { el.pause(); el.muted = true; }
    if (el instanceof HTMLIFrameElement) { youtubeCommand(el, 'pauseVideo'); el.classList.remove('is-on'); }
  }
  const el = mediaFor(p);
  const wasYoutube = onYoutube;
  onYoutube = el instanceof HTMLIFrameElement;
  ytLayer.hidden = !onYoutube;
  $('stage').classList.toggle('is-off', onYoutube);
  if (onYoutube) {
    el.classList.add('is-on');
    youtubeCommand(el, 'seekTo', [0, true]);
    youtubeCommand(el, 'playVideo');
    youtubeCommand(el, sound ? 'unMute' : 'mute');
    $('sound').hidden = false;
    preloadNext();
    return;
  }
  if (el instanceof HTMLVideoElement) {
    el.currentTime = 0;
    el.muted = !sound;
    el.play().catch(() => { el.muted = true; el.play().catch(() => {}); });
  }
  if (dither) dither.setSource(el, { instant: first || wasYoutube }); // tras YouTube, el canvas vuelve sin mezclar
  else {
    fallback.hidden = false;
    fallback.replaceChildren(...(el ? [el] : []));
  }
  $('sound').hidden = !(el instanceof HTMLVideoElement);
  preloadNext();
}

/** Precarga el siguiente (los de YouTube no: su reproductor arrancaría solo). */
function preloadNext() {
  if (projects.length < 2) return;
  const next = projects[(index + 1) % projects.length];
  if (!ytOf(next)) mediaFor(next);
}

/* ---------- tarjeta ---------- */
function fill(p) {
  $('pc-index').textContent = `${pad2(index + 1)} / ${pad2(projects.length)}`;
  $('pc-cat').textContent = p.category;
  $('pc-date').textContent = shortDate(p.date);
  $('pc-title').textContent = p.title;
  $('pc-text').textContent = p.text;
  $('pc-tags').replaceChildren(...p.tags.map((t) => Object.assign(document.createElement('li'), { textContent: t })));
  const link = $('pc-link');
  link.hidden = !p.link;
  if (p.link) link.href = p.link;
  card.setAttribute('aria-label', `${p.title}, proyecto ${index + 1} de ${projects.length}`);
}

let swapTimer = 0;
function show(i, { first = false } = {}) {
  index = (i + projects.length) % projects.length;
  elapsed = 0;
  const p = projects[index];
  showMedia(p, first);
  if (first) { fill(p); return; }
  clearTimeout(swapTimer);
  card.classList.add('is-out');
  swapTimer = setTimeout(() => {
    fill(p);
    card.classList.remove('is-out');
    card.classList.add('is-in');
    void card.offsetWidth; // fuerza el estado inicial antes de animar la entrada
    card.classList.remove('is-in');
  }, 260);
}

/* ---------- tiempo ---------- */
const durOf = (p) => (p.duration || duration) * 1000;
const paused = () => userPaused || hovering || document.hidden;
let last = performance.now();
function tick(now) {
  const dt = Math.min(100, now - last);
  last = now;
  if (projects.length && !paused()) {
    elapsed += dt;
    if (elapsed >= durOf(projects[index]) && projects.length > 1) show(index + 1);
  }
  const p = projects[index];
  if (p) $('pc-progress').style.width = `${Math.min(100, (elapsed / durOf(p)) * 100)}%`;
  card.classList.toggle('is-paused', userPaused);
  requestAnimationFrame(tick);
}

/* ---------- controles ---------- */
card.addEventListener('pointerenter', (e) => { if (e.pointerType === 'mouse') hovering = true; });
card.addEventListener('pointerleave', () => { hovering = false; });
card.addEventListener('focusin', () => { hovering = true; });
card.addEventListener('focusout', () => { hovering = false; });
$('pc-prev').addEventListener('click', () => show(index - 1));
$('pc-next').addEventListener('click', () => show(index + 1));

document.addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea, select') || projects.length < 2) return;
  if (e.key === 'ArrowRight') show(index + 1);
  else if (e.key === 'ArrowLeft') show(index - 1);
  else if (e.key === ' ' && !e.target.closest?.('button, a')) { e.preventDefault(); userPaused = !userPaused; }
});

// deslizar el dedo sobre la tarjeta
let touchX = null;
card.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
card.addEventListener('touchend', (e) => {
  if (touchX == null || projects.length < 2) return;
  const dx = e.changedTouches[0].clientX - touchX;
  touchX = null;
  if (Math.abs(dx) > 50) show(index + (dx < 0 ? 1 : -1));
});

/* sonido: los videos arrancan en silencio (los navegadores no dejan otra cosa) */
$('sound').addEventListener('click', () => {
  sound = !sound;
  $('sound').setAttribute('aria-pressed', String(sound));
  $('sound').setAttribute('aria-label', sound ? 'Silenciar' : 'Activar sonido');
  const el = media.get(projects[index]?.id);
  if (el instanceof HTMLVideoElement) { el.muted = !sound; el.play().catch(() => {}); }
  if (el instanceof HTMLIFrameElement) youtubeCommand(el, sound ? 'unMute' : 'mute');
});

/* ---------- arranque ---------- */
async function load() {
  try {
    const r = await fetch('/api/site?t=portfolio', { cache: 'no-store' });
    if (!r.ok) throw new Error(`api ${r.status}`);
    const data = await r.json();
    duration = data.duration || DEFAULT_DURATION;
    return data.projects || [];
  } catch (err) {
    console.info(`[portafolio] sin API (${err.message}): proyecto de ejemplo`);
    return [];
  }
}

const list = await load();
projects = (list.length ? list : DEMO_PROJECTS).map((p) => ({
  ...PROJECT_DEFAULTS,
  ...Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '' && v != null)),
  tags: p.tags?.length ? p.tags : PROJECT_DEFAULTS.tags,
}));
card.classList.toggle('is-single', projects.length < 2);
$('pc-nav').hidden = projects.length < 2;
show(0, { first: true });
requestAnimationFrame(tick);
