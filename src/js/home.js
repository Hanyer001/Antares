import { runtime } from "./platform.js";
// Secciones de Inicio: mezclas, géneros, artistas, listas y estadísticas.
// Cada sección se muestra cuando llegan sus datos; el orden y la visibilidad
// se toman de las preferencias.

import { createShelfCache } from "./shelf-cache.js";
import * as moments from "./moments.js";
import * as discovery from "./discovery.js";
import { els } from "./dom.js";
import { displayThumbnail } from "./thumbnails.js";
import { createHoverPrefetch, bindScrollFeedback } from "./scroll-activity.js";
import { makeFilter } from "./filters.js";
import { detectGenres, genreById, GENRES, tracksOfGenre } from "./genres.js";
import { HomeSection, home_section_id as sectionId, move_home_section } from "./rust-core.js";
import * as prefs from "./prefs.js";
import { bindTouchSort, dropPosition } from "./mobile-interactions.js";
import { orderedShelves } from "./interaction-policy.js";
import { openMenu } from "./menu.js";
import { haptic } from "./haptics.js";
import { toast } from "./toast.js";
import { searchTracks } from "./search.js";

const { invoke } = runtime.core;

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
  artistPlay: () => {},
  prefetch: () => {},
  lastPlayed: () => null,
  detected: () => {},
};

/** Lo que devuelve `get_home`: estanterías de las estadísticas y la biblioteca. */
let data = { again: [], top: [], discoveries: [], artists: [], library: [] };
let playlists = [];

/** Estanterías que se generan (mezcla, géneros, radios, explorar), por clave. */
const shelfCache = createShelfCache();
const dynamic = shelfCache.entries;
let refreshVersion = 0;

/** Tus géneros ahora mismo: `{ id, name, seeds }`. */
let genres = [];
let detected = [];

let visible = false;
let loadedOnce = false;
const hoverPrefetch = createHoverPrefetch();

/** El elemento de cada estantería y su firma, para no repintar las que no cambian. */
const painted = new Map();

// --- Callbacks -----------------------------------------------------------

/**
 * Instala los callbacks: `{ pick, playAll, menu, openList, artist, artistPlay,
 * prefetch, lastPlayed, detected }`. `artist(track, link)`: clic en el artista
 * de una tarjeta.
 */
export function initHome(callbacks) {
  Object.assign(handlers, callbacks);
  bindScrollFeedback(els.home);
  if(document.documentElement.dataset.platform==='android') initOrganizer();

  prefs.on("home", () => {
    chooseGenres();
    generateMissing();
    render();
  });
  // Bloquear un canal o una palabra lo quita de las estanterías ya pintadas.
  prefs.on("discovery", () => { invalidate(); render(); });
}

export function setPlaylists(lists) {
  playlists = lists;
  render();
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
  try {
    await shelfCache.generate(key, make, render);
  } catch (error) {
    console.warn(`Inicio: no se pudo preparar «${key}»:`, error);
  }
}

/** Recalcular al volver a Inicio, sin mover tarjetas durante una elección. */
export function invalidate() { shelfCache.invalidate(); }

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
 * las generadas al cambiar las escuchas y volver, o con "Actualizar".
 */
export async function refresh({ force = false } = {}) {
  const version = ++refreshVersion;
  const regenerate = shelfCache.consumeInvalidation() || force;
  // Invalidar antes de esperar: otra recarga más nueva puede terminar primero.
  if (regenerate) dynamic.clear();
  try {
    const fresh = await invoke("get_home");
    if (version !== refreshVersion) return;
    data = fresh;
  } catch (error) {
    if (version !== refreshVersion) return;
    invalidate();
    console.warn("Inicio: no se pudieron leer las estadísticas:", error);
  }

  chooseGenres();
  generateMissing(regenerate);
  loadedOnce = true;
  render();
}

export function show(isVisible) {
  const entering = isVisible && !visible;
  visible = isVisible;
  els.home.hidden = !visible;
  if (!visible) return;

  if (!loadedOnce || (entering && shelfCache.needsRefresh)) refresh();
  else render();
}

// --- Estanterías ---------------------------------------------------------

