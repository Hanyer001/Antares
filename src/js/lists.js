// Renderiza la vista de listas, la barra lateral y sus acciones.
// Las filas de canciones están en results.js; las acciones se delegan en main.js.

import { groupLists } from "./library-model.js";
import { els } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { iconArt, coverArt, renderLibrary } from "./results.js";
import { LibraryView, playlist_count_label as countLabel } from "./rust-core.js";

export { countLabel };
const sidebar = new LibraryView();

const handlers = {
  onOpen: () => {},
  onCreate: () => {},
  onImport: () => {},
  onPlay: () => {},
  onShuffle: () => {},
  onMore: () => {},
  onSort: () => {},
  onSaveQueue: () => {},
  onClearQueue: () => {},
  onMix: () => {},
  onRefreshHome: () => {},
};

/** Instala un callback: `on("open", fn)`, `on("play", fn)`... */
export function on(name, cb) {
  handlers[`on${name[0].toUpperCase()}${name.slice(1)}`] = cb;
}

function model(playlists) {
  return playlists.map(playlist => ({
    id: playlist.id,
    name: playlist.name,
    count: playlist.tracks.length,
    pinned: Boolean(playlist.pinned),
    system: Boolean(playlist.system),
    smart: Boolean(playlist.rules),
    folder: playlist.folder,
    description: playlist.description,
  }));
}

export function renderOverview(playlists) {
  renderLibrary(model(playlists));
  els.resultsList.querySelectorAll(".result--list").forEach((row, index) => {
    const playlist = playlists[index];
    const cover = playlist.cover || playlist.tracks[0]?.thumbnail;
    const art = cover && !playlist.system ? coverArt(cover) : iconArt(playlist.system ? "heart" : "list");
    if (playlist.system) art.classList.add("result__art--likes");
    row.prepend(art);
    row.querySelector(".result__chevron").append(icon("back"));

    const open = () => handlers.onOpen(playlist.id);
    row.addEventListener("click", open);
    row.addEventListener("keydown", event => {
      if (event.target !== row || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      open();
    });
  });
}

export function renderSidebar(playlists, activeId) {
  const grouped = groupLists(playlists);
  sidebar.render(els.sidebarLists, JSON.stringify(model(grouped)), true, activeId ?? undefined);
  els.sidebarLists.querySelectorAll(".side-list").forEach((button, index) => {
    const playlist = grouped[index];
    button.prepend(icon(playlist.system ? "heart" : "list"));
    button.addEventListener("click", () => handlers.onOpen(playlist.id));
  });
}

// --- Cabecera del panel --------------------------------------------------

function show(nodes) {
  els.panelHead.replaceChildren(...nodes);
  els.panelHead.hidden = nodes.length === 0;
}

export function hideHead() {
  show([]);
}

function textButton(label, onClick) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn btn--mini";
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

/** Inicio: rehacer las estanterías generadas (mezcla, géneros, radios). */
export function showHomeHead() {
  show([textButton("Actualizar", () => handlers.onRefreshHome())]);
}

export function showOverviewHead() {
  show([
    textButton(document.documentElement.dataset.platform === "android" ? "+ Crear playlist" : "Nueva lista", () => handlers.onCreate()),
    textButton(document.documentElement.dataset.platform === "android" ? "Importar enlace" : "Importar lista…", () => handlers.onImport()),
  ]);
}

/** @param {boolean} hasTracks Sin pistas no hay nada que guardar ni vaciar. */
export function showQueueHead(hasTracks) {
  const save = textButton("Guardar como lista", () => handlers.onSaveQueue());
  const clear = textButton("Vaciar", () => handlers.onClearQueue());
  save.disabled = !hasTracks;
  clear.disabled = !hasTracks;
  show([save, clear]);
}

/** @param {boolean} busy Mientras se prepara una mezcla, el botón espera. */
export function showDiscoverHead(busy) {
  const mix = iconButton({
    icon: "shuffle",
    label: busy ? "Preparando..." : "Nueva mezcla",
    className: "btn btn--mini btn--with-icon btn--primary",
    text: true,
    onClick: () => handlers.onMix(),
  });
  mix.disabled = busy;
  show([mix]);
}

/** Artista, álbum o lista de YouTube: volver a donde se estaba. */
export function showPageHead(onBack) {
  const back = iconButton({
    icon: "back",
    label: "Volver",
    className: "btn btn--mini btn--with-icon",
    text: true,
    onClick: () => onBack(),
  });
  back.title = "Volver (Alt+←)";
  show([back]);
}

export function showDetailHead(playlist) {
  const empty = playlist.tracks.length === 0;

  const play = iconButton({
    icon: "play",
    label: "Reproducir",
    className: "btn btn--mini btn--with-icon",
    text: true,
    onClick: () => handlers.onPlay(playlist),
  });

  const shuffle = iconButton({
    icon: "shuffle",
    label: "Reproducir en aleatorio",
    className: "btn btn--icon",
    onClick: () => handlers.onShuffle(playlist),
  });

  play.disabled = empty;
  shuffle.disabled = empty;

  const nodes = [play, shuffle];

  // "Me gusta" no se renombra, no se borra ni se reordena: no hay nada que
  // ofrecer ni en "Ordenar" ni en el menú.
  if (!playlist.system) {
    const sort = iconButton({
      icon: "sort",
      label: "Ordenar",
      className: "btn btn--mini btn--with-icon",
      text: true,
      onClick: (event, button) => handlers.onSort(playlist, button),
    });
    sort.setAttribute("aria-haspopup", "menu");
    sort.setAttribute("aria-expanded", "false");
    sort.disabled = playlist.tracks.length < 2 || Boolean(playlist.rules);
    nodes.push(sort);

    const more = iconButton({
      icon: "more",
      label: "Más opciones",
      className: "btn btn--icon",
      onClick: (event, button) => handlers.onMore(playlist, button),
    });
    more.setAttribute("aria-haspopup", "menu");
    more.setAttribute("aria-expanded", "false");
    nodes.push(more);
  }

  show(nodes);
}
