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
  // Los enlaces copiados sin protocolo siguen siendo enlaces, no canciones.
  if (single && !/\s/.test(text) && serviceName(text)) return { url: `https://${text}` };
  return { text };
}

/** Si el texto pegado es de un servicio que se lee por enlace. */
export function serviceName(url) {
  const text = String(url ?? "").trim();
  if (/^spotify:/i.test(text)) return "Spotify";
  let u;
  try { u = new URL(/^[a-z][a-z\d+.-]*:/i.test(text) ? text : `https://${text}`); }
  catch { return null; }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
  const host = u.hostname.toLowerCase();
  if (["open.spotify.com", "spotify.com", "www.spotify.com", "spotify.link", "spoti.fi"].includes(host)) return "Spotify";
  if (["deezer.com", "www.deezer.com", "link.deezer.com", "deezer.page.link"].includes(host)) return "Deezer";
  if (["music.apple.com", "embed.music.apple.com"].includes(host)) return "Apple Music";
  if (host === "music.youtube.com") return "YouTube Music";
  if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(host)) return "YouTube";
  return null;
}

/** Un enlace de colección se importa; no se intenta resolver como audio. */
export function isPlaylistLink(raw) {
  const input = classify(raw);
  if (!input?.url) return false;
  const service = serviceName(input.url);
  if (!service) return false;
  if (/^spotify:/i.test(input.url)) return /^spotify:(?:user:[^:]+:)?(?:playlist|album):[^:]+$/i.test(input.url);
  const url = new URL(input.url);
  if (service.startsWith("YouTube")) return Boolean(url.searchParams.get("list"));
  if (service === "Spotify" && ["spotify.link", "spoti.fi"].includes(url.hostname)) return true;
  if (service === "Deezer" && ["link.deezer.com", "deezer.page.link"].includes(url.hostname)) return true;
  return /\/(playlist|album)\/[^/]+/i.test(url.pathname);
}

let pending = null;

/** Contar por separado las entradas leídas, las ausentes y las repetidas. */
export function importSummary(result) {
  const missing = result.missing?.length ?? 0;
  const duplicates = result.duplicates ?? 0;
  const total = result.source_count ?? result.count + missing + duplicates;
  return `Importada «${result.name}» · ${result.count} de ${total} canciones`
    + (missing ? ` · ${missing} sin encontrar` : "")
    + (duplicates ? ` · ${duplicates} repetidas` : "");
}

/**
 * Abre el diálogo.
 * @returns {Promise<{ url: string } | { text: string, name: string } | null>}
 */
export function ask(initial = "") {
  const dialog = $("import-dialog");
  const area = $("import-text");
  const name = $("import-name");

  area.value = initial;
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
