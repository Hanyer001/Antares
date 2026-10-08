// Vistas de artistas, álbumes y listas de YouTube Music.
// Comparte las filas de results.js y delega las acciones en main.js.

import { els } from "./dom.js";
import { icon, iconButton } from "./icons.js";
import * as results from "./results.js";

const { invoke } = window.__TAURI__.core;

/** Cuánto se guarda lo ya pedido: volver atrás es instantáneo. */
const CACHE_MS = 30 * 60 * 1000;
/** A partir de cuántas tarjetas una estantería lleva flechas. */
const ARROWS_FROM = 5;

// --- Datos ---------------------------------------------------------------

const cache = new Map();

function cached(key, load) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.promise;

  const promise = load();
  cache.set(key, { at: Date.now(), promise });
  // Un fallo no se guarda: la próxima vez se vuelve a intentar.
  promise.catch(() => cache.delete(key));
  return promise;
}

export const fetchArtist = (id) => cached(`artist:${id}`, () => invoke("artist_page", { id }));
export const fetchArtistSongs = (id) => cached(`artist-songs:${id}`, () => invoke("artist_songs", { id }));
export const fetchAlbum = (id) => cached(`album:${id}`, () => invoke("album_page", { id }));
export const fetchList = (id) => cached(`list:${id}`, () => invoke("youtube_list", { id }));

function fetchMore(browseId, params) {
  return cached(`more:${browseId}:${params ?? ""}`, () =>
    invoke("shelf_more", { browseId, params: params ?? null }),
  );
}

/** A qué artistas (y álbum) lleva una canción: `{ artists: [{ id, name }], album }`. */
export function trackLinks(track) {
  return cached(`links:${track.id}`, () =>
    invoke("track_links", {
      videoId: track.id ?? null,
      uploader: track.uploader ?? null,
      title: track.title ?? null,
    }),
  );
}

/** El artista que se está buscando, o null. Nunca falla: sin él, no hay tarjeta. */
export function artistForQuery(query) {
  return invoke("artist_for_query", { query }).catch(() => null);
}

// --- Callbacks -----------------------------------------------------------

const handlers = {
  play: () => {},
  radio: () => {},
  openArtist: () => {},
  openAlbum: () => {},
  openList: () => {},
  playVideo: () => {},
  save: () => {},
  menu: () => {},
  error: () => {},
};

/**
 * `{ play(tracks, start, { shuffle, ordered, artistOnly }), radio(seeds, name), openArtist(id, name),
 * openAlbum(id, title), openList(id, title, thumbnail), playVideo(track),
 * save(name, tracks), menu(track, button), error(error) }`
 */
export function initArtistView(callbacks) {
  Object.assign(handlers, callbacks);
}

// --- Estado --------------------------------------------------------------

/** La página que se ve (`{ type, id, name }`), su nombre y sus canciones. */
let shown = null;
let shownName = null;
let tracks = [];
let playRequest = 0;

export function cancelPendingPlay() { playRequest++; }

/** Carga la colección antes de sustituir la cola; la última elección manda. */
export async function playCollection(page, { trackId = null, shuffle = false, button = null, visible = false, artistTrack = null, artistOnly = false } = {}) {
  const request = ++playRequest;
  button?.setAttribute("aria-busy", "true");
  if (button) button.disabled = true;
  try {
    if (artistTrack) {
      const { artists } = await trackLinks(artistTrack);
      const match = artists.find((a) => a.name.toLocaleLowerCase() === page.name?.replace(/ - Topic$/, "").toLocaleLowerCase()) ?? artists[0];
      if (!match) throw new Error("No encontré la página de este artista.");
      page = { type: "artist", id: match.id, name: match.name };
    }
    if (request !== playRequest) return;
    const data = await ({ artist: fetchArtist, album: fetchAlbum, ytlist: fetchList }[page.type])(page.id);
    const only = page.type === "artist" && artistOnly;
    const list = page.type === "artist" ? (only ? await fetchArtistSongs(page.id) : data.songs.slice(0, 5)) : data.tracks;
    if (request !== playRequest || (visible && (shown !== page || els.artist.hidden))) return;
    if (!list?.length) throw new Error("Esta colección no tiene canciones disponibles.");
    const start = trackId == null ? 0 : list.findIndex((t) => t.id === trackId);
    if (start < 0) throw new Error("Esta canción ya no está disponible en la colección. Vuelve a abrirla.");
    const name = data.name ?? data.title ?? page.name;
    handlers.play(list, start, { shuffle, ordered: page.type !== "ytlist", selected: trackId != null, artistOnly: only, name: only ? `Solo ${name}` : name });
  } catch (error) {
    if (request === playRequest) handlers.error(error);
  } finally {
    button?.removeAttribute("aria-busy");
    if (button) button.disabled = false;
  }
}

