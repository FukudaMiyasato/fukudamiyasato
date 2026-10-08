# fukudamiyasato

Sitio personal estático — sin build. Se sirve en Vercel (las funciones de
`api/` y la única dependencia, `@vercel/blob`, para subir videos).

```
index.html      portada = portafolio: los videos de cada proyecto en secuencia + su tarjeta
works.html      Apps (antes Works) — SIN acceso desde la portada
ia.html         consola de transcripciones que llegan por webhook — SIN acceso desde la portada
todo.html       lista de pendientes por día — SIN acceso desde la portada
mic/            grabar con el dedo en vez de hablarle al webhook externo —
                SIN acceso desde la portada
support/        página de soporte para App Store / Google Play (FAQ + contacto)
marketing/      landing de las apps
privacy/        políticas de privacidad (una por app: privacy/kofres/)
admin/          login con Google + panel (Dashboards · Permisos; el amo supremo
                además Portafolio · Configuración). Sin botón en la portada:
                se entra escribiendo /admin
dashboards/     una sola página para todos: /dashboards/?d=<id>
```

`support/` y `marketing/` están en 6 idiomas (es, ja, en, it, fr, de) con
un selector arriba a la derecha; los textos viven en `js/i18n.js` y se
puede forzar uno con `?lang=xx`. La portada las enlaza discretamente en el pie.

Todas las páginas internas llevan una **flecha fija arriba a la izquierda**
que regresa a la portada.

`todo.html` y `mic/` están ocultas: la portada no las enlaza, pero
siguen vivas y funcionando si entras por la URL directa. Para volver a
mostrar `todo.html`, descomenta su acceso en `index.html` — la grilla se
reacomoda sola.

---

## Correr en local

```bash
npm run dev          # http://localhost:5190
```

Hace falta un servidor (aunque sea el de Python): las páginas usan módulos
ES y `fetch`, así que abrir el `index.html` con doble clic no funciona.

---

## Portada (portafolio)

La web pública es una sola página: los proyectos, uno tras otro. Arriba a la
izquierda el logo (FUKU y, debajo, «fullstack user centricity designer» del
mismo ancho); arriba a la derecha dos botones redondos: **correo**
(`mailto:fukuda.miyasato@gmail.com`) y **sonido**. No hay menú inferior ni
botón de login: el panel se abre escribiendo `/admin`.

**Proyectos** (`index.html`, `js/home.js`): cada proyecto pasa **sus videos en
secuencia** y, cuando termina el último, sigue el próximo (al final vuelve al
primero). De fondo, el video en **semitono** (`js/dither.js`, WebGL: un círculo
liso por celda, de su color y con radio según su luz, sobre negro; entre
videos, disolución por celdas). Encima, al centro-izquierda, la tarjeta: **dos
cuadrados** blancos semitransparentes del mismo tamaño — **Qué es** (con año y
nombre, chicos, bajo la etiqueta) y **Qué hice** (con las etiquetas «Testimonio
real» y/o «Generado con IA»). Si un texto es largo se corta con «…» (el cuadrado
no crece); si uno está vacío, se ve solo el otro. Un proyecto
sin videos (o una imagen de los proyectos viejos) dura el **tiempo sin video**
del panel. Flechas ← → del teclado cambian de proyecto.

**Sonido:** la experiencia es con audio, así que arranca activado. Los
navegadores no dejan sonar sin un toque previo: si lo bloquean, el video
arranca en silencio, aparece «Toca la pantalla para escuchar» y suena con el
primer toque o tecla. Apagarlo abre un modal («Esta experiencia es con audio
— ¿Seguro que quieres apagarlo?» · Apagar / Continuar); la elección dura la
sesión. Encenderlo de nuevo no pregunta.

