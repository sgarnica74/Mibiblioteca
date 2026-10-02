# Mi Biblioteca

Web personal para llevar el registro de los libros que has leído, que estás leyendo y que quieres leer. Hecha en HTML, CSS y JavaScript puro, sin frameworks ni librerías externas.

## Archivos

- `index.html` — estructura de la página
- `styles.css` — todo el diseño visual
- `app.js` — toda la lógica (búsqueda, tarjetas, guardado)
- `books.json` — tu "base de datos" en formato JSON, con 3 libros de ejemplo

## Cómo funciona el guardado y sincronización

GitHub es la **única fuente de verdad**. Los libros no se guardan nunca en el navegador (ni en localStorage ni en ningún otro sitio):

1. **Lectura y escritura directa en GitHub**: cada vez que abres la app con GitHub conectado, se lee el `books.json` real de tu repositorio. Cada vez que añades, editas o borras un libro, se escribe directamente ahí. No existe ninguna copia intermedia que pueda desincronizarse.
2. **Protección anti-conflicto**: justo antes de guardar, la app vuelve a comprobar la versión actual del archivo en GitHub. Si cambió desde la última vez que lo leíste (por ejemplo, lo editaste desde otro dispositivo), GitHub rechaza el guardado en vez de sobrescribirlo, y la app te avisa y recarga la versión correcta. **Es imposible machacar el archivo por accidente.**
3. **Backups automáticos (ramas de versiones)**: cada guardado exitoso crea además una rama de respaldo en tu repositorio con la fecha y hora (por ejemplo, `backup-2026-09-07T14-30-00`), para poder recuperar cualquier versión anterior desde el propio GitHub.
4. **Modo solo lectura**: si no tienes GitHub conectado, la app muestra el `books.json` de ejemplo incluido en el sitio, pero no te deja guardar cambios — verás un aviso pidiéndote que conectes tu repositorio (botón ☁️) para poder editar.

Lo único que se guarda en el navegador es la configuración de conexión (token, repositorio, rama y ruta), para no tener que volver a pegar el token cada vez que abres la página. Esto no incluye ningún libro.

---

## Configuración de la Sincronización con GitHub

Para activar la sincronización automática:

### 1. Requisitos previos
- Una cuenta en **GitHub**.
- Un repositorio creado (puede ser público o privado, ej: `mi-usuario/mi-biblioteca`).
- Un **Token de Acceso Personal (PAT)**. Puedes crearlo desde tu cuenta de GitHub en `Settings > Developer settings > Personal access tokens (classic)`. Asegúrate de otorgarle permisos de escritura en repositorios (`repo` o `contents: write`).

### 2. Conexión en la App
1. Pulsa el botón **☁️ GitHub** abajo a la izquierda.
2. Introduce tu **Token de Acceso Personal (PAT)**.
3. Escribe tu **Repositorio** exacto en formato `usuario/repositorio`.
4. (Opcional) Define la rama principal (por defecto `main`) y la ruta del archivo (por defecto `books.json`).
5. Pulsa **Conectar y Guardar**.

### 3. Qué pasa con el archivo al conectar
- **Si el archivo ya existe en GitHub**: se carga directamente, sin preguntar ni mezclar con nada. GitHub manda.
- **Si el archivo no existe todavía**: la aplicación lo crea con los libros que tengas en pantalla en ese momento (solo ocurre la primera vez, cuando no hay nada en GitHub con lo que pueda haber conflicto).

### 4. Indicador de estado visual (Punto de color)
- **Verde**: Conectado y sincronizado con éxito.
- **Amarillo**: Cargando, o error temporal de conexión/guardado.
- **Rojo**: Sin GitHub conectado — modo solo lectura.

---

## Cómo alojarla en Google Drive

Google Drive no ejecuta archivos HTML directamente (los abre como descarga, no como página web). Tienes dos opciones sencillas:

**Opción A — Uso local:**
Puedes guardar la carpeta completa (`index.html`, `styles.css`, `app.js`, `books.json`) en tu Google Drive de escritorio y abrir `index.html` con doble clic. Sin embargo, como GitHub es la única fuente de verdad, necesitas conectar tu repositorio (botón ☁️) para poder guardar cambios; sin conexión a GitHub la app solo te dejará consultar el `books.json` de ejemplo, en modo solo lectura. Recomendamos la Opción B.

**Opción B — Alojarla como web real (recomendado si quieres acceder desde el móvil):**
Sube estos mismos archivos a un hosting gratuito de páginas estáticas, por ejemplo GitHub Pages o Netlify, en un par de minutos y sin necesidad de saber programar. Así tendrás una URL fija a la que acceder desde cualquier dispositivo. Puedo ayudarte con estos pasos si quieres.

## La búsqueda de libros

Al pulsar el botón **+** y escribir un título, la app consulta la base de datos abierta de Open Library para autocompletar portada, autor, año y editorial. Es un servicio público gratuito, no una librería de código: no hace falta instalar nada.

Si no encuentra el libro, puedes rellenar los campos a mano y usar el botón **📷 Añadir foto** para subir o hacer una foto de la portada desde el móvil.

## Fecha de lectura

En el formulario de añadir/editar libro, justo después de la valoración, puedes indicar el mes y año en que leíste (o terminaste) el libro. Es opcional y se guarda internamente como `readDate` (formato `AAAA-MM`). Cuando está rellena, aparece en la tarjeta del libro como texto (p. ej. "Leído en agosto de 2026"). No aplica a los libros en estado "Quiero leer".

## Las recomendaciones del estante

El banner superior busca automáticamente otros libros de los mismos autores que tus libros mejor valorados (4-5 estrellas). Si aún no has valorado nada, usa el conjunto completo de tu biblioteca como referencia.
