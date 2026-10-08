// Filas de canciones para búsqueda, cola, historial y listas.
// El contexto define las acciones y si se permite reordenar; main.js
// recibe los eventos de selección.

import { els } from "./dom.js";
import { formatTime } from "./format.js";
import { icon, iconButton } from "./icons.js";
import { bindTouchSort, dropPosition } from "./mobile-interactions.js";

/**
 * Milisegundos de ratón quieto sobre una fila antes de resolverla por
 * adelantado. Lo bastante largo para que pasar el ratón de camino a otro sitio
 * no lance procesos, y lo bastante corto para que quien está leyendo una fila
 * llegue al clic con la URL ya lista.
 */
const HOVER_PREFETCH_MS = 400;

let currentId = null;
let hoverTimer = null;

/** Posición de la fila que se está arrastrando, o null. */
let dragFrom = null;
const touchLists = new WeakSet();

/**
 * Las listas donde se han pintado filas: la del panel y la de la página de un
 * artista o álbum. "La que suena" se marca en todas.
 */
const lists = new Set([els.resultsList]);

/** Callbacks que instala main.js. */
const handlers = {
  onPick: () => {},
  onHover: () => {},
  onAdd: () => {},
  onRemove: () => {},
  onMenu: () => {},
  onMove: () => {},
  onUpNext: () => {},
  onPlayNext: () => {},
  onArtist: () => {},
};

/**
 * Clic en el artista de una fila: recibe la pista y el enlace pulsado (para
 * anclar un menú si la canción es de varios artistas).
 */
export function onArtist(cb) {
  handlers.onArtist = cb;
}

/** Botón "Reproducir a continuación" de una fila. */
export function onPlayNext(cb) {
  handlers.onPlayNext = cb;
}

/** Clic en una fila de "A continuación". */
export function onUpNext(cb) {
  handlers.onUpNext = cb;
}

export function onPick(cb) {
  handlers.onPick = cb;
}
export function onHover(cb) {
  handlers.onHover = cb;
}
export function onAdd(cb) {
  handlers.onAdd = cb;
}
export function onRemove(cb) {
  handlers.onRemove = cb;
}
/** Botón "Añadir a lista…": recibe la pista y el botón, para anclar el menú. */
export function onMenu(cb) {
  handlers.onMenu = cb;
}
/**
 * Reordenar: recibe la posición de origen, la de destino y `{ keyboard }` si
 * fue con Alt+flechas (para devolver el foco a la fila movida).
 */
export function onMove(cb) {
  handlers.onMove = cb;
}

/**
 * Los botones de la fila: el menú (radio y listas) y, según dónde esté,
 * "reproducir a continuación" y "añadir a la cola", o quitar de donde está (la
 * cola o la lista abierta).
 */
function buildActions(track, removeLabel, playNext) {
  const wrap = document.createElement("div");
  wrap.className = "result__actions";

  const mobile = document.documentElement.dataset.platform === "android";
  if (playNext && !mobile) {
    wrap.append(
      iconButton({
        icon: "playNext",
        label: "Reproducir a continuación",
        className: "result__action",
        onClick: (event) => {
          event.stopPropagation();
          handlers.onPlayNext(track);
        },
      }),
    );
  }

  // Sin stopPropagation, pulsar un botón también dispararía el clic de la fila
  // entera y la canción empezaría a sonar al intentar solo encolarla.
  const listButton = iconButton({
    icon: "more",
    label: "Más: radio y listas",
    className: "result__action",
    onClick: (event, button) => {
      event.stopPropagation();
      handlers.onMenu(track, button, { removeLabel, onRemove: () => handlers.onRemove(track) });
    },
  });
  listButton.setAttribute("aria-haspopup", "menu");
  listButton.setAttribute("aria-expanded", "false");

  const mainButton = iconButton({
    icon: removeLabel ? "close" : "plus",
    label: removeLabel || "Añadir a la cola",
    className: "result__action",
    onClick: (event) => {
      event.stopPropagation();
      (removeLabel ? handlers.onRemove : handlers.onAdd)(track);
    },
  });

  wrap.append(...(mobile ? [listButton] : [mainButton, listButton]));
  return wrap;
}

