// Inicialización y coordinación de reproducción, navegación y biblioteca.
// Los módulos de js/ gestionan los controles y servicios de cada función.

import * as libraryTools from "./js/library-tools.js";
import * as moments from "./js/moments.js";
import * as backups from "./js/backups.js";
import { Recovery } from "./js/recovery.js";
import * as appearance from "./js/appearance.js";
import * as artistView from "./js/artist.js";
import { clearArtwork, setArtwork } from "./js/artwork.js";
import * as customize from "./js/customize.js";
import * as dialog from "./js/dialog.js";
import * as discovery from "./js/discovery.js";
import { els } from "./js/dom.js";
import { describeOrigin, friendlyError } from "./js/format.js";
import { clearHistory, loadHistory, recordPlay } from "./js/history.js";
import * as home from "./js/home.js";
import * as layout from "./js/layout.js";
import * as library from "./js/library.js";
import * as lists from "./js/lists.js";
import * as listening from "./js/listening.js";
import { sortDoneText, sortTracks, SORTS } from "./js/listsort.js";
import { findDuplicates, findSame } from "./js/songmatch.js";
import * as lyrics from "./js/lyrics.js";
import * as appUpdate from "./js/appupdate.js";
import * as importList from "./js/importlist.js";
import * as media from "./js/mediasession.js";
import { connectNative, NativeDeck, sendToBackground } from "./js/native-deck.js";
import { closeMenu, isMenuOpen, openMenu } from "./js/menu.js";
import * as people from "./js/people.js";
import * as player from "./js/player.js";
import * as prefs from "./js/prefs.js";
import * as queue from "./js/queue.js";
import * as results from "./js/results.js";
import * as session from "./js/session.js";
import * as shortcuts from "./js/shortcuts.js";
import * as sleep from "./js/sleep.js";
import * as sound from "./js/sound.js";
import * as summary from "./js/summary.js";
import * as thumbbar from "./js/thumbbar.js";
import * as miniPlayer from "./js/miniplayer.js";
import * as nowState from "./js/nowstate.js";
import * as playerBar from "./js/playerbar.js";
import { prefetchTrack, resolveTrack, searchSongs, searchTracks } from "./js/search.js";
import { rankSearch } from "./js/searchrank.js";
import * as settings from "./js/settings.js";
import { toast } from "./js/toast.js";
import { checkNow, installedVersion, onUpdated } from "./js/updater.js";
import * as user from "./js/user.js";
import {
  setBusy,
  setEngine,
  setModes,
  setQueueControls,
  setRating,
  setStatus,
  setTrack,
  setTransportEnabled,
  setView,
} from "./js/ui.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

/** En el móvil (lo marca boot-theme.js antes de pintar). */
const ANDROID = document.documentElement.dataset.platform === "android";

/** Segundos del fundido final del temporizador para dormir. */
const SLEEP_FADE_SECONDS = 8;

// El salto de las flechas y el paso del volumen son ajustes (behavior.*).
const skipSeconds = () => prefs.get("behavior.skipSeconds");
const volumeStep = () => prefs.get("behavior.volumeStep") / 100;

/** Excluye la sesión del historial y las estadísticas. Se desactiva al reiniciar. */
let incognito = false;
let learnCurrent = true;

/** Cuántas se ven en "A continuación". */
const UPNEXT_COUNT = 6;

/** Canciones de una mezcla nueva, de una radio y de cada ampliación de la cola. */
const MIX_SIZE = 30;
const RADIO_SIZE = 25;
const CONTINUE_SIZE = 10;

/** Solicita más canciones antes de agotar la cola. */
const CONTINUE_WHEN_LEFT = 2;

/** Descarta respuestas de reproducción anteriores a la solicitud actual. */
let requestId = 0;

/** Identificador independiente para descartar búsquedas anteriores. */
let searchId = 0;

/**
 * Estado de reproducción. query conserva la consulta para reintentar;
 * audioQuery identifica la cargada en el reproductor. track contiene los
 * metadatos de la escucha activa. Recovery controla el límite de reintentos.
 */
const playing = { query: "", audioQuery: "", hint: null, retriedSafe: false, track: null, loading: false };

const recoveryNotice = document.createElement("div");
recoveryNotice.className = "recovery-notice"; recoveryNotice.hidden = true;
recoveryNotice.setAttribute("role", "status"); document.body.append(recoveryNotice);
function showRecovery(waiting = false) {
  recoveryNotice.replaceChildren(); recoveryNotice.hidden = false;
  const message = document.createElement("span");
  message.textContent = waiting ? "Sin conexión. Continuaremos cuando vuelva internet." : "No se pudo continuar esta canción.";
  recoveryNotice.append(message);
  for (const [label, action] of [
    ["Reintentar", async () => {
      const startAt = recovery.position; recovery.begin(startAt); recoveryNotice.hidden = true;
      if (!await reproducir(playing.query, { hint: playing.hint, startAt, fresh: true, safeMode: true, recovering: true })) recovery.fail();
    }],
    ["Buscar otra versión", () => {
      recovery.pause(); player.pause(); recoveryNotice.hidden = true;
      els.input.value = [playing.hint?.uploader, playing.hint?.title].filter(Boolean).join(" ") || playing.query; buscar();
    }],
    ["Saltar", () => { recovery.pause(); recoveryNotice.hidden = true; if (!saltarASiguiente()) player.pause(); }],
  ]) {
    const button = document.createElement("button"); button.className = "btn btn--mini"; button.type = "button";
    button.textContent = label; button.addEventListener("click", action); recoveryNotice.append(button);
  }
}
const recovery = new Recovery({
  retry: (startAt) => {
    // En segundo plano, timeupdate puede retrasarse. Consultar también el audio
    // y conservar la última posición si la fuente fallida la ha reiniciado a cero.
    if (playing.audioQuery === playing.query && player.currentTime() > 0) {
      recovery.progress(player.currentTime());
      startAt = recovery.position;
    }
    return reproducir(playing.query, { safeMode: true, fresh: true, recovering: true, hint: playing.hint, startAt });
  },
  waiting: () => { setEngine("busy"); showRecovery(true); },
  failed: () => { playing.loading = false; ++requestId; player.pause(); setEngine("error"); showRecovery(); },
  recovered: () => { recoveryNotice.hidden = true; },
});
window.addEventListener("online", () => recovery.reconnect());
window.addEventListener("offline", () => { if (playing.loading) recovery.fail(); });

/** Valoración de la pista que suena. */
let rating = "none";

/**
 * Vista visible en la columna central: "results", "discover", "queue",
 * "history", "lists" o "settings". También una página de YouTube Music:
 * "artist", "album" o "ytlist" (ver `PAGE_LABELS`).
 */
let activeTab = "home";

/**
 * Las páginas de artista, álbum o lista abiertas una tras otra, la actual la
 * última: "Volver" va a la anterior. `returnTo` es la vista de la que se
 * salió al abrir la primera, a la que se vuelve al acabarse.
 */
let pageStack = [];
let returnTo = null;

/**
 * Qué se está escuchando ("Mi lista", "Radio de Radiohead", "Tu mezcla"), o
 * null: en la cola, lo que viene tras "Siguiente en la cola" dice de dónde es.
 */
let contexto = null;

/** Carga la cola y apunta de dónde sale. */
function cargarCola(tracks, start, opts, nombre = null) {
  contexto = nombre;
  queue.load(tracks, start, opts);
}

let lastQuery = "";
let lastResults = [];
let searching = false;
let lastHistory = [];

/** El artista que se está buscando (su tarjeta encima de los resultados), o null. */
let lastArtistHit = null;

/**
 * El reparto de los resultados: de quién es la canción buscada y dónde
 * empiezan los "Otros resultados" (-1: sin reparto). Ver searchrank.js.
 */
let lastSearchArtist = null;
let lastSearchSplit = -1;

/** La última mezcla del aleatorio inteligente, y si se está preparando una. */
let lastMix = [];
let mixBusy = false;

/**
 * La petición de la cola infinita en curso, o null. Se comparte en vez de
 * lanzar una segunda: si la canción acaba mientras aún se piden, el final
 * espera a esta misma en lugar de rendirse.
 */
let continuation = null;

/** Todas las listas, "Me gusta" primero, y cuál está abierta (null: ninguna). */
let playlists = [];
let openListId = null;

/** Las canciones del resumen, para que sus filas se puedan poner como las demás. */
let lastSummary = [];

/**
 * La canción de la sesión anterior, en pausa hasta que se pulse play:
 * `{ track, time }`, o null. Al darle al play se resuelve y empieza en `time`.
 */
let pendingResume = null;

/**
 * Id de la canción para la que ya se lanzó la transición a la siguiente. Evita
 * lanzarla dos veces: `timeupdate` llega varias veces por segundo en el tramo
 * final.
 */
let transitionFrom = null;

/** Cada cuánto se guarda por dónde va la canción, mientras suena. */
const SESSION_EVERY_MS = 5000;
let lastSessionSave = 0;

// --- Reproducción --------------------------------------------------------

/**
 * Reproduce una consulta concreta.
 *
 * @param {string} query        Texto de búsqueda o URL de YouTube.
 * @param {object} [opts]
 * @param {boolean} [opts.safeMode]  Reintento con el cliente conservador.
 * @param {object}  [opts.hint]      Metadatos ya conocidos (al venir de una lista).
 * @param {number}  [opts.startAt]   Segundo en el que empezar (al retomar la sesión).
 * @param {number}  [opts.crossfade] Segundos para fundirla con la que suena, en
 *                                   vez de cortar.
 */
