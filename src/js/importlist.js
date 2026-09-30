// Recoge enlaces, texto o CSV para importar listas.
// main.js procesa el resultado de ask().

const $ = (id) => document.getElementById(id);

/**
 * Qué se pegó: un enlace (una sola línea que lo parece) o canciones.
 *
 * @returns {{ url: string } | { text: string } | null}
 */
export function classify(raw) {
  const text = (raw ?? "").trim();
  if (!text) return null;
  const single = !/[\r\n]/.test(text);
  if (single && /^(https?:\/\/|spotify:)\S+$/i.test(text)) return { url: text };
  return { text };
}

/** Si el texto pegado es de un servicio que se lee por enlace. */
export function serviceName(url) {
  const u = url.toLowerCase();
  if (u.includes("spotify")) return "Spotify";
  if (u.includes("deezer")) return "Deezer";
  if (u.includes("music.apple.com")) return "Apple Music";
  if (u.includes("music.youtube.com")) return "YouTube Music";
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "YouTube";
  return null;
}

let pending = null;

/**
 * Abre el diálogo.
 * @returns {Promise<{ url: string } | { text: string, name: string } | null>}
 */
export function ask() {
  const dialog = $("import-dialog");
  const area = $("import-text");
  const name = $("import-name");

  area.value = "";
  name.value = "";
  refresh();
  dialog.returnValue = "";
  dialog.showModal();
  area.focus();

  return new Promise((resolve) => {
    pending = resolve;
  });
}

/** El botón y el nombre según lo que haya escrito. */
function refresh() {
  const what = classify($("import-text").value);
  const ok = $("import-ok");

  ok.disabled = !what;
  // El nombre solo hace falta con canciones sueltas: una lista enlazada ya
  // trae el suyo.
  $("import-name").hidden = !what?.text;

  const service = what?.url ? serviceName(what.url) : null;
  ok.textContent = service ? `Importar de ${service}` : "Importar";
}

export function initImportList() {
  const dialog = $("import-dialog");
  const area = $("import-text");
  const file = $("import-csv");

  area.addEventListener("input", refresh);

  $("import-cancel").addEventListener("click", () => dialog.close("cancel"));
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close("cancel");
  });

  // Un CSV (o .txt) abierto se vuelca en el campo: se ve qué se va a importar
  // y el nombre del archivo sirve de nombre de la lista.
  $("import-file").addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const chosen = file.files?.[0];
    file.value = "";
    if (!chosen) return;
    area.value = await chosen.text();
    refresh();
    const name = $("import-name");
    if (!name.value) name.value = chosen.name.replace(/\.(csv|txt)$/i, "");
  });

  dialog.addEventListener("close", () => {
    const resolve = pending;
    pending = null;
    if (!resolve) return;

    const what = dialog.returnValue === "ok" ? classify(area.value) : null;
    if (what?.text) what.name = $("import-name").value.trim();
    resolve(what);
  });
}