**Panel → Portafolio** (solo amo supremo): cada proyecto tiene **nombre**,
**año** (por defecto el actual), **qué es** y **qué hice** (los dos cuadrados;
unas 30–40 palabras cada uno), **etiquetas** que se
muestran (checkbox: video generado con IA · testimonio real) y una lista de
**videos** (subirlos — varios a la vez — o pegar un link mp4/YouTube y Enter;
se ordenan con ↑ ↓). En la lista, ↑ ↓ cambian el orden de los proyectos y el
**switch** de cada fila los muestra u oculta (el oculto sigue en el panel,
atenuado; editarlo no lo vuelve visible). Si están todos ocultos, la portada
queda solo con el fondo; si no hay ninguno, se ve el de ejemplo
(`assets/portfolio/abc.mp4`). Se guarda en Redis (`fm:portfolio`); los
proyectos de formatos anteriores se convierten solos al leerlos (la «info» de
antes pasa a «qué es»).

**Videos de YouTube:** se guardan como `{ type: 'youtube', id }`. WebGL no
puede leerlos (iframe de otro dominio), así que la portada los muestra con el
reproductor oficial (su API avisa cuándo termina cada video) de fondo, un poco
agrandado para esconder el título, con una trama de puntos en CSS encima.

**Subir videos — Vercel Blob:** Vercel → Storage → Create → **Blob**
(**Public**) → **Connect Project** a este proyecto con **Production** marcado →
**redeploy** (las variables solo llegan a los despliegues nuevos). El archivo va
directo del navegador a Blob, hasta 200 MB; `api/upload.js` solo firma el
permiso, y solo para el amo supremo. Hay dos formas de autenticarse, según
cómo conectó Vercel el store, y se elige sola:
- **OIDC** (stores nuevos): variables `BLOB_STORE_ID` y
  `BLOB_WEBHOOK_PUBLIC_KEY`, sin token fijo; Vercel da una credencial que se
  renueva sola. Se firma con `handleUploadPresigned` + `issueSignedToken` y el
  navegador sube con `uploadPresigned` (`@vercel/blob` ≥ 2.8.1).
- **Token fijo**: `BLOB_READ_WRITE_TOKEN` (o con prefijo propio); se firma con
  `handleUpload` y el navegador sube con `upload`.
El editor de proyectos muestra si este despliegue ve Blob y en qué modo
(`GET /api/upload`, solo amo supremo; nunca devuelve valores). Mientras no
esté, se puede pegar un link.

**Estilo:** vectorial, en rojo (`css/site.css`): formas lisas, colores planos,
títulos en Space Grotesk y etiquetas en JetBrains Mono. El panel (`/admin`)
usa el mismo lenguaje (`css/vector.css`, `body.vx`); el lienzo de los
dashboards no cambia.

## APPS (antes Works)

`works.html` ya no tiene acceso desde la portada; sigue leyendo Airtable
(o `data/works.json`).

## WORKS · datos desde Airtable (fuente vieja)

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

## IA · voz → mini-app

La sección IA es una pantalla limpia: solo una nebulosa roja girando y el
botón de la esquina. Cuando entra una transcripción por el webhook, se
manda a GPT, GPT devuelve una página HTML que implementa lo pedido
("crea una calculadora", "un botón que contabilice") y esa app se ejecuta a
pantalla completa. Mientras GPT trabaja, la nebulosa gira 5× más rápido.
El botón pasa de flecha a **X**: cierra la app y vuelve a la espera.

### Variables de entorno

| Variable | Para qué |
|----------|----------|
| `INDEX_AUT` | secreto del webhook (ya la tienes) |
| `OPENAI_API_KEY` | la key de OpenAI |
| `OPENAI_MODEL` | opcional, por defecto `gpt-4o` |
| `TEST_ORDER_KEY` | clave de `/test/sendOrder/` (ver abajo) |

### Endpoints

```
POST /api/ia                 webhook (multipart, header Authorization)
GET  /api/ia                 última transcripción + metadata de la app
GET  /api/ia?app=1           el código de la app generada
POST /api/ia?generate=1      { id } -> genera la app con GPT
POST /api/ia?test=1          { key, text } -> ver /test/sendOrder/ abajo
GET  /api/ia?diag=1          qué variables ve la función
GET  /api/ia?diag=models     lo mismo + comprueba el modelo contra OpenAI
GET  /api/ia?diag=write      prueba Airtable de punta a punta
```

### Estado compartido (ia_state) — por qué existe

