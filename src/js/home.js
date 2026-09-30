// Secciones de Inicio: mezclas, géneros, artistas, listas y estadísticas.
// Cada sección se muestra cuando llegan sus datos; el orden y la visibilidad
// se toman de las preferencias.

import * as moments from "./moments.js";
import * as discovery from "./discovery.js";
import { els } from "./dom.js";
import { makeFilter } from "./filters.js";
import { detectGenres, genreById, GENRES, tracksOfGenre } from "./genres.js";
import { icon, iconButton } from "./icons.js";
import * as prefs from "./prefs.js";
import { searchTracks } from "./search.js";

const { invoke } = window.__TAURI__.core;

/** Canciones por estantería del recomendador o de una búsqueda. */
const SHELF_SIZE = 14;
/** Géneros deducidos que se enseñan (los elegidos a mano, todos). */
const AUTO_GENRES = 2;
/** Pausa del ratón sobre una tarjeta antes de resolverla por adelantado. */
const HOVER_PREFETCH_MS = 400;

export const SHELF_LABELS = {
  mix: "Tu mezcla",
  again: "Volver a escuchar",
  genres: "Tus géneros",
  because: "Porque escuchaste…",
  top: "Lo que más escuchas",
  discoveries: "Descubrimientos recientes",
  artists: "Tus artistas",
  lists: "Tus listas",
  explore: "Explora otro género",
};

const handlers = {
  pick: () => {},
  playAll: () => {},
  menu: () => {},
  openList: () => {},
  artist: () => {},
  artistRadio: () => {},
  prefetch: () => {},
  lastPlayed: () => null,
  detected: () => {},
};

/** Lo que devuelve `get_home`: estanterías de las estadísticas y la biblioteca. */
let data = { again: [], top: [], discoveries: [], artists: [], library: [] };
let playlists = [];

/** Estanterías que se generan (mezcla, géneros, radios, explorar), por clave. */
const dynamic = new Map();

/** Tus géneros ahora mismo: `{ id, name, seeds }`. */
let genres = [];
let detected = [];

let visible = false;
let loadedOnce = false;
let hoverTimer = null;

/** El elemento de cada estantería y su firma, para no repintar las que no cambian. */
const painted = new Map();

// --- Callbacks -----------------------------------------------------------

/**
 * Instala los callbacks: `{ pick, playAll, menu, openList, artist, artistRadio,
 * prefetch, lastPlayed, detected }`. `artist(track, link)`: clic en el artista
 * de una tarjeta.
 */
export function initHome(callbacks) {
  Object.assign(handlers, callbacks);

  prefs.on("home", () => {
    chooseGenres();
    generateMissing();
    render();
  });
  // Bloquear un canal o una palabra lo quita de las estanterías ya pintadas.
  prefs.on("discovery", render);
}

export function setPlaylists(lists) {
  playlists = lists;
  render();
}

/** Los géneros deducidos de lo que escuchas (para Ajustes). */
export function detectedGenres() {
  return detected;
}

// --- Datos ---------------------------------------------------------------

function artistsOf(tracks) {
  const names = [...new Set(tracks.map((t) => t.uploader?.replace(/ - Topic$/, "")).filter(Boolean))];
  return names.slice(0, 2).join(" y ");
}

function chooseGenres() {
  detected = detectGenres(data.library);
  handlers.detected(detected);

  const manual = prefs.get("home.genres");
  if (manual.length > 0) {
    genres = manual.map((id) => ({
      id,
      name: genreById(id).name,
      seeds: tracksOfGenre(data.library, id).slice(0, 3),
    }));
  } else {
    genres = detected
      .slice(0, AUTO_GENRES)
      .map((g) => ({ id: g.id, name: g.name, seeds: g.tracks.slice(0, 3) }));
  }
}

/** Un género que no escuchas, distinto cada día. */
function exploreGenre() {
  const mine = new Set([...genres.map((g) => g.id), ...detected.map((g) => g.id)]);
  const pool = GENRES.filter((g) => !mine.has(g.id));
  const day = Math.floor(Date.now() / 86_400_000);
  return pool.length ? pool[day % pool.length] : GENRES[day % GENRES.length];
}

/** Genera una estantería en segundo plano y la pinta al llegar. */
async function generate(key, make) {
  dynamic.set(key, { state: "loading" });
  render();

  try {
    const shelf = await make();
    dynamic.set(key, shelf ? { ...shelf, state: "ready" } : { state: "empty" });
  } catch (error) {
    console.warn(`Inicio: no se pudo preparar «${key}»:`, error);
    dynamic.set(key, { state: "error" });
  }
  render();
}

