/* ============================================================
   config.js — the only file you normally need to edit
   ============================================================ */

export const CONFIG = {

  /* ---------- WORKS · Airtable ----------
     The data is pulled ONCE, when the page opens or is refreshed.

     Leave `token` empty to serve the local snapshot in data/works.json.
     Put a read-only Airtable Personal Access Token here to go live.

     ⚠  Anything in this file ships to the browser, so a token placed
        here is public. Use a PAT scoped to `data.records:read` on this
        single base, or keep it empty and regenerate the snapshot with
        `AIRTABLE_TOKEN=pat... npm run works:pull`.
  ------------------------------------------ */
  airtable: {
    token:  '',
    baseId: 'appU39PYosvxt8FfG',
    tableId:'tblYmNMjQai8IJeeL',
    viewId: 'viwoFafbiplokrhWt',
  },

  /* Local snapshot used when there is no token (or the call fails). */
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
    email: 'hola@fukudamiyasato.com',
    links: [
      { label: 'GitHub',    url: 'https://github.com/FukudaMiyasato', icon: 'github'    },
      { label: 'LinkedIn',  url: '#',                                 icon: 'linkedin'  },
      { label: 'Instagram', url: '#',                                 icon: 'instagram' },
      { label: 'X',         url: '#',                                 icon: 'x'         },
      { label: 'Behance',   url: '#',                                 icon: 'behance'   },
    ],
  },

  /* ---------- TODO ---------- */
  todo: {
    daysBack: 7,
    daysForward: 7,
    people: [
      { id: 'fuku',  name: 'Fuku',   color: '#e0102b' },
      { id: 'ana',   name: 'Ana',    color: '#c2185b' },
      { id: 'luis',  name: 'Luis',   color: '#5e35b1' },
      { id: 'sofia', name: 'Sofía',  color: '#00897b' },
      { id: 'kenji', name: 'Kenji',  color: '#ef6c00' },
      { id: 'mara',  name: 'Mara',   color: '#3949ab' },
    ],
  },
};
