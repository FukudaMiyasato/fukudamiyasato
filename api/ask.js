/* ============================================================
   /api/ask — hazle una pregunta a los dashboards
   ------------------------------------------------------------
   POST { question, dashboard? }
     1. Elige el dashboard que trata del tema (la IA lee un resumen de
        cada uno). Con `dashboard` (su id) o si hay uno solo, no elige.
     2. Responde usando solo el contenido de ese dashboard.
     → 200 { question, dashboard: { id, name, url }, answer, detail, confidence,
             used: [{ id, title, kind }], routing: { reason, candidates } }
     → 404 { error, routing } si ningún dashboard trata del tema
     → 422 { error } si el dashboard no tiene cómo responder
   GET → esta ayuda, en JSON.

   Quién puede:
     · Authorization: Bearer <DASHBOARD_API_KEY>  → todos los dashboards (para
       integraciones: un bot, otra app). Sin saldo: el gasto se anota al dashboard.
     · La sesión del panel (cookie)               → solo los dashboards que esa
       persona ve; paga con sus tokens como cualquier herramienta de IA.
   Cuesta tokens ("api") y se suma al gasto del dashboard que respondió.
   ============================================================ */

import crypto from 'node:crypto';
import { currentUser } from './_lib/auth.js';
import { listDashboards, listWidgets, addSpent } from './_lib/dashboards.js';
import { contextFrom } from './_lib/context.js';
import { askRoute, askDashboard, AIError } from './_lib/ai.js';
import { getConfig, priceOf } from './_lib/config.js';
import { unlimited, balanceOf, charge, refund } from './_lib/tokens.js';

export const maxDuration = 60;

const HELP = {
  uso: 'POST /api/ask con { "question": "…", "dashboard": "id (opcional)" }',
  auth: 'Authorization: Bearer <DASHBOARD_API_KEY>, o la sesión del panel',
  responde: '{ dashboard: { id, name, url }, answer, detail, confidence, used, routing }',
};

/** ¿Trae la API key correcta? (comparación en tiempo constante) */
function hasApiKey(req) {
  const key = String(process.env.DASHBOARD_API_KEY || '').trim();
  const got = String(req.headers?.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!key || !got) return false;
  const a = Buffer.from(key), b = Buffer.from(got);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Resumen corto de un dashboard para elegir a cuál le toca la pregunta. */
function summaryOf(widgets) {
  const parts = widgets.map((w) => {
    const d = w.data || {};
    if (d.kind === 'user') return `usuario ${d.name} (${d.age} años)`;
    if (d.kind === 'journey') return `journey «${d.title}»${d.goal ? `: ${d.goal}` : ''}`;
    if (d.kind === 'file') return `archivo ${(d.files || []).map((f) => f.name).join(', ')}`;
    if (d.kind === 'label' || d.kind === 'note') return String(d.text || '').slice(0, 120);
    if (d.kind === 'group') return `sección «${d.title}»`;
    return d.title || d.name || '';
  }).filter(Boolean);
  return [...new Set(parts)].slice(0, 60).join(' · ');
}

const titleOf = (w) => w.data?.title || w.data?.name || (w.data?.text ? String(w.data.text).slice(0, 60) : '') || 'Widget';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'GET') return res.status(200).json(HELP);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  }

  try {
    const catalog = await listDashboards();
    const byKey = hasApiKey(req);
    const user = byKey ? null : await currentUser(req, catalog);
    if (!byKey && !user) return res.status(401).json({ error: 'Falta la API key (Authorization: Bearer …) o iniciar sesión.' });
    const allowed = byKey ? catalog : catalog.filter((d) => user.dashboards.some((x) => x.id === d.id));
    if (!allowed.length) return res.status(403).json({ error: 'No tienes dashboards.' });

    const question = String(req.body?.question || '').trim().slice(0, 1000);
    if (!question) return res.status(400).json({ error: 'Falta "question".' });
    const wanted = req.body?.dashboard ? String(req.body.dashboard).toLowerCase() : '';
    if (wanted && !allowed.some((d) => d.id === wanted)) return res.status(404).json({ error: 'Ese dashboard no existe o no tienes acceso.' });

    // tokens: el que pregunta con su sesión paga como siempre; con API key, sin saldo
    const cost = priceOf(await getConfig(), 'api');
    const price = !user || unlimited(user) ? 0 : cost;
    if (price && !(await charge(user.email, price))) {
      return res.status(402).json({ error: `No te quedan tokens: esto cuesta ${price.toLocaleString('es-PE')}.`, tokens: await balanceOf(user.email) });
    }

    try {
      // 1. ¿a qué dashboard le toca?
      let dash = wanted ? allowed.find((d) => d.id === wanted) : null;
      const contents = new Map();
      const load = async (d) => { if (!contents.has(d.id)) contents.set(d.id, await listWidgets(d.id)); return contents.get(d.id); };
      let routing = { reason: wanted ? 'Lo indicó la pregunta.' : '', candidates: allowed.length };
      if (!dash && allowed.length === 1) [dash] = allowed;
      if (!dash) {
        const summaries = await Promise.all(allowed.map(async (d) => ({ id: d.id, name: d.name, summary: summaryOf(await load(d)) })));
        const route = await askRoute({ question, dashboards: summaries.filter((x) => x.summary) });
        routing = { reason: route.reason, candidates: allowed.length };
        dash = allowed.find((d) => d.id === route.id);
        if (!dash) { if (price) await refund(user.email, price); return res.status(404).json({ error: 'Ningún dashboard trata de eso.', routing }); }
      }

      // 2. responder con todo lo que tiene ese dashboard
      const widgets = (await load(dash)).filter((w) => w.data?.kind !== 'group');
      if (!widgets.length) { if (price) await refund(user.email, price); return res.status(422).json({ error: `«${dash.name}» está vacío.`, routing }); }
      const out = await askDashboard({ question, name: dash.name, context: contextFrom(widgets) });
      await addSpent(dash.id, cost);

      const used = out.used.map((t) => widgets.find((w) => titleOf(w) === t || (w.data?.title || w.data?.name) === t)).filter(Boolean)
        .map((w) => ({ id: w.id, title: titleOf(w), kind: w.data?.kind || w.type }));
      const host = req.headers?.host ? `https://${req.headers.host}` : '';
      return res.status(200).json({
        question,
        dashboard: { id: dash.id, name: dash.name, url: `${host}${dash.url}` },
        answer: out.answer, detail: out.detail, confidence: out.confidence,
        used: [...new Map(used.map((u) => [u.id, u])).values()],
        routing,
        ...(user && !unlimited(user) ? { tokens: await balanceOf(user.email) } : {}),
      });
    } catch (err) {
      if (price) await refund(user.email, price);
      if (err instanceof AIError) return res.status(422).json({ error: err.message });
      throw err;
    }
  } catch (err) {
    console.error('[api/ask]', err);
    return res.status(500).json({ error: err.message });
  }
}