function makers() {
  const list = new Map();
  const haveLibrary = data.library.length > 0;

  if (haveLibrary) {
    list.set("mix", async () => ({
      title: "Tu mezcla",
      subtitle: "Lo tuyo y algo nuevo, mezclado para hoy",
      tracks: await discovery.request("mix", { count: SHELF_SIZE }),
    }));
  }

  for (const genre of genres) {
    list.set(`genre:${genre.id}`, async () => {
      if (genre.seeds.length > 0) {
        return {
          title: `Más ${genre.name.toLowerCase()}`,
          subtitle: `Porque escuchas a ${artistsOf(genre.seeds)}`,
          tracks: await discovery.request("radio", { seeds: genre.seeds, count: SHELF_SIZE }),
        };
      }
      // Elegido a mano y sin nada tuyo de ese género: una búsqueda para empezar.
      return {
        title: genre.name,
        subtitle: "Una selección para empezar",
        tracks: await searchTracks(genreById(genre.id).query, SHELF_SIZE),
      };
    });
  }

  const last = handlers.lastPlayed();
  if (last?.id) {
    list.set(`because:${last.id}`, async () => ({
      title: `Porque escuchaste «${last.title ?? "esa canción"}»`,
      subtitle: last.uploader ?? "",
      tracks: await discovery.request("radio", { seeds: [last], count: SHELF_SIZE }),
    }));
  }

  const explore = exploreGenre();
  list.set(`explore:${explore.id}`, async () => ({
    title: `Explora: ${explore.name}`,
    subtitle: "Algo distinto a lo de siempre",
    tracks: await searchTracks(explore.query, SHELF_SIZE),
  }));

  return list;
}

/** Lanza las estanterías que aún no existen (o todas, con `force`). */
function generateMissing(force = false) {
  for (const [key, make] of makers()) {
    const hidden = prefs.get("home.hiddenShelves");
    const section = key.split(":")[0].replace("genre", "genres");
    if (hidden.includes(section)) continue;
    if (!force && dynamic.has(key) && dynamic.get(key).state !== "error") continue;

    // "Porque escuchaste" y "Explora" son una sola estantería: la nueva
    // sustituye a la de otra canción u otro día.
    const prefix = key.split(":")[0];
    if (prefix === "because" || prefix === "explore") {
      for (const other of [...dynamic.keys()]) {
        if (other !== key && other.startsWith(`${prefix}:`)) dynamic.delete(other);
      }
    }
    generate(key, make);
  }
}

/**
 * Carga Inicio: las estanterías de las estadísticas siempre (son instantáneas),
 * las generadas solo la primera vez o con `force` ("Actualizar").
 */
export async function refresh({ force = false } = {}) {
  try {
    data = await invoke("get_home");
  } catch (error) {
    console.warn("Inicio: no se pudieron leer las estadísticas:", error);
  }

  chooseGenres();
  if (force) dynamic.clear();
  generateMissing(force);
  loadedOnce = true;
  render();
}

export function show(isVisible) {
  visible = isVisible;
  els.home.hidden = !visible;
  if (!visible) return;

  if (!loadedOnce) refresh();
  else render();
}

// --- Estanterías ---------------------------------------------------------

/** Las estanterías a pintar, en el orden elegido y sin las ocultas ni vacías. */
function shelves() {
  const { shelfOrder, hiddenShelves } = prefs.get("home");
  const out = [];

  for (const id of shelfOrder) {
    if (hiddenShelves.includes(id)) continue;

    switch (id) {
      case "mix":
        out.push({ key: "mix", ...dynamic.get("mix") });
        break;
      case "genres":
        for (const genre of genres) {
          out.push({ key: `genre:${genre.id}`, ...dynamic.get(`genre:${genre.id}`) });
        }
        break;
      case "because":
      case "explore":
        for (const [key, shelf] of dynamic) {
          if (key.startsWith(`${id}:`)) out.push({ key, ...shelf });
        }
        break;
      case "again":
        out.push({ key: id, title: "Volver a escuchar", subtitle: "Te gustan y hace días que no suenan", tracks: data.again, state: "ready" });
        break;
      case "top":
        out.push({ key: id, title: "Lo que más escuchas", subtitle: "Por tiempo escuchado", tracks: data.top, state: "ready" });
        break;
      case "discoveries":
        out.push({ key: id, title: "Descubrimientos recientes", subtitle: "Nuevas para ti estas dos semanas, y las escuchaste enteras", tracks: data.discoveries, state: "ready" });
        break;
      case "artists":
        out.push({ key: id, kind: "artists", title: "Tus artistas", subtitle: "Un clic: su radio", items: data.artists, state: "ready" });
        break;
      case "lists": {
        const lists = playlists.filter((pl) => pl.tracks.length > 0);
        out.push({ key: id, kind: "lists", title: "Tus listas", subtitle: "", items: lists, state: "ready" });
        break;
      }
    }
  }

  // Lo que se pidió no recomendar (canales, palabras, duración) tampoco sale
  // en Inicio, aunque la estantería no venga del recomendador.
  const allowed = makeFilter(prefs.get("discovery"));
  const filtered = out.map((shelf) =>
    shelf.tracks ? { ...shelf, tracks: shelf.tracks.filter(t => allowed(t) && moments.allowed(t)) } : shelf,
  );

  return filtered.filter((shelf) => {
    if (!shelf.state || shelf.state === "empty" || shelf.state === "error") return false;
    if (shelf.state === "loading") return true;
    return (shelf.tracks ?? shelf.items ?? []).length > 0;
  });
}