async function reproducir(query, { safeMode = false, hint = null, startAt = 0, crossfade = 0, fresh = false, recovering = false } = {}) {
  if (!query) {
    setStatus("Escribe el nombre de una canción o pega un enlace.", "error");
    setEngine("error");
    els.input.focus();
    return;
  }

  if (!recovering) { recovery.begin(startAt); recoveryNotice.hidden = true; }
  const currentRequest = ++requestId;
  const startedAt = performance.now();
  playing.loading = true;

  // Una reproducción nueva empieza sin haber gastado el reintento.
  if (!safeMode) {
    playing.query = query;
    playing.hint = hint;
    playing.retriedSafe = false;
  }

  // Mostrar los metadatos conocidos mientras se resuelve el audio.
  if (hint) {
    setTrack({ title: hint.title, uploader: hint.uploader });
    setArtwork(hint.thumbnail);
    results.markCurrent(hint.id);
  }

  // Indicar la carga en el botón de reproducción.
  setEngine("busy");

  try {
    const result = await resolveTrack(query, safeMode, fresh);

    // Llegó tarde: ya hay otra reproducción en curso, la descartamos.
    if (currentRequest !== requestId) return;

    const resolvedMs = Math.round(performance.now() - startedAt);
    const origen = describeOrigin(result);
    console.log(`URL resuelta en ${resolvedMs} ms (${origen})`);

    // Priorizar los metadatos resueltos y usar los conocidos como respaldo.
    setTrack({
      title: result.title || hint?.title || query,
      uploader: result.uploader || hint?.uploader,
    });

    // Evitar recalcular el acento si la carátula no ha cambiado.
    if (result.thumbnail && result.thumbnail !== hint?.thumbnail) {
      setArtwork(result.thumbnail);
    }

    // La marca de "sonando" se pone por id de vídeo, no por posición: la
    // resolución y la búsqueda son llamadas independientes y YouTube podría
    // ordenar distinto en cada una.
    if (result.id) {
      results.markCurrent(result.id);
      queue.pointAt(result.id);
    }

    // La duración llega ya resuelta, así que el tiempo total aparece de
    // inmediato en vez de esperar a `loadedmetadata`.
    const knownDuration = result.duration ?? hint?.duration ?? null;

    if (crossfade > 0 && player.isPlaying()) {
      // Transición: la que sonaba llegó a sus últimos segundos, así que
      // cuenta como escuchada entera, y se funde con esta en vez de cortarse.
      cerrarEscucha(true);
      await player.crossfadeTo(result.url, knownDuration, crossfade);
      playing.audioQuery = query;
    } else {
      // Lo que sonaba deja de sonar aquí: es el momento de apuntar cuánto se
      // escuchó. Antes no, porque mientras se resolvía la nueva seguía sonando.
      if (!recovering || playing.track?.id !== (result.id ?? hint?.id)) cerrarEscucha(false);
      const videoId = result.id ?? hint?.id;
      playing.audioQuery = query;
      player.load(result.url, knownDuration, startAt, {
        title: result.title || hint?.title || null,
        artist: result.uploader || hint?.uploader || null,
        artwork: videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : null,
      });

      // play() devuelve una promesa: si el navegador rechaza la URL (formato no
      // soportado, enlace caducado, 403 de YouTube) se captura abajo.
      await player.play();
    }

    if (currentRequest !== requestId) return false;
    recovery.playing();
    setTransportEnabled(true);

    setEngine("playing");

    // Registrar la escucha tras iniciar el audio; el prefetch no cuenta.
    const id = result.id ?? hint?.id;
    const track = {
      id,
      title: result.title || hint?.title,
      uploader: result.uploader || hint?.uploader,
      duration: result.duration ?? hint?.duration,
      thumbnail: result.thumbnail || hint?.thumbnail,
      watch_url: hint?.watch_url ?? (id ? `https://www.youtube.com/watch?v=${id}` : null),
      // De qué Mix salió, si vino de una recomendación: así un salto se le
      // puede atribuir a esa semilla.
      seed: hint?.seed ?? null,
    };

    if (!recovering || !playing.track || playing.track.id !== track.id) {
      empezarEscucha(track);
      if (!incognito) recordPlay(track).then(refrescarHistorial);
    }
    playing.hint = track;
    prefetchSiguiente();
    asegurarContinuacion();
    return true;
  } catch (error) {
    if (currentRequest !== requestId) return;

    console.warn("No se pudo reproducir:", error);
    if (!recovering) recovery.fail();
    return false;
  } finally {
    // Si la sustituyó otra (o el reintento en modo seguro), esa sigue cargando.
    if (currentRequest === requestId) playing.loading = false;
  }
}

/** Resuelve la próxima pista mientras suena la actual para reducir la espera. */
function prefetchSiguiente() {
  const siguiente = queue.peekNext();
  if (siguiente) prefetchTrack(siguiente.watch_url);
}

/**
 * El cliente rápido a veces entrega una URL que el navegador rechaza. Gastamos
 * el único reintento permitido antes de dar el fallo por definitivo.
 *
 * @returns {boolean} true si se lanzó el reintento.
 */

/** Reproduce una pista de cualquier lista, con sus metadatos ya conocidos. */
function reproducirPista(track) {
  reproducir(track.watch_url, { hint: track });
}

/** Salta a la siguiente de la cola, si la hay. */
function saltarASiguiente() {
  const track = queue.next();
  if (track) reproducirPista(track);
  return Boolean(track);
}

// --- Escuchas ------------------------------------------------------------

/**
 * La pista empezó a sonar: se cuenta su escucha, se lee su valoración y se
 * avisa a todo lo que enseña qué suena (Windows, la bandeja, la letra).
 */
function empezarEscucha(track) {
  playing.track = track;
  pendingResume = null;
  learnCurrent = moments.shouldLearn();
  listening.start(track);
  cargarValoracion(track.id);
  els.radioButton.hidden = !track.id;

  media.setTrack(track);
  lyrics.load(track);
  invoke("set_tray_tooltip", {
    text: track.title ? `${track.title} — Antares` : "Antares",
  }).catch(() => {});

  // El aviso de Windows solo si Antares no está delante: con ella a la vista
  // ya se ve qué suena.
  // En Android sobra: la notificación del reproductor ya dice qué suena.
  if (!ANDROID && prefs.get("behavior.notify") && (document.hidden || !document.hasFocus())) {
    invoke("notify_track", {
      title: track.title ?? "Antares",
      body: track.uploader ?? "",
    }).catch(() => {});
  }

  guardarSesion();
}

/** Activa o quita el modo incógnito (Ajustes › Reproducción, o su chip). */
function ponerIncognito(activo) {
  incognito = activo;
  els.incognitoChip.hidden = !activo;
  els.incognitoToggle.checked = activo;
  setStatus(
    activo
      ? "Modo incógnito: lo que escuches no se guarda."
      : "Modo incógnito desactivado.",
    "ok",
  );
}

// --- Sesión --------------------------------------------------------------

/** Guarda dónde te quedaste: la cola, lo que suena y por qué segundo va. */
function guardarSesion() {
  const track = playing.track ?? pendingResume?.track ?? null;
  const time = playing.track ? player.currentTime() : pendingResume?.time ?? 0;

  session.save({
    queue: queue.snapshot(),
    track,
    time: Number.isFinite(time) ? time : 0,
    picks: discovery.getPicks(),
  });
  lastSessionSave = performance.now();
}

/**
 * Recupera la sesión anterior: la cola tal cual, y la canción que sonaba en
 * pausa, lista para seguir donde se quedó.
 */
function restaurarSesion() {
  // "Al abrir la app": retomar (lo de siempre), una mezcla nueva o nada.
  const startup = prefs.get("behavior.startup");
  if (startup === "mix") {
    prepararMezclaInicial();
    return;
  }
  if (startup === "empty") return;

  const saved = session.load();
  if (!saved) return;

  queue.restore(saved.queue);
  discovery.setPicks(saved.picks);

  const track = saved.track;
  if (!track?.id) return;

  pendingResume = { track, time: Number(saved.time) || 0 };

  setTrack({ title: track.title, uploader: track.uploader });
  setArtwork(track.thumbnail);
  results.markCurrent(track.id);
  media.setTrack(track);
  lyrics.load(track);
  // Sin aviso: la canción ya está en la consola con su play. Uno en cada
  // arranque sería ruido.
  els.play.disabled = false;
}

/**
 * Al abrir con "Mezcla nueva": la cola nace con una mezcla lista, en pausa. No
 * suena sola: abrir la app no debería ponerse a hacer ruido.
 */
async function prepararMezclaInicial() {
  try {
    lastMix = await discovery.request("mix", { count: MIX_SIZE });
    cargarCola(lastMix, 0, { ordered: true, auto: true }, "Tu mezcla");

    // La primera queda "en pausa", como una sesión retomada: play la empieza.
    const first = queue.current();
    if (!first || player.hasSource()) return;
    pendingResume = { track: first, time: 0 };
    setTrack({ title: first.title, uploader: first.uploader });
    setArtwork(first.thumbnail);
    els.play.disabled = false;
    setStatus("Tu mezcla está lista: pulsa play.", "ok");
    renderPanel();
  } catch (error) {
    console.warn("No se pudo preparar la mezcla de inicio:", error);
  }
}

/**
 * Play cuando no hay nada cargado: retomar la sesión anterior si la hay, o
 * empezar la cola.
 */
function reanudar() {
  if (pendingResume) {
    const { track, time } = pendingResume;
    pendingResume = null;
    queue.pointAt(track.id);
    reproducir(track.watch_url ?? `https://www.youtube.com/watch?v=${track.id}`, {
      hint: track,
      startAt: time,
    });
    return;
  }

  saltarASiguiente();
}

/** Play/pausa desde cualquier sitio: el botón, el espacio, Windows o la bandeja. */
function alternarPlay() {
  if (player.hasSource()) player.toggle();
  else reanudar();
}

function anterior() {
  const track = queue.prev();
  if (track) reproducirPista(track);
}

/** "Salir" en la bandeja: guardar lo que suena y cerrar. */
async function salir() {
  cerrarEscucha(false);
  guardarSesion();
  await prefs.flush();
  await invoke("quit_app").catch(() => {});
}

// --- Transiciones --------------------------------------------------------

/**
 * En los últimos segundos de una canción, con la transición activada, empieza
 * la siguiente fundiéndose con ella. No hay transición si no hay siguiente, si
 * se repite esta canción, o si el temporizador tiene que parar al acabar.
 */
function comprobarTransicion(time) {
  const seconds = sound.crossfadeSeconds();
  if (seconds <= 0 || !playing.track || transitionFrom === playing.track.id) return;
  if (queue.repeatMode() === "one" || sleep.stopsAfterTrack()) return;

  const total = player.duration();
  if (!Number.isFinite(total) || total < seconds * 3) return;
  if (total - time > seconds) return;

  const siguiente = queue.peekNext();
  if (!siguiente) return;

  transitionFrom = playing.track.id;
  queue.next();
  reproducir(siguiente.watch_url, { hint: siguiente, crossfade: seconds });
}

/**
 * Apunta cuánto se escuchó la pista que sonaba.
 *
 * Es lo que alimenta las estadísticas: llegar al final, escuchar casi entera o
 * quitarla enseguida dicen cosas muy distintas de tu gusto.
 */
function cerrarEscucha(ended) {
  const escucha = listening.finish(ended);
  if (!escucha || incognito) return;

  return library.recordListen({ ...escucha, learn: learnCurrent }).then((outcome) => {
    if (!outcome) return;

    discovery.noteListen(escucha.track, outcome);
    refrescarListas().catch(console.warn);

    const segundos = Math.round(escucha.listened);
    console.log(`Escucha: ${outcome} · ${segundos} s · ${escucha.track.title ?? escucha.track.id}`);
  });
}

// --- Valoración ----------------------------------------------------------

async function cargarValoracion(id) {
  rating = await library.getRating(id);

  // Si mientras tanto cambió la pista, esta respuesta ya no es de la que suena.
  if (playing.track?.id !== id) return;
  setRating(rating, Boolean(id));
}