export function playFrom(track) {
  if (shown) return playCollection(shown, { trackId: track.id, visible: true });
}

/** Las canciones que se ven: al elegir una, suenan estas desde ella. */
export function currentTracks() {
  return tracks;
}

/** El artista, álbum o lista que se ve: la cola lo usa para decir de dónde es. */
export function currentName() {
  return shownName;
}

export function show(visible) {
  if (!visible && !els.artist.hidden) cancelPendingPlay();
  els.artist.hidden = !visible;
}

/**
 * Enseña una página. Si ya es la que se ve no hace nada: se llama en cada
 * repintado del panel, y rehacerla perdería el scroll y lo desplegado.
 *
 * @param {{ type: "artist"|"album"|"ytlist", id: string, name?: string, thumbnail?: string }} page
 */
export function display(page) {
  show(true);
  if (page === shown) return;

  cancelPendingPlay();

  shown = page;
  shownName = page.name ?? null;
  tracks = [];
  els.artist.scrollTop = 0;
  paintLoading(page);

  const load = { artist: fetchArtist, album: fetchAlbum, ytlist: fetchList }[page.type];
  load(page.id)
    .then((data) => {
      if (shown !== page) return;
      if (page.type === "artist") paintArtist(data);
      else if (page.type === "album") paintAlbum(data);
      else paintList(page, data);
    })
    .catch((error) => {
      if (shown === page) paintError(page, error);
    });
}

// --- Piezas --------------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function img(src, className) {
  const image = el("img", className);
  image.alt = "";
  image.loading = "lazy";
  if (src) image.src = src;
  return image;
}

function button(iconName, label, onClick, { primary = false } = {}) {
  return iconButton({
    icon: iconName,
    label,
    className: `btn btn--mini btn--with-icon${primary ? " btn--primary" : ""}`,
    text: true,
    onClick,
  });
}