/** Las estanterías a pintar, en el orden elegido y sin las ocultas ni vacías. */
function shelves() {
  const { shelfOrder, hiddenShelves, pinnedShelves } = prefs.get("home");
  const out = [];

  for (const id of orderedShelves(shelfOrder,pinnedShelves)) {
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
        out.push({ key: id, kind: "artists", title: "Tus artistas", subtitle: "Empieza por sus cinco principales", items: data.artists, state: "ready" });
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
    shelf.tracks ? { ...shelf, tracks: shelf.tracks.filter(t => allowed(t) && moments.allowed(t) && (!isDiscoveryShelf(shelf.key) || !prefs.get("discovery.knownTracks").includes(t.id))) } : shelf,
  );

  return filtered.filter((shelf) => {
    if (!shelf.state || shelf.state === "empty" || shelf.state === "error") return false;
    if (shelf.state === "loading") return true;
    return (shelf.tracks ?? shelf.items ?? []).length > 0;
  });
}

const thumbnail = src => src ? displayThumbnail(src) : null;

function shelfModel(shelf) {
  const section = sectionId(shelf.key);
  const cards = shelf.kind === "artists"
    ? shelf.items.map(({ name, tracks }) => ({ kind: "artist", name, thumbnail: thumbnail(tracks[0]?.thumbnail) }))
    : shelf.kind === "lists"
      ? shelf.items.map(({ name, tracks, system }) => ({
        kind: "list", name, count: tracks.length, system: Boolean(system),
        thumbnails: system ? [] : tracks.map(t => t.thumbnail).filter(Boolean).slice(0, 4).map(thumbnail),
      }))
      : (shelf.tracks ?? []).map(({ id, title, uploader, thumbnail: src }) => ({
        kind: "track", id, title, artist: uploader, thumbnail: thumbnail(src),
      }));
  return {
    section, title: shelf.title ?? "", subtitle: shelf.subtitle,
    pinned: prefs.get("home.pinnedShelves").includes(section),
    mobile: document.documentElement.dataset.platform === "android",
    loading: shelf.state === "loading", playable: Boolean(shelf.tracks?.length), cards,
  };
}

function bindShelf(node, entry) {
  const row = node.querySelector(".shelf__row");
  for (const button of node.querySelectorAll("[data-home-action]")) {
    button.addEventListener("click", () => {
      const shelf = entry.shelf;
      switch (button.dataset.homeAction) {
        case "play": handlers.playAll(shelf.tracks, shelf.title); break;
        case "organize": sectionMenu(shelf, button); break;
        default: {
          const dir = button.dataset.homeAction === "previous" ? -1 : 1;
          row.scrollBy({ left: dir * row.clientWidth * 0.8, behavior: "smooth" });
        }
      }
    });
  }
  row.querySelectorAll(".card:not(.card--skeleton)").forEach((card, index) => {
    if (entry.shelf.kind === "artists") {
      card.addEventListener("click", () => handlers.artistPlay(entry.shelf.items[index]));
      return;
    }
    if (entry.shelf.kind === "lists") {
      card.addEventListener("click", () => handlers.openList(entry.shelf.items[index].id));
      return;
    }
    const track = () => entry.shelf.tracks[index];
    const more = card.querySelector(".card__more");
    more.addEventListener("click", event => { event.stopPropagation(); handlers.menu(track(), more); });
    const by = card.querySelector(".card__by--link");
    by?.addEventListener("click", event => { event.stopPropagation(); handlers.artist(track(), by); });
    by?.addEventListener("keydown", event => event.stopPropagation());
    const pick = () => handlers.pick(track());
    card.addEventListener("click", pick);
    card.addEventListener("keydown", event => {
      if (event.target !== card || (event.key !== "Enter" && event.key !== " ")) return;
      event.preventDefault();
      pick();
    });
    card.addEventListener("contextmenu", event => { event.preventDefault(); handlers.menu(track(), more); });
    hoverPrefetch.bind(card, () => handlers.prefetch(track()), HOVER_PREFETCH_MS);
  });
}