/** Cambia la valoración de lo que suena. Devuelve false si no se pudo. */
async function valorar(nuevo) {
  const track = playing.track;
  if (!track?.id) return false;

  const antes = rating;
  rating = nuevo;
  setRating(rating, true);

  try {
    await library.setRating(track, nuevo);
  } catch (error) {
    rating = antes;
    setRating(rating, true);
    setStatus(friendlyError(error, "No se pudo guardar. Inténtalo de nuevo."), "error");
    return false;
  }

  // "Me gusta" es una lista: si está a la vista, debe reflejarlo.
  await refrescarListas();
  return true;
}

// --- Recomendaciones -----------------------------------------------------

/** Aleatorio inteligente: una mezcla nueva de tu biblioteca y descubrimientos. */
async function mezclar() {
  if (mixBusy) return;

  mixBusy = true;
  activeTab = "discover";
  renderPanel();
  setStatus("Preparando tu mezcla…", "busy");

  try {
    lastMix = await discovery.request("mix", { count: MIX_SIZE });
    cargarCola(lastMix, 0, { ordered: true, auto: true }, "Tu mezcla");
    reproducirPista(queue.current());
    setStatus(`Tu mezcla · ${lastMix.length} canciones`, "ok");
  } catch (error) {
    setStatus(friendlyError(error), "error");
  } finally {
    mixBusy = false;
    renderPanel();
  }
}

/**
 * Radio desde una canción: ella primero y detrás lo relacionado. Si es la que
 * ya suena, no se corta: solo cambia lo que viene después.
 */
async function iniciarRadio(track) {
  if (!track?.id) return;

  const nombre = track.title ?? "esta canción";
  setStatus(`Preparando la radio de «${nombre}»…`, "busy");

  try {
    const recs = await discovery.request("radio", { seeds: [track], count: RADIO_SIZE });
    const yaSuena = playing.track?.id === track.id;

    cargarCola([track], 0, { ordered: true }, `Radio de «${nombre}»`);
    queue.appendAuto(recs);
    activeTab = "queue";
    renderPanel();

    if (yaSuena) prefetchSiguiente();
    else reproducirPista(track);
    setStatus(`Radio de «${nombre}» · ${recs.length} canciones después`, "ok");
  } catch (error) {
    setStatus(friendlyError(error), "error");
  }
}

/**
 * Radio de varias canciones a la vez (la de un artista, desde Inicio): suena la
 * primera y detrás lo relacionado con todas.
 */
async function iniciarRadioDe(seeds, nombre) {
  if (!seeds?.length) return;
  setStatus(`Preparando la radio de ${nombre}…`, "busy");

  try {
    const recs = await discovery.request("radio", { seeds, count: RADIO_SIZE });
    cargarCola([seeds[0]], 0, { ordered: true }, `Radio de ${nombre}`);
    queue.appendAuto(recs);
    reproducirPista(seeds[0]);
    setStatus(`Radio de ${nombre} · ${recs.length + 1} canciones`, "ok");
  } catch (error) {
    setStatus(friendlyError(error), "error");
  }
}

// --- Cola general --------------------------------------------------------
//
// Buscar ya no reproduce: cada resultado se pone ahora, a continuación o al
// final de lo que has añadido. Detrás de lo tuyo, la cola sigue sola con
// recomendaciones que parten de lo último que elegiste.

/** La pone a sonar ya, dejando el resto de la cola detrás. */
function reproducirAhora(track) {
  discovery.notePick(track);
  queue.playNow(track);
  reproducirPista(track);
  recomendarDetras();
}

/** Será la siguiente, sin cortar lo que suena. */
function reproducirSiguiente(track) {
  discovery.notePick(track);

  if (!queue.playNext(track)) {
    toast("Ya está sonando.", { tone: "warn" });
    return;
  }

  tras(`«${track.title ?? "La canción"}» sonará a continuación.`);
}

/**
 * A "Siguiente en la cola": suena después de la actual y de lo que ya habías
 * encolado, antes que el resto de la lista y que las recomendaciones.
 */
function anadirACola(track) {
  discovery.notePick(track);

  if (!queue.add(track)) {
    toast("Ya está sonando.", { tone: "warn" });
    return;
  }

  const delante = queue.queuedCount() - 1;
  const cuando = !player.hasSource() && !playing.loading
    ? ""
    : delante === 0
      ? " Sonará a continuación."
      : ` Sonará después de ${delante === 1 ? "otra" : `otras ${delante}`} que ya pusiste.`;
  tras(`«${track.title ?? "La canción"}» añadida a la cola.${cuando}`);
}

/**
 * Clic en una canción suelta (Inicio, búsqueda, Reciente, Resumen): lo que
 * diga Ajustes › Reproducción.
 */
function elegirCancion(track) {
  const accion = prefs.get("behavior.rowClick");
  if (accion === "next") reproducirSiguiente(track);
  else if (accion === "add") anadirACola(track);
  else reproducirAhora(track);
}

/** Lo común tras encolar algo: avisar, repintar y, si no sonaba nada, empezar. */
function tras(mensaje) {
  toast(mensaje);
  if (activeTab === "queue") renderPanel();

  // Sin nada sonando, encolar es darle al play: esperar a que el usuario lo
  // pulse después sería un paso inútil. "Cargando" no es "nada sonando": si
  // se encola mientras carga la primera, se espera a que suene.
  if (!player.hasSource() && !playing.loading) {
    saltarASiguiente();
    return;
  }

  prefetchSiguiente();
  recomendarDetras();
}

/** Espera antes de renovar recomendaciones: varias elecciones seguidas, una petición. */
const RECOMMEND_DEBOUNCE_MS = 700;
let recommendTimer = null;
let recommendToken = 0;

/**
 * La renovación pendiente o en curso, o null. La cola infinita la espera en vez
 * de lanzar otra petición: justo después de elegir algo, las dos querrían
 * recomendar a la vez.
 */
let pendingRecs = null;
let resolvePending = () => {};

/**
 * Cambia las recomendaciones que aún no han sonado por otras que partan de lo
 * que acabas de elegir. Lo que elegiste tú no se toca.
 */
function recomendarDetras() {
  if (!discovery.autoplayEnabled()) return;

  clearTimeout(recommendTimer);
  const scheduledToken = ++recommendToken;
  if (!pendingRecs) {
    pendingRecs = new Promise((resolve) => {
      resolvePending = resolve;
    });
  }

  recommendTimer = setTimeout(async () => {
    const mine = scheduledToken;

    try {
      // Modo radio con varias semillas: solo lo RELACIONADO con lo que
      // elegiste. Una mezcla metería también canciones sueltas de tu
      // biblioteca sin relación con lo que acabas de buscar.
      const seeds = discovery.seedsFor(playing.track);
      if (!seeds.length) return;
      const recs = await discovery.request("radio", {
        seeds,
        count: CONTINUE_SIZE,
        exclude: queue.all().map((t) => t.id),
      });

      // Otra elección más reciente ya pidió las suyas.
      if (mine !== recommendToken) return;

      queue.replaceUpcomingAuto(recs);
      if (activeTab === "queue") renderPanel();
      prefetchSiguiente();
    } catch (error) {
      console.warn("No se pudieron renovar las recomendaciones:", error);
    } finally {
      if (mine === recommendToken) {
        resolvePending();
        pendingRecs = null;
      }
    }
  }, RECOMMEND_DEBOUNCE_MS);
}

/**
 * Cola infinita: si quedan pocas por delante, pide más. Se llama cada vez que
 * empieza una pista, así que al llegar al final la continuación ya está en la
 * cola (y la primera, resuelta).
 */
function asegurarContinuacion() {
  if (continuation) return continuation;
  if (!discovery.autoplayEnabled() || queue.repeatMode() !== "off") return Promise.resolve();
  if (!playing.track?.id) return Promise.resolve();

  // Lo que suena puede no estar en la cola (un enlace que ya sonaba antes de
  // tocarla): entonces entra delante, para que "siguiente" tenga de dónde partir.
  if (queue.current()?.id !== playing.track.id) queue.playNow(playing.track);

  if (pendingRecs) return pendingRecs;
  if (queue.upcomingCount() >= CONTINUE_WHEN_LEFT) return Promise.resolve();

  continuation = continuar().finally(() => {
    continuation = null;
  });
  return continuation;
}

async function continuar() {
  try {
    const recs = await discovery.request("radio", {
      seeds: discovery.seedsFor(playing.track),
      count: CONTINUE_SIZE,
      exclude: queue.all().map((t) => t.id),
    });

    queue.appendAuto(recs);
    if (activeTab === "queue") renderPanel();
    prefetchSiguiente();
  } catch (error) {
    console.warn("La cola infinita no pudo continuar:", error);
  }
}

// --- Listas --------------------------------------------------------------

function listaAbierta() {
  return playlists.find((pl) => pl.id === openListId) ?? null;
}

function nombreDe(id) {
  return playlists.find((pl) => pl.id === id)?.name ?? "la lista";
}

async function refrescarListas() {
  playlists = await library.getPlaylists();
  if (playing.track?.id) await cargarValoracion(playing.track.id);
  if (openListId && !listaAbierta()) openListId = null;
  home.setPlaylists(playlists);
  renderPanel();
}

/** Abre una lista en la vista Listas. */
function abrirLista(id) {
  library.getPlaylists().then(updated => { playlists = updated; if (openListId === id) renderPanel(); }).catch(console.warn);
  activeTab = "lists";
  openListId = id;
  closeMenu();
  renderPanel();
}

/**
 * Crea una lista pidiendo el nombre.
 *
 * @param {Array} tracks  Pistas con las que nace (la cola, o una fila del menú).
 * @param {boolean} open  Si se abre al crearla. Desde el menú de una fila no:
 *                        el usuario estaba mirando otra cosa.
 */
async function nuevaLista(tracks = [], { open = true } = {}) {
  const name = await dialog.ask({
    title: "Nueva lista",
    placeholder: "Nombre de la lista",
    confirmLabel: "Crear",
  });
  if (!name) return;

  try {
    const id = await library.createPlaylist(name, tracks);
    await refrescarListas();
    if (open) abrirLista(id);
    toast(
      `Lista «${nombreDe(id)}» creada.`,
      open ? {} : { action: { label: "Ver lista", onClick: () => abrirLista(id) } },
    );
  } catch (error) {
    toast(friendlyError(error), { tone: "error" });
  }
}

/** Un álbum o una lista de YouTube, guardados como lista propia. */
async function guardarComoLista(name, tracks) {
  if (!tracks.length) return;

  try {
    const id = await library.createPlaylist(name, tracks);
    await refrescarListas();
    toast(`Guardada como «${nombreDe(id)}».`, { action: { label: "Ver lista", onClick: () => abrirLista(id) } });
  } catch (error) {
    toast(friendlyError(error), { tone: "error" });
  }
}

