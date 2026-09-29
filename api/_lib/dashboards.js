/* ============================================================
   api/_lib/dashboards.js — catálogo de dashboards
   ------------------------------------------------------------
   Cada dashboard es una página en /dashboards/<id>/. Para crear uno:
     1. agrégalo aquí (id en minúsculas, sin espacios),
     2. crea su página copiando /dashboards/proyecto-jazz/,
     3. si usa un ícono nuevo, agrégalo en js/dashboard-icons.js.
   Desde el panel, en Permisos, se asigna a los correos.
   ============================================================ */

export const DASHBOARDS = [
  { id: 'proyecto-jazz', name: 'PROYECTO-JAZZ', icon: 'sax', url: '/dashboards/proyecto-jazz/' },
];

export const isDashboard = (id) => DASHBOARDS.some((d) => d.id === id);