function isDiscoveryShelf(key) {
  return ["mix", "genres", "because", "discoveries", "explore"].includes(sectionId(key));
}
function moveSection(from, to) {
  if (to == null) return;
  const order = move_home_section(prefs.get("home.shelfOrder"), prefs.get("home.pinnedShelves"), from, to);
  if (!order) return;
  prefs.set("home.shelfOrder", order);
  haptic();
  toast("Orden de Inicio actualizado.");
}
function sectionMenu(shelf,button){
  const id=sectionId(shelf.key),pins=prefs.get('home.pinnedShelves'),pinned=pins.includes(id);
  const order=orderedShelves(prefs.get('home.shelfOrder'),pins).filter(key=>pins.includes(key)===pinned && !prefs.get('home.hiddenShelves').includes(key));
  const at=order.indexOf(id);
  openMenu(button,[{heading:shelf.title},
    {label:pinned?'Dejar de fijar':'Fijar arriba',onSelect:()=>{prefs.set('home.pinnedShelves',pinned?pins.filter(key=>key!==id):[...pins,id]);haptic();}},
    ...(at>0?[{label:'Subir sección',onSelect:()=>moveSection(id,order[at-1])}]:[]),
    ...(at>=0&&at<order.length-1?[{label:'Bajar sección',onSelect:()=>moveSection(id,order[at+1])}]:[]),
    {label:'Ocultar sección',onSelect:()=>{prefs.set('home.hiddenShelves',[...prefs.get('home.hiddenShelves'),id]);toast('Sección oculta.',{action:{label:'Deshacer',onClick:()=>prefs.set('home.hiddenShelves',prefs.get('home.hiddenShelves').filter(key=>key!==id))}});}}
  ]);
}
function initOrganizer(){
  const bar=document.createElement('div');bar.className='home-organizer';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='btn btn--mini';toggle.textContent='Organizar Inicio';toggle.setAttribute('aria-pressed','false');
  const hint=document.createElement('span');hint.className='home-organizer__hint';hint.hidden=true;hint.textContent='Arrastra el asa. Tócala para fijar, mover u ocultar.';
  toggle.addEventListener('click',()=>{const on=!els.home.classList.contains('home--editing');els.home.classList.toggle('home--editing',on);toggle.setAttribute('aria-pressed',String(on));toggle.textContent=on?'Listo':'Organizar Inicio';hint.hidden=!on;});
  bar.append(toggle,hint);els.home.before(bar);
  new MutationObserver(()=>{bar.hidden=els.home.hidden;}).observe(els.home,{attributes:true,attributeFilter:['hidden']});bar.hidden=els.home.hidden;
  bindTouchSort(els.home,{rowSelector:'.shelf',handleSelector:'.shelf__organize',onMove:(row,target,after)=>{
    const visible=[...new Set([...els.home.querySelectorAll('.shelf')].map(e=>e.dataset.section))];
    const from=visible.indexOf(row.dataset.section),at=visible.indexOf(target.dataset.section);
    moveSection(row.dataset.section,visible[dropPosition(from,at,after,visible.length)]);
  }});
}

export function render() {
  if (!visible) return;

  const list = shelves();
  const needsWelcome = data.library.length === 0 && prefs.get("home.genres").length === 0;

  const nodes = [];
  const keep = new Set();
  const update = (key, signature, makeView, shelf) => {
    keep.add(key);
    let entry = painted.get(key);
    if (!entry || entry.signature !== signature) {
      const view = makeView();
      const node = view.element();
      entry?.view.free();
      entry = { view, node, signature, shelf };
      painted.set(key, entry);
      if (shelf) bindShelf(node, entry);
      else if (key === "welcome") {
        for (const button of node.querySelectorAll("[data-genre]")) {
          button.addEventListener("click", () => prefs.set("home.genres", [...prefs.get("home.genres"), button.dataset.genre]));
        }
      }
    }
    entry.shelf = shelf;
    nodes.push(entry.node);
  };
  if (needsWelcome) update("welcome", "", () => HomeSection.welcome(JSON.stringify(GENRES)));
  for (const shelf of list) {
    const model = JSON.stringify(shelfModel(shelf));
    update(shelf.key, model, () => HomeSection.shelf(model), shelf);
  }
  if (!nodes.length) update("empty", "", () => HomeSection.empty());
  for (const [key, entry] of painted) {
    if (!keep.has(key)) {
      entry.view.free();
      painted.delete(key);
    }
  }

  // Se mueven los nodos existentes para conservar el foco y el scroll horizontal.
  for (const [index, node] of nodes.entries()) {
    if (els.home.children[index] !== node) els.home.insertBefore(node, els.home.children[index] ?? null);
  }
  while (els.home.children.length > nodes.length) els.home.lastElementChild.remove();
}