/**
 * Importar una lista de otra app: por enlace (YouTube, YouTube Music, Spotify,
 * Deezer, Apple Music) o con las canciones pegadas o en un CSV. Las que no son
 * de YouTube se buscan una a una en YouTube Music: el aviso va contando.
 */
async function importarLista() {
  const pedido = await importList.ask();
  if (!pedido) return;

  const aviso = (texto, opciones = {}) => toast(texto, { key: "import", ...opciones });
  aviso("Leyendo la lista…", { tone: "busy" });

  const dejarDeEscuchar = await listen("import-progress", ({ payload: { done, total } }) => {
    aviso(`Buscando las canciones en YouTube Music… ${done} de ${total}`, { tone: "busy" });
  });

  try {
    const r = pedido.url
      ? await library.importPlaylist(pedido.url)
      : await library.importText(pedido.name, pedido.text);
    await refrescarListas();

    const faltan = r.missing.length;
    aviso(
      `Importada «${r.name}» · ${lists.countLabel(r.count)}${faltan ? ` · ${faltan} sin encontrar` : ""}`,
      {
        tone: faltan ? "warn" : "ok",
        // Con canciones sin encontrar, tiempo de leerlo y de pulsar "Ver cuáles".
        ms: faltan ? 15_000 : null,
        action: faltan
          ? {
              label: "Ver cuáles",
              onClick: () =>
                dialog.confirmAction({
                  title: `No se encontraron en YouTube Music (${faltan})`,
                  text: r.missing.join("\n"),
                  confirmLabel: "Entendido",
                  cancelLabel: "Cerrar",
                }),
            }
          : null,
      },
    );
    abrirLista(r.id);
  } catch (error) {
    aviso(friendlyError(error), { tone: "error" });
  } finally {
    dejarDeEscuchar();
  }
}

/** El "+" de "Tus listas": crear una vacía o traerla de otra app. */
function menuNuevaLista() {
  openMenu(els.newListButton, [
    { label: "Nueva lista…", onSelect: () => nuevaLista() },
    { label: "Importar lista…", hint: "YouTube, Spotify, Deezer…", onSelect: importarLista },
  ]);
}

/** Si la canción ya está en la lista (en "Me gusta", si la tiene marcada). */
function estaEnLista(pl, track) {
  return pl.tracks.some((t) => t.id === track.id);
}

/** "Radiohead - Creep (Official Video)", o solo el título si no hay más. */
function describir(track) {
  const artista = nombreArtista(track);
  const titulo = track.title ?? "Sin título";
  return artista && !titulo.toLowerCase().includes(artista.toLowerCase()) ? `${titulo} (${artista})` : titulo;
}

async function anadirALista(id, track) {
  const verLista = { label: "Ver lista", onClick: () => abrirLista(id) };

  // Confirmar antes de añadir otra versión de una canción que ya está en la lista.
  const pl = playlists.find((p) => p.id === id);
  const parecida = pl && !estaEnLista(pl, track) ? findSame(pl.tracks, track) : null;
  if (parecida) {
    const seguir = await dialog.confirmAction({
      title: "Ya está en la lista",
      text: `«${nombreDe(id)}» ya tiene esta canción: «${describir(parecida)}». ¿Añadir también «${describir(track)}»?`,
      confirmLabel: "Añadir de todas formas",
      cancelLabel: "No añadir",
    });
    if (!seguir) return;
  }

  try {
    const added = await library.addToPlaylist(id, track);
    await refrescarListas();

    // Distinguir una pista ya presente de una inserción nueva.
    if (added) toast(`Añadida a «${nombreDe(id)}».`, { action: verLista });
    else toast(`«${track.title ?? "Esta canción"}» ya está en «${nombreDe(id)}».`, { tone: "warn", action: verLista });

    // Añadir a "Me gusta" la pista que suena es marcar su corazón.
    if (id === library.LIKES_ID && track.id === playing.track?.id) {
      rating = "like";
      setRating(rating, true);
    }
  } catch (error) {
    toast(friendlyError(error), { tone: "error" });
  }
}

async function quitarDeLista(pl, track) {
  try {
    await library.removeFromPlaylist(pl.id, track.id);
    await refrescarListas();

    if (pl.id === library.LIKES_ID && track.id === playing.track?.id) {
      rating = "none";
      setRating(rating, true);
    }
  } catch (error) {
    toast(friendlyError(error), { tone: "error" });
  }
}

/** Nombre del artista de una fila, sin el " - Topic" de los canales automáticos. */
function nombreArtista(track) {
  return (track.uploader ?? "").replace(/ - Topic$/, "");
}

/**
 * Menú de una fila: cola, radio, ir al artista, y "Añadir a lista" con una
 * marca en las listas que ya la tienen.
 */
function menuDeFila(track, button) {
  const propias = playlists.filter((pl) => !pl.system && !pl.rules);
  const meGusta = playlists.find((pl) => pl.id === library.LIKES_ID);

  // Añadir a la cola respeta el orden manual; Reproducir a continuación
  // inserta al principio. En la vista Cola solo se ofrece adelantar.
  const siguiente = { label: "Reproducir a continuación", onSelect: () => reproducirSiguiente(track) };
  const encolar =
    track.id === playing.track?.id
      ? []
      : activeTab === "queue"
        ? [siguiente]
        : [{ label: "Añadir a la cola", onSelect: () => anadirACola(track) }, siguiente];

  // Dentro de una lista propia: moverla sin arrastrar (en el móvil no se puede).
  const abierta = activeTab === "lists" ? listaAbierta() : null;
  const posicion = abierta ? abierta.tracks.findIndex((t) => t.id === track.id) : -1;
  const mover =
    abierta && !abierta.system && !abierta.rules && posicion !== -1 && abierta.tracks.length > 1
      ? [
          "sep",
          ...(posicion > 0 ? [{ label: "Mover al principio", onSelect: () => moverEnLista(posicion, 0) }] : []),
          ...(posicion < abierta.tracks.length - 1
            ? [{ label: "Mover al final", onSelect: () => moverEnLista(posicion, abierta.tracks.length - 1) }]
            : []),
        ]
      : [];

  // Una lista que ya la tiene lleva la marca: se ve antes de pulsar. También
  // si la tiene con otro vídeo ("Creep" y "Creep (Official Video)").
  const opcionLista = (pl, label = pl.name) => {
    const hint = estaEnLista(pl, track) ? "ya está" : findSame(pl.tracks, track) ? "ya está (otro vídeo)" : undefined;
    return { label, checked: Boolean(hint), hint, onSelect: () => anadirALista(pl.id, track) };
  };

  openMenu(button, [
    ...encolar,
    { label: "Iniciar radio", onSelect: () => iniciarRadio(track) },
    { label: "Más de este estilo", onSelect: () => moments.more(track) },
    { label: "Hoy no quiero esta canción", onSelect: () => moments.snooze(track) },
    ...(track.uploader
      ? [
          { label: `Ir a ${nombreArtista(track)}`, onSelect: () => irAlArtista(track, button) },
          { label: `No recomendar «${nombreArtista(track)}»`, onSelect: () => bloquearCanal(track) },
        ]
      : []),
    ...mover,
    "sep",
    { heading: "Añadir a lista" },
    meGusta ? opcionLista(meGusta, "Me gusta") : { label: "Me gusta", onSelect: () => anadirALista(library.LIKES_ID, track) },
    ...propias.map((pl) => opcionLista(pl)),
    "sep",
    { label: "Nueva lista…", onSelect: () => nuevaLista([track], { open: false }) },
  ]);
}

/**
 * "No recomendar este canal": sale de las recomendaciones, de Inicio y de lo
 * que la cola iba a poner detrás. Se deshace en Ajustes › Recomendaciones.
 */
function bloquearCanal(track) {
  const canal = nombreArtista(track);
  prefs.set("discovery.blockedChannels", [...prefs.get("discovery.blockedChannels"), canal]);
  toast(`No se recomendará más a «${canal}». Se deshace en Ajustes › Recomendaciones.`);
  recomendarDetras();
}

/** Menú "Más opciones" de una lista abierta. */
function menuDeLista(pl, button) {
  openMenu(button, [
    { label: pl.pinned ? "Desfijar lista" : "Fijar lista", onSelect: async () => {
      try { await invoke("update_playlist_details", { id: pl.id, details: { pinned: !pl.pinned, folder: pl.folder || "", description: pl.description || "", cover: pl.cover || null, rules: pl.rules || null } }); await refrescarListas(); } catch(e) { toast(String(e), {tone:"error"}); }
    } },
    { label: "Editar detalles y reglas…", onSelect: () => libraryTools.editPlaylist(pl) },
    ...(pl.rules ? [] : opcionesDeOrden(pl)),
    "sep",
    ...(pl.rules ? [] : [{ label: "Quitar canciones repetidas…", onSelect: () => quitarRepetidas(pl) }]),
    { label: "Renombrar…", onSelect: () => renombrarLista(pl) },
    { label: "Borrar lista", danger: true, onSelect: () => borrarLista(pl) },
  ]);
}

/**
 * Busca en la lista la misma canción repetida con otro vídeo y, si el usuario
 * lo confirma, deja solo la primera. Para las listas que ya las tenían antes
 * de que se avisara al añadir.
 */
async function quitarRepetidas(pl) {
  const repetidas = findDuplicates(pl.tracks);
  if (repetidas.length === 0) {
    toast(`«${pl.name}» no tiene canciones repetidas.`);
    return;
  }

  const ejemplos = repetidas.slice(0, 3).map((d) => `«${describir(d.track)}»`).join(", ");
  const mas = repetidas.length > 3 ? ` y ${repetidas.length - 3} más` : "";
  const ok = await dialog.confirmAction({
    title: repetidas.length === 1 ? "Quitar 1 canción repetida" : `Quitar ${repetidas.length} canciones repetidas`,
    text: `Se quedan las que estaban primero y se quitan: ${ejemplos}${mas}.`,
    confirmLabel: "Quitar",
    danger: true,
  });
  if (!ok) return;

  try {
    for (const { track } of repetidas) await library.removeFromPlaylist(pl.id, track.id);
    await refrescarListas();
    toast(repetidas.length === 1 ? "Quitada 1 canción repetida." : `Quitadas ${repetidas.length} canciones repetidas.`);
  } catch (error) {
    toast(friendlyError(error), { tone: "error" });
    await refrescarListas();
  }
}

/** "Ordenar por…": para el menú de la lista y para su botón "Ordenar". */
function opcionesDeOrden(pl) {
  return [{ heading: "Ordenar por" }, ...SORTS.map((s) => ({ label: s.label, onSelect: () => ordenarLista(pl, s.id) }))];
}