function clearDropMarks() {
  for (const row of els.resultsList.querySelectorAll(".is-drop-before, .is-drop-after")) {
    row.classList.remove("is-drop-before", "is-drop-after");
  }
}

/** Si el puntero está en la mitad inferior de la fila: soltar ahí es "después". */
function isLowerHalf(event, li) {
  const rect = li.getBoundingClientRect();
  return event.clientY - rect.top > rect.height / 2;
}

/**
 * Arrastrar para reordenar, o Alt+flechas con la fila enfocada. Solo en listas
 * propias: la cola se reordena sola con el aleatorio, y los resultados o el
 * historial no tienen un orden que cambiar.
 */
function makeReorderable(li, position, count, min=0) {
  if (document.documentElement.dataset.platform === "android") {
    li.classList.add("result--reorderable");
    const move = document.createElement("button");
    move.type = "button"; move.className = "btn result__move";
    move.append(icon("grip")); move.setAttribute("aria-label","Mover canción: arrastra o toca para opciones");
    move.title="Arrastra para ordenar; toca para subir o bajar";
    move.addEventListener("click",async event => {
      event.stopPropagation();
      const {openMenu} = await import("./menu.js");
      openMenu(move,[{heading:"Mover canción"},
        ...(position > min ? [{label:"Subir",onSelect:()=>handlers.onMove(position,position-1)},
          {label:"Al principio",onSelect:()=>handlers.onMove(position,min)}] : []),
        ...(position+1 < count ? [{label:"Bajar",onSelect:()=>handlers.onMove(position,position+1)},
          {label:"Al final",onSelect:()=>handlers.onMove(position,count-1)}] : [])]);
    });
    li.prepend(move);
    return;
  }
  li.draggable = true;
  li.classList.add("result--reorderable");

  // El asa: dice que la fila se puede arrastrar sin tener que descubrirlo.
  const grip = document.createElement("span");
  grip.className = "result__grip";
  grip.setAttribute("aria-hidden", "true");
  grip.title = "Arrastra para cambiarla de sitio (o Alt+↑ / Alt+↓)";
  grip.append(icon("grip"));
  li.prepend(grip);

  li.addEventListener("keydown", (event) => {
    if (event.target !== li || !event.altKey) return;
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();

    const to = position + (event.key === "ArrowUp" ? -1 : 1);
    if (to >= 0 && to < count) handlers.onMove(position, to, { keyboard: true });
  });

  li.addEventListener("dragstart", (event) => {
    dragFrom = position;
    li.classList.add("is-dragging");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(position));
  });

  li.addEventListener("dragend", () => {
    dragFrom = null;
    li.classList.remove("is-dragging");
    clearDropMarks();
  });

  li.addEventListener("dragover", (event) => {
    if (dragFrom === null) return;
    event.preventDefault();

    const after = isLowerHalf(event, li);
    clearDropMarks();
    li.classList.add(after ? "is-drop-after" : "is-drop-before");
  });

  li.addEventListener("drop", (event) => {
    if (dragFrom === null) return;
    event.preventDefault();

    // "Antes de la fila N" o "después de la fila N" es una posición de hueco;
    // al sacar la pista de su sitio, los huecos por delante se desplazan uno.
    let to = position + (isLowerHalf(event, li) ? 1 : 0);
    if (dragFrom < to) to -= 1;

    const from = dragFrom;
    dragFrom = null;
    clearDropMarks();

    if (to !== from) handlers.onMove(from, to);
  });
}

/**
 * El "de quién es" de una fila. El nombre del artista es un enlace a su
 * página; el motivo de una recomendación va detrás, como texto.
 */
function buildBy(track) {
  const by = document.createElement("span");
  by.className = "result__by";

  if (track.uploader) {
    const artist = document.createElement("button");
    artist.type = "button";
    artist.className = "result__artist";
    artist.textContent = track.uploader;
    artist.title = `Ir a ${track.uploader.replace(/ - Topic$/, "")}`;
    // Sin stopPropagation, el clic también pondría la canción a sonar.
    artist.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.onArtist(track, artist);
    });
    artist.addEventListener("keydown", (event) => event.stopPropagation());
    by.append(artist);
  }

  // Una recomendación dice por qué está ahí: es lo que hace que el aleatorio
  // inteligente se entienda en vez de parecer caprichoso.
  if (track.reason) {
    const reason = document.createElement("span");
    reason.className = "result__reason";
    reason.textContent = track.reason;
    by.append(track.uploader ? " · " : "", reason);
  }

  return by;
}