La última transcripción, la app generada y el último id descartado con el
shake NO viven en variables del proceso: Vercel no garantiza que dos
requests caigan en la misma instancia de la función, ni que una instancia
siga viva entre una y otra (se reciclan solas tras un rato sin tráfico).
Guardar ese estado en memoria hacía que el shake dijera "listo" en un
celular y otro dispositivo (atendido por otra instancia, o por una
instancia nueva que nunca se enteró) siguiera mostrando la app vieja para
siempre — o que a veces pareciera "atorarse" regenerando de más.

Ahora ese estado vive en Airtable, tabla **`ia_state`** (configurable con
`AIRTABLE_STATE_TABLE`): un único registro con tres columnas —
`latestJSON`, `appJSON` (la transcripción y la app, serializadas como
JSON) y `dismissedId` (texto simple). Se lee en cada poll y se escribe
cuando cambia algo (webhook, generación, dismiss) — no hace falta crearla
a mano, se crea sola la primera vez que hace falta escribir (mismo
mecanismo que `ia_save`/`ia_forms`, necesita el scope
`schema.bases:write` además de `data.records:write`).

Lo único que sigue viviendo solo en memoria es el `inflight` que evita
llamar dos veces seguidas a OpenAI para el mismo id — pero solo dentro de
una misma instancia; entre instancias distintas, en el peor caso se
genera dos veces (gasta de más, no rompe nada).

### `/test/sendOrder/` — probar sin hablarle al webhook

Un formulario con una clave y un textarea: manda el texto a
`POST /api/ia?test=1`, que hace exactamente lo que haría el webhook real
(guarda una transcripción nueva), y salta a `/ia.html` a verla ejecutarse.

No usa `INDEX_AUT` — usa su propia variable, `TEST_ORDER_KEY`, así esta
página no necesita conocer el secreto real del webhook. Sin esa variable
configurada, el endpoint responde `501` y la página no funciona.

Para ponerla:
```
vercel env add TEST_ORDER_KEY
```
o a mano en **Vercel → tu proyecto → Settings → Environment Variables**.
El valor: algo largo y random, nunca una frase fácil de adivinar —
```
openssl rand -hex 24
```
genera uno bueno. Para probar en local, ponla en `.env.local` (ver
`.env.example`); ese archivo está en `.gitignore`, así que nunca se sube.

`diag` nunca devuelve el valor de una variable: solo si existe, de qué
largo es y en qué entorno corre la función. `diag=write` crea un registro
vacío en `ia_save`, le cuelga un adjunto de prueba y borra todo: es la
única forma de comprobar de verdad los permisos de escritura. Sirve para distinguir una
variable que falta de una puesta en otro entorno o con espacios de más.

> **Las variables de entorno exigen redeploy.** Vercel no las inyecta en
> deployments ya creados: si agregas una y no vuelves a desplegar, la
> función la sigue viendo vacía.

El POST de generación no lleva `Authorization` porque lo llama el
navegador. Para que no sea un generador abierto — ni se te vaya el crédito
de OpenAI — solo acepta el id de la transcripción vigente y cachea el
resultado: **un mensaje, una llamada a la API**. No se pueden mandar
prompts sueltos.

### Cómo se ejecuta la app

En un `<iframe sandbox="allow-scripts allow-forms allow-modals">`, **sin**
`allow-same-origin`. El código lo escribe un modelo a partir de un mensaje
que llega de fuera, así que corre en un origen opaco: puede usar JS y verse
a pantalla completa, pero no puede leer el `localStorage` del sitio, ni las
cookies, ni llamar a `/api/ia`.

La app generada NO se guarda en el navegador (ni localStorage ni nada
parecido): si recargás la página, `ia.html` le pregunta al servidor si hay
una app vigente (el mismo estado compartido de arriba) y la retoma sin
repetir la animación de entrada. Si la cerraste con el shake, el servidor
ya sabe que se descartó, así que la próxima carga arranca en la nebulosa
— no hay caché local que pueda quedar desincronizada ni que haya que
limpiar a mano.

## Capacidades · el objeto FM