function menuDeOrden(pl, button) {
  openMenu(button, opcionesDeOrden(pl));
}

/**
 * Ordena la lista y lo guarda. Pisa el orden a mano que tuviera, así que el
 * aviso trae "Deshacer", que la deja como estaba.
 */
async function ordenarLista(pl, by) {
  if (pl.tracks.length < 2) return;

  const antes = pl.tracks.map((t) => t.id);
  const orden = sortTracks(pl.tracks, by).map((t) => t.id);
  if (orden.every((id, i) => id === antes[i])) {
    toast("La lista ya estaba en ese orden.", { tone: "warn" });
    return;
  }

  const aplicar = async (ids) => {
    try {
      await library.reorderPlaylist(pl.id, ids);
    } catch (error) {
      toast(friendlyError(error), { tone: "error" });
    }
    await refrescarListas();
  };

  await aplicar(orden);
  toast(sortDoneText(by), { action: { label: "Deshacer", onClick: () => aplicar(antes) } });
}

async function renombrarLista(pl) {
  const name = await dialog.ask({
    title: "Renombrar lista",
    value: pl.name,
    confirmLabel: "Guardar",
  });
  if (!name || name === pl.name) return;

  try {
    await library.renamePlaylist(pl.id, name);
    await refrescarListas();
  } catch (error) {
    toast(friendlyError(error), { tone: "error" });
  }
}

async function borrarLista(pl) {
  const ok = await dialog.confirmAction({
    title: `¿Borrar «${pl.name}»?`,
    text: "No se puede deshacer. Las canciones siguen en tu historial y en otras listas.",
    confirmLabel: "Borrar",
    danger: true,
  });
  if (!ok) return;

  try {
    await library.deletePlaylist(pl.id);
    openListId = null;
    await refrescarListas();
    toast(`Lista «${pl.name}» borrada.`);
  } catch (error) {
    toast(friendlyError(error), { tone: "error" });
  }
}

/**
 * Mueve una canción de la lista abierta: se mueve en pantalla al instante y se
 * guarda detrás. Si Rust lo rechaza, se recarga lo que de verdad hay.
 */
async function moverEnLista(from, to, { keyboard = false } = {}) {
  const pl = listaAbierta();
  if (!pl || pl.system) return;

  const [moved] = pl.tracks.splice(from, 1);
  pl.tracks.splice(to, 0, moved);
  renderPanel();
  // Con Alt+flechas el foco sigue a la fila, para poder seguir moviéndola.
  if (keyboard) results.rowAt(to)?.focus();

  try {
    await library.moveInPlaylist(pl.id, from, to);
  } catch (error) {
    toast(friendlyError(error), { tone: "error" });
    await refrescarListas();
  }
}

/**
 * Reproduce una lista entera. Respeta el aleatorio que haya puesto: con él
 * activo empieza por una al azar, que es lo que se espera al pulsar play en una
 * lista barajada.
 */
function reproducirLista(pl) {
  reproducirPistas(pl.tracks, 0, { name: pl.name });
}

/**
 * Pone a sonar estas canciones como cola, desde `start` (o una al azar con
 * aleatorio). `name`: qué son ("Mi lista", "OK Computer"), para la cola.
 */
function reproducirPistas(tracks, start = 0, { shuffle = false, name = null } = {}) {
  if (!tracks?.length) return;
  if (shuffle && !queue.isShuffled()) alternarAleatorio();

  const desde = queue.isShuffled() && (shuffle || start === 0) ? Math.floor(Math.random() * tracks.length) : start;
  cargarCola(tracks, desde, {}, name);
  renderPanel();
  reproducirPista(queue.current());
}

// --- Artistas y álbumes --------------------------------------------------
//
// Páginas de YouTube Music (ver artist.js). Se apilan: de un artista a su
// álbum, de ahí a otro artista... y "Volver" deshace el camino hasta la vista
// de la que se salió.

const PAGE_LABELS = { artist: "Artista", album: "Álbum", ytlist: "Lista de YouTube" };

const esPagina = (tab) => Object.hasOwn(PAGE_LABELS, tab);

function paginaActual() {
  return pageStack.at(-1) ?? null;
}

function abrirPagina(page) {
  closeMenu();
  if (layout.isFocus()) layout.setFocus(false);

  const top = paginaActual();
  if (esPagina(activeTab) && top?.type === page.type && top?.id === page.id) return;

  if (!esPagina(activeTab)) {
    returnTo = { tab: activeTab, listId: openListId };
    pageStack = [];
  }
  pageStack.push(page);
  activeTab = page.type;
  renderPanel();
}

function volver() {
  pageStack.pop();
  const top = paginaActual();

  if (top) {
    activeTab = top.type;
  } else {
    activeTab = returnTo?.tab ?? "home";
    openListId = returnTo?.listId ?? null;
    returnTo = null;
  }
  renderPanel();
}

const abrirArtista = (id, name) => abrirPagina({ type: "artist", id, name });
const abrirAlbum = (id, name) => abrirPagina({ type: "album", id, name });
const abrirListaYoutube = (id, name, thumbnail) => abrirPagina({ type: "ytlist", id, name, thumbnail });

/**
 * Del artista de una canción a su página. Una canción de varios artistas
 * pregunta a cuál, en un menú junto a lo que se pulsó.
 */
async function irAlArtista(track, anchor = null) {
  if (!track) return;
  anchor?.setAttribute("aria-busy", "true");

  try {
    const { artists } = await artistView.trackLinks(track);

    if (artists.length === 0) {
      toast(`No encontré la página de «${nombreArtista(track) || "este artista"}».`, { tone: "warn" });
    } else if (artists.length === 1 || !anchor?.isConnected) {
      abrirArtista(artists[0].id, artists[0].name);
    } else {
      openMenu(anchor, [
        { heading: "Ir al artista" },
        ...artists.map((a) => ({ label: a.name, onSelect: () => abrirArtista(a.id, a.name) })),
      ]);
    }
  } catch (error) {
    toast(friendlyError(error, "No se pudo abrir la página del artista ahora mismo."), { tone: "error" });
  } finally {
    anchor?.removeAttribute("aria-busy");
  }
}

/** Un álbum o lista de YouTube a sonar sin abrirlo (el play de su tarjeta). */
async function reproducirListaYoutube(playlistId, titulo) {
  try {
    const { tracks } = await artistView.fetchList(playlistId);
    if (tracks.length === 0) {
      toast(`«${titulo}» no tiene canciones disponibles.`, { tone: "warn" });
      return;
    }
    reproducirPistas(tracks, 0, { name: titulo });
  } catch (error) {
    toast(friendlyError(error, "No se pudo cargar ahora mismo."), { tone: "error" });
  }
}

// --- Aleatorio y repetir -------------------------------------------------

/** Aleatorio y repetir se recuerdan entre sesiones, con las demás preferencias. */
function guardarModos() {
  prefs.set("playback", {
    ...prefs.get("playback"),
    shuffle: queue.isShuffled(),
    repeat: queue.repeatMode(),
  });
}

/**
 * Pone los modos guardados. También al restablecer o importar ajustes; si ya
 * estaban así no se toca la cola, que al cambiar el aleatorio se rebaraja.
 */
function cargarModos() {
  const { shuffle, repeat } = prefs.get("playback");
  if (shuffle !== queue.isShuffled()) queue.setShuffle(shuffle);
  if (repeat !== queue.repeatMode()) queue.setRepeat(repeat);

  setModes({ shuffle: queue.isShuffled(), repeat: queue.repeatMode() });
}

function alternarAleatorio() {
  queue.setShuffle(!queue.isShuffled());
  setModes({ shuffle: queue.isShuffled(), repeat: queue.repeatMode() });
  guardarModos();

  // El orden de la cola cambió: la lista visible y lo que se adelanta, también.
  renderPanel();
  prefetchSiguiente();

  setStatus(queue.isShuffled() ? "Aleatorio activado." : "Aleatorio desactivado.", "ok");
}

function alternarRepetir() {
  const mode = queue.cycleRepeat();
  setModes({ shuffle: queue.isShuffled(), repeat: mode });
  guardarModos();
  prefetchSiguiente();

  const texto = { off: "Repetir desactivado.", all: "Repetir toda la cola.", one: "Repetir esta canción." };
  setStatus(texto[mode], "ok");
}

// --- Pantalla completa ---------------------------------------------------

/**
 * Pantalla completa de verdad (sin barra de tareas), además de la ventana
 * maximizada con la que arranca la app.
 */
async function alternarPantallaCompleta() {
  try {
    const win = window.__TAURI__.window.getCurrentWindow();
    await win.setFullscreen(!(await win.isFullscreen()));
  } catch (error) {
    console.warn("Pantalla completa:", error);
    setStatus("No se pudo cambiar a pantalla completa.", "error");
  }
}

// --- Vista central -------------------------------------------------------

function fuenteDe(tab) {
  if (tab === "queue") return queue.all();
  if (tab === "results") return lastResults;
  if (tab === "discover") return lastMix;
  if (tab === "lists") return listaAbierta()?.tracks ?? [];
  if (tab === "history") return lastHistory;
  if (tab === "summary") return lastSummary;
  if (esPagina(tab)) return artistView.currentTracks();
  return [];
}

function cuenta(n) {
  return `${n} ${n === 1 ? "canción" : "canciones"}`;
}

/**
 * Redibuja la vista central entera —título, acciones y lista— y lo que depende
 * de ella en la barra lateral.
 *
 * A diferencia de la ventana pequeña, aquí las secciones no se esconden al
 * quedarse vacías: con sitio de sobra, una vista vacía explica qué poner en
 * ella, que es más útil que desaparecer.
 */