function buildRow(track, { removeLabel, reorderable, count, playNext, minReorderIndex = 0 }, position) {
  const li = document.createElement("li");
  li.className = "result";
  li.dataset.id = track.id;
  li.dataset.position = String(position);

  // Es una fila que se pulsa: debe poder recibir foco y responder al teclado,
  // no solo al ratón.
  li.tabIndex = 0;
  li.setAttribute("role", "button");

  const art = document.createElement("img");
  art.className = "result__art";
  art.alt = "";
  art.loading = "lazy";
  if (track.thumbnail) art.src = track.thumbnail;

  const text = document.createElement("div");
  text.className = "result__text";

  const title = document.createElement("span");
  title.className = "result__title";
  title.textContent = track.title || "Sin título";

  text.append(title, buildBy(track));

  const time = document.createElement("span");
  time.className = "result__time";
  time.textContent = track.duration ? formatTime(track.duration) : "";

  const actions = buildActions(track, removeLabel, playNext);
  li.append(art, text, time, actions);
  if (reorderable && position >= minReorderIndex) makeReorderable(li, position, count, minReorderIndex);

  // Clic derecho: el mismo menú que el botón "Más", como en Spotify.
  li.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const more = actions.querySelector('[aria-haspopup="menu"]');
    if (more) handlers.onMenu(track, more);
  });

  const pick = () => handlers.onPick(track);

  li.addEventListener("click", pick);
  li.addEventListener("keydown", (event) => {
    // Enter sobre uno de los botones de la fila es de ese botón, no de la fila.
    if (event.target !== li) return;
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    pick();
  });

  li.addEventListener("pointerenter", () => {
    if (document.documentElement.dataset.platform === "android") return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => handlers.onHover(track), HOVER_PREFETCH_MS);
  });

  li.addEventListener("pointerleave", () => clearTimeout(hoverTimer));

  return li;
}

/**
 * Dibuja las pistas de la pestaña activa.
 *
 * @param {Array}  tracks
 * @param {object} [opts]
 * @param {string}  [opts.removeLabel] Si se da, el botón de cada fila quita (con
 *                                     este texto) en vez de añadir a la cola.
 * @param {boolean} [opts.reorderable] Si las filas se pueden arrastrar.
 * @param {boolean} [opts.playNext]    Si lleva el botón "Reproducir a
 *                                     continuación" (por defecto, sí).
 * @param {Array}   [opts.dividers]    Separadores `{ at, text, action? }`: van
 *                                     delante de la fila `at` (en la cola:
 *                                     "Siguiente en la cola", "Siguiente de…",
 *                                     las recomendaciones). `action` es un
 *                                     botón `{ label, onClick }`.
 * @param {Node}    [opts.lead]        Algo que va antes de las filas (en la
 *                                     búsqueda: el artista buscado).
 */
export function render(tracks, opts = {}) {
  renderInto(els.resultsList, tracks, opts);
}

function buildDivider({ text, action }) {
  const divider = document.createElement("li");
  divider.className = "results__divider";

  const label = document.createElement("span");
  label.textContent = text;
  divider.append(label);

  if (action) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn--link results__divider-action";
    button.textContent = action.label;
    button.addEventListener("click", action.onClick);
    divider.append(button);
  }
  return divider;
}

/** Como `render`, en otra lista (la de la página de un artista o un álbum). */
export function renderInto(
  list,
  tracks,
  { removeLabel = null, reorderable = false, playNext = true, dividers = [], lead = null, minReorderIndex = 0 } = {},
) {
  if(document.documentElement.dataset.platform==='android' && list===els.resultsList && !touchLists.has(list)){
    touchLists.add(list);
    bindTouchSort(list,{rowSelector:'.result',handleSelector:'.result__move',onMove:(row,target,after)=>{
      if(!target.classList.contains('result--reorderable'))return;
      const from=Number(row.dataset.position),at=Number(target.dataset.position);
      const count=list.querySelectorAll('.result').length;
      handlers.onMove(from,dropPosition(from,at,after,count),{id:row.dataset.id,targetId:target.dataset.id});
    }});
  }
  clearTimeout(hoverTimer);
  lists.add(list);
  list.replaceChildren();
  if (lead) list.append(lead);

  const all = tracks ?? [];
  const opts = { removeLabel, reorderable, playNext, count: all.length, minReorderIndex };
  all.forEach((track, position) => {
    for (const divider of dividers) {
      if (divider.at === position) list.append(buildDivider(divider));
    }

    list.append(buildRow(track, opts, position));
  });

  markCurrent(currentId);
}

