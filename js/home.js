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
     · tarjeta: un cuadrado negro translúcido — año y nombre, «qué se
       hizo» y las etiquetas (testimonio real · generado con IA)
     · barra roja abajo: el avance de TODOS los videos del proyecto
       (cada uno con su parte, según su duración); se toca o arrastra
       para adelantar, también a otro video del mismo proyecto
     · un clic en el video (o la barra espaciadora) pausa / reanuda
   Sonido: la experiencia es con audio, así que arranca activado. Los
   navegadores no dejan sonar antes del primer toque: si lo bloquean,
   el video arranca en silencio y suena con el primer toque/tecla (ese
   toque no pausa). El botón abre el volumen; apagarlo (o bajarlo a 0)
   pide confirmación. Volumen y apagado duran la sesión.
   Flechas ← → cambian de proyecto. Si no hay proyectos (o la API no
   responde) se ve el de ejemplo; si están todos ocultos, solo el fondo.
   ============================================================ */

import { createDither } from './dither.js';
import { DEMO_PROJECTS, DEFAULT_DURATION, TAGS } from './site-defaults.js';
import { youtubeId } from './youtube.js';

const $ = (id) => document.getElementById(id);
const card = $('pcard');
const SOUND_KEY = 'fm-sound';
const VOL_KEY = 'fm-volume';
const session = {
  get: (k) => { try { return sessionStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { sessionStorage.setItem(k, v); } catch { /* sin almacenamiento */ } },
};

let projects = [];
let duration = DEFAULT_DURATION;   // s: proyecto sin videos o imagen
let pi = 0;                        // proyecto actual
let vi = 0;                        // video actual dentro del proyecto
let itemMs = 0;                    // ms transcurridos de una imagen / proyecto sin video
let paused = false;
let sound = session.get(SOUND_KEY) !== 'off';
let volume = Math.min(100, Math.max(1, Number(session.get(VOL_KEY)) || 80));
let unlocked = false;              // ya hubo un toque: el navegador deja sonar
let swallowClick = false;          // el toque que desbloqueó el audio no pausa
let current = null;                // { kind: 'video' | 'youtube' | 'image' | 'none', el?, key? }
const durations = new Map();       // url o 'yt:<id>' → segundos

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

function elementFor(item, preload = 'auto') {
  if (media.has(item.url)) {
    const el = media.get(item.url);
    if (preload === 'auto' && el.preload !== 'auto') el.preload = 'auto';
    return el;
  }
  let el;
  if (item.type === 'image') {
    el = document.createElement('img');
    el.decoding = 'async';
    el.alt = '';
  } else {
    el = document.createElement('video');
    Object.assign(el, { muted: true, playsInline: true, preload });
    el.setAttribute('playsinline', '');
    el.addEventListener('loadedmetadata', () => { if (Number.isFinite(el.duration)) durations.set(item.url, el.duration); renderMarks(); });
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
          onStateChange: (e) => {
            if (current?.kind !== 'youtube') return;
            if (e.data === 1) {                                    // reproduciendo: ya sabe cuánto dura
              const d = yt.getDuration();
              if (d > 0) { durations.set(current.key, d); renderMarks(); }
              if (paused) yt.pauseVideo();
            }
            if (e.data === 0) nextItem();                          // terminó
          },
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

/* ---------- sonido y volumen ---------- */
function applySound() {
  const on = sound && unlocked;
  if (current?.kind === 'video') { current.el.muted = !on; current.el.volume = volume / 100; }
  if (current?.kind === 'youtube' && yt?.setVolume) { yt.setVolume(volume); if (on) yt.unMute(); else yt.mute(); }
  $('sound').setAttribute('aria-pressed', String(sound));
  $('vol-mute').setAttribute('aria-pressed', String(sound));
  $('vol-mute').setAttribute('aria-label', sound ? 'Apagar el sonido' : 'Activar el sonido');
  $('vol').value = sound ? volume : 0;
  $('vol-val').textContent = sound ? volume : 0;
  $('vol').style.setProperty('--v', `${sound ? volume : 0}%`);
  $('sound-hint').hidden = !(sound && !unlocked && $('vol-pop').hidden && (current?.kind === 'video' || current?.kind === 'youtube'));
}

/* el primer toque o tecla "desbloquea" el audio (y ese toque no pausa el video) */
function unlock(e) {
  if (unlocked) return;
  unlocked = true;
  swallowClick = sound && e?.type !== 'keydown';    // solo un toque/clic genera el click siguiente
  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.removeEventListener(ev, unlock, true));
  if (current?.kind === 'video' && !paused) current.el.play().catch(() => {});
  applySound();
}
['pointerdown', 'keydown', 'touchstart'].forEach((ev) => document.addEventListener(ev, unlock, true));

function setSound(on) {
  sound = on;
  session.set(SOUND_KEY, on ? 'on' : 'off');
  applySound();
}

/** Apagar pide confirmación ("la experiencia es con audio"). */
function askMute() {
  const dlg = $('sound-dialog');
  if (typeof dlg.showModal === 'function') { dlg.returnValue = ''; dlg.showModal(); }
  else if (confirm('Esta experiencia es con audio. ¿Seguro que quieres apagarlo?')) setSound(false);
  else applySound();
}
$('sound-dialog').addEventListener('close', () => {
  if ($('sound-dialog').returnValue === 'off') setSound(false);
  else applySound();                                // continuar: el deslizador vuelve a su volumen
});
$('sound-dialog').addEventListener('click', (e) => { if (e.target === e.currentTarget) e.currentTarget.close('keep'); });

/* el botón abre el volumen */
function toggleVolume(open) {
  $('vol-pop').hidden = !open;
  $('sound').setAttribute('aria-expanded', String(open));
  applySound();
}
$('sound').addEventListener('click', () => toggleVolume($('vol-pop').hidden));
document.addEventListener('pointerdown', (e) => { if (!e.target.closest?.('.top-actions')) toggleVolume(false); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('vol-pop').hidden) toggleVolume(false); });
$('vol-mute').addEventListener('click', () => (sound ? askMute() : setSound(true)));
$('vol').addEventListener('input', () => {
  const v = Number($('vol').value);
  $('vol-val').textContent = v;
  $('vol').style.setProperty('--v', `${v}%`);
  if (v === 0) return;                               // a 0 se confirma al soltar
  volume = v;
  session.set(VOL_KEY, String(v));
  if (!sound) setSound(true); else applySound();
});
$('vol').addEventListener('change', () => { if (Number($('vol').value) === 0 && sound) askMute(); });

/* ---------- pausa ---------- */
let pauseFlash = 0;
function setPaused(p) {
  paused = p;
  if (current?.kind === 'video') { if (p) current.el.pause(); else current.el.play().catch(() => {}); }
  if (current?.kind === 'youtube' && yt) { if (p) yt.pauseVideo(); else yt.playVideo(); }
  const ind = $('pause-ind');
  ind.hidden = false;
  ind.classList.toggle('is-paused', p);
  ind.classList.remove('is-flash'); void ind.offsetWidth; ind.classList.add('is-flash');
  clearTimeout(pauseFlash);
  if (!p) pauseFlash = setTimeout(() => { ind.hidden = true; }, 700);
}

/** Pausa sin la animación (al saltar a otro video estando en pausa). */
function holdPause() {
  paused = true;
  if (current?.kind === 'video') current.el.pause();
  if (current?.kind === 'youtube' && yt) yt.pauseVideo();
  const ind = $('pause-ind');
  ind.hidden = false;
  ind.classList.add('is-paused');
  ind.classList.remove('is-flash');
}

/* clic en el video (todo lo que no sea tarjeta, botones, barra o un diálogo) */
document.addEventListener('click', (e) => {
  if (swallowClick) { swallowClick = false; return; }
  if (!projects.length || e.target.closest?.('.folio, .top-actions, .brand, .seek, dialog')) return;
  setPaused(!paused);
});
document.addEventListener('keydown', (e) => {
  if (e.key !== ' ' || e.target.closest?.('button, a, input, dialog, .seek') || !projects.length) return;
  e.preventDefault();
  setPaused(!paused);
});

/* ---------- reproducir ---------- */
function stopCurrent() {
  if (current?.kind === 'video') current.el.pause();
  if (current?.kind === 'youtube' && yt) yt.pauseVideo();
}

/** Muestra el video/imagen `vi` del proyecto actual, desde `startAt` segundos. */
async function playItem({ first = false, startAt = 0 } = {}) {
  stopCurrent();
  paused = false;
  $('pause-ind').hidden = true;
  itemMs = startAt * 1000;
  const p = projects[pi];
  const item = p.videos[vi];
  const ytId = item?.type === 'youtube' ? (item.id || youtubeId(item.url)) : '';
  const wasYoutube = current?.kind === 'youtube';

  if (!item || item.type === 'image') {          // imagen, o proyecto sin videos (fondo de nube)
    const el = item ? elementFor(item) : null;
    current = { kind: item ? 'image' : 'none', el };
    showYoutube(false);
    if (dither) dither.setSource(el, { instant: first || wasYoutube });
    else fallback.replaceChildren(...(el ? [el] : []));
    applySound();
    preloadProject();
    return;
  }

  if (ytId) {
    current = { kind: 'youtube', key: `yt:${ytId}` };
    showYoutube(true);
    applySound();
    const player = await youtubePlayer();
    if (current?.key !== `yt:${ytId}`) return;    // ya cambió mientras cargaba
    player.mute();                                // en silencio arranca seguro; applySound lo destapa
    player.loadVideoById({ videoId: ytId, startSeconds: startAt });
    applySound();
    preloadProject();
    return;
  }

  const el = elementFor(item);
  current = { kind: 'video', el, key: item.url };
  showYoutube(false);
  if (dither) dither.setSource(el, { instant: first || wasYoutube });
  else fallback.replaceChildren(el);
  setTime(el, startAt);
  el.volume = volume / 100;
  el.muted = !sound;                              // primero se intenta con sonido
  try {
    await el.play();
    if (!el.muted) unlocked = true;               // el navegador ya dejaba sonar
  } catch {
    el.muted = true;                              // bloqueado: en silencio hasta el primer toque
    el.play().catch(() => {});
  }
  applySound();
  preloadProject();
}

/** Fija el tiempo de un video; si todavía no cargó sus datos, apenas los tenga. */
function setTime(el, t) {
  if (el.readyState >= 1) { el.currentTime = t; return; }
  el.addEventListener('loadedmetadata', () => { el.currentTime = t; }, { once: true });
}

function showYoutube(on) {
  ytLayer.hidden = !on;
  $('stage').classList.toggle('is-off', on);
  if (!on && yt) yt.pauseVideo();
}

/** Precarga: el próximo video entero y, de los demás del proyecto, sus duraciones (para la barra). */
function preloadProject() {
  const p = projects[pi];
  p.videos.forEach((v, i) => { if (v.type !== 'youtube' && i !== vi) elementFor(v, i === vi + 1 ? 'auto' : 'metadata'); });
  const next = p.videos[vi + 1] || projects[(pi + 1) % projects.length].videos[0];
  if (next && next.type !== 'youtube') elementFor(next);
}

/** Siguiente video del proyecto; si era el último, el siguiente proyecto. */
function nextItem() {
  const p = projects[pi];
  if (vi + 1 < p.videos.length) { vi += 1; playItem(); } else show(pi + 1);
}

/* ---------- barra de avance (todos los videos del proyecto) ---------- */

/** Duración de cada parte de la barra (s). Las que aún no se saben, el promedio de las conocidas. */
function segments() {
  const p = projects[pi];
  if (!p) return [];
  if (!p.videos.length) return [duration];
  const keyOf = (v) => (v.type === 'youtube' ? `yt:${v.id || youtubeId(v.url)}` : v.url);
  const known = p.videos.map((v) => (v.type === 'image' ? duration : durations.get(keyOf(v))));
  const ok = known.filter((d) => d > 0);
  const guess = ok.length ? ok.reduce((a, b) => a + b, 0) / ok.length : 30;
  return known.map((d) => (d > 0 ? d : guess));
}

/** Segundos que van del video actual. */
function currentTime() {
  if (current?.kind === 'video') return current.el.currentTime || 0;
  if (current?.kind === 'youtube') return yt?.getCurrentTime?.() || 0;
  return itemMs / 1000;
}

function renderMarks() {
  const segs = segments();
  const total = segs.reduce((a, b) => a + b, 0) || 1;
  let acc = 0;
  $('seek-marks').replaceChildren(...segs.slice(0, -1).map((d) => {
    acc += d;
    const m = document.createElement('i');
    m.style.left = `${(acc / total) * 100}%`;
    return m;
  }));
}

/** Va a la fracción `f` (0…1) de todos los videos del proyecto. */
function seekTo(f) {
  const segs = segments();
  const total = segs.reduce((a, b) => a + b, 0);
  let t = Math.min(Math.max(f, 0), 0.999) * total;
  let i = 0;
  while (i < segs.length - 1 && t >= segs[i]) { t -= segs[i]; i += 1; }
  if (i !== vi || current?.kind === 'none') {
    const keep = paused;                           // si estaba en pausa, sigue en pausa
    vi = i;
    playItem({ startAt: t }).then(() => { if (keep && !paused) holdPause(); });
    return;
  }
  if (current?.kind === 'video') setTime(current.el, t);
  else if (current?.kind === 'youtube') yt?.seekTo(t, true);
  else itemMs = t * 1000;
}

const seek = $('seek');
let dragging = false;
const fracAt = (x) => { const r = seek.getBoundingClientRect(); return (x - r.left) / r.width; };
seek.addEventListener('pointerdown', (e) => {
  dragging = true;
  seek.setPointerCapture(e.pointerId);
  seek.classList.add('is-dragging');
  seekTo(fracAt(e.clientX));
});
seek.addEventListener('pointermove', (e) => { if (dragging) seekTo(fracAt(e.clientX)); });
const endDrag = () => { dragging = false; seek.classList.remove('is-dragging'); };
seek.addEventListener('pointerup', endDrag);
seek.addEventListener('pointercancel', endDrag);
seek.addEventListener('keydown', (e) => {               // ← → de a 5 segundos
  if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
  e.preventDefault();
  e.stopPropagation();
  const segs = segments();
  const total = segs.reduce((a, b) => a + b, 0);
  const now = segs.slice(0, vi).reduce((a, b) => a + b, 0) + currentTime();
  seekTo((now + (e.key === 'ArrowRight' ? 5 : -5)) / total);
});

let last = performance.now();
function tick(now) {
  const dt = Math.min(250, now - last);
  last = now;
  if (projects.length) {
    // imágenes y proyectos sin video: el tiempo corre aquí (y se detiene en pausa)
    if ((current?.kind === 'image' || current?.kind === 'none') && !paused && !document.hidden) {
      itemMs += dt;
      if (itemMs >= duration * 1000) nextItem();
    }
    const segs = segments();
    const total = segs.reduce((a, b) => a + b, 0) || 1;
    const done = segs.slice(0, vi).reduce((a, b) => a + b, 0) + Math.min(currentTime(), segs[vi] || 0);
    const pct = Math.min(100, (done / total) * 100);
    $('seek-fill').style.width = `${pct}%`;
    seek.setAttribute('aria-valuenow', String(Math.round(pct)));
  }
  requestAnimationFrame(tick);
}

/* ---------- tarjeta ---------- */
function fill(p) {
  $('pc-year').textContent = p.year || '';
  $('pc-name').textContent = p.name || '';
  // «qué se hizo»; los proyectos viejos traían "qué es" o "info"
  $('pc-did').textContent = p.did || p.what || p.info || '';
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
  playItem({ first });
  renderMarks();
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
  if (projects.length < 2 || e.target.closest?.('dialog, input, textarea, .seek')) return;
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
if (projects.length) {
  show(0, { first: true });
  requestAnimationFrame(tick);
} else {
  document.querySelector('.folio').hidden = true;
  seek.hidden = true;
  dither?.setSource(null, { instant: true });
}
