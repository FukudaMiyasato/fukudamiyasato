/* ============================================================
   test-send-order.js — manda un texto a /api/ia como si fuera el
   webhook de voz, y salta a IA a que lo ejecute. La clave nunca vive
   en este archivo: la valida el servidor contra TEST_ORDER_KEY.
   ============================================================ */

const KEY_STORE = 'fm.test.key.v1';

const form   = document.getElementById('order-form');
const keyEl  = document.getElementById('order-key');
const textEl = document.getElementById('order-text');
const note   = document.getElementById('order-note');
const submit = document.getElementById('order-submit');

// comodidad para pruebas repetidas: la clave se recuerda en esta pestaña,
// nunca se manda a ningún lado salvo en el propio POST de abajo
try {
  const saved = sessionStorage.getItem(KEY_STORE);
  if (saved) keyEl.value = saved;
} catch { /* modo privado */ }

form.addEventListener('submit', async (e) => {
  e.preventDefault();

  const key = keyEl.value.trim();
  const text = textEl.value.trim();
  if (!key || !text) return;

  submit.disabled = true;
  note.className = 'order-note';
  note.textContent = 'Enviando…';

  try {
    const res = await fetch('/api/ia?test=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, text }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    try { sessionStorage.setItem(KEY_STORE, key); } catch { /* modo privado */ }
    location.href = '/ia.html';
  } catch (err) {
    note.textContent = err.message;
    note.classList.add('err');
    submit.disabled = false;
  }
});