function renderPanel() {
  libraryTools.hide();
  const listOpen = activeTab === "lists" && openListId !== null;

  for (const button of document.querySelectorAll(".tab[data-tab]")) {
    const current = button.dataset.tab === activeTab && !listOpen;
    button.setAttribute("aria-current", current ? "page" : "false");
  }

  const total = queue.all().length;
  els.queueCount.textContent = total > 0 ? String(total) : "";

  lists.renderSidebar(playlists, listOpen ? openListId : null);
  settings.show(activeTab === "settings");
  home.show(activeTab === "home");
  artistView.show(esPagina(activeTab));
  els.discover.hidden = activeTab !== "discover";
  els.summary.hidden = activeTab !== "summary";
  results.setVisible(activeTab !== "settings" && activeTab !== "home" && !esPagina(activeTab));

  switch (activeTab) {
    case "home":
      lists.showHomeHead();
      setView(saludo(), "Música elegida para ti");
      break;

    case "artist":
    case "album":
    case "ytlist":
      lists.showPageHead(volver);
      setView(PAGE_LABELS[activeTab], "");
      artistView.display(paginaActual());
      break;

    case "results":
      lists.hideHead();
      setView("Buscar", searching ? "Buscando..." : resumenBusqueda());
      pintarPistas(
        lastResults,
        {
          // El artista que se busca, si lo es: un clic y a su página.
          lead: lastArtistHit ? artistView.artistHit(lastArtistHit) : null,
          // Primero lo del artista de la canción, después lo demás.
          dividers:
            lastSearchSplit > 0
              ? [
                  { at: 0, text: `De ${lastSearchArtist}` },
                  { at: lastSearchSplit, text: "Otros resultados" },
                ]
              : [],
        },
        searching
          ? "Buscando..."
          : lastQuery
            ? "No encontré nada con eso. Prueba con otras palabras."
            : "Escribe arriba el nombre de una canción o pega un enlace de YouTube.",
      );
      break;

    case "discover":
      lists.showDiscoverHead(mixBusy);
      setView("Descubrir", lastMix.length ? `Tu mezcla · ${cuenta(lastMix.length)}` : "Aleatorio inteligente");
      pintarPistas(lastMix, {}, "Pulsa «Nueva mezcla» para empezar. Cuanto más escuches, mejor acierta.");
      break;

    case "queue":
      lists.showQueueHead(total > 0);
      setView("Cola", total ? `${cuenta(total)}${queue.isShuffled() ? " · en aleatorio" : ""}` : "");
      pintarPistas(
        queue.all(),
        { removeLabel: "Quitar de la cola", dividers: separadoresDeCola() },
        "La cola está vacía. Busca algo y añádelo, abre una lista o prepara una mezcla en Descubrir.",
      );
      break;

    case "history":
      lists.hideHead();
      setView("Reciente", "Lo último que escuchaste");
      pintarPistas(lastHistory, {}, "Aún no has escuchado nada.");
      break;

    case "lists":
      renderListas();
      break;

    case "summary":
      lists.hideHead();
      setView("Tu resumen", "Desde que Antares empezó a contar");
      pintarPistas(lastSummary, {}, "Todavía no hay escuchas que resumir.");
      break;

    case "settings":
      lists.hideHead();
      setView("Ajustes", "");
      break;
  }

  renderUpNext();
}

/** El título de Inicio, según la hora. */
function saludo() {
  const hora = new Date().getHours();
  if (hora < 6) return "Buenas noches";
  if (hora < 13) return "Buenos días";
  if (hora < 20) return "Buenas tardes";
  return "Buenas noches";
}

/** Pide el resumen a Rust y lo pinta. Se recalcula cada vez que se abre. */
async function abrirResumen() {
  try {
    lastSummary = summary.render(await summary.loadSummary());
  } catch (error) {
    lastSummary = [];
    setStatus(friendlyError(error, "No se pudo preparar tu resumen."), "error");
  }

  if (activeTab === "summary") renderPanel();
}

function pintarPistas(tracks, opts, emptyText) {
  if (tracks.length === 0) results.renderEmpty(emptyText, { lead: opts.lead });
  else results.render(tracks, opts);
}

function renderListas() {
  const pl = listaAbierta();
  if (!pl) { lists.showOverviewHead(); setView("Listas", playlists.length + " listas"); }
  else { lists.showDetailHead(pl); setView(pl.name, lists.countLabel(pl.tracks.length) + (pl.rules ? " · inteligente" : "")); }
  libraryTools.show(pl, playlists);
}

/**
 * Los tramos de la cola, como en Spotify: lo que pediste que sonara después
 * ("Siguiente en la cola", con su botón para vaciarlo), lo que se estaba
 * escuchando ("Siguiente de «Mi lista»") y las recomendaciones.
 */
function separadoresDeCola() {
  const i = queue.currentIndex();
  const encoladas = queue.queuedCount();
  const recomendadas = queue.firstUpcomingAuto();
  const tras = i + 1 + encoladas;
  const out = [];

  if (encoladas > 0) {
    out.push({ at: i + 1, text: "Siguiente en la cola", action: { label: "Borrar la cola", onClick: borrarColaAnadida } });
    // Solo si después de lo encolado queda algo de lo que se escuchaba.
    if (tras < queue.all().length && tras !== recomendadas) {
      out.push({ at: tras, text: contexto ? `Siguiente de «${contexto}»` : "Después" });
    }
  }
  if (recomendadas >= 0) out.push({ at: recomendadas, text: "Recomendadas a partir de lo que elegiste" });
  return out;
}

/** "Borrar la cola": quita lo encolado a mano; lo que suena y la lista siguen. */
function borrarColaAnadida() {
  const n = queue.queuedCount();
  queue.clearQueued();
  renderPanel();
  prefetchSiguiente();
  toast(n === 1 ? "Quitada la canción que habías puesto en la cola." : `Quitadas las ${n} canciones que habías puesto en la cola.`);
}

/** "A continuación", en la columna de lo que suena. */
function renderUpNext() {
  const i = queue.currentIndex();
  const siguientes = queue.all().slice(i + 1, i + 1 + UPNEXT_COUNT);

  let vacio = "Aquí verás lo que viene después.";
  if (playing.track) {
    vacio = discovery.autoplayEnabled()
      ? "Al acabar seguirán recomendaciones."
      : "No hay nada más en la cola.";
  }

  results.renderUpNext(siguientes, vacio, { queued: queue.queuedCount(), context: contexto });
}

function resumenBusqueda() {
  if (!lastQuery) return "";
  const n = lastResults.length;
  const clic = { now: "ponerla ya", next: "que suene a continuación", add: "añadirla a la cola" };
  return `${n} ${n === 1 ? "resultado" : "resultados"} para «${lastQuery}» · clic para ${clic[prefs.get("behavior.rowClick")]}`;
}

/**
 * Busca y enseña los resultados. No reproduce nada ni toca la cola: eso lo
 * decide el usuario desde cada fila (ahora, a continuación o a la cola).
 *
 * Un enlace pegado no tiene "resultados": se resuelve para enseñar qué hay
 * detrás, y de paso su URL queda en caché para cuando se le dé a play.
 */
async function buscarResultados(query) {
  const mine = ++searchId;

  // Si lo buscado empieza por el nombre de un artista, su tarjeta sale encima.
  // Va aparte y en paralelo: las canciones no esperan por ella.
  if (!query.startsWith("http")) {
    artistView.artistForQuery(query).then((hit) => {
      if (mine !== searchId || !hit) return;
      lastArtistHit = hit;
      if (activeTab === "results") renderPanel();
    });
  }

  try {
    let found;

    if (query.startsWith("http")) {
      const track = await resolveTrack(query);
      found = track.id
        ? [{ ...track, watch_url: `https://www.youtube.com/watch?v=${track.id}` }]
        : [{ ...track, id: query, watch_url: query }];
      lastSearchArtist = null;
      lastSearchSplit = -1;
    } else {
      // YouTube y YouTube Music a la vez: el segundo dice de quién es la
      // canción, y sus resultados van primero (ver searchrank.js).
      const [videos, songs] = await Promise.all([searchTracks(query), searchSongs(query)]);
      const ranked = rankSearch(videos, songs, query);
      found = ranked.tracks;
      lastSearchArtist = ranked.artist;
      lastSearchSplit = ranked.split;
    }

    if (mine !== searchId) return;
    lastResults = found;
  } catch (error) {
    if (mine !== searchId) return;
    lastResults = [];
    lastSearchSplit = -1;
    setStatus(friendlyError(error, "No se pudo buscar ahora mismo. Inténtalo de nuevo."), "error");
  }

  searching = false;
  setBusy(false);
  if (activeTab === "results") renderPanel();

  // La primera es la que más probablemente se elija: se resuelve ya, para que
  // el clic sea instantáneo.
  if (lastResults[0]) prefetchTrack(lastResults[0].watch_url);
}

async function cargarHistorial() {
  lastHistory = await loadHistory();
  settings.setHistoryCount(lastHistory.length);
  renderPanel();
}

/**
 * Tras cada reproducción, "Reciente" se pone al día. Solo se repinta si es la
 * vista visible: redibujar otra le cambiaría la lista al usuario debajo del
 * ratón por algo que no está mirando.
 */
async function refrescarHistorial() {
  lastHistory = await loadHistory();
  settings.setHistoryCount(lastHistory.length);
  if (activeTab === "history") renderPanel();
}

/** Enter en el buscador: enseñar resultados, sin reproducir nada. */
function buscar() {
  const query = els.input.value.trim();
  if (!query) {
    els.input.focus();
    return;
  }

  // Limpiar los resultados de la búsqueda anterior.
  lastQuery = query;
  lastResults = [];
  lastArtistHit = null;
  lastSearchSplit = -1;
  searching = true;
  setBusy(true);
  activeTab = "results";
  renderPanel();

  buscarResultados(query);
}

// --- Cableado ------------------------------------------------------------

// Quién usa la app y sus preferencias antes que nada: casi todo lo que arranca
// abajo las lee.
await user.initUser();
await backups.restoreWorkspace();
await prefs.init();

// El aspecto primero, para que lo demás ya se pinte con él. La imagen de fondo
// llega de Rust después, sin hacer esperar al resto.
appearance.onError((texto) => setStatus(texto, "error"));
appearance.initAppearance().catch((error) => console.warn("Apariencia:", error));
layout.initLayout();

// En Android suena el sistema (native-deck.js), no un <audio> de la página:
// el reproductor usa esos platos y no hay cadena de Web Audio que montar.
if (ANDROID) {
  const deck = new NativeDeck();
  player.useDecks(deck, new NativeDeck({ inert: true }));
  connectNative(deck, {
    // "Siguiente" y "anterior" de la notificación, los auriculares o el coche.
    onCommand: (action) => {
      if (action === "next") saltarASiguiente();
      else if (action === "prev") anterior();
    },
  }).catch((error) => console.warn("Reproductor nativo:", error));
}

// El sonido antes que el reproductor: este conecta sus platos a la cadena que
// crea aquel.
sound.initSound({ enabled: !ANDROID });
player.initPlayer();
dialog.initDialog();
libraryTools.init({ refresh: refrescarListas, open: abrirLista });
moments.init((contextChanged) => {
  learnCurrent &&= moments.shouldLearn();
  if (contextChanged) { discovery.setPicks([]); lastMix = []; }
  else lastMix = lastMix.filter(moments.allowed);
  for (const track of [...queue.all()]) {
    if (track.auto && track.id !== playing.track?.id && !moments.allowed(track)) queue.remove(track.id);
  }
  recomendarDetras();
  home.refresh({ force: true });
  if (activeTab === "discover") renderPanel();
});
importList.initImportList();
discovery.initDiscovery();

lyrics.initLyrics({ seek: (time) => player.seek(time) });

