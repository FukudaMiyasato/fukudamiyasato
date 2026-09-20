/* ============================================================
   config.js — the only file you normally need to edit
   ============================================================ */

export const CONFIG = {

  /* ---------- WORKS · de dónde sale la data ----------
     Se jala UNA sola vez, al abrir o refrescar la página.
     Se intenta en este orden, y el primero que responda gana:

       1. worksApi      → la función serverless (api/works.js). En Vercel
                          el token vive en Environment Variables y nunca
                          llega al navegador. Esta es la forma buena.
       2. airtable      → llamada directa desde el navegador. Solo si
                          pones un token aquí abajo. ⚠ Este archivo se
                          publica: el token queda a la vista de cualquiera.
       3. worksFallback → snapshot local versionado en el repo.
  ------------------------------------------ */
  worksApi: '/api/airtable?t=works',
  peopleApi: '/api/airtable?t=people',
  meApi: '/api/airtable?t=me',

  airtable: {
    token: '',            // déjalo vacío: en Vercel usa AIRTABLE_TOKEN
    baseId: 'appU39PYosvxt8FfG',
    tableId: 'tblYmNMjQai8IJeeL',
    viewId: 'viwoFafbiplokrhWt',
  },

  worksFallback: 'data/works.json',

  /* ---------- Defaults for incomplete records ---------- */
  defaults: {
    title: 'Sin título',
    year: 'S/F',
    type: 'Otro',
    platforms: [],          // no platform ticked -> no icons
    image: '',              // '' -> generated red/black placeholder
  },

  /* ---------- YO ---------- */
  me: {
    name: 'fukudamiyasato',
    role: 'Product Designer & Developer',
    description:
      'Diseño y construyo productos digitales: interfaces, apps y ' +
      'automatizaciones. Me muevo entre el diseño y el código, y me ' +
      'interesa todo lo que hace que un producto se sienta rápido, ' +
      'claro y bien hecho.',
    location: 'Lima, Perú',
    email: 'fukudamiyasato@gmail.com',
    // Los links salen de la tabla `yo` de Airtable (columna `img` + `url`).
  },

  /* ---------- TODO ---------- */
  todo: {
    daysBack: 7,
    daysForward: 7,
    people: [
      { id: 'fuku', name: 'Fuku', color: '#e0102b' },
      { id: 'ana', name: 'Ana', color: '#c2185b' },
      { id: 'luis', name: 'Luis', color: '#5e35b1' },
      { id: 'sofia', name: 'Sofía', color: '#00897b' },
      { id: 'kenji', name: 'Kenji', color: '#ef6c00' },
      { id: 'mara', name: 'Mara', color: '#3949ab' },
    ],
  },
};