function signature(shelf) {
  const items = shelf.tracks ?? shelf.items ?? [];
  return `${shelf.state}|${shelf.title}|${items.map((i) => i.id ?? i.name).join(",")}`;
}

function shelfHeader(shelf, row) {
  const head = document.createElement("header");
  head.className = "shelf__head";

  const text = document.createElement("div");
  text.className = "shelf__text";
  const title = document.createElement("h3");
  title.className = "shelf__title";
  title.textContent = shelf.title ?? "";
  text.append(title);
  if (shelf.subtitle) {
    const sub = document.createElement("p");
    sub.className = "shelf__sub";
    sub.textContent = shelf.subtitle;
    text.append(sub);
  }

  const actions = document.createElement("div");
  actions.className = "shelf__actions";

  if (shelf.tracks?.length) {
    actions.append(
      iconButton({
        icon: "play",
        label: "Reproducir",
        className: "btn btn--mini btn--with-icon",
        text: true,
        onClick: () => handlers.playAll(shelf.tracks, shelf.title),
      }),
    );
  }

  // Flechas para recorrer la fila sin rueda horizontal.
  for (const [name, dir] of [["back", -1], ["back", 1]]) {
    const button = iconButton({
      icon: name,
      label: dir < 0 ? "Anteriores" : "Siguientes",
      className: `btn btn--icon shelf__arrow${dir > 0 ? " shelf__arrow--next" : ""}`,
      onClick: () => row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: "smooth" }),
    });
    actions.append(button);
  }

  head.append(text, actions);
  return head;
}

function art(src, className) {
  const img = document.createElement("img");
  img.className = className;
  img.alt = "";
  img.loading = "lazy";
  if (src) img.src = src;
  return img;
}

function trackCard(track) {
  const card = document.createElement("div");
  card.className = "card";
  card.tabIndex = 0;
  card.setAttribute("role", "button");
  card.dataset.id = track.id;
  card.title = [track.title, track.uploader].filter(Boolean).join(" · ");

  const cover = document.createElement("div");
  cover.className = "card__cover";
  cover.append(art(track.thumbnail, "card__art"));

  const play = document.createElement("span");
  play.className = "card__play";
  play.append(icon("play"));
  cover.append(play);

  const more = iconButton({
    icon: "more",
    label: "Más opciones",
    className: "card__more",
    onClick: (event, button) => {
      event.stopPropagation();
      handlers.menu(track, button);
    },
  });
  cover.append(more);

  const title = document.createElement("span");
  title.className = "card__title";
  title.textContent = track.title || "Sin título";

  // El artista lleva a su página; el resto de la tarjeta, a la canción.
  const by = document.createElement(track.uploader ? "button" : "span");
  by.className = "card__by";
  by.textContent = track.uploader || "";
  if (track.uploader) {
    by.type = "button";
    by.classList.add("card__by--link");
    by.title = `Ir a ${track.uploader.replace(/ - Topic$/, "")}`;
    by.addEventListener("click", (event) => {
      event.stopPropagation();
      handlers.artist(track, by);
    });
    by.addEventListener("keydown", (event) => event.stopPropagation());
  }

  card.append(cover, title, by);

  const pick = () => handlers.pick(track);
  card.addEventListener("click", pick);
  card.addEventListener("keydown", (event) => {
    if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    pick();
  });
  card.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    handlers.menu(track, more);
  });
  card.addEventListener("pointerenter", () => {
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => handlers.prefetch(track), HOVER_PREFETCH_MS);
  });
  card.addEventListener("pointerleave", () => clearTimeout(hoverTimer));

  return card;
}