// En Android los controles del sistema los pone el reproductor nativo.
if (!ANDROID) media.initMediaSession({
  play: alternarPlay,
  pause: () => player.pause(),
  next: saltarASiguiente,
  prev: anterior,
  seek: (time) => player.seek(time),
  skip: (delta) => player.skip(delta),
});

// Los botones de la miniatura de la barra de tareas: copian la consola.
if (!ANDROID) thumbbar.initThumbbar();

// La barra de reproducción y el mini reproductor (Ajustes › Reproductor):
// copian la consola, como la miniatura. Lo que no es un botón de la consola
// (la letra, la cola, el álbum) se lo da main.js.
if (!ANDROID) {
  nowState.initNowState();
  nowState.setMoreMenu((button) => {
    if (playing.track) menuDeFila(playing.track, button);
  });

  const alternarLetra = () => {
    if (!prefs.get("layout.upnext")) layout.setFocus(!layout.isFocus());
    else prefs.set("interface.sideTab", prefs.get("interface.sideTab") === "lyrics" ? "upnext" : "lyrics");
  };

  playerBar.initPlayerBar({
    handlers: {
      lyrics: alternarLetra,
      queue: () => abrirPestana("queue"),
      mini: () => layout.setMini(true),
      expand: () => layout.setFocus(!layout.isFocus()),
    },
    // "MF DOOM · MM..FOOD": el álbum sale de YouTube Music (con caché). Si la
    // canción del título aún no es la que suena (está cargando), falla y la
    // barra lo reintenta.
    album: async (title) => {
      if (!playing.track?.id || playing.track.title !== title) throw new Error("aún no");
      const links = await artistView.trackLinks(playing.track);
      return links?.album?.title ?? null;
    },
  });

  miniPlayer.initMiniPlayer({
    restore: () => layout.setMini(false),
    queue: async () => {
      await layout.setMini(false);
      abrirPestana("queue");
    },
    onLyricLine: lyrics.onLine,
  });
} else {
  playerBar.initPlayerBar({ enabled: false });
}

sleep.initSleep({
  expire: () => {
    player.fadeOutAndPause(SLEEP_FADE_SECONDS);
    setStatus("Temporizador: la música se queda en pausa. Buenas noches.", "ok");
  },
  change: (texto) => setStatus(texto, "ok"),
});

els.form.addEventListener("submit", (event) => {
  event.preventDefault();
  buscar();
});

// Escape en el buscador lo vacía.
els.input.addEventListener("keydown", (event) => {
  if (event.key === "Escape") els.input.value = "";
});

// Navegación: los botones de la barra lateral y el de ajustes.
function abrirPestana(tab) {
  activeTab = tab;
  pageStack = [];
  returnTo = null;
  if (activeTab === "lists") openListId = null;
  // Se recuerda para "Al abrir, mostrar: donde lo dejé". Ajustes no cuenta.
  if (tab !== "settings") prefs.set("interface.lastTab", tab);
  closeMenu();
  renderPanel();
  if (activeTab === "summary") abrirResumen();
}

for (const button of document.querySelectorAll(".tab[data-tab]")) {
  button.addEventListener("click", () => abrirPestana(button.dataset.tab));
}

/** La pestaña con la que abre la app (Ajustes › Diseño). */
function pestanaInicial() {
  const { startTab, hiddenTabs, tabOrder } = prefs.get("layout");
  const wanted = startTab === "last" ? prefs.get("interface.lastTab") : startTab;
  // Si está oculta, la primera que se vea.
  return hiddenTabs.includes(wanted) ? tabOrder.find((t) => !hiddenTabs.includes(t)) : wanted;
}

// Una pestaña que se oculta mientras está abierta cede el sitio a la primera visible.
prefs.on("layout.hiddenTabs", (hidden) => {
  if (hidden.includes(activeTab)) {
    activeTab = prefs.get("layout.tabOrder").find((t) => !hidden.includes(t)) ?? "settings";
    renderPanel();
  }
});

// --- Columna derecha: "A continuación" o la letra --------------------------

function mostrarPestanaLateral(tab) {
  const letra = tab === "lyrics";

  els.upnextTab.setAttribute("aria-selected", String(!letra));
  els.lyricsTab.setAttribute("aria-selected", String(letra));
  els.upnextList.hidden = letra;
  els.upnextMore.hidden = letra;
  els.lyrics.hidden = !letra;

  if (letra) lyrics.tick(player.currentTime());
}

// Se recuerda cuál estaba a la vista. El aviso de la preferencia es el que
// cambia la pestaña, así que un restablecer también la devuelve a su sitio.
els.upnextTab.addEventListener("click", () => prefs.set("interface.sideTab", "upnext"));
els.lyricsTab.addEventListener("click", () => prefs.set("interface.sideTab", "lyrics"));

// --- Bandeja del sistema ---------------------------------------------------
//
// Si cerrar la ventana la esconde en la bandeja es un ajuste más
// (`system.closeToTray`): Rust lo lee de los ajustes guardados al cerrar.

// El menú del icono de la bandeja. Las acciones son las de la consola.
listen("tray", ({ payload }) => {
  if (payload === "toggle") alternarPlay();
  else if (payload === "next") saltarASiguiente();
  else if (payload === "prev") anterior();
  else if (payload === "quit") salir();
}).catch((error) => console.warn("Sin eventos de la bandeja:", error));

els.newListButton.addEventListener("click", menuNuevaLista);

// Clic en una fila. Siempre reproduce ese vídeo concreto (su URL de YouTube,
// que `build_target` en Rust deja pasar tal cual), pero qué pasa con la cola
// depende de dónde esté la fila:
//
//   - Búsqueda y Reciente: suena ya, y la cola sigue como estaba detrás. Son
//     canciones sueltas: la cola no se sustituye por la lista de resultados.
//   - Cola: salta a esa posición.
//   - Una lista o una mezcla: se reproduce la lista entera desde esa canción,
//     que es lo que se espera al elegir dentro de una lista.
results.onPick((track) => {
  if (activeTab === "results" || activeTab === "history" || activeTab === "summary") {
    elegirCancion(track);
    return;
  }

  if (activeTab === "queue") {
    queue.pointAt(track.id);
    reproducirPista(track);
    return;
  }

  const fuente = fuenteDe(activeTab);
  const desde = Math.max(fuente.findIndex((t) => t.id === track.id), 0);

  if (activeTab === "discover") {
    cargarCola(fuente, desde, { ordered: true, auto: true }, "Tu mezcla");
  } else {
    discovery.notePick(track);
    const nombre = esPagina(activeTab) ? artistView.currentName() : listaAbierta()?.name;
    cargarCola(fuente, desde, {}, nombre ?? null);
  }

  reproducirPista(queue.current());
});

// Ratón quieto sobre una fila: la resolvemos por adelantado para que el clic sea
// instantáneo. El comando de prefetch ya deduplica, así que repetir no cuesta.
results.onHover((track) => prefetchTrack(track.watch_url));

results.onAdd(anadirACola);
results.onPlayNext(reproducirSiguiente);

// La × de una fila quita de donde se está mirando: la cola o la lista abierta.
results.onRemove((track) => {
  if (activeTab === "lists") {
    const pl = listaAbierta();
    if (pl) quitarDeLista(pl, track);
    return;
  }

  queue.remove(track.id);
  renderPanel();
});

results.onMenu(menuDeFila);

// Reordenar una lista: arrastrando o con Alt+flechas.
results.onMove(moverEnLista);

// El nombre del artista de una fila lleva a su página.
results.onArtist(irAlArtista);

// Páginas de artista, álbum y lista de YouTube.
artistView.initArtistView({
  play: reproducirPistas,
  radio: (seeds, nombre) => iniciarRadioDe(seeds, nombre),
  openArtist: abrirArtista,
  openAlbum: abrirAlbum,
  openList: abrirListaYoutube,
  playVideo: elegirCancion,
  playPlaylist: reproducirListaYoutube,
  save: guardarComoLista,
  menu: menuDeFila,
});

// El artista de lo que suena, bajo el título. En el mini reproductor de
// Android un toque abre el reproductor entero: ahí no se navega.
function artistaDeLoQueSuena() {
  if (!playing.track?.uploader) return;
  if (ANDROID && !layout.isFocus()) return;
  irAlArtista(playing.track, els.by);
}

els.by.addEventListener("click", artistaDeLoQueSuena);
els.by.addEventListener("keydown", (event) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  artistaDeLoQueSuena();
});

// "A continuación": saltar directamente a una de las próximas.
results.onUpNext((track) => {
  queue.pointAt(track.id);
  reproducirPista(track);
});

els.upnextMore.addEventListener("click", () => {
  activeTab = "queue";
  renderPanel();
});

lists.on("open", abrirLista);
lists.on("create", () => nuevaLista());
lists.on("import", importarLista);
lists.on("play", reproducirLista);
lists.on("shuffle", (pl) => {
  if (!queue.isShuffled()) alternarAleatorio();
  reproducirLista(pl);
});
lists.on("more", menuDeLista);
lists.on("sort", menuDeOrden);
lists.on("saveQueue", () => nuevaLista(queue.all()));
// Vaciar quita lo que viene, no lo que suena: la canción sigue y la cola vuelve
// a empezar desde ella.
lists.on("clearQueue", () => {
  const suena = playing.track?.id ? queue.current() ?? playing.track : null;
  queue.clear();
  if (suena) cargarCola([suena], 0);
  renderPanel();
});
lists.on("mix", mezclar);
lists.on("refreshHome", () => home.refresh({ force: true }));

// --- Inicio --------------------------------------------------------------

home.initHome({
  pick: elegirCancion,
  // "Reproducir" de una estantería: la estantería entera, en su orden.
  playAll: (tracks, titulo) => {
    cargarCola(tracks, 0, { ordered: true, auto: true }, titulo ?? null);
    reproducirPista(queue.current());
  },
  menu: menuDeFila,
  openList: abrirLista,
  artist: irAlArtista,
  artistRadio: (artist) => iniciarRadioDe(artist.tracks, artist.name),
  prefetch: (track) => prefetchTrack(track.watch_url),
  lastPlayed: () => lastHistory[0] ?? null,
  detected: customize.setDetectedGenres,
});

// La cola avisa cuando cambia; los botones y "A continuación" se redibujan solos.
queue.onChange(() => {
  setQueueControls({ hasPrev: queue.hasPrev(), hasNext: queue.hasNext() });
  els.queueCount.textContent = queue.all().length > 0 ? String(queue.all().length) : "";

  // Sin nada cargado, el play arranca la cola (o retoma la sesión anterior):
  // se enciende en cuanto hay algo.
  if (!player.hasSource()) els.play.disabled = !queue.hasNext() && !pendingResume;

  renderUpNext();
  guardarSesionPronto();
});

/** Guardar la sesión en cada cambio de cola sería escribir decenas de veces seguidas. */
let sessionTimer = null;
function guardarSesionPronto() {
  clearTimeout(sessionTimer);
  sessionTimer = setTimeout(guardarSesion, 800);
}

