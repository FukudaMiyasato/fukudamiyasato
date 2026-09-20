/* ============================================================
   audio.js — tiny Web Audio synth (no asset files needed)
   ============================================================ */

const NOTES = {
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.00,
};

/** The 5 musical notes that get handed out to the Works items. */
export const NOTE_NAMES = Object.keys(NOTES);

let ctx = null;
let master = null;

function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.9;
    master.connect(ctx.destination);
  }
  if (ctx.state === 'suspended') ctx.resume();
  return ctx;
}

/* Browsers block audio until the user interacts — warm it up on the
   first gesture so the very first hover already sounds. */
function unlock() {
  ac();
  window.removeEventListener('pointerdown', unlock);
  window.removeEventListener('keydown', unlock);
}
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

/** One soft bell-ish note. `name` is a key of NOTE_NAMES. */
export function playNote(name, { gain = 0.16 } = {}) {
  const c = ac();
  if (!c) return;
  const freq = NOTES[name] || NOTES.C5;
  const t = c.currentTime;

  const g = c.createGain();
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
  g.connect(master);

  // fundamental + a quiet octave for a glassy timbre
  [[freq, 'sine', 1], [freq * 2, 'triangle', 0.28]].forEach(([f, type, mix]) => {
    const o = c.createOscillator();
    const og = c.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f, t);
    og.gain.value = mix;
    o.connect(og).connect(g);
    o.start(t);
    o.stop(t + 1.0);
  });
}

/** Bright rising arpeggio — "done". */
export function playDone() {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => {
    const o = c.createOscillator();
    const g = c.createGain();
    const t = t0 + i * 0.065;
    o.type = 'triangle';
    o.frequency.setValueAtTime(f, t);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.2, t + 0.014);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.36);
  });
}

/** The mocking sad-trombone "womp womp womp waaah" — delete. */
export function playFail() {
  const c = ac();
  if (!c) return;
  const t0 = c.currentTime;
  const steps = [
    { f: 233.08, d: 0.17 },  // Bb3
    { f: 207.65, d: 0.17 },  // Ab3
    { f: 185.00, d: 0.17 },  // F#3
    { f: 164.81, d: 0.62 },  // E3  (the long droopy one)
  ];
  let t = t0;
  steps.forEach((s, i) => {
    const last = i === steps.length - 1;

    const o = c.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(s.f, t);
    if (last) o.frequency.exponentialRampToValueAtTime(s.f * 0.72, t + s.d);

    // brass-ish: lowpass that opens then shuts
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(420, t + s.d);
    lp.Q.value = 6;

    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.22, t + 0.03);
    g.gain.setValueAtTime(0.22, t + s.d * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + s.d);

    // wobble on the last note, for the jeering effect
    if (last) {
      const lfo = c.createOscillator();
      const lfoGain = c.createGain();
      lfo.frequency.value = 7;
      lfoGain.gain.value = 6;
      lfo.connect(lfoGain).connect(o.frequency);
      lfo.start(t);
      lfo.stop(t + s.d);
    }

    o.connect(lp).connect(g).connect(master);
    o.start(t);
    o.stop(t + s.d + 0.02);
    t += s.d * 0.92;
  });
}

/** Dry click for pick-up / drop. */
export function playTick(freq = 440) {
  const c = ac();
  if (!c) return;
  const t = c.currentTime;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = 'square';
  o.frequency.setValueAtTime(freq, t);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.09, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + 0.1);
}