Para que las apps generadas no tengan que reinventar nada, el servidor
inyecta un SDK en cada página que devuelve el modelo. El prompt se lo
documenta, así que GPT llama a estas funciones en vez de escribir su propio
código de guardado o grabación:

```js
await FM.saveFile(blob, 'audio.webm')   // -> { id, filename, url, size }
await FM.saveText('hola', 'nota.txt')
await FM.saveJSON({ a: 1 }, 'datos.json')
await FM.saveForm('Contacto', { nombre: 'Ana', tel: '999' })  // -> { id, name, fields, url }
await FM.listFiles(20)                  // lo guardado antes, con sus urls
await FM.record.start()
await FM.record.stop({ save: true })    // -> { id, url, seconds, ... }
```

### Cómo funciona por dentro

La app está aislada: no puede llamar a `/api/ia` ni pedir el micrófono
(un origen opaco no obtiene `getUserMedia`). Así que **las capacidades
viven en la página contenedora**, que sí está en el dominio:

```
app (iframe)  --postMessage-->  ia.html  --fetch-->  /api/ia?save=1  -->  Airtable
app (iframe)  --postMessage-->  ia.html  --fetch-->  /api/ia?saveForm=1  -->  Airtable
```

`ia.html` solo atiende mensajes de su propio iframe (compara
`event.source`), convierte el Blob a base64 y hace la llamada autenticada.
La grabación de audio también ocurre en la página contenedora: el permiso
de micrófono se pide una vez en el dominio real y queda.

### Dónde se guarda

Tabla **`ia_save`** de la base, campo de adjuntos **`file`**. El registro se
crea vacío y el archivo se sube por la API de contenido de Airtable, que
acepta base64. Configurable con `AIRTABLE_SAVE_TABLE` y
`AIRTABLE_SAVE_FIELD`.

> El `AIRTABLE_TOKEN` necesita scope **`data.records:write`** sobre esta
> base, además del de lectura. Sin eso, guardar devuelve un error que lo
> dice explícitamente.

Límite por archivo: ~2.7 MB, porque Vercel corta los cuerpos de request en
4.5 MB y el base64 crece un tercio.

**`FM.saveForm`** guarda en la MISMA tabla `ia_save` que todo lo demás, no
en una tabla aparte: las respuestas del formulario se suben como un adjunto
`.json` (mismo mecanismo que `FM.saveJSON`). Así no depende de una tabla ni
de un scope adicional — si `ia_save` ya existe y ya guarda archivos,
`FM.saveForm` funciona sin configuración extra.

Si en algún momento `ia_save` tampoco existiera todavía, el servidor la
crea sola (con su columna de adjuntos) y reintenta el guardado — para eso
necesita, además de `data.records:write`, el scope **`schema.bases:write`**.
Sin ese scope, guardar devuelve un error que lo dice explícitamente; en ese
caso creá la tabla a mano (ver "Dónde se guarda" arriba) o agregá el scope
al token.

### El token de guardado

`?save=1` lo llama el navegador, así que no lleva `Authorization`. Va
firmado con HMAC sobre `INDEX_AUT`, atado al id de la app y con 24 h de
vigencia, y se verifica sin necesidad de estado compartido.

> Es una barrera contra el abuso casual, no autenticación real: quien abra
> la página obtiene un token válido. Para un dispositivo personal alcanza;
> si esto se vuelve público conviene ponerle algo más.

> La transcripción y la app generada viven en Airtable (`ia_state`, ver
> "Estado compartido" más arriba) con un respaldo en memoria si Airtable
> no está configurado — no en el navegador: recargar la página, o abrirla
> en otro dispositivo, siempre pregunta al servidor qué está vigente.

---

## /mic — grabar con el dedo, sin pasar por el webhook externo

Página aparte, pensada para el propio celular: un botón circular grande
que mientras lo mantenés presionado graba con el micrófono del navegador,
y al soltarlo manda el audio a Whisper. El texto que devuelve se guarda
como transcripción vigente — el mismo lugar que llena el webhook real o
`/test/sendOrder/` — así que dispara la generación de la app exactamente
igual, pasando por la misma función que le habla a GPT.