/** "1 h 12 min" o "42 min". */
export function totalDuration(list) {
  const seconds = list.reduce((sum, t) => sum + (t.duration ?? 0), 0);
  if (seconds <= 0) return "";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

function countLabel(n) {
  return `${n} ${n === 1 ? "canción" : "canciones"}`;
}

/** Reproducir, aleatorio y (según la página) radio o guardar. */
function actions(extra = []) {
  const page = shown;
  const box = el("div", "hero__actions");
  const play = button("play", "Reproducir", () => playCollection(page, { button: play, visible: true }), { primary: true });
  const shuffle = button("shuffle", "Aleatorio", () => playCollection(page, { shuffle: true, button: shuffle, visible: true }));
  play.disabled = shuffle.disabled = tracks.length === 0;
  box.append(play, shuffle, ...extra);
  return box;
}

/** Enlaces a los artistas de un álbum ("Radiohead, Thom Yorke"). */
function artistLinks(artists) {
  const box = el("span", "hero__artists");
  artists.forEach((artist, i) => {
    if (i > 0) box.append(", ");
    const link = el("button", "hero__link", artist.name);
    link.type = "button";
    link.addEventListener("click", () => handlers.openArtist(artist.id, artist.name));
    box.append(link);
  });
  return box;
}

/** Texto largo recortado a unas líneas, con "Leer más". */
function description(text) {
  const box = el("div", "hero__desc");
  const p = el("p", "hero__desc-text", text);
  box.append(p);

  if (text.length > 220) {
    box.classList.add("is-clamped");
    const more = el("button", "btn btn--link hero__desc-more", "Leer más");
    more.type = "button";
    more.addEventListener("click", () => {
      const open = box.classList.toggle("is-clamped");
      more.textContent = open ? "Leer más" : "Leer menos";
    });
    box.append(more);
  }
  return box;
}

function sectionHead(title, extra = []) {
  const head = el("header", "shelf__head");
  const text = el("div", "shelf__text");
  text.append(el("h3", "shelf__title", title));
  const side = el("div", "shelf__actions");
  side.append(...extra);
  head.append(text, side);
  return head;
}

function setSongs(list) {
  tracks = list;
  results.renderInto(els.artistSongs, list);
}

function clear() {
  els.artistTop.replaceChildren();
  els.artistSongs.replaceChildren();
  els.artistShelves.replaceChildren();
}

// --- Tarjetas ------------------------------------------------------------

/** Un vídeo de una estantería, como pista que se puede reproducir o encolar. */
function videoTrack(card, artistName) {
  return {
    id: card.id,
    title: card.title,
    uploader: artistName ?? null,
    duration: null,
    thumbnail: `https://i.ytimg.com/vi/${card.id}/mqdefault.jpg`,
    watch_url: `https://www.youtube.com/watch?v=${card.id}`,
  };
}

function buildCard(card, artistName) {
  const isArtist = card.kind === "artist";
  const node = el("div", `card card--yt${isArtist ? " card--artist" : ""}${card.kind === "video" ? " card--video" : ""}`);
  node.tabIndex = 0;
  node.setAttribute("role", "button");
  node.title = [card.title, card.subtitle].filter(Boolean).join(" · ");

  const cover = el("div", "card__cover");
  cover.append(img(card.thumbnail, "card__art"));

  let open;
  if (card.kind === "artist") {
    open = () => handlers.openArtist(card.id, card.title);
  } else if (card.kind === "album") {
    open = () => handlers.openAlbum(card.id, card.title);
  } else if (card.kind === "playlist") {
    open = () => handlers.openList(card.playlist_id, card.title, card.thumbnail);
  } else {
    const track = videoTrack(card, artistName);
    open = () => handlers.playVideo(track);

    const more = iconButton({
      icon: "more",
      label: "Más opciones",
      className: "card__more",
      onClick: (event, btn) => {
        event.stopPropagation();
        handlers.menu(track, btn);
      },
    });
    cover.append(more);
  }

  // La colección usa su propio endpoint; un álbum nunca se convierte en radio.
  {
    const canPlay = card.kind === "album" || card.kind === "artist" || !!card.playlist_id;
    const play = el(canPlay ? "button" : "span", "card__play");
    play.append(icon("play"));
    if (canPlay) {
      play.type = "button";
      play.classList.add("card__play--button");
      play.setAttribute("aria-label", `Reproducir «${card.title}»`);
      play.title = "Reproducir";
      play.addEventListener("click", (event) => {
        event.stopPropagation();
        playCollection({ type: card.kind === "playlist" ? "ytlist" : card.kind, id: card.kind === "playlist" ? card.playlist_id : card.id, name: card.title }, { button: play });
      });
    }
    cover.append(play);
  }

  node.append(cover, el("span", "card__title", card.title), el("span", "card__by", card.subtitle ?? ""));

  node.addEventListener("click", open);
  node.addEventListener("keydown", (event) => {
    if (event.target !== node || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    open();
  });

  return node;
}

function buildShelf(shelf, artistName) {
  const section = el("section", "shelf");
  const row = el("div", "shelf__row");
  row.append(...shelf.items.map((card) => buildCard(card, artistName)));

  const side = [];

  if (shelf.more) {
    const all = el("button", "btn btn--mini", "Ver todo");
    all.type = "button";
    all.addEventListener("click", async () => {
      const { browse_id: browseId, params } = shelf.more;
      // "Ver todo" de los vídeos es una lista de YouTube: se abre como tal.
      if (browseId.startsWith("VL")) {
        handlers.openList(browseId.slice(2), shelf.title, shelf.items[0]?.thumbnail);
        return;
      }

      all.disabled = true;
      all.textContent = "Cargando…";
      try {
        const cards = await fetchMore(browseId, params);
        if (cards.length > 0) {
          row.replaceChildren(...cards.map((card) => buildCard(card, artistName)));
          row.classList.add("shelf__row--grid");
          for (const node of side) node.remove();
        }
      } catch {
        all.disabled = false;
        all.textContent = "Ver todo";
      }
    });
    side.push(all);
  }

  if (shelf.items.length >= ARROWS_FROM) {
    for (const dir of [-1, 1]) {
      side.push(
        iconButton({
          icon: "back",
          label: dir < 0 ? "Anteriores" : "Siguientes",
          className: `btn btn--icon shelf__arrow${dir > 0 ? " shelf__arrow--next" : ""}`,
          onClick: () => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: "smooth" }),
        }),
      );
    }
  }

  section.append(sectionHead(shelf.title, side), row);
  return section;
}

// --- Páginas -------------------------------------------------------------

function paintLoading(page) {
  clear();

  const hero = el("div", `hero hero--${page.type === "artist" ? "artist" : "album"} is-loading`);
  if (page.type !== "artist") hero.append(el("div", "hero__cover hero__cover--blank"));
  const body = el("div", "hero__body");
  body.append(el("h2", "hero__title", page.name ?? ""), el("p", "hero__meta", "Cargando…"));
  hero.append(body);
  els.artistTop.append(hero);

  const rows = Array.from({ length: 5 }, () => {
    const li = el("li", "result result--skeleton");
    li.setAttribute("aria-hidden", "true");
    li.innerHTML = '<span class="result__art"></span><span class="result__text"><span></span><span></span></span>';
    return li;
  });
  els.artistSongs.replaceChildren(...rows);
}

