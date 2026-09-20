# fukudamiyasato

Sitio personal estático — sin build, sin dependencias. Se sirve tal cual
(GitHub Pages, Netlify, o cualquier servidor de archivos).

```
index.html      portada: wordmark + 4 accesos (solo íconos)
works.html      grilla de aplicativos con filtros de año y tipo
ia.html         vacío por ahora
todo.html       lista de pendientes por día
yo.html         perfil + redes
```

Todas las páginas internas llevan una **X fija arriba a la derecha** que
regresa a la portada.

---

## Correr en local

```bash
npm run dev          # http://localhost:5190
```

Hace falta un servidor (aunque sea el de Python): las páginas usan módulos
ES y `fetch`, así que abrir el `index.html` con doble clic no funciona.

---

## WORKS · datos desde Airtable

La data se jala **una sola vez, al abrir o refrescar la página**. Solo se
muestran los registros marcados como *visible*; lo que venga incompleto cae
a los valores por defecto de `js/config.js` (año `S/F`, tipo `Otro`,
placeholder generado, sin íconos de plataforma).

Los nombres de columna son tolerantes — se aceptan variantes en español e
inglés:

| Campo      | Se acepta                                                       |
|------------|-----------------------------------------------------------------|
| Título     | `Name`, `Title`, `Nombre`, `Título`, `App`, `Proyecto`          |
| Año        | `Year`, `Año`, `Fecha`                                          |
| Tipo       | `Type`, `Tipo`, `Categoría`                                     |
| Visible    | `Visible`, `Activo`, `Publicado`, `Status`                      |
| Imagen     | `Image`, `Imagen`, `Foto`, `Cover`, `Portada`, `Ícono`          |
| Plataformas| `Platforms`, `Plataformas`, `Devices` — o una casilla por plataforma (`iOS`, `Android`, `Web`, `Cel`, `Monitor`) |
| Link       | `URL`, `Link`, `Enlace`                                         |

Las plataformas se normalizan a los 5 íconos: **ios · android · web · cel · monitor**.

### De dónde sale la data

Al cargar, el sitio prueba tres fuentes en orden y se queda con la primera
que responda:

| # | Fuente | Cuándo aplica |
|---|--------|---------------|
| 1 | `/api/works` | En Vercel. El token vive en el servidor. **Esta es la buena.** |
| 2 | Airtable directo | Solo si pones un token en `js/config.js`. ⚠️ Queda público. |
| 3 | `data/works.json` | Snapshot del repo. Es lo que corre en `npm run dev`. |

En local verás un `404` de `/api/works` en la consola: es la prueba del
paso 1 fallando y cayendo al snapshot. Es lo esperado.

---

## Deploy en Vercel

El proyecto es estático + una Serverless Function, sin build. Vercel lo
detecta solo: no hace falta `vercel.json`.

1. **Importa el repo** en [vercel.com/new](https://vercel.com/new).
   Framework Preset: *Other*. Build Command: vacío. Output Directory: `./`.

2. **Crea el token** en [airtable.com/create/tokens](https://airtable.com/create/tokens)
   con el scope `data.records:read` y acceso **solo** a esta base.

3. **Agrega la variable** en Vercel → tu proyecto → *Settings* →
   *Environment Variables*:

   | Name | Value | Environments |
   |------|-------|--------------|
   | `AIRTABLE_TOKEN` | `pat...` | Production, Preview, Development |

   Opcionales, solo si cambias de tabla: `AIRTABLE_BASE`, `AIRTABLE_TABLE`,
   `AIRTABLE_VIEW`, `WORKS_CACHE_SECONDS`.

4. **Redeploy.** Las variables se leen al arrancar la función, así que un
   deploy que ya estaba corriendo no las toma: hay que volver a desplegar.

Para verificar, abre `https://tu-dominio.vercel.app/api/works` — debe
devolver el JSON de Airtable. Y al pie de *Works* la nota debe decir
"Data en vivo desde Airtable" en vez de "Snapshot local".

> El token nunca llega al navegador: `api/works.js` corre en el servidor de
> Vercel, llama a Airtable y devuelve solo los registros. Una variable de
> entorno **no** protege un `fetch` hecho desde el cliente — por eso existe
> esta función.

### Probar la función en local

```bash
cp .env.example .env.local     # pon tu token ahí (está en .gitignore)
npx vercel dev                 # http://localhost:3000 — con /api funcionando
```

`npm run dev` no levanta la función; sirve el snapshot, que para maquetar
alcanza.

### Sin Vercel

Si algún día lo mueves a un hosting puramente estático (GitHub Pages y
compañía), no hay servidor que proteja el token. Ahí la salida es
regenerar el snapshot cuando actualices la tabla:

```bash
AIRTABLE_TOKEN=pat... npm run works:pull
```

Eso reescribe `data/works.json` y el token nunca sale de tu máquina.

---

## Interacción

**Works** — hover sobre un item: la capa oscura y el texto bajan de 50 % a
5 %, la foto crece 10 % y suena la nota musical asignada al azar a ese item
(5 notas: do, re, mi, sol, la).

**To-do** — carrusel con 7 días atrás y 7 adelante, hoy activo al entrar.

- deslizar **←** elimina (con trombón burlón)
- deslizar **→** marca como hecho: se va al final, con opacidad y etiqueta
- **mantener presionado** levanta el item; suéltalo sobre otro día del
  carrusel para reasignarlo

Los pendientes se guardan en `localStorage` del navegador.

Todos los sonidos se generan con la Web Audio API (`js/audio.js`), no hay
archivos de audio.

---

## Configuración

Casi todo vive en [`js/config.js`](js/config.js): credenciales de Airtable,
valores por defecto, textos y redes de **Yo**, y la lista de personas del
**To-do**.
