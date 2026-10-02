/* =========================================================
   MI BIBLIOTECA — lógica de la aplicación
   =========================================================
   ARQUITECTURA DE DATOS — GITHUB ES LA ÚNICA FUENTE DE VERDAD
   ---------------------------------------------------------
   · Los LIBROS (el array `books`) NO se guardan nunca en
     localStorage. Cada vez que se abre la app, si hay GitHub
     conectado, se leen en directo desde el books.json real
     del repositorio. No existe ninguna copia "en caché" que
     pueda quedarse desactualizada o pisar lo que hay en GitHub.
   · Cada guardado (añadir/editar/borrar un libro) vuelve a
     pedir el `sha` actual del archivo justo antes de escribir.
     Si el archivo cambió mientras tanto (por ejemplo, lo editaste
     desde otro dispositivo), GitHub RECHAZA la escritura con un
     conflicto 409 en vez de machacarlo, y la app te avisa y
     recarga la versión buena. Así es imposible sobrescribir sin
     darte cuenta.
   · Lo ÚNICO que se guarda en localStorage es la configuración
     de conexión (token / repositorio / rama / ruta). Esto NO es
     la base de datos de libros, son solo las credenciales, para
     no tener que volver a pegar el token cada vez que abres la
     página.
   · Si no hay GitHub conectado, la app entra en modo SOLO LECTURA:
     se muestra el books.json de ejemplo del propio sitio, pero no
     se puede guardar nada hasta conectar un repositorio.
   ========================================================= */

/* ---------------- CONFIGURACIÓN Y ESTADO GLOBAL ---------------- */
const GIT_CONFIG_KEY = "mi_biblioteca_git_config_v1"; // solo credenciales, nunca libros
const DATA_FILE = "books.json"; // biblioteca de ejemplo, usada solo en modo solo-lectura

let books = [];                 // los libros en memoria durante esta sesión
let isReadOnly = true;          // true mientras no haya GitHub conectado
let currentTab = "reading";
let editingId = null;
let selectedStatus = "quiero_leer";
let selectedRating = 0;
let searchDebounce = null;
let currentFilter = "all";
let currentViewMode = "grid";
let gitConfig = null;           // { token, repo, branch, path }
let gitFileSha = null;          // sha del último books.json leído de GitHub

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

/* ---------------- INICIO (INIT) ---------------- */
document.addEventListener("DOMContentLoaded", init);

async function init() {
  loadGitConfig();
  await loadBooks();
  populateReadYearOptions();
  renderAll();
  bindEvents();
}

function loadGitConfig() {
  const saved = localStorage.getItem(GIT_CONFIG_KEY);
  if (!saved) { gitConfig = null; return; }
  try {
    gitConfig = JSON.parse(saved);
  } catch (e) {
    gitConfig = null;
  }
}

function populateReadYearOptions() {
  const select = $("#readYearInput");
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 1900; y--) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    select.appendChild(opt);
  }
}

/* ---------------- CARGA DE LIBROS (GITHUB / SOLO LECTURA) ---------------- */

// Construye la URL de la API de contenidos de GitHub para el books.json configurado.
// `bust` añade un parámetro para evitar que el navegador sirva una respuesta cacheada.
function githubContentsUrl(bust = true) {
  const cleanRepo = gitConfig.repo.replace(/\/+$/, "");
  const cleanPath = (gitConfig.path || "books.json").replace(/^\/+/, "");
  const branch = gitConfig.branch || "main";
  let url = `https://api.github.com/repos/${cleanRepo}/contents/${cleanPath}?ref=${branch}`;
  if (bust) url += `&t=${Date.now()}`;
  return url;
}

async function loadBooks() {
  if (gitConfig && gitConfig.token && gitConfig.repo) {
    await loadBooksFromGitHub();
    return;
  }

  // Sin GitHub conectado: modo solo lectura con el books.json de ejemplo del sitio
  isReadOnly = true;
  updateGitStatusUI("red");
  try {
    const res = await fetch(DATA_FILE, { cache: "no-store" });
    books = res.ok ? await res.json() : [];
  } catch (e) {
    books = [];
  }
}

// Lee el books.json directamente de GitHub. Esta es la ÚNICA fuente de libros
// cuando hay una conexión configurada: no se combina con nada guardado localmente.
async function loadBooksFromGitHub() {
  updateGitStatusUI("yellow");
  try {
    const res = await fetch(githubContentsUrl(), {
      headers: { "Authorization": `token ${gitConfig.token}` }
    });
    if (!res.ok) throw new Error(`GitHub respondió ${res.status}`);

    const data = await res.json();
    gitFileSha = data.sha;
    books = JSON.parse(fromBase64Utf8(data.content));
    isReadOnly = false;
    updateGitStatusUI("green");
  } catch (e) {
    console.error("Error al cargar desde GitHub:", e);
    showToast("No se pudo leer el books.json de GitHub. Revisa la conexión.");
    updateGitStatusUI("yellow");
    books = [];
    isReadOnly = true;
  }
}

