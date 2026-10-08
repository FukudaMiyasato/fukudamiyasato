/* ============================================================
   home.js — portada: los proyectos, uno tras otro, con sus videos
   ------------------------------------------------------------
   Los proyectos salen de /api/site?t=portfolio (el amo supremo los
   carga en el panel → Portafolio; solo los visibles). Cada proyecto
   pasa sus videos en secuencia y, cuando termina el último, sigue el
   próximo proyecto (y al final vuelve al primero). Un proyecto sin
   videos, o una imagen, dura N segundos (el tiempo general del panel).
     · fondo: el video en semitono (js/dither.js), con disolución
       entre videos
     · YouTube: WebGL no puede leerlo (iframe de otro dominio); se ve
       con su reproductor de fondo (API oficial, para saber cuándo
       termina) y una trama de puntos encima
     · tarjeta: año y nombre arriba a la derecha, la info y las
       etiquetas (testimonio real · generado con IA)
   Sonido: la experiencia es con audio, así que arranca activado. Los
   navegadores no dejan sonar antes del primer toque: si lo bloquean,
   el video arranca en silencio y suena con el primer toque/tecla.
   Apagarlo pide confirmación; la elección dura la sesión.
   Flechas ← → cambian de proyecto. Si no hay proyectos (o la API no
   responde) se ve el de ejemplo; si están todos ocultos, solo el fondo.
   ============================================================ */

import { createDither } from './dither.js';
import { DEMO_PROJECTS, DEFAULT_DURATION, TAGS } from './site-defaults.js';
import { youtubeId } from './youtube.js';

const $ = (id) => document.getElementById(id);
const card = $('pcard');
const SOUND_KEY = 'fm-sound';

let projects = [];
let duration = DEFAULT_DURATION;   // s: proyecto sin videos o imagen
let pi = 0;                        // proyecto actual
let vi = 0;                        // video actual dentro del proyecto
let timer = 0;                     // para imágenes / proyectos sin video
let sound = (() => { try { return sessionStorage.getItem(SOUND_KEY) !== 'off'; } catch { return true; } })();
let unlocked = false;              // ya hubo un toque: el navegador deja sonar
let current = null;                // { kind: 'video' | 'youtube' | 'image' | 'none', el? }

/* ---------- fondo ---------- */
const fallback = $('stage-media');
const ytLayer = $('stage-yt');
let dither = createDither($('stage'), { cell: 10, onTaint: useFallback });
if (!dither) useFallback();

/** Sin WebGL (o con un video que no deja pintarse): el video tal cual con la trama en CSS. */
function useFallback() {
  dither?.destroy();
  dither = null;
  $('stage').hidden = true;
  fallback.hidden = false;
  if (current?.el && current.kind !== 'youtube') fallback.replaceChildren(current.el);
}

const media = new Map();   // url → <video>/<img> ya creado (precarga)

function elementFor(item) {
  if (media.has(item.url)) return media.get(item.url);
  let el;
  if (item.type === 'image') {
    el = document.createElement('img');
    el.decoding = 'async';
    el.alt = '';
  } else {
    el = document.createElement('video');
    Object.assign(el, { muted: true, playsInline: true, preload: 'auto' });
    el.setAttribute('playsinline', '');
    el.addEventListener('ended', () => { if (current?.el === el) nextItem(); });
    el.addEventListener('error', () => { if (current?.el === el) setTimeout(nextItem, 600); });
  }
  // los de otro dominio (Vercel Blob) necesitan CORS para poder pintarse en WebGL
  if (new URL(item.url, location.href).origin !== location.origin) el.crossOrigin = 'anonymous';
  el.src = item.url;
  media.set(item.url, el);
  return el;
}

/* ---------- YouTube: su API oficial (avisa cuándo termina el video) ---------- */
let yt = null;            // YT.Player
let ytReady = null;       // promesa: el reproductor está listo
function youtubePlayer() {
  if (ytReady) return ytReady;
  ytReady = new Promise((resolve) => {
    const make = () => {
      yt = new window.YT.Player('yt-player', {
        host: 'https://www.youtube-nocookie.com',
        playerVars: { autoplay: 1, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => resolve(yt),
          onStateChange: (e) => { if (e.data === 0 && current?.kind === 'youtube') nextItem(); },   // 0 = terminó
          onError: () => { if (current?.kind === 'youtube') setTimeout(nextItem, 600); },
        },
      });
    };
    if (window.YT?.Player) make();
    else {
      window.onYouTubeIframeAPIReady = make;
      const s = document.createElement('script');
      s.src = 'https://www.youtube.com/iframe_api';
      document.head.append(s);
    }
  });
  return ytReady;
}

/* ---------- sonido ---------- */
function applySound() {
  const on = sound && unlocked;
  if (current?.kind === 'video') current.el.muted = !on;
  if (current?.kind === 'youtube' && yt) { if (on) yt.unMute(); else yt.mute(); }
  $('sound').setAttribute('aria-pressed', String(sound));
  $('sound').setAttribute('aria-label', sound ? 'Apagar el sonido' : 'Activar el sonido');
  $('sound-hint').hidden = !(sound && !unlocked && (current?.kind === 'video' || current?.kind === 'youtube'));
}

/* el primer toque o tecla "desbloquea" el audio */
function unlock() {
  if (unlocked) return;
  unlocked = true;
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.removeEventListener(ev, unlock, true));
  if (current?.kind === 'video') current.el.play().catch(() => {});
  applySound();
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, true));