function artistCard(artist) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "card card--artist";
  card.title = `Radio de ${artist.name}`;

  const cover = document.createElement("div");
  cover.className = "card__cover";
  cover.append(art(artist.tracks[0]?.thumbnail, "card__art"));

  const name = document.createElement("span");
  name.className = "card__title";
  name.textContent = artist.name.replace(/ - Topic$/, "");

  const by = document.createElement("span");
  by.className = "card__by";
  by.textContent = "Radio";

  card.append(cover, name, by);
  card.addEventListener("click", () => handlers.artistRadio(artist));
  return card;
}

function listCard(list) {
  const card = document.createElement("button");
  card.type = "button";
  card.className = "card card--list";

  const cover = document.createElement("div");
  cover.className = "card__cover";
  if (list.system) {
    cover.classList.add("card__cover--likes");
    cover.append(icon("heart"));
  } else {
    // Mosaico de hasta cuatro carátulas.
    const thumbs = list.tracks.map((t) => t.thumbnail).filter(Boolean).slice(0, 4);
    cover.classList.toggle("card__cover--mosaic", thumbs.length >= 4);
    for (const src of thumbs.length >= 4 ? thumbs : thumbs.slice(0, 1)) cover.append(art(src, "card__art"));
  }

  const name = document.createElement("span");
  name.className = "card__title";
  name.textContent = list.name;

  const by = document.createElement("span");
  by.className = "card__by";
  const n = list.tracks.length;
  by.textContent = `${n} ${n === 1 ? "canción" : "canciones"}`;

  card.append(cover, name, by);
  card.addEventListener("click", () => handlers.openList(list.id));
  return card;
}

function skeletons() {
  return Array.from({ length: 6 }, () => {
    const card = document.createElement("div");
    card.className = "card card--skeleton";
    card.setAttribute("aria-hidden", "true");
    card.innerHTML = '<div class="card__cover"></div><span class="card__title"></span><span class="card__by"></span>';
    return card;
  });
}

function buildShelf(shelf) {
  const section = document.createElement("section");
  section.className = "shelf";
  section.setAttribute("aria-busy", String(shelf.state === "loading"));

  const row = document.createElement("div");
  row.className = "shelf__row";

  if (shelf.state === "loading") {
    row.append(...skeletons());
  } else if (shelf.kind === "artists") {
    row.append(...shelf.items.map(artistCard));
  } else if (shelf.kind === "lists") {
    row.append(...shelf.items.map(listCard));
  } else {
    row.append(...shelf.tracks.map(trackCard));
  }

  section.append(shelfHeader(shelf, row), row);
  return section;
}

/** Sin nada escuchado ni géneros elegidos: preguntar qué le gusta. */
function welcome() {
  const box = document.createElement("section");
  box.className = "home__welcome";

  const title = document.createElement("h3");
  title.className = "shelf__title";
  title.textContent = "¿Qué música te gusta?";

  const text = document.createElement("p");
  text.className = "shelf__sub";
  text.textContent =
    "Elige uno o varios géneros y Antares te preparará estanterías con ellos. Según escuches, aprenderá tus gustos solo.";

  const chips = document.createElement("div");
  chips.className = "genre-chips";
  for (const genre of GENRES) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "genre-chip";
    chip.textContent = genre.name;
    chip.addEventListener("click", () => prefs.set("home.genres", [...prefs.get("home.genres"), genre.id]));
    chips.append(chip);
  }

  box.append(title, text, chips);
  return box;
}

export function render() {
  if (!visible) return;

  const list = shelves();
  const needsWelcome = data.library.length === 0 && prefs.get("home.genres").length === 0;

  const nodes = [];
  if (needsWelcome) nodes.push(painted.get("welcome")?.node ?? welcome());

  const keep = new Set(needsWelcome ? ["welcome"] : []);
  if (needsWelcome) painted.set("welcome", { node: nodes[0], sig: "welcome" });

  for (const shelf of list) {
    const sig = signature(shelf);
    const old = painted.get(shelf.key);
    const node = old && old.sig === sig ? old.node : buildShelf(shelf);
    painted.set(shelf.key, { node, sig });
    keep.add(shelf.key);
    nodes.push(node);
  }

  for (const key of painted.keys()) if (!keep.has(key)) painted.delete(key);

  if (nodes.length === 0) {
    const p = document.createElement("p");
    p.className = "results__empty";
    p.textContent = "Todas las secciones de Inicio están ocultas. Actívalas en Ajustes › Inicio.";
    nodes.push(p);
  }

  // Solo se mueve lo que cambió: el scroll horizontal de cada fila se conserva.
  const current = [...els.home.children];
  if (current.length !== nodes.length || current.some((n, i) => n !== nodes[i])) {
    els.home.replaceChildren(...nodes);
  }
}