function paintError(page, error) {
  clear();
  const box = el("div", "artist-page__error");
  const message =
    String(error).includes("network") || String(error).includes("HTTP")
      ? "No se pudo conectar con YouTube Music. Revisa la conexión."
      : "No se pudo abrir esta página ahora mismo.";
  box.append(el("p", "results__empty", message));

  const retry = el("button", "btn btn--mini", "Reintentar");
  retry.type = "button";
  retry.addEventListener("click", () => {
    shown = null;
    display(page);
  });
  box.append(retry);
  els.artistTop.append(box);
}

function paintArtist(data) {
  clear();
  shownName = data.name;
  tracks = data.songs.slice(0, 5);

  const hero = el("div", "hero hero--artist");
  if (data.image) {
    hero.classList.add("has-banner");
    hero.append(img(data.image, "hero__banner"));
  }

  const body = el("div", "hero__body");
  body.append(
    el("h2", "hero__title", data.name),
    el("p", "hero__meta", data.subscribers ? `${data.subscribers} suscriptores` : "Artista"),
  );

  const radio = button("radio", "Radio", () => handlers.radio(tracks.slice(0, 5), data.name));
  const box = actions([radio]);
  radio.disabled = data.songs.length === 0;
  body.append(box);

  hero.append(body);
  els.artistTop.append(hero);
  if (data.description) els.artistTop.append(description(data.description));

  if (data.songs.length > 0) {
    const page = shown;
    const only = button("play", "Solo este artista", () => playCollection(page, { artistOnly: true, button: only, visible: true }));
    only.title = "Reproduce su lista de canciones sin añadir recomendaciones de otros artistas.";
    els.artistTop.append(sectionHead("Canciones más escuchadas", [only]));
    setSongs(tracks);
  }

  els.artistShelves.replaceChildren(...data.shelves.map((shelf) => buildShelf(shelf, data.name)));
}

/** Cabecera de un álbum o una lista: carátula a la izquierda, datos al lado. */
function coverHero({ kicker, title, thumbnail, meta, artists = [], extra = [] }) {
  const hero = el("div", "hero hero--album");
  hero.append(img(thumbnail, "hero__cover"));

  const body = el("div", "hero__body");
  if (kicker) body.append(el("p", "hero__kicker", kicker));
  body.append(el("h2", "hero__title", title));

  const line = el("p", "hero__meta");
  if (artists.length) line.append(artistLinks(artists), meta ? ` · ${meta}` : "");
  else line.textContent = meta;
  body.append(line, actions(extra));

  hero.append(body);
  return hero;
}

function metaOf(list) {
  return [countLabel(list.length), totalDuration(list)].filter(Boolean).join(" · ");
}

function paintAlbum(data) {
  clear();
  shownName = data.title;
  tracks = data.tracks;
  const save = button("save", "Guardar como lista", () => handlers.save(data.title, tracks));

  els.artistTop.append(
    coverHero({
      kicker: [data.kind, data.year].filter(Boolean).join(" · "),
      title: data.title,
      thumbnail: data.thumbnail,
      artists: data.artists,
      meta: metaOf(data.tracks),
      extra: [save],
    }),
  );

  if (data.tracks.length === 0) {
    els.artistSongs.replaceChildren(el("li", "results__empty", "Este álbum no tiene canciones disponibles."));
    return;
  }
  setSongs(data.tracks);
}

function paintList(page, data) {
  clear();
  const title = data.title ?? page.name ?? "Lista de YouTube";
  shownName = title;
  tracks = data.tracks;
  const save = button("save", "Guardar como lista", () => handlers.save(title, tracks));

  els.artistTop.append(
    coverHero({
      kicker: "Lista de YouTube",
      title,
      thumbnail: page.thumbnail ?? data.tracks[0]?.thumbnail,
      meta: metaOf(data.tracks),
      extra: [save],
    }),
  );

  if (data.tracks.length === 0) {
    els.artistSongs.replaceChildren(el("li", "results__empty", "Esta lista está vacía o es privada."));
    return;
  }
  setSongs(data.tracks);
}

// --- Búsqueda ------------------------------------------------------------

/** La tarjeta del artista buscado, encima de los resultados. */
export function artistHit(hit) {
  const li = el("li", "artist-hit");
  li.tabIndex = 0;
  li.setAttribute("role", "button");
  li.title = `Ir a ${hit.name}`;

  const text = el("span", "artist-hit__text");
  text.append(el("span", "artist-hit__name", hit.name), el("span", "artist-hit__sub", hit.subtitle ?? "Artista"));

  const chevron = el("span", "result__chevron");
  chevron.append(icon("back"));

  li.append(img(hit.thumbnail, "artist-hit__art"), text, chevron);

  const open = () => handlers.openArtist(hit.id, hit.name);
  li.addEventListener("click", open);
  li.addEventListener("keydown", (event) => {
    if (event.target !== li || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    open();
  });
  return li;
}
