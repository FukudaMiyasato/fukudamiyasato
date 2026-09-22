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

La app generada se guarda en el `localStorage` del navegador, así que
sobrevive a recargas. Si la cierras con la X, se recuerda que la cerraste y
la próxima carga arranca en la nebulosa.

## Capacidades · el objeto FM

Para que las apps generadas no tengan que reinventar nada, el servidor
inyecta un SDK en cada página que devuelve el modelo. El prompt se lo
documenta, así que GPT llama a estas funciones en vez de escribir su propio
código de guardado o grabación:

```js
await FM.saveFile(blob, 'audio.webm')   // -> { id, filename, url, size }
await FM.saveText('hola', 'nota.txt')
await FM.saveJSON({ a: 1 }, 'datos.json')
await FM.saveForm('Contacto', { nombre: 'Ana', tel: '999' })  // -> { id, name, fields, createdTime }
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

**`FM.saveForm`** usa una tabla aparte, **`ia_forms`** (configurable con
`AIRTABLE_FORMS_TABLE`), sin adjuntos: un registro por envío, con dos
columnas fijas — `formulario` (texto corto, el nombre que le puso GPT) y
`respuestas` (texto largo, el objeto de respuestas como JSON). Es genérica
a propósito: así cualquier formulario que se le pida a la IA se guarda sin
tener que crear columnas nuevas por cada uno.

Si la tabla no existe todavía, el propio servidor la crea sola la primera
vez que alguien guarda un formulario (con esas dos columnas) y reintenta el
guardado — ninguna app generada tiene que ocuparse de esto. Para eso el
`AIRTABLE_TOKEN` necesita, además de `data.records:write`, el scope
**`schema.bases:write`**. Si no lo tiene, guardar devuelve un error que lo
dice explícitamente; en ese caso creá la tabla a mano, con esas dos
columnas, o agregá el scope al token.

### El token de guardado

`?save=1` lo llama el navegador, así que no lleva `Authorization`. Va
firmado con HMAC sobre `INDEX_AUT`, atado al id de la app y con 24 h de
vigencia, y se verifica sin necesidad de estado compartido.

> Es una barrera contra el abuso casual, no autenticación real: quien abra
> la página obtiene un token válido. Para un dispositivo personal alcanza;
> si esto se vuelve público conviene ponerle algo más.

> Igual que antes, la transcripción y el código viven en memoria de la
> función. Si Vercel levanta otra instancia se pierden, pero la app ya
> guardada en el navegador sigue ahí.

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
