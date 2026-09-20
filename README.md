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

### Dos formas de conectar

**A) En vivo desde el navegador.** Pon un token en `js/config.js`:

```js
airtable: { token: 'patXXXX...', baseId: 'appU39PYosvxt8FfG', ... }
```

> ⚠️ Ese archivo se publica, así que el token queda visible para cualquiera.
> Usa un PAT de **solo lectura** (`data.records:read`) limitado a esta base.

**B) Snapshot (recomendado para un sitio público).** Deja el token vacío y
regenera el archivo local cuando actualices la tabla:

```bash
AIRTABLE_TOKEN=patXXXX... npm run works:pull
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
