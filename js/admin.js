/* ============================================================
   admin.js — login con Google + panel de administrador
   ------------------------------------------------------------
   Quién entra lo decide el servidor (/api/auth): esta página solo
   muestra la vista que corresponde al rol que devuelve.
   ============================================================ */

const $ = (id) => document.getElementById(id);
const VIEWS = ['loading', 'login', 'denied', 'client', 'admin'];
const ROLE_LABEL = { admin: 'Administrador', cliente: 'Cliente' };

function show(view) {
  for (const v of VIEWS) $(`v-${v}`).hidden = v !== view;
}

async function api(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: opts.body ? { 'Content-Type': 'application/json' } : undefined,
    credentials: 'same-origin',
  });
  let data = {};
  try { data = await r.json(); } catch { /* sin cuerpo JSON */ }
  return { ok: r.ok, status: r.status, data };
}

function fillUser(user) {
  document.querySelectorAll('[data-user-name]').forEach((el) => { el.textContent = user.name; });
  document.querySelectorAll('[data-user-email]').forEach((el) => { el.textContent = user.email; });
  document.querySelectorAll('[data-user-pic]').forEach((el) => {
    if (user.picture) { el.src = user.picture; el.referrerPolicy = 'no-referrer'; } else el.hidden = true;
  });
}

function enter(user) {
  fillUser(user);
  if (user.role === 'admin') { show('admin'); loadPerms(); }
  else show('client');
}

/* ---------- login ---------- */

let clientId = '';

function whenGoogle() {
  return new Promise((resolve) => {
    const tick = () => (window.google?.accounts?.id ? resolve() : setTimeout(tick, 60));
    tick();
  });
}

async function showLogin(msg = '') {
  show('login');
  $('login-err').textContent = msg;
  if (!clientId) {
    $('login-err').textContent = msg || 'Falta configurar GOOGLE_CLIENT_ID en el servidor.';
    return;
  }
  await whenGoogle();
  google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: 'popup' });
  $('g-btn').innerHTML = '';
  google.accounts.id.renderButton($('g-btn'), {
    theme: 'filled_black', size: 'large', shape: 'pill', text: 'signin_with', locale: 'es', width: 260,
  });
}

async function onCredential({ credential }) {
  $('login-err').textContent = '';
  const { ok, status, data } = await api('/api/auth', { method: 'POST', body: JSON.stringify({ credential }) });
  if (ok) return enter(data.user);
  if (status === 403) {
    $('denied-email').textContent = data.email || '';
    return show('denied');
  }
  $('login-err').textContent = data.error || 'No se pudo iniciar sesión.';
}

$('denied-retry').addEventListener('click', () => {
  window.google?.accounts?.id?.disableAutoSelect();
  showLogin();
});

document.querySelectorAll('[data-logout]').forEach((b) => b.addEventListener('click', async () => {
  await api('/api/auth', { method: 'DELETE' });
  window.google?.accounts?.id?.disableAutoSelect();
  showLogin();
}));

/* ---------- permisos ---------- */

const list = $('perm-list');
const msg = (text, err = false) => { $('perm-msg').textContent = text; $('perm-msg').classList.toggle('err', err); };

function row(email, roleCell, action) {
  const el = document.createElement('div');
  el.className = 'perm-row';
  el.setAttribute('role', 'row');
  const mail = document.createElement('span');
  mail.className = 'perm-email';
  mail.textContent = email;
  const role = document.createElement('span');
  role.append(roleCell);
  const act = document.createElement('span');
  act.className = 'perm-act';
  if (action) act.append(action);
  el.append(mail, role, act);
  return el;
}

function badge(text, cls = '') {
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

function roleSelect(roles, value) {
  const s = document.createElement('select');
  for (const r of roles) s.add(new Option(ROLE_LABEL[r] || r, r, false, r === value));
  return s;
}

async function loadPerms() {
  list.innerHTML = '<p class="perm-empty">Cargando…</p>';
  const { ok, data } = await api('/api/perms');
  if (!ok) {
    list.innerHTML = '';
    return msg(data.error || 'No se pudieron cargar los permisos.', true);
  }

  $('perm-role').innerHTML = '';
  for (const r of data.roles) $('perm-role').add(new Option(ROLE_LABEL[r] || r, r));

  list.innerHTML = '';
  list.append(row(data.owner, badge('Administrador', 'badge--admin'), badge('Propietario')));

  for (const p of data.perms) {
    // Si en Airtable quedó un rol que ya no se puede asignar, se muestra tal cual.
    const cell = data.roles.includes(p.role) && data.roles.length > 1
      ? roleSelect(data.roles, p.role)
      : badge(ROLE_LABEL[p.role] || p.role);
    if (cell.tagName === 'SELECT') {
      cell.addEventListener('change', async () => {
        const r = await api('/api/perms', { method: 'PATCH', body: JSON.stringify({ id: p.id, role: cell.value }) });
        msg(r.ok ? 'Rol actualizado.' : (r.data.error || 'No se pudo actualizar.'), !r.ok);
      });
    }
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'link-btn';
    del.textContent = 'Quitar';
    del.addEventListener('click', async () => {
      if (!confirm(`¿Quitar el acceso de ${p.email}?`)) return;
      del.disabled = true;
      const r = await api(`/api/perms?id=${encodeURIComponent(p.id)}`, { method: 'DELETE' });
      if (r.ok) { msg(`Se quitó el acceso de ${p.email}.`); loadPerms(); }
      else { del.disabled = false; msg(r.data.error || 'No se pudo quitar.', true); }
    });
    list.append(row(p.email, cell, del));
  }

  if (!data.perms.length) {
    const empty = document.createElement('p');
    empty.className = 'perm-empty';
    empty.textContent = 'Aún no agregaste correos.';
    list.append(empty);
  }
}

$('perm-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = $('perm-email').value.trim();
  const role = $('perm-role').value;
  $('perm-add').disabled = true;
  const r = await api('/api/perms', { method: 'POST', body: JSON.stringify({ email, role }) });
  $('perm-add').disabled = false;
  if (!r.ok) return msg(r.data.error || 'No se pudo agregar.', true);
  $('perm-email').value = '';
  msg(`${email} ahora es ${ROLE_LABEL[role] || role}.`);
  loadPerms();
});

/* ---------- arranque ---------- */

(async () => {
  const { ok, status, data } = await api('/api/auth');
  if (!ok) {
    clientId = '';
    return showLogin(status === 404 || status === 501
      ? 'El login necesita la API: en local usa `npx vercel dev`.'
      : (data.error || 'No se pudo conectar con el servidor.'));
  }
  clientId = data.clientId;
  if (data.user) enter(data.user);
  else showLogin();
})();
