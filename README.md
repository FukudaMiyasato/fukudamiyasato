# fukudamiyasato

Sitio personal estático — sin build, sin dependencias. Se sirve tal cual
(GitHub Pages, Netlify, o cualquier servidor de archivos).

```
index.html      portada: wordmark + accesos (solo íconos)
works.html      grilla de aplicativos con filtros de año y tipo
ia.html         consola de transcripciones que llegan por webhook
todo.html       lista de pendientes por día — SIN acceso desde la portada
yo.html         perfil + links
```

Todas las páginas internas llevan una **flecha fija arriba a la izquierda**
que regresa a la portada.

`todo.html` está oculto: la portada ya no lo enlaza, pero la página sigue
viva y funcionando si entras por la URL directa. Para volver a mostrarlo,
descomenta su acceso en `index.html` — la grilla se reacomoda sola.

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
| 1 | `/api/airtable?t=works` | En Vercel. El token vive en el servidor. **Esta es la buena.** |
| 2 | Airtable directo | Solo si pones un token en `js/config.js`. ⚠️ Queda público. |
| 3 | `data/works.json` | Snapshot del repo. Es lo que corre en `npm run dev`. |

En local verás un `404` de `/api/airtable` en la consola: es la prueba del
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

Para verificar, abre `https://tu-dominio.vercel.app/api/airtable?t=works` — debe
devolver el JSON de Airtable. Y al pie de *Works* la nota debe decir
"Data en vivo desde Airtable" en vez de "Snapshot local".

> El token nunca llega al navegador: `api/airtable.js` corre en el servidor de
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

## Las otras dos tablas

La misma función sirve tres fuentes, con allowlist (no es un proxy abierto
a toda la base):

| Endpoint | Tabla | Para qué |
|----------|-------|----------|
| `/api/airtable?t=works`  | la del sitio | la grilla de Works |
| `/api/airtable?t=people` | `todo_amos`  | responsables del To-do |
| `/api/airtable?t=me`     | `yo`         | links de la sección Yo |

**`todo_amos`** — columnas que lee: `Name` (o `Nombre`), `icon` (attachment,
url o un emoji) y `visible` (checkbox). **`yo`** — `URL` (o `Link`), `img`
(attachment: sube ahí el PNG) y `visible`. Cada link se pinta como un cuadro
de 60x60 con borde gris y 5px de padding, con la imagen centrada y sin texto;
si el registro no trae `img`, se usa una imagen por defecto. **Solo aparecen
los links que estén en esa tabla**: si está vacía, la sección no muestra
ninguno.

Si la columna `visible` todavía no existe en la tabla, no se filtra nada —
así una tabla recién creada no aparece vacía. En cuanto agregues la columna
y la marques en al menos un registro, el filtro empieza a aplicar.

Si `todo_amos` no responde, el To-do usa los responsables de `js/config.js`
como respaldo. Los links de **Yo** no tienen respaldo: salen de Airtable o no
salen.

---

## IA · webhook de transcripciones

El sitio expone `POST https://fukudamiyasato.com/api/ia`:

```
Authorization: <el valor de la env INDEX_AUT>
Content-Type: application/json

{ "transcription": "el texto..." }
```

Respuestas: `200` con `{ok:true}`, `401` si el header no coincide, `400`
si falta `transcription`, `501` si `INDEX_AUT` no está configurada en
Vercel. También acepta el header como `Bearer <valor>`.

`ia.html` consulta `GET /api/ia` cada 2 s y, cuando entra una nueva,
dispara un `alert()` con el texto y la agrega al listado. Hay un botón
para silenciar el alert sin dejar de recibir.

> **Esto es un montaje de prueba.** La última transcripción se guarda en
> memoria de la función, no en una base: si Vercel levanta otra instancia o
> apaga la que estaba caliente, el `GET` puede devolver `null` aunque el
> `POST` haya entrado bien. El `POST` siempre queda en los logs de Vercel,
> así que ahí se puede confirmar. Para que sobreviva de verdad hay que
> persistirlo (Airtable, Vercel KV, Upstash…).
>
> El `GET` es **público**: cualquiera con la URL puede leer la última
> transcripción. Para probar está bien; si va a llevar contenido sensible,
> hay que ponerle autenticación.

---

## Interacción

**Works** — hover sobre un item: la capa oscura y el texto bajan de 50 % a
5 %, la card crece 10 % en su sitio y se ladea unos grados al azar (dirección
y ángulo se sortean en cada hover, hasta 20°), y suena la nota musical
asignada a ese item (5 notas: do, re, mi, sol, la). Si el registro trae
`URL`, la card es un link.

**To-do** — carrusel con 7 días atrás y 7 adelante. Hoy va en rojo; el día
seleccionado baja unos píxeles y rompe la línea gris, como una pestaña.

- deslizar **←** elimina (con trombón burlón); el item no desaparece: se
  queda al final del día con un mate rojo
- deslizar **→** marca como hecho: se va al final, con un mate verde
- en un hecho o eliminado, cualquier deslizada lo **repone** como activo
- **mantener presionado** levanta el item; suéltalo sobre otro día del
  carrusel para reasignarlo. Solo hacia hoy o más adelante — los días que ya
  pasaron se apagan durante el arrastre
- si lo mandas a un día posterior queda marcado **“Postergado N veces”**
- más de 5 tareas en un día (activas + hechas) y el contador del chip pasa
  a un **∞**

Los pendientes se guardan en `localStorage` del navegador.

Todos los sonidos se generan con la Web Audio API (`js/audio.js`), no hay
archivos de audio.

---

## Configuración

Casi todo vive en [`js/config.js`](js/config.js): credenciales de Airtable,
valores por defecto, textos y redes de **Yo**, y la lista de personas del
**To-do**.