$('sound').addEventListener('click', () => {
  if (!sound) { setSound(true); return; }
  const dlg = $('sound-dialog');
  if (typeof dlg.showModal === 'function') { dlg.returnValue = ''; dlg.showModal(); }
  else if (confirm('Esta experiencia es con audio. ¿Seguro que quieres apagarlo?')) setSound(false);
});
$('sound-dialog').addEventListener('close', () => { if ($('sound-dialog').returnValue === 'off') setSound(false); });
// clic fuera del cuadro = continuar
$('sound-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close('keep'); });

function setSound(on) {
  sound = on;
  try { sessionStorage.setItem(SOUND_KEY, on ? 'on' : 'off'); } catch { /* sin almacenamiento */ }
  applySound();
}

/* ---------- reproducir ---------- */
function stopCurrent() {
  clearTimeout(timer);
  if (current?.kind === 'video') current.el.pause();
  if (current?.kind === 'youtube' && yt) yt.pauseVideo();
}

/** Muestra el video/imagen `vi` del proyecto actual. */
async function playItem(first = false) {
  stopCurrent();
  const p = projects[pi];
  const item = p.videos[vi];
  const ytId = item?.type === 'youtube' ? (item.id || youtubeId(item.url)) : '';
  const wasYoutube = current?.kind === 'youtube';

  if (!item) {                                   // proyecto sin videos: el fondo de nube
    current = { kind: 'none' };
    showYoutube(false);
    dither?.setSource(null, { instant: first || wasYoutube });
    timer = setTimeout(nextItem, duration * 1000);
    applySound();
    return;
  }

  if (ytId) {
    current = { kind: 'youtube' };
    showYoutube(true);
    applySound();
    const player = await youtubePlayer();
    if (current?.kind !== 'youtube') return;      // ya cambió mientras cargaba
    player.mute();                                // en silencio arranca seguro; applySound lo destapa
    player.loadVideoById(ytId);
    applySound();
    return;
  }

  const el = elementFor(item);
  current = { kind: item.type === 'image' ? 'image' : 'video', el };
  showYoutube(false);
  if (dither) dither.setSource(el, { instant: first || wasYoutube });
  else fallback.replaceChildren(el);

  if (current.kind === 'image') {
    timer = setTimeout(nextItem, duration * 1000);
  } else {
    el.currentTime = 0;
    el.muted = !sound;                            // primero se intenta con sonido
    try {
      await el.play();
      if (!el.muted) unlocked = true;             // el navegador ya dejaba sonar
    } catch {
      el.muted = true;                            // bloqueado: en silencio hasta el primer toque
      el.play().catch(() => {});
    }
  }
  applySound();
  preloadNext();
}

function showYoutube(on) {
  ytLayer.hidden = !on;
  $('stage').classList.toggle('is-off', on);
  if (!on && yt) yt.pauseVideo();
}

/** Precarga el próximo video (no los de YouTube: arrancarían solos). */
function preloadNext() {
  const p = projects[pi];
  const next = p.videos[vi + 1] || projects[(pi + 1) % projects.length].videos[0];
  if (next && next.type !== 'youtube') elementFor(next);
}

/** Siguiente video del proyecto; si era el último, el siguiente proyecto. */
function nextItem() {
  const p = projects[pi];
  if (vi + 1 < p.videos.length) { vi += 1; playItem(); } else show(pi + 1);
}

/* ---------- tarjeta ---------- */
function fill(p) {
  $('pc-year').textContent = p.year || '';
  $('pc-name').textContent = p.name || '';
  $('pc-info').textContent = p.info || '';
  $('pc-tags').replaceChildren(...TAGS.filter((t) => p.tags?.includes(t.key)).map((t) => {
    const li = document.createElement('li');
    li.className = `tag tag--${t.key}`;
    li.textContent = t.label;
    return li;
  }));
  card.setAttribute('aria-label', [p.year, p.name].filter(Boolean).join(' · ') || 'Proyecto');
}

let swapTimer = 0;
function show(i, { first = false } = {}) {
  pi = (i + projects.length) % projects.length;
  vi = 0;
  const p = projects[pi];
  playItem(first);
  if (first) { fill(p); return; }
  clearTimeout(swapTimer);
  card.classList.add('is-out');
  swapTimer = setTimeout(() => {
    fill(p);
    card.classList.remove('is-out');
    card.classList.add('is-in');
    void card.offsetWidth; // fija el estado inicial antes de animar la entrada
    card.classList.remove('is-in');
  }, 260);
}

document.addEventListener('keydown', (e) => {
  if (projects.length < 2 || e.target.closest?.('dialog, input, textarea')) return;
  if (e.key === 'ArrowRight') show(pi + 1);
  else if (e.key === 'ArrowLeft') show(pi - 1);
});

/* ---------- arranque ---------- */
async function load() {
  try {
    const r = await fetch('/api/site?t=portfolio', { cache: 'no-store' });
    if (!r.ok) throw new Error(`api ${r.status}`);
    const data = await r.json();
    duration = data.duration || DEFAULT_DURATION;
    return { list: data.projects || [], hidden: data.hidden || 0 };
  } catch (err) {
    console.info(`[portafolio] sin API (${err.message}): proyecto de ejemplo`);
    return { list: [], hidden: 0 };
  }
}

const { list, hidden } = await load();
// el de ejemplo sale solo si no hay ningún proyecto; si están todos ocultos,
// queda el fondo sin tarjeta
projects = (list.length ? list : hidden ? [] : DEMO_PROJECTS).map((p) => ({ ...p, videos: p.videos || [], tags: p.tags || [] }));
applySound();
if (projects.length) show(0, { first: true });
else {
  document.querySelector('.folio').hidden = true;
  dither?.setSource(null, { instant: true });
}