También tiene un botón de borrar (ícono de tacho, arriba a la derecha)
que hace lo mismo que sacudir el celular en IA: descarta la app vigente
para todos los dispositivos que la tengan abierta.

```
POST /api/ia?mic=1   { key, data (base64), contentType, filename }
```

Necesita `OPENAI_API_KEY` (la misma que usa la generación) y una clave
propia, **`MIC_KEY`** — misma idea que `TEST_ORDER_KEY`: una clave aparte
para que esta página no tenga que conocer el secreto real del webhook.
Sin `MIC_KEY` configurada, el endpoint responde `501` y la página no
funciona.

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

---

## Login y panel de administrador (`/admin`)

El botón **login** de la portada lleva a `/admin/`, que muestra el botón
"Acceder con Google". El servidor (`api/auth.js`) valida el token de Google
y decide:

| Rol | Quién | Qué puede hacer |
|-----|-------|-----------------|
| **Amo supremo** | `ADMIN_EMAIL` (fukuda.miyasato@gmail.com) | todo; es el único que crea, cambia y elimina **amos** |
| **Amo** | los que agregue el amo supremo | ve y edita todos los dashboards, crea dashboards y chismosos; no toca a otros amos |
| **Chismoso** | los que agregue cualquier amo | solo mira los dashboards que un amo le active |
| cualquier otro | — | "No tienes acceso" |

Un chismoso recién creado no ve nada: un amo le activa cada dashboard desde
el botón **Integrantes** (arriba a la derecha, dentro del dashboard), que
lista a todos los chismosos con un switch. Sin dashboards ve "No tienes
permisos"; con uno entra directo; con varios elige de una lista.

La sesión es una cookie `HttpOnly` firmada con `SESSION_SECRET` (7 días) y el
rol se vuelve a consultar en cada request: los cambios aplican al instante.

### Dashboards: lienzo de widgets

Cada dashboard (`/dashboards/?d=<id>`) es un lienzo con rejilla de puntos que
ocupa toda la pantalla; la cabecera flota encima (fondo al 50%, al 90% con el
mouse encima) igual que el dock:

- **Moverse:** arrastrar el fondo (o la rueda / el trackpad). Todos pueden.
- **Zoom:** control arriba a la derecha, debajo de la cabecera (− · esfera · +),
  blanco semitransparente. De 0,5× a 2×; la esfera al centro es 1×. También
  con Ctrl + rueda o pellizcando el trackpad (hacia el puntero). Cada navegador
  recuerda el zoom de cada dashboard.
- **Ojo de pez:** una sola función de lente (`warp` en `js/fisheye.js`) curva
  la rejilla y todo lo que va encima. Los puntos se dibujan desplazados en su
  canvas; las tarjetas, tablas y líneas se deforman con un filtro SVG
  `feDisplacementMap` cuyo mapa es la inversa exacta de esa lente
  (`unwarp` / `buildLensFilter`), así los bordes y las líneas de las tablas se
  curvan igual que la rejilla (no son rectángulos inclinados). La capa se
  pinta al doble de resolución antes de deformarla (supersampling) para que
  el texto no se vea dentado. Como un filtro no mueve dónde el navegador
  detecta los clics, `dashboard.js` los redirige: clic, arrastre, rueda y
  hover se traducen de lo que ves a dónde está cada elemento. La intensidad
  la elige el amo supremo en *Panel → Configuración* (de −20 a 20; 0 = sin
  efecto ni filtro, negativo = al revés) y aplica a todos los dashboards.
- **Amos:** dock de herramientas abajo; mueven los widgets desde su cabecera
  y los agrandan desde la esquina (encajan en la rejilla y no se enciman).
  **Mantener presionado** un widget hace temblar a todos y muestra un botón
  rojo para borrar cada uno; tocar el fondo o `Esc` sale de ese modo.
- **Chismosos:** solo miran; su dock tiene un único botón: actualizar la página.
- **Widgets con tres estados:** al tocar una herramienta aparece el widget en el
  lienzo con sus campos (*creación*); al aceptar pasa a *pensando* (carga al
  centro, no se puede tocar) y luego a *terminado* con la respuesta. Cada uno es
  independiente: puedes tener varios pensando a la vez. El lienzo se centra en
  el widget que lanzas y en cada uno que termina (2 s entre uno y otro si
  terminan juntos). "me arrepentí" lo descarta.
