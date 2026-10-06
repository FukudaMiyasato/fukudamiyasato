/* ============================================================
   yo.js — página Yo: fondo negro, FUKU y una frase que cambia
   ------------------------------------------------------------
   Cada PHRASE_MS (5 s) la frase de abajo se va letra por letra
   (sube, gira un poco y se desenfoca, en cascada) y entra la
   siguiente desde abajo. Título y frases se editan en el panel →
   YO (/api/site?t=me); si nunca se guardaron, se usan los de
   js/site-defaults.js.
   ============================================================ */

import { DEFAULT_ME, PHRASE_MS } from './site-defaults.js';

const $ = (id) => document.getElementById(id);
const phraseEl = $('me-phrase');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Pone el texto como una letra por <span> (para animarlas en cascada). */
function setLetters(text) {
  phraseEl.replaceChildren(...[...text].map((ch, i) => {
    const s = document.createElement('span');
    s.className = 'ch';
    s.style.setProperty('--i', i);
    s.textContent = ch;
    return s;
  }));
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function swap(text) {
  const n = phraseEl.children.length;
  phraseEl.classList.add('is-out');
  await wait(reduced ? 300 : 500 + n * 22);           // que termine de irse la última letra
  setLetters(text);
  phraseEl.classList.remove('is-out');
  phraseEl.classList.add('is-in');
  void phraseEl.offsetWidth;                           // fija el estado inicial antes de animar
  phraseEl.classList.remove('is-in');
}

function start(me) {
  const title = me.title || DEFAULT_ME.title;
  const phrases = (me.phrases || []).filter(Boolean);
  const list = phrases.length ? phrases : DEFAULT_ME.phrases;
  $('me-fuku').textContent = title;
  $('me-phrases-sr').textContent = list.join(' · ');
  document.title = `Yo — ${title}`;
  setLetters(list[0]);
  if (list.length < 2) return;
  let i = 0;
  setInterval(() => {
    if (document.hidden) return;
    i = (i + 1) % list.length;
    swap(list[i]);
  }, PHRASE_MS);
}

let me = DEFAULT_ME;
try {
  const r = await fetch('/api/site?t=me', { cache: 'no-store' });
  const d = r.ok ? await r.json() : null;
  if (d?.me) me = d.me;
} catch { /* sin API: los de por defecto */ }
start(me);
