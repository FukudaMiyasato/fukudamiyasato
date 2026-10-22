/* ============================================================
   /api/config — configuración global (solo amo supremo)
   ------------------------------------------------------------
   GET                      → { config, ranges, tools, prices, aiKey }
                              aiKey: si OPENAI_API_KEY está cargada (sin revelarla)
   PUT  { fisheye?, surcharge?, costs?: { tool: n }, usdPen?, usdPerM? }
                            → guarda lo que venga · { config, prices }
   POST ?measure=<tool>     → llama de verdad a esa herramienta con un pedido de
                              prueba, cuenta los tokens que gastó y los deja como
                              su costo · { tool, tokens, config, prices }
   Los dashboards reciben la config junto con sus widgets (GET /api/dash).
   ============================================================ */

import { currentUser } from './_lib/auth.js';
import { getConfig, setConfig, RANGES, TOOLS, prices, hasAiKey } from './_lib/config.js';
import { askVisual, askShort, askFollow, askJourney, askJourneyFit, askResearch, askDashboard } from './_lib/ai.js';

export const maxDuration = 60; // medir llama a OpenAI

/* Pedidos de prueba: parecidos a un uso normal de cada herramienta. */
const SAMPLE_CONTEXT = '### Entradas por ciudad\nCiudad | Entradas\nLima | 17.151\nArequipa | 15.247\nCusco | 14.093\nTrujillo | 9.870';
const MEASURE = {
  table: (meter) => askVisual({ prompt: 'Las 5 ciudades más pobladas del Perú con su población aproximada', meter }),
  ask: (meter) => askShort({ prompt: '¿Por qué el cielo es azul?', meter }),
  follow: (meter) => askFollow({ prompt: '¿Qué conclusiones sacas de esto y qué harías?', context: SAMPLE_CONTEXT, meter }),
  journey: (meter) => askJourney({
    goal: 'Comprar un seguro de auto por internet',
    users: [{ name: 'Lucía', sex: 'f', age: 34, context: 'Texto «entrevista»:\nNo entiendo las coberturas y desconfío de los precios que cambian al final.' }],
    meter,
  }),
  api: (meter) => askDashboard({ question: '¿Qué conclusiones saca este dashboard?', name: 'Ejemplo', context: SAMPLE_CONTEXT, meter }),
  research: (meter) => askResearch({ question: '¿Qué apps ayudan a dividir gastos entre amigos?', meter }),
  fit: (meter) => askJourneyFit({
    journey: { goal: 'Pagar una cuenta entre amigos', stages: [{ name: 'Pide la cuenta', doing: 'Llama al mozo', pain: 'Nadie lleva efectivo' }, { name: 'Divide', doing: 'Calcula cuánto le toca a cada uno', pain: 'Errores en la división' }] },
    solution: 'App que divide la cuenta y cobra a cada uno por Yape.',
    meter,
  }),
};

function num(v, [min, max], label) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw Object.assign(new Error(`${label} va de ${min} a ${max}.`), { status: 400 });
  return n;
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const user = await currentUser(req);
    if (!user) return res.status(401).json({ error: 'Inicia sesión.' });
    if (user.role !== 'supremo') return res.status(403).json({ error: 'Solo el amo supremo.' });

    if (req.method === 'GET') {
      const config = await getConfig();
      return res.status(200).json({ config, ranges: RANGES, tools: TOOLS, prices: prices(config), aiKey: hasAiKey() });
    }

    if (req.method === 'PUT') {
      const b = req.body || {};
      const patch = {};
      if (b.fisheye != null) patch.fisheye = Math.round(num(b.fisheye, RANGES.fisheye, 'El ojo de pez'));
      if (b.surcharge != null) patch.surcharge = Math.round(num(b.surcharge, RANGES.surcharge, 'El sobrecargo'));
      if (b.usdPen != null) patch.usdPen = num(b.usdPen, RANGES.usdPen, 'El tipo de cambio');
      if (b.usdPerM != null) patch.usdPerM = num(b.usdPerM, RANGES.usdPerM, 'El precio por millón');
      if (b.costs && typeof b.costs === 'object') {
        patch.costs = {};
        for (const [t, v] of Object.entries(b.costs)) {
          if (!TOOLS[t]) return res.status(400).json({ error: 'Herramienta desconocida.' });
          patch.costs[t] = Math.round(num(v, RANGES.cost, 'El costo'));
        }
      }
      if (!Object.keys(patch).length) return res.status(400).json({ error: 'Nada que guardar.' });
      const config = await setConfig(patch);
      return res.status(200).json({ config, prices: prices(config) });
    }

    if (req.method === 'POST' && req.query?.measure) {
      const tool = String(req.query.measure);
      if (!MEASURE[tool]) return res.status(400).json({ error: 'Herramienta desconocida.' });
      const meter = {};
      try { await MEASURE[tool](meter); } catch (err) {
        if (!meter.tokens) throw err; // si OpenAI respondió (aunque dijera que no), igual cuenta
      }
      if (!meter.tokens) return res.status(502).json({ error: 'OpenAI no informó cuántos tokens gastó.' });
      const config = await setConfig({ costs: { [tool]: meter.tokens } });
      return res.status(200).json({ tool, tokens: meter.tokens, config, prices: prices(config) });
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    return res.status(405).json({ error: 'Método no permitido.' });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('[api/config]', err);
    return res.status(500).json({ error: err.message });
  }
}