// Play sin nada cargado: retoma la sesión anterior o empieza la cola. Con algo
// cargado, el propio reproductor alterna play/pausa y esto no hace nada.
els.play.addEventListener("click", () => {
  if (!player.hasSource()) reanudar();
});

els.prev.addEventListener("click", anterior);

els.next.addEventListener("click", saltarASiguiente);

els.shuffle.addEventListener("click", alternarAleatorio);
els.repeat.addEventListener("click", alternarRepetir);

els.radioButton.addEventListener("click", () => iniciarRadio(playing.track));

els.like.addEventListener("click", () => alternarMeGusta());

// Saltar la pista actual al marcar No me gusta.
els.dislike.addEventListener("click", async () => {
  if (rating === "dislike") {
    if (await valorar("none")) setStatus("Quitado el «No me gusta».", "ok");
    return;
  }

  if (!(await valorar("dislike"))) return;

  setStatus("Marcada con «No me gusta».", "ok");
  saltarASiguiente();
});

player.on("play", () => {
  setEngine("playing");
  media.setPlaying(true);
});

player.on("pause", () => {
  setEngine("idle");
  media.setPlaying(false);
  guardarSesion();
});

player.on("time", (currentTime) => {
  listening.tick(currentTime);
  lyrics.tick(currentTime);
  media.setPosition(currentTime, player.duration());
  comprobarTransicion(currentTime);

  if (performance.now() - lastSessionSave > SESSION_EVERY_MS) guardarSesion();
});

// Se queda sin datos a mitad de canción: el aro del play, como al cargar.
player.on("waiting", () => { setEngine("busy"); recovery.buffering(); });
player.on("playing", () => { setEngine("playing"); recovery.playing(); });
player.on("time", (time) => { if (!playing.loading) recovery.progress(time); });
player.on("pause", () => { if (!playing.loading && !recovery.inFlight && !player.hasError()) { recovery.pause(); recoveryNotice.hidden = true; } });
player.on("play", () => { if (!playing.loading && !recovery.intent) { recovery.intent = true; recovery.buffering(); } });

// Registrar la escucha completa y reproducir la siguiente pista.
player.on("ended", async () => {
  cerrarEscucha(true);

  // El temporizador pedía parar al acabar esta: se queda aquí.
  if (sleep.consumeTrackEnd()) {
    setEngine("idle");
    media.setPlaying(false);
    setStatus("Temporizador: la música se paró al acabar la canción. Buenas noches.", "ok");
    return;
  }

  if (queue.repeatMode() === "one" && playing.track) {
    player.restart().catch(() => {});
    listening.start(playing.track);
    return;
  }

  if (saltarASiguiente()) return;

  // Se acabó la cola y la continuación no llegó a tiempo (o falló): se pide
  // ahora, con la última como semilla.
  if (discovery.autoplayEnabled() && queue.repeatMode() === "off") {
    setEngine("busy");
    await asegurarContinuacion();
    if (saltarASiguiente()) return;
  }

  setEngine("idle");
  setStatus("Fin de la cola.", "info");
});

player.on("intent", (play) => {
  if (!play) { recovery.pause(); ++requestId; playing.loading = false; recoveryNotice.hidden = true; setEngine("idle"); }
  else if (!recovery.intent) { recovery.intent = true; recovery.attempts = 0; recovery.buffering(); }
});
player.on("error", () => recovery.fail());

// Guardar la posición y cerrar la escucha antes de salir. El registro en Rust
// puede perderse si el proceso termina antes de recibir la llamada.
window.addEventListener("pagehide", () => {
  guardarSesion();
  cerrarEscucha(false);
  prefs.flush();
});

// --- Atajos de teclado ---------------------------------------------------
//
// Qué tecla hace cada cosa se elige en Ajustes › Atajos (ver shortcuts.js);
// aquí, qué hace cada acción. Las mismas sirven para los atajos de todo
// Windows, que llegan de Rust aunque la ventana esté escondida.

async function alternarMeGusta() {
  if (!playing.track?.id) return;
  const nuevo = rating === "like" ? "none" : "like";
  if (await valorar(nuevo)) {
    setStatus(nuevo === "like" ? "Añadida a Me gusta." : "Quitada de Me gusta.", "ok");
  }
}

shortcuts.initShortcuts({
  playPause: alternarPlay,
  next: saltarASiguiente,
  prev: anterior,
  seekForward: () => player.skip(skipSeconds()),
  seekBack: () => player.skip(-skipSeconds()),
  volumeUp: () => player.nudgeVolume(volumeStep()),
  volumeDown: () => player.nudgeVolume(-volumeStep()),
  mute: () => player.toggleMute(),
  shuffle: alternarAleatorio,
  repeat: alternarRepetir,
  like: alternarMeGusta,
  search: () => {
    if (layout.isMini()) layout.setMini(false);
    layout.setFocus(false);
    els.input.focus();
    els.input.select();
  },
  focus: () => layout.setFocus(!layout.isFocus()),
  mini: () => layout.setMini(!layout.isMini()),
  fullscreen: alternarPantallaCompleta,
});

// --- Android: "atrás" y el mini reproductor --------------------------------

if (ANDROID) {
  // "Atrás" deshace lo último antes de salir: cierra el reproductor a
  // pantalla completa, un menú o un diálogo, vuelve a Inicio... y en Inicio
  // manda la app al fondo en vez de cerrarla, para que la música siga.
  window.__TAURI__.core
    .addPluginListener("app", "back-button", () => {
      if (dialog.isOpen()) els.dialog.close("cancel");
      else if (isMenuOpen()) closeMenu();
      else if (layout.isFocus()) layout.setFocus(false);
      else if (esPagina(activeTab)) volver();
      else if (activeTab === "lists" && openListId !== null) {
        openListId = null;
        renderPanel();
      } else if (activeTab !== "home") abrirPestana("home");
      else sendToBackground();
    })
    .catch((error) => console.warn("Botón atrás:", error));

  // Tocar el mini reproductor de abajo (no sus botones) lo abre entero.
  document.querySelector(".console").addEventListener("click", (event) => {
    if (layout.isFocus() || event.target.closest("button, input")) return;
    layout.setFocus(true);
  });
}

// En una página de artista o álbum, "atrás" como en un navegador: el botón
// lateral del ratón o Alt+←.
window.addEventListener("mouseup", (event) => {
  if (event.button === 3 && esPagina(activeTab)) {
    event.preventDefault();
    volver();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.altKey && event.key === "ArrowLeft" && esPagina(activeTab) && !event.target.closest?.("input, textarea")) {
    event.preventDefault();
    volver();
  }
});

// Esc sale del modo mini o del modo escucha. No se puede cambiar: es la
// salida de emergencia de dos modos que esconden casi toda la app.
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape" || event.target.closest?.("input, dialog, .menu")) return;
  if (layout.isMini()) layout.setMini(false);
  else if (layout.isFocus()) layout.setFocus(false);
});


setTrack();
setTransportEnabled(false);
setRating("none", false);
setQueueControls({ hasPrev: false, hasNext: false });

// Donde te quedaste. Antes que los modos: la cola guardada ya viene barajada si
// lo estaba, y cargar el aleatorio después no la vuelve a barajar.
restaurarSesion();
cargarModos();
prefs.on("playback", cargarModos);

mostrarPestanaLateral(prefs.get("interface.sideTab"));
prefs.on("interface.sideTab", mostrarPestanaLateral);

els.input.focus();

// Cargar historial y listas antes del primer renderizado.
activeTab = pestanaInicial();

Promise.all([loadHistory(), library.getPlaylists()]).then(([history, lists]) => {
  lastHistory = history;
  playlists = lists;
  home.setPlaylists(lists);
  settings.setHistoryCount(history.length);
  // Sin historial, Reciente estaría vacía: Inicio explica qué hacer.
  if (history.length === 0 && activeTab === "history") activeTab = "home";
  renderPanel();
});

// --- Ajustes -------------------------------------------------------------

settings.initSettings();
backups.init({ beforeBackup: async () => { guardarSesion(); await prefs.flush(); }, beforeRestore: async () => { recovery.pause(); player.pause(); await cerrarEscucha(false); guardarSesion(); await prefs.flush(); } });
settings.onMessage((texto, tono) => setStatus(texto, tono));
customize.initCustomize();

people.initPeople({
  say: (texto, tono = "ok") => setStatus(texto, tono),
  // Cambiar de usuario reinicia la app: antes, guardar dónde iba cada cosa.
  beforeSwitch: async () => {
    cerrarEscucha(false);
    guardarSesion();
    await prefs.flush();
  },
  openSettings: () => {
    abrirPestana("settings");
    settings.openGroup("people");
  },
});

els.incognitoToggle.addEventListener("change", () => ponerIncognito(els.incognitoToggle.checked));
els.incognitoChip.addEventListener("click", () => ponerIncognito(false));

// "Abrir al iniciar Windows" vive en el registro, y el usuario puede quitarlo
// desde el Administrador de tareas: el ajuste se pone al día con lo real.
invoke("get_autostart")
  .then((real) => {
    if (real !== prefs.get("system.autostart")) prefs.set("system.autostart", real);
  })
  .catch(() => {});

// La versión solo se pide al abrir la vista por primera vez: preguntársela al
// binario cuesta ~1 s porque arranca PyInstaller.
settings.onOpen(async () => {
  settings.setVersion(await installedVersion());
});

settings.onUpdate(async () => {
  settings.setUpdating(true);
  setStatus("Buscando actualización del motor de reproducción…", "busy");

  try {
    const version = await checkNow();

    if (version) {
      settings.setVersion(version);
      setStatus("Motor de reproducción actualizado.", "ok");
    } else {
      setStatus("El motor de reproducción ya está al día.", "ok");
    }
  } catch (error) {
    setStatus(friendlyError(error, "No se pudo buscar la actualización. Inténtalo más tarde."), "error");
  } finally {
    settings.setUpdating(false);
  }
});

settings.onClear(async () => {
  await clearHistory();
  await cargarHistorial();
  setStatus("Historial vaciado.", "ok");
});

settings.onFullscreen(alternarPantallaCompleta);

// Versiones nuevas de Antares (Ajustes › Sistema). Antes de instalar, lo
// mismo que "Salir" en la bandeja: el instalador cierra la app.
if (!ANDROID) {
  appUpdate.initAppUpdate({
    beforeInstall: async () => {
      cerrarEscucha(false);
      guardarSesion();
      await prefs.flush();
    },
  });
}

// Registrar las actualizaciones de yt-dlp en consola. La versión instalada
// se muestra en Ajustes › Sistema.
onUpdated((version) => {
  console.log(`yt-dlp actualizado a ${version}`);
  settings.setVersion(version);
});