/* ---------------- GUARDADO EN GITHUB (CON PROTECCIÓN ANTI-CONFLICTO) ---------------- */
async function saveBooks() {
  if (isReadOnly || !gitConfig || !gitConfig.token || !gitConfig.repo) {
    showToast("Conecta tu repositorio de GitHub (☁️) para poder guardar cambios");
    return false;
  }

  // Aviso preventivo: por encima de 1 MB, la API de GitHub deja de devolver
  // el contenido del archivo al leerlo, y la app no podría volver a cargarlo.
  const payloadSize = new Blob([JSON.stringify(books)]).size;
  if (payloadSize > 900 * 1024) {
    showToast("Aviso: la biblioteca pesa mucho (fotos muy grandes). Usa fotos más ligeras.");
  }

  updateGitStatusUI("yellow");
  try {
    // 1. Releer el sha justo antes de escribir: es la base de la protección
    //    anti-conflicto. Si alguien cambió el archivo entretanto, el sha que
    //    enviemos no coincidirá y GitHub rechazará la escritura (409) en vez
    //    de dejarnos machacarla.
    const getRes = await fetch(githubContentsUrl(), {
      headers: { "Authorization": `token ${gitConfig.token}` }
    });
    const currentSha = getRes.ok ? (await getRes.json()).sha : gitFileSha;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const payload = {
      message: `Actualizar biblioteca desde Mi Biblioteca - ${timestamp}`,
      content: toBase64Utf8(JSON.stringify(books, null, 2)),
    };
    if (currentSha) payload.sha = currentSha;

    const putRes = await fetch(githubContentsUrl(false), {
      method: "PUT",
      headers: {
        "Authorization": `token ${gitConfig.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (putRes.status === 409) {
      // Conflicto real: el archivo cambió en GitHub desde la última lectura.
      // En vez de forzar la escritura, recargamos la versión buena y avisamos.
      showToast("La biblioteca cambió en GitHub mientras editabas. Recargando la versión más reciente…");
      await loadBooksFromGitHub();
      renderAll();
      return false;
    }

    if (!putRes.ok) throw new Error(`GitHub respondió ${putRes.status} al guardar`);

    const putData = await putRes.json();
    gitFileSha = putData.content.sha;
    updateGitStatusUI("green");
    createBackupBranch(putData.commit.sha, timestamp);
    return true;
  } catch (e) {
    console.error("Error al guardar en GitHub:", e);
    showToast("Error al guardar en GitHub");
    updateGitStatusUI("yellow");
    return false;
  }
}

// Copia de seguridad: cada guardado crea además una rama con esa versión exacta,
// para poder recuperar cualquier estado anterior desde el propio GitHub.
async function createBackupBranch(commitSha, timestamp) {
  const branchName = `backup-${timestamp}`;
  try {
    await fetch(`https://api.github.com/repos/${gitConfig.repo}/git/refs`, {
      method: "POST",
      headers: {
        "Authorization": `token ${gitConfig.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ref: `refs/heads/${branchName}`, sha: commitSha }),
    });
  } catch (e) {
    console.error("No se pudo crear la rama de respaldo", e);
  }
}

function uid() {
  return "b_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7);
}

/* ---------------- RENDER ---------------- */
function renderAll() {
  renderGrid("leido_leyendo", "gridReading", "emptyReading");
  renderGrid("quiero_leer", "gridWishlist", "emptyWishlist");
  renderGrid("abandonado", "gridAbandoned", "emptyAbandoned");
  renderShelf();
  renderStats();
}

function renderStats() {
  const readBooks = books.filter(b => b.status === "leido");
  
  // 1. Total libros leídos
  $("#statTotalBooks").textContent = readBooks.length;
  
  // 2. Leídos este año
  const currentYear = new Date().getFullYear().toString();
  const yearBooks = readBooks.filter(b => b.readDate && b.readDate.startsWith(currentYear));
  $("#statYearBooks").textContent = yearBooks.length;
  
  // Función auxiliar para sacar el más frecuente
  const getMostFrequent = (arr) => {
    if (arr.length === 0) return "—";
    const counts = {};
    let maxCount = 0;
    let maxItem = "—";
    for (const item of arr) {
      if (!item) continue;
      counts[item] = (counts[item] || 0) + 1;
      if (counts[item] > maxCount) {
        maxCount = counts[item];
        maxItem = item;
      }
    }
    return maxItem;
  };

  // 3. Autor más leído
  const authors = readBooks.map(b => b.author).filter(Boolean);
  let topAuthor = getMostFrequent(authors);
  if (topAuthor.length > 20) topAuthor = topAuthor.substring(0, 18) + "...";
  $("#statTopAuthor").textContent = topAuthor;
  $("#statTopAuthor").title = topAuthor; 

  // 4. Género favorito
  const genres = readBooks.map(b => b.genre).filter(Boolean);
  let topGenre = getMostFrequent(genres);
  if (topGenre.length > 20) topGenre = topGenre.substring(0, 18) + "...";
  $("#statTopGenre").textContent = topGenre;
  $("#statTopGenre").title = topGenre;
}

function renderGrid(group, gridId, emptyId) {
  const grid = $("#" + gridId);
  const empty = $("#" + emptyId);
  let list;
  if (group === "leido_leyendo") {
    list = books.filter(b => b.status === "leido" || b.status === "leyendo");
    if (currentFilter !== "all") {
      list = list.filter(b => b.status === currentFilter);
    }
  } else if (group === "quiero_leer") {
    list = books.filter(b => b.status === "quiero_leer");
  } else if (group === "abandonado") {
    list = books.filter(b => b.status === "abandonado");
  }

  grid.innerHTML = "";

  if (currentViewMode === "list") {
    grid.classList.add("view-list");
  } else {
    grid.classList.remove("view-list");
  }

  if (list.length === 0) {
    if (group === "leido_leyendo") {
      if (currentFilter === "leyendo") {
        empty.innerHTML = "No tienes ningún libro en estado <strong>Leyendo</strong> en este momento.";
      } else if (currentFilter === "leido") {
        empty.innerHTML = "No tienes ningún libro en estado <strong>Leído</strong> en este momento.";
      } else {
        empty.innerHTML = "Aún no has añadido ningún libro leído. Pulsa el botón <strong>+</strong> para empezar tu estantería.";
      }
    }
    empty.hidden = false;
    return;
  }
  empty.hidden = true;

  list.forEach(book => {
    grid.appendChild(buildCard(book));
  });
}

function buildCard(book) {
  const card = document.createElement("div");
  card.className = "book-card status-" + book.status;

  const cover = document.createElement("div");
  cover.className = "book-cover";
  if (book.cover) {
    cover.style.backgroundImage = `url(${book.cover})`;
  } else {
    cover.textContent = book.title || "Sin título";
  }
  const flag = document.createElement("span");
  flag.className = "status-flag " + book.status;
  if (book.status === "leido") flag.textContent = "Leído";
  else if (book.status === "leyendo") flag.textContent = "Leyendo";
  else if (book.status === "abandonado") flag.textContent = "Abandonado";
  else flag.textContent = "Pendiente";
  
  cover.appendChild(flag);
  card.appendChild(cover);

  const body = document.createElement("div");
  body.className = "book-body";

  const infoMain = document.createElement("div");
  infoMain.className = "book-info-main";

  const title = document.createElement("div");
  title.className = "book-title";
  title.textContent = book.title || "Sin título";
  infoMain.appendChild(title);

  const meta = document.createElement("div");
  meta.className = "book-meta";
  meta.textContent = [book.author, book.year, book.publisher].filter(Boolean).join(" · ");
  infoMain.appendChild(meta);

  const stars = document.createElement("div");
  const filled = book.rating || 0;
  stars.className = "book-stars" + (filled === 0 ? " empty" : "");
  stars.textContent = filled === 0 ? "☆☆☆☆☆" : "★".repeat(filled) + "☆".repeat(5 - filled);
  infoMain.appendChild(stars);

  if (book.readDate) {
    const readDate = document.createElement("div");
    readDate.className = "book-read-date";
    readDate.textContent = formatReadDate(book.readDate);
    infoMain.appendChild(readDate);
  }

  if (book.recommendation) {
    const r = document.createElement("div");
    r.className = "book-comments";
    r.innerHTML = `<strong>Recomendado a:</strong> ${escapeHtml(book.recommendation)}`;
    infoMain.appendChild(r);
  }

  if (book.comments) {
    const c = document.createElement("div");
    c.className = "book-comments";
    c.textContent = book.comments;
    infoMain.appendChild(c);
  }

  body.appendChild(infoMain);

  const footer = document.createElement("div");
  footer.className = "book-footer";

  if (book.status === "leido" || book.status === "leyendo") {
    const label = document.createElement("label");
    label.className = "finished-toggle";
    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.checked = book.status === "leido";
    cb.addEventListener("change", async () => {
      if (isReadOnly) {
        showToast("Conecta tu repositorio de GitHub (☁️) para poder guardar cambios");
        cb.checked = !cb.checked;
        return;
      }
      const previousStatus = book.status;
      book.status = cb.checked ? "leido" : "leyendo";
      const ok = await saveBooks();
      if (!ok) book.status = previousStatus;
      renderAll();
    });
    label.appendChild(cb);
    label.appendChild(document.createTextNode("Terminado"));
    footer.appendChild(label);
  } else {
    footer.appendChild(document.createElement("span"));
  }

  const editBtn = document.createElement("button");
  editBtn.className = "edit-link";
  editBtn.textContent = "Editar";
  editBtn.addEventListener("click", () => openModal(book.id));
  footer.appendChild(editBtn);

  body.appendChild(footer);
  card.appendChild(body);
  return card;
}

/* ---------------- SHELF (recomendaciones) ---------------- */
async function renderShelf() {
  const track = $("#shelfTrack");
  track.innerHTML = "";

  const favorites = books.filter(b => b.status === "leido" && (b.rating || 0) >= 4);
  const source = favorites.length ? favorites : books;

  if (source.length === 0) {
    track.innerHTML = `<div class="spine placeholder">Añade libros a tu biblioteca<br>para ver recomendaciones aquí</div>`;
    return;
  }

  // toma hasta 3 autores/géneros distintos de tus favoritos como semillas
  const seeds = [...new Set(source.map(b => b.author).filter(Boolean))].slice(0, 3);
  if (seeds.length === 0) {
    track.innerHTML = `<div class="spine placeholder">Añade autor o género a tus libros<br>para ver recomendaciones</div>`;
    return;
  }

  track.innerHTML = `<div class="spine placeholder">Buscando<br>recomendaciones...</div>`;

  try {
    const results = [];
    for (const author of seeds) {
      const res = await fetch(`https://openlibrary.org/search.json?author=${encodeURIComponent(author)}&limit=6&fields=title,author_name,first_publish_year,publisher,subject,cover_i`);
      if (!res.ok) continue;
      const data = await res.json();
      (data.docs || []).forEach(d => results.push(d));
    }
    // filtra libros que ya tenemos
    const ownedTitles = new Set(books.map(b => (b.title || "").toLowerCase()));
    const filtered = results.filter(d => d.title && !ownedTitles.has(d.title.toLowerCase()));
    const unique = [];
    const seenTitles = new Set();
    for (const d of filtered) {
      const key = d.title.toLowerCase();
      if (!seenTitles.has(key)) { seenTitles.add(key); unique.push(d); }
      if (unique.length >= 12) break;
    }

    track.innerHTML = "";
    if (unique.length === 0) {
      track.innerHTML = `<div class="spine placeholder">No encontramos recomendaciones<br>nuevas por ahora</div>`;
      return;
    }
    unique.forEach((d, i) => {
      const spine = document.createElement("div");
      spine.className = "spine";
      spine.style.setProperty("--tilt", (i % 2 === 0 ? "-1.5deg" : "1.5deg"));
      spine.title = `Pulsa para añadir "${d.title}" a tu biblioteca`;

      if (d.cover_i) {
        spine.style.backgroundImage = `url(https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg)`;
      } else {
        spine.style.background = "linear-gradient(160deg, var(--wood-light), var(--wood))";
      }
      const info = document.createElement("div");
      info.className = "spine-info";
      info.innerHTML = `<span class="spine-title">${escapeHtml(d.title)}</span><span class="spine-sub">${escapeHtml((d.author_name || [])[0] || "")}</span>`;
      spine.appendChild(info);

      spine.addEventListener("click", () => openModal(null, d));

      track.appendChild(spine);
    });
  } catch (e) {
    track.innerHTML = `<div class="spine placeholder">No se pudieron cargar<br>recomendaciones ahora mismo</div>`;
  }
}

function formatReadDate(value) {
  // value tiene formato "YYYY-MM"
  const [year, month] = (value || "").split("-");
  if (!year || !month) return "";
  const meses = ["enero", "febrero", "marzo", "abril", "mayo", "junio",
                 "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const idx = Number(month) - 1;
  if (idx < 0 || idx > 11) return value;
  return `Leído en ${meses[idx]} de ${year}`;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

/* ---------------- SINCRONIZACIÓN DE GITHUB ---------------- */
function toBase64Utf8(str) {
  return btoa(unescape(encodeURIComponent(str)));
}

function fromBase64Utf8(base64) {
  return decodeURIComponent(escape(atob(base64.replace(/\s/g, ""))));
}

function updateGitStatusUI(status) {
  const dot = $("#gitSyncStatus");
  if (!dot) return;
  dot.className = "dot-status " + status;
  if (status === "green") {
    dot.parentElement.title = "Conectado y Sincronizado con GitHub";
  } else if (status === "yellow") {
    dot.parentElement.title = "Problema de sincronización o cargando...";
  } else {
    dot.parentElement.title = "Sincronización desconfigurada";
  }
}

function openGitModal() {
  const overlay = $("#gitModalOverlay");
  $("#gitToken").value = gitConfig?.token || "";
  $("#gitRepo").value = gitConfig?.repo || "";
  $("#gitBranch").value = gitConfig?.branch || "main";
  $("#gitPath").value = gitConfig?.path || "books.json";
  overlay.hidden = false;
}

function closeGitModal() {
  $("#gitModalOverlay").hidden = true;
}

async function disconnectGit() {
  if (!confirm("¿Seguro que quieres desconectar la sincronización de GitHub?\n(Tus libros se conservan en tu repositorio; la app pasará a modo solo lectura)")) {
    return;
  }
  gitConfig = null;
  gitFileSha = null;
  isReadOnly = true;
  localStorage.removeItem(GIT_CONFIG_KEY);
  await loadBooks(); // recarga el books.json de ejemplo en modo solo lectura
  renderAll();
  updateGitStatusUI("red");
  closeGitModal();
  showToast("GitHub desconectado");
}

async function testAndConnectGit() {
  const token = $("#gitToken").value.trim();
  const repo = $("#gitRepo").value.trim().replace(/\/+$/, "");
  const branch = $("#gitBranch").value.trim() || "main";
  const path = $("#gitPath").value.trim().replace(/^\/+/, "") || "books.json";

  if (!token || !repo) {
    showToast("Introduce el Token y el Repositorio");
    return;
  }

  const connectBtn = $("#btnGitSave");
  const originalText = connectBtn.textContent;
  connectBtn.textContent = "Conectando...";
  connectBtn.disabled = true;

  // Probamos la conexión con esta configuración antes de darla por buena
  gitConfig = { token, repo, branch, path };

  try {
    const res = await fetch(githubContentsUrl(), {
      headers: { "Authorization": `token ${token}` }
    });

    if (res.ok) {
      // El archivo ya existe en GitHub: es la única fuente de la verdad,
      // así que lo cargamos tal cual, sin mezclar con nada de esta sesión.
      await loadBooksFromGitHub();
      localStorage.setItem(GIT_CONFIG_KEY, JSON.stringify(gitConfig));
      renderAll();
      closeGitModal();
      showToast(`¡Conectado! Se han cargado ${books.length} libros de GitHub`);
    } else if (res.status === 404) {
      // El archivo no existe todavía: lo creamos con lo que haya ahora mismo
      // en memoria (normalmente el books.json de ejemplo, en modo solo lectura).
      const payload = {
        message: "Crear archivo de biblioteca",
        content: toBase64Utf8(JSON.stringify(books, null, 2))
      };
      const createRes = await fetch(githubContentsUrl(false), {
        method: "PUT",
        headers: {
          "Authorization": `token ${token}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });
      if (!createRes.ok) throw new Error(`Fallo al crear archivo: Error ${createRes.status}`);

      const createData = await createRes.json();
      gitFileSha = createData.content.sha;
      isReadOnly = false;
      localStorage.setItem(GIT_CONFIG_KEY, JSON.stringify(gitConfig));
      updateGitStatusUI("green");
      closeGitModal();
      showToast("¡Conectado! Archivo creado en GitHub");
    } else {
      throw new Error(`Credenciales/Permisos: Error ${res.status}`);
    }
  } catch (err) {
    console.error("Error en testAndConnectGit:", err);
    gitConfig = null; // la conexión probada ha fallado: no la damos por buena
    showToast(`Error: ${err.message}. Revisa la consola (F12)`);
  } finally {
    connectBtn.textContent = originalText;
    connectBtn.disabled = false;
  }
}

/* ---------------- MODAL ---------------- */
function openModal(bookId, seedData = null) {
  editingId = bookId || null;
  const overlay = $("#modalOverlay");
  const book = bookId ? books.find(b => b.id === bookId) : null;

  $("#modalTitle").textContent = book ? "Editar libro" : "Añadir libro";
  $("#btnDelete").hidden = !book;
  $("#searchInput").value = "";
  $("#autocompleteList").hidden = true;

  if (book) {
    $("#titleInput").value = book.title || "";
    $("#yearInput").value = book.year || "";
    $("#authorInput").value = book.author || "";
    $("#publisherInput").value = book.publisher || "";
    $("#genreInput").value = book.genre || "";
    const [readYear, readMonth] = (book.readDate || "").split("-");
    $("#readMonthInput").value = readMonth || "";
    $("#readYearInput").value = readYear || "";
    $("#commentsInput").value = book.comments || "";
    $("#recommendationInput").value = book.recommendation || "";
    $("#coverUrlInput").value = "";
    setCoverPreview(book.cover || "");
    selectedStatus = book.status || "leido";
    selectedRating = book.rating || 0;
  } else if (seedData) {
    $("#titleInput").value = seedData.title || "";
    $("#yearInput").value = seedData.year || seedData.first_publish_year || "";
    $("#authorInput").value = seedData.author || (seedData.author_name || [])[0] || "";
    const pub = Array.isArray(seedData.publisher) ? seedData.publisher[0] : (seedData.publisher || "");
    $("#publisherInput").value = pub || "";
    const genre = Array.isArray(seedData.subject) ? seedData.subject[0] : (seedData.genre || seedData.subject || "");
    $("#genreInput").value = genre || "";
    $("#readMonthInput").value = "";
    $("#readYearInput").value = "";
    $("#commentsInput").value = "";
    $("#recommendationInput").value = "";
    $("#coverUrlInput").value = "";
    const coverUrl = seedData.cover || (seedData.cover_i ? `https://covers.openlibrary.org/b/id/${seedData.cover_i}-M.jpg` : "");
    setCoverPreview(coverUrl);
    selectedStatus = "quiero_leer";
    selectedRating = 0;
  } else {
    $("#titleInput").value = "";
    $("#yearInput").value = "";
    $("#authorInput").value = "";
    $("#publisherInput").value = "";
    $("#genreInput").value = "";
    $("#readMonthInput").value = "";
    $("#readYearInput").value = "";
    $("#commentsInput").value = "";
    $("#recommendationInput").value = "";
    $("#coverUrlInput").value = "";
    setCoverPreview("");
    if (currentTab === "wishlist") selectedStatus = "quiero_leer";
    else if (currentTab === "abandoned") selectedStatus = "abandonado";
    else selectedStatus = "leido";
    selectedRating = 0;
  }

  updateStatusUI();
  updateStarsUI();

  overlay.hidden = false;
}

function closeModal() {
  $("#modalOverlay").hidden = true;
  editingId = null;
}

function setCoverPreview(url) {
  const img = $("#coverImg");
  const placeholder = $("#coverPlaceholder");
  if (url) {
    img.src = url;
    img.hidden = false;
    placeholder.hidden = true;
  } else {
    img.hidden = true;
    placeholder.hidden = false;
  }
  $("#coverPreview").dataset.cover = url || "";
}

function updateStatusUI() {
  $$(".status-opt").forEach(btn => {
    btn.classList.toggle("selected", btn.dataset.status === selectedStatus);
  });
}

function updateStarsUI() {
  $$(".star").forEach(btn => {
    const val = Number(btn.dataset.val);
    btn.classList.toggle("filled", val <= selectedRating);
  });
}

async function saveFromModal() {
  if (isReadOnly) {
    showToast("Conecta tu repositorio de GitHub (☁️) para poder guardar libros");
    return;
  }
  const title = $("#titleInput").value.trim();
  if (!title) {
    showToast("Escribe al menos el título del libro");
    return;
  }
  const cover = $("#coverUrlInput").value.trim() || $("#coverPreview").dataset.cover || "";

  const readMonth = $("#readMonthInput").value;
  const readYear = $("#readYearInput").value;
  const readDate = (readMonth && readYear) ? `${readYear}-${readMonth}` : "";

  const data = {
    title,
    year: $("#yearInput").value.trim(),
    author: $("#authorInput").value.trim(),
    publisher: $("#publisherInput").value.trim(),
    genre: $("#genreInput").value.trim(),
    cover,
    status: selectedStatus,
    rating: selectedStatus === "quiero_leer" ? 0 : selectedRating,
    readDate: selectedStatus === "quiero_leer" ? "" : readDate,
    comments: selectedStatus === "quiero_leer" ? "" : $("#commentsInput").value.trim(),
    recommendation: selectedStatus === "quiero_leer" ? "" : $("#recommendationInput").value.trim(),
  };

  // Guardamos una copia por si GitHub rechaza la escritura y hay que deshacer
  const previousBooks = books;
  if (editingId) {
    const idx = books.findIndex(b => b.id === editingId);
    books = books.map((b, i) => i === idx ? { ...b, ...data } : b);
  } else {
    books = [...books, { id: uid(), ...data }];
  }

  const ok = await saveBooks();
  if (!ok) {
    books = previousBooks; // deshacemos el cambio en memoria si no se pudo guardar
    renderAll();
    return;
  }
  renderAll();
  closeModal();
  showToast("Libro guardado");
}

async function deleteCurrent() {
  if (isReadOnly) {
    showToast("Conecta tu repositorio de GitHub (☁️) para poder eliminar libros");
    return;
  }
  if (!editingId) return;

  const previousBooks = books;
  books = books.filter(b => b.id !== editingId);

  const ok = await saveBooks();
  if (!ok) {
    books = previousBooks;
    renderAll();
    return;
  }
  renderAll();
  closeModal();
  showToast("Libro eliminado");
}

/* ---------------- BÚSQUEDA / AUTOCOMPLETE ---------------- */
function handleSearchInput(e) {
  const q = e.target.value.trim();
  clearTimeout(searchDebounce);
  if (q.length < 3) {
    $("#autocompleteList").hidden = true;
    return;
  }
  searchDebounce = setTimeout(() => runSearch(q), 400);
}

async function runSearch(q) {
  const list = $("#autocompleteList");
  list.hidden = false;
  list.innerHTML = `<div class="ac-empty">Buscando...</div>`;
  try {
    let combinedResults = [];
    
    // 1. Buscar en Google Books (suele tener mejores portadas y datos en español)
    try {
      const gbRes = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=5`);
      if (gbRes.ok) {
        const gbData = await gbRes.json();
        if (gbData.items) {
          gbData.items.forEach(item => {
            const vol = item.volumeInfo;
            if (!vol) return;
            // Asegurarnos de usar https para las imágenes de Google
            let coverUrl = vol.imageLinks?.thumbnail || vol.imageLinks?.smallThumbnail || "";
            if (coverUrl) coverUrl = coverUrl.replace(/^http:/, "https:");
            
            combinedResults.push({
              source: "google",
              title: vol.title,
              author: (vol.authors || [])[0] || "",
              year: (vol.publishedDate || "").substring(0, 4),
              publisher: vol.publisher || "",
              genre: (vol.categories || [])[0] || "",
              coverThumb: coverUrl, 
              coverFull: coverUrl,
              id: item.id
            });
          });
        }
      }
    } catch (e) { console.error("Error Google Books:", e); }

    // 2. Buscar en OpenLibrary como respaldo o para rellenar
    if (combinedResults.length < 6) {
      try {
        const olRes = await fetch(`https://openlibrary.org/search.json?q=${encodeURIComponent(q)}&limit=5&fields=title,author_name,first_publish_year,publisher,subject,cover_i,key`);
        if (olRes.ok) {
          const olData = await olRes.json();
          (olData.docs || []).forEach(d => {
            combinedResults.push({
              source: "openlibrary",
              title: d.title,
              author: (d.author_name || [])[0] || "",
              year: d.first_publish_year || "",
              publisher: (d.publisher || [])[0] || "",
              genre: (d.subject || [])[0] || "",
              coverThumb: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-S.jpg` : "",
              coverFull: d.cover_i ? `https://covers.openlibrary.org/b/id/${d.cover_i}-M.jpg` : "",
              id: d.key
            });
          });
        }
      } catch (e) { console.error("Error OpenLibrary:", e); }
    }

    // Filtrar duplicados por título aproximado
    const uniqueResults = [];
    const seenTitles = new Set();
    for (const res of combinedResults) {
      const t = (res.title || "").toLowerCase().trim();
      if (!seenTitles.has(t) && t !== "") {
        seenTitles.add(t);
        uniqueResults.push(res);
      }
      if (uniqueResults.length >= 8) break; // Máximo 8 resultados
    }

    if (uniqueResults.length === 0) {
      list.innerHTML = `<div class="ac-empty">Sin resultados. Puedes rellenar los campos a mano y añadir una foto.</div>`;
      return;
    }
    
    list.innerHTML = "";
    uniqueResults.forEach(d => {
      const item = document.createElement("div");
      item.className = "ac-item";
      item.innerHTML = `
        ${d.coverThumb ? `<img src="${d.coverThumb}" alt="">` : `<div style="width:32px;height:46px;background:var(--paper-deep);flex-shrink:0;"></div>`}
        <div class="ac-text">
          <div>${escapeHtml(d.title)}</div>
          <div class="ac-author">${escapeHtml(d.author)} · ${d.year || "—"}</div>
        </div>`;
      item.addEventListener("click", () => selectSearchResult(d));
      list.appendChild(item);
    });
  } catch (e) {
    list.innerHTML = `<div class="ac-empty">No se pudo buscar. Rellena los campos a mano.</div>`;
  }
}

function selectSearchResult(d) {
  $("#titleInput").value = d.title || "";
  $("#authorInput").value = d.author || "";
  $("#yearInput").value = d.year || "";
  $("#publisherInput").value = d.publisher || "";
  $("#genreInput").value = d.genre || "";
  if (d.coverFull) {
    setCoverPreview(d.coverFull);
  } else {
    setCoverPreview("");
  }
  $("#autocompleteList").hidden = true;
  $("#searchInput").value = "";
}

/* ---------------- FOTO DE PORTADA (cámara) ---------------- */
// Tamaño máximo (en ancho) y calidad para las portadas subidas por el usuario.
// Sin esto, una foto de cámara (varios MB) acababa embebida tal cual en el
// books.json, que GitHub deja de poder leer a partir de 1 MB de tamaño total.
const COVER_MAX_WIDTH = 500;
const COVER_JPEG_QUALITY = 0.72;

function handleCameraInput(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => compressImage(reader.result, setCoverPreview);
  reader.readAsDataURL(file);
}

// Redimensiona y comprime una imagen (data URL) antes de guardarla, para que
// las portadas nunca disparen el tamaño del books.json.
function compressImage(dataUrl, onDone) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, COVER_MAX_WIDTH / img.width);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    onDone(canvas.toDataURL("image/jpeg", COVER_JPEG_QUALITY));
  };
  img.onerror = () => onDone(dataUrl); // si algo falla, seguimos con la original
  img.src = dataUrl;
}

/* ---------------- TOAST ---------------- */
let toastTimer = null;
function showToast(msg) {
  const toast = $("#toast");
  toast.textContent = msg;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 2400);
}

/* ---------------- EVENTOS ---------------- */
function bindEvents() {
  $$(".tab").forEach(tab => {
    tab.addEventListener("click", () => {
      $$(".tab").forEach(t => { t.classList.remove("active"); t.setAttribute("aria-selected", "false"); });
      tab.classList.add("active");
      tab.setAttribute("aria-selected", "true");
      currentTab = tab.dataset.tab;
      $$(".tab-panel").forEach(p => p.classList.remove("active"));
      $("#panel-" + tab.dataset.tab).classList.add("active");

      const filterGroup = $("#filterGroup");
      if (currentTab === "wishlist") {
        filterGroup.style.display = "none";
      } else {
        filterGroup.style.display = "flex";
      }
    });
  });

  $("#btnAdd").addEventListener("click", () => openModal(null));
  $("#modalClose").addEventListener("click", closeModal);
  $("#modalOverlay").addEventListener("click", (e) => { if (e.target.id === "modalOverlay") closeModal(); });

  // Eventos de Filtro de Estado
  $$(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      $$(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      currentFilter = btn.dataset.filter;
      renderAll();
    });
  });

  // Eventos de Alternar Modo de Vista (Cuadrícula / Lista)
  $("#btnViewGrid").addEventListener("click", () => {
    $("#btnViewGrid").classList.add("active");
    $("#btnViewList").classList.remove("active");
    currentViewMode = "grid";
    renderAll();
  });

  $("#btnViewList").addEventListener("click", () => {
    $("#btnViewList").classList.add("active");
    $("#btnViewGrid").classList.remove("active");
    currentViewMode = "list";
    renderAll();
  });

  $("#searchInput").addEventListener("input", handleSearchInput);
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#searchInput") && !e.target.closest("#autocompleteList")) {
      $("#autocompleteList").hidden = true;
    }
  });

  $("#coverCamera").addEventListener("change", handleCameraInput);
  $("#coverUrlInput").addEventListener("input", (e) => setCoverPreview(e.target.value.trim()));

  $$(".status-opt").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedStatus = btn.dataset.status;
      updateStatusUI();
    });
  });

  $$(".star").forEach(btn => {
    btn.addEventListener("click", () => {
      selectedRating = Number(btn.dataset.val);
      updateStarsUI();
    });
  });
  $("#starClear").addEventListener("click", () => { selectedRating = 0; updateStarsUI(); });

  $("#btnSave").addEventListener("click", saveFromModal);
  $("#btnDelete").addEventListener("click", deleteCurrent);



  // Eventos de Configuración de GitHub
  $("#btnGitSettings").addEventListener("click", openGitModal);
  $("#gitModalClose").addEventListener("click", closeGitModal);
  $("#gitModalOverlay").addEventListener("click", (e) => { if (e.target.id === "gitModalOverlay") closeGitModal(); });
  $("#btnGitSave").addEventListener("click", testAndConnectGit);
  $("#btnGitDisconnect").addEventListener("click", disconnectGit);

  $("#shelfPrev").addEventListener("click", () => {
    $("#shelfTrack").scrollBy({ left: -260, behavior: "smooth" });
  });
  $("#shelfNext").addEventListener("click", () => {
    $("#shelfTrack").scrollBy({ left: 260, behavior: "smooth" });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!$("#modalOverlay").hidden) closeModal();
      if (!$("#gitModalOverlay").hidden) closeGitModal();
    }
  });
}