- **Herramientas de IA** (dock de los amos, `api/_lib/ai.js`):
  - **Tabla con IA:** pregunta + CSV opcional (máx. 2 MB). Con CSV interpreta
    esos datos; sin CSV responde con lo que sabe GPT. Elige el formato que
    mejor sirva: **tabla**, **gráfico** (barras o líneas), **número**
    destacado o **texto** corto. Archivos grandes se recortan a ~120k caracteres.
  - **Estrella roja:** solo una pregunta; responde con un párrafo como máximo.

  Si la pregunta está vacía, no tiene sentido o no se puede responder, el
  widget dice "No sirve tu tabla/pregunta", tiembla y se borra (el mensaje
  queda ~4,5 s para poder leerlo). El CSV no se
  guarda: solo la respuesta.
- **Línea de tiempo** (tercera herramienta, `js/timeline.js`): un círculo por
  hito unidos por una línea, y la cabeza de un personaje que avanza según los
  días transcurridos entre el hito anterior y el siguiente. Al crearla: inicio
  = hoy, fin = en 7 días. Cara según el tramo hacia el siguiente hito: primer
  30% durmiendo (Z Z Z), siguiente 40% normal, último 30% asustado (gotas); el
  día de un hito, asustado (salvo el inicio: durmiendo). Pasar el mouse por un
  hito muestra su nombre y los días que faltan. En su bloque de información se
  cambia el personaje (‹ cara ›), se editan nombres y fechas, y el + suma
  hitos: se ordenan solos por fecha y el widget crece con cada uno. Las caras
  están en `assets/faces/` (`m_*` chico, `f_*` chica; falta `m_scared.png`, que
  por ahora usa la cara normal).
- **Usuario** (cuarta herramienta, `js/persona.js`): un widget con la imagen y
  el nombre de un tipo de usuario. Empieza como el usuario por defecto; en su
  bloque de información van primero los archivos de contexto (arrastrando o
  eligiéndolos) y debajo el tipo, que se cambia con las flechas ‹ › entre los
  predefinidos (joven, papá divorciado, mamá soltera, familia feliz, nido
  vacío, jubilado). Por ahora la subida es
  simulada: solo se guarda el nombre y el tamaño de cada archivo. Imágenes en
  `assets/users/`.
- **Nebulosa de IA** (quinta herramienta): un widget con una nube de color que
  gira lento y estrellas. Por ahora solo se ve; se conecta como cualquier otro.
- **Maleta** (después de la separación del dock, redonda y color cuero): abre
  dos herramientas que **no son widgets** (sin tarjeta ni bloque de información).
  Se guardan en `fm:marks:<dashId>` y se quitan con el botón rojo en modo
  "tiemblan".
  - **Bandera:** se clava en el punto de la rejilla al centro de la vista, con
    un color al azar que no tenga otra (8 colores → máximo 8 banderas). Con la
    primera aparece, a la izquierda del zoom, un botón de bandera que despliega
    el listado; elegir una mueve el lienzo hasta dejarla al centro (también
    para los chismosos).
  - **Raya divisoria:** una línea blanca vertical sobre la columna de puntos
    siguiente a lo que esté más a la derecha (widgets y banderas). Solo una.
- **Seleccionar:** tocar un widget terminado lo marca con brillo rojo y abre, al
  centro-derecha, un bloque claro (sin lente, flota suave y se queda quieto con
  el mouse encima) con la pregunta usada, el archivo CSV, lo conectado y el
  tamaño de la respuesta. Tocar el fondo, la × o `Esc` lo cierra.
- **Borradores temporales:** un widget en creación que no se envía desaparece
  al tocar cualquier otra zona (salvo el + de otro widget, para poder
  conectarle cosas antes de preguntar).
