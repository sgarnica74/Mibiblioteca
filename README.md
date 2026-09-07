# Mi Biblioteca

Web personal para llevar el registro de los libros que has leído, que estás leyendo y que quieres leer. Hecha en HTML, CSS y JavaScript puro, sin frameworks ni librerías externas.

## Archivos

- `index.html` — estructura de la página
- `styles.css` — todo el diseño visual
- `app.js` — toda la lógica (búsqueda, tarjetas, guardado)
- `books.json` — tu "base de datos" en formato JSON, con 3 libros de ejemplo

## Cómo funciona el guardado y sincronización

La aplicación gestiona tus libros interactuando directamente con tu repositorio de GitHub:

1. **Sincronización directa con GitHub**: Al conectar la aplicación a GitHub, todos los libros se leen y escriben directamente en un archivo `.json` de tu repositorio. **No hay almacenamiento intermedio en el navegador (LocalStorage)** para los libros; esto evita confusiones de sincronización o pérdida de datos. ¡GitHub es tu única fuente de verdad!
2. **Backups automáticos (Ramas de versiones)**: Para mayor seguridad, cada vez que realizas un cambio (añadir, editar, borrar un libro), la aplicación no solo actualiza tu archivo principal, sino que también **crea de forma automática una rama (branch) de respaldo** en tu repositorio con la fecha y hora del cambio (por ejemplo, `backup-2026-09-07T14-30-00`). Así, tienes un historial completo de versiones y puedes recuperar tu biblioteca desde GitHub si cometes algún error.
3. **Modo local**: Si no tienes configurado GitHub, la aplicación simplemente intentará leer el archivo `books.json` en local.

La app incluye las siguientes herramientas en la barra inferior izquierda:

- **Exportar**: Descarga tu biblioteca actual como `books.json` (copia de seguridad manual).
- **Importar**: Carga un archivo `books.json` externo para sustituir los datos (y subirlos directamente a GitHub).
- **GitHub**: Abre el panel de configuración de la sincronización en la nube.

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

### 3. Resolución de conflictos inicial
- **Si el archivo ya existe en GitHub**: La aplicación te preguntará si deseas **Importar** los libros desde GitHub a tu vista actual o **Sobrescribir** el archivo de GitHub con la biblioteca que tengas abierta en ese momento.
- **Si el archivo no existe**: La aplicación creará un nuevo archivo `books.json` en tu repositorio.

### 4. Indicador de estado visual (Punto de color)
- **Verde**: Conectado y sincronizado con éxito.
- **Amarillo**: Cargando, error temporal de conexión o credenciales incorrectas.
- **Rojo**: Sincronización desactivada o desconfigurada.

---

## Cómo alojarla en Google Drive

Google Drive no ejecuta archivos HTML directamente (los abre como descarga, no como página web). Tienes dos opciones sencillas:

**Opción A — Uso local (la más simple):**
Guarda la carpeta completa (`index.html`, `styles.css`, `app.js`, `books.json`) sincronizada en tu Google Drive de escritorio, y haz doble clic en `index.html` para abrirla en el navegador cuando quieras usarla. Funciona sin conexión salvo para la búsqueda de libros y las recomendaciones (que sí necesitan internet).

**Opción B — Alojarla como web real (recomendado si quieres acceder desde el móvil):**
Sube estos mismos archivos a un hosting gratuito de páginas estáticas, por ejemplo GitHub Pages o Netlify, en un par de minutos y sin necesidad de saber programar. Así tendrás una URL fija a la que acceder desde cualquier dispositivo. Puedo ayudarte con estos pasos si quieres.

## La búsqueda de libros

Al pulsar el botón **+** y escribir un título, la app consulta la base de datos abierta de Open Library para autocompletar portada, autor, año y editorial. Es un servicio público gratuito, no una librería de código: no hace falta instalar nada.

Si no encuentra el libro, puedes rellenar los campos a mano y usar el botón **📷 Añadir foto** para subir o hacer una foto de la portada desde el móvil.

## Fecha de lectura

En el formulario de añadir/editar libro, justo después de la valoración, puedes indicar el mes y año en que leíste (o terminaste) el libro. Es opcional y se guarda internamente como `readDate` (formato `AAAA-MM`). Cuando está rellena, aparece en la tarjeta del libro como texto (p. ej. "Leído en agosto de 2026"). No aplica a los libros en estado "Quiero leer".

## Las recomendaciones del estante

El banner superior busca automáticamente otros libros de los mismos autores que tus libros mejor valorados (4-5 estrellas). Si aún no has valorado nada, usa el conjunto completo de tu biblioteca como referencia.
