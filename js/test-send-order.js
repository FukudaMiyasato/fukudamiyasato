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
const mockBtn = document.getElementById('order-mock');

// comodidad para pruebas repetidas: la clave se recuerda en esta pestaña,
// nunca se manda a ningún lado salvo en el propio POST de abajo
try {
  const saved = sessionStorage.getItem(KEY_STORE);
  if (saved) keyEl.value = saved;
} catch { /* modo privado */ }

/** Manda la orden y, si sale bien, salta a IA a verla ejecutarse. */
async function sendOrder(text, { mock = false } = {}) {
  submit.disabled = true;
  mockBtn.disabled = true;
  note.className = 'order-note';
  note.textContent = mock ? 'Enviando (modo prueba, sin gastar tokens)…' : 'Enviando…';

  try {
    const key = keyEl.value.trim();
    const res = await fetch('/api/ia?test=1', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key, text, mock }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);

    try { sessionStorage.setItem(KEY_STORE, key); } catch { /* modo privado */ }
    location.href = '/ia.html';
  } catch (err) {
    note.textContent = err.message;
    note.classList.add('err');
    submit.disabled = false;
    mockBtn.disabled = false;
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  const key = keyEl.value.trim();
  const text = textEl.value.trim();
  if (!key || !text) return;
  sendOrder(text, { mock: false });
});

// "Probar gratis": no hace falta escribir nada, solo la clave — el
// resultado es siempre el mismo código estático, para probar la
// animación (ensamblaje + flotación) sin gastar tokens de OpenAI.
mockBtn.addEventListener('click', () => {
  const key = keyEl.value.trim();
  if (!key) {
    note.className = 'order-note err';
    note.textContent = 'Escribe la clave primero.';
    return;
  }
  sendOrder(textEl.value.trim() || 'prueba de animación', { mock: true });
});