- **Conectores:** cada widget tiene uno a la izquierda (recibe) y uno con **+**
  a la derecha (da). Arrastrar desde el + dibuja una línea roja; soltarla en el
  conector izquierdo de otro widget los conecta (si no, desaparece). Un mismo
  conector recibe varias líneas. Los puntos rojos de cada línea se ven encima de los conectores. Un **clic** en el + crea al lado, en un espacio libre y **sin
  línea**, un widget de la IA normal (estrella) ("pregunta porfa"): responde con
  un párrafo más libre (puede interpretar, relacionar y sugerir) usando la
  pregunta y como contexto ese widget más toda su cadena de widgets conectados
  hacia atrás (se envía como `about`, no se guarda como conexión). Mientras
  piensa, las líneas y esos widgets brillan y quedan bloqueados. Clic sobre una línea la quita.
  Las conexiones se guardan en `inputs` de cada widget.
- **OpenAI:** la IA usa siempre `OPENAI_API_KEY` (la del amo supremo).
- **Tokens** (`api/_lib/tokens.js`): cada herramienta de IA del lienzo (tabla
  con IA, la estrella y el + de un conector) cuesta tokens. Su **costo** se
  fija en *Panel → Configuración → Tokens*, a mano o con **Medir** (llama de
  verdad a la herramienta con un pedido de prueba y guarda los tokens que
  gastó). Encima va el **sobrecargo** (10 % por defecto): el usuario ve y paga
  costo + sobrecargo; la lista muestra los dos. Ahí mismo, el tipo de cambio
  (S/ por US$) y el precio de OpenAI (US$ por millón de tokens) con los que
  los soles se pasan a tokens.
  En *Panel → Permisos* el amo supremo asigna **soles** a cada persona (**+ S/**):
  se ve el monto en soles y su equivalente en tokens, que se suma a su saldo
  (en negativo, se lo quita). El usuario solo ve sus tokens, arriba en el
  dashboard, y el precio bajo cada herramienta de IA. Al pasar el mouse sobre
  una (las del dock o el + de un widget) sale un tooltip con su costo y, en
  letra chica, cuántos tokens le quedarían (o cuántos le faltan, en rojo). Se reserva antes de
  llamar a OpenAI y se devuelve si la IA no respondió o rechazó el pedido;
  sin saldo, la herramienta se apaga y el servidor responde 402. El amo
  supremo no tiene límite. Saldo en Redis: `fm:tokens:<correo>` (y
  `fm:soles:<correo>`, en céntimos), con INCRBY para que dos usos a la vez no
  se pisen.
- **Crear dashboards:** en el panel, la tarjeta **+ Nuevo dashboard** abre un
  modal con título e ícono opcional (una imagen; se recorta a 128×128). Sin
  imagen, el ícono son las iniciales del título. Se borran con la papelera de
  su cabecera; PROYECTO-JAZZ es fijo.

Para agregar otra herramienta al dock: súmala a `TOOLS` en `js/dashboard.js`
y su ícono a `TOOL_ICONS` en `js/dashboard-icons.js`.

### Configuración

1. **Google Cloud** → APIs & Services → Credentials → *Create credentials* →
   *OAuth client ID* → tipo **Web application**. En *Authorized JavaScript
   origins* agrega tu dominio y `http://localhost:3000`. (La pantalla de
   consentimiento puede quedar en modo *Testing* con tu correo como usuario
   de prueba, o publicarla para que entren clientes.)
2. **Base de datos** → Vercel → tu proyecto → *Storage* → *Create Database* →
   **Upstash for Redis** (plan gratis) → conéctala al proyecto. Vercel agrega
   solo `KV_REST_API_URL` y `KV_REST_API_TOKEN`. Ahí se guardan los permisos,
   los dashboards y sus widgets (`api/_lib/store.js`); no hay tablas ni
   columnas que crear. Sin ella igual puedes entrar al panel, pero no guardar.
3. **Vercel** → Environment Variables: `GOOGLE_CLIENT_ID` y `SESSION_SECRET`
   (ver `.env.example`). La tabla con IA usa la misma `OPENAI_API_KEY` que la
   sección IA. Redeploy.

En local hace falta `npx vercel dev`: con `npm run dev` no hay API y el
panel lo avisa.
