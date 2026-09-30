// Renderiza la vista de listas, la barra lateral y sus acciones.
// Las filas de canciones están en results.js; las acciones se delegan en main.js.

import { groupLists } from "./library-model.js";
import { els } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import { iconArt } from "./results.js";

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

export function countLabel(count) {
  if (count === 0) return "Vacía";
  return `${count} ${count === 1 ? "canción" : "canciones"}`;
}

// --- Vista general -------------------------------------------------------

function buildListRow(playlist) {
  const li = document.createElement("li");
  li.className = "result result--list";
  li.dataset.id = playlist.id;
  li.tabIndex = 0;
  li.setAttribute("role", "button");

  // La carátula de una lista es la de su primera canción. "Me gusta" lleva
  // siempre su corazón, para encontrarla de un vistazo.
  const cover = playlist.cover || playlist.tracks[0]?.thumbnail;
  let art;

  if (cover && !playlist.system) {
    art = document.createElement("img");
    art.className = "result__art";
    art.alt = "";
    art.loading = "lazy";
    art.src = cover;
  } else {
    art = iconArt(playlist.system ? "heart" : "list");
    if (playlist.system) art.classList.add("result__art--likes");
  }

  const text = document.createElement("div");
  text.className = "result__text";

  const title = document.createElement("span");
  title.className = "result__title";
  title.textContent = playlist.name;

  const by = document.createElement("span");
  by.className = "result__by";
  by.textContent = [countLabel(playlist.tracks.length), playlist.pinned ? "Fijada" : null, playlist.folder, playlist.rules ? "Inteligente" : null, playlist.description].filter(Boolean).join(" · ");

  text.append(title, by);

  const chevron = document.createElement("span");
  chevron.className = "result__chevron";
  const arrow = icon("back");
  chevron.append(arrow);

  li.append(art, text, chevron);

  const open = () => handlers.onOpen(playlist.id);
  li.addEventListener("click", open);
  li.addEventListener("keydown", (event) => {
    if (event.target !== li) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    open();
  });

  return li;
}

export function renderOverview(playlists) {
  els.resultsList.replaceChildren(...playlists.map(buildListRow));
}

// --- Barra lateral -------------------------------------------------------

/**
 * Las listas en la barra lateral: a un clic desde cualquier vista.
 *
 * @param {Array} playlists
 * @param {string|null} activeId La lista abierta ahora, para marcarla.
 */
export function renderSidebar(playlists, activeId) {
  const items = groupLists(playlists).map((playlist) => {
    const li = document.createElement("li");

    const button = document.createElement("button");
    button.type = "button";
    button.className = "side-list" + (playlist.system ? " side-list--likes" : "");
    button.setAttribute("aria-current", String(playlist.id === activeId));
    button.title = [playlist.folder, playlist.name].filter(Boolean).join(" / ");

    button.append(icon(playlist.system ? "heart" : "list"));

    const name = document.createElement("span");
    name.className = "side-list__name";
    name.textContent = (playlist.pinned ? "★ " : "") + playlist.name;

    const count = document.createElement("span");
    count.className = "side-list__count";
    count.textContent = String(playlist.tracks.length);

    button.append(name, count);
    button.addEventListener("click", () => handlers.onOpen(playlist.id));

    li.append(button);
    return li;
  });

  els.sidebarLists.replaceChildren(...items);
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
    textButton("Nueva lista", () => handlers.onCreate()),
    textButton("Importar lista…", () => handlers.onImport()),
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