/** Un mensaje en lugar de filas, para una lista vacía. */
export function renderEmpty(message, { lead = null } = {}) {
  clearTimeout(hoverTimer);

  const li = document.createElement("li");
  li.className = "results__empty";
  li.textContent = message;

  els.resultsList.replaceChildren(...(lead ? [lead, li] : [li]));
}

/** La fila con la posición `position` de la lista del panel, para enfocarla. */
export function rowAt(position) {
  return els.resultsList.querySelectorAll(".result")[position] ?? null;
}

/**
 * "A continuación": las próximas de la cola en la columna de lo que suena.
 * Filas compactas y sin acciones: para eso está la vista de la cola.
 *
 * @param {Array} tracks
 * @param {string} emptyText Qué decir cuando no viene nada.
 * @param {object} [opts]
 * @param {number} [opts.queued]   Cuántas de las primeras son "Siguiente en la
 *                                 cola": llevan su título, como en Spotify.
 * @param {string} [opts.context]  Qué se escuchaba, para el título del resto.
 */
export function renderUpNext(tracks, emptyText, { queued = 0, context = null } = {}) {
  if (tracks.length === 0) {
    const li = document.createElement("li");
    li.className = "upnext__empty";
    li.textContent = emptyText;
    els.upnextList.replaceChildren(li);
    return;
  }

  const heading = (text) => {
    const li = document.createElement("li");
    li.className = "upnext__heading";
    li.textContent = text;
    return li;
  };

  const rows = tracks.flatMap((track, i) => {
    const li = document.createElement("li");
    const before = [];
    if (queued > 0 && i === 0) before.push(heading("Siguiente en la cola"));
    if (queued > 0 && i === queued) before.push(heading(context ? `Siguiente de «${context}»` : "Después"));

    const button = document.createElement("button");
    button.type = "button";
    button.className = "upnext__item";
    button.title = track.title || "";

    const art = document.createElement("img");
    art.className = "upnext__art";
    art.alt = "";
    art.loading = "lazy";
    if (track.thumbnail) art.src = track.thumbnail;

    const text = document.createElement("span");
    text.className = "upnext__text";

    const title = document.createElement("span");
    title.className = "upnext__name";
    title.textContent = track.title || "Sin título";

    const by = document.createElement("span");
    by.className = "upnext__by";
    by.textContent = track.uploader || "";

    text.append(title, by);
    button.append(art, text);
    button.addEventListener("click", () => handlers.onUpNext(track));

    li.append(button);
    return [...before, li];
  });

  els.upnextList.replaceChildren(...rows);
}

/** Icono en lugar de carátula, para filas que no son pistas (las listas). */
export function iconArt(name) {
  const art = document.createElement("div");
  art.className = "result__art result__art--icon";
  art.append(icon(name));
  return art;
}

/** Muestra u oculta el panel entero. */
export function setVisible(visible) {
  els.results.hidden = !visible;
  document.body.classList.toggle("has-results", visible);

  if (!visible) {
    clearTimeout(hoverTimer);
    els.resultsList.replaceChildren();
  }
}

/**
 * Marca qué fila está sonando, buscándola por id de vídeo.
 *
 * Se hace por id y no por posición porque la resolución y la búsqueda son dos
 * llamadas independientes: YouTube podría devolver un primer resultado distinto
 * a cada una. Si no hay coincidencia, no se marca nada — mejor eso que señalar
 * una fila equivocada.
 */
export function markCurrent(id) {
  currentId = id ?? null;

  for (const list of lists) {
    for (const row of list.querySelectorAll(":scope > .result")) {
      const isCurrent = Boolean(currentId) && row.dataset.id === currentId;
      row.classList.toggle("is-current", isCurrent);
      row.setAttribute("aria-current", isCurrent ? "true" : "false");
    }
  }
}
