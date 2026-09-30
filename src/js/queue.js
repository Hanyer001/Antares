// Estado de la cola. El índice incluye la pista actual; -1 indica que aún
// no se ha seleccionado ninguna. main.js controla la reproducción.
//
// queued marca canciones añadidas manualmente; auto, recomendaciones.
// Las manuales se conservan al cambiar de lista o renovar recomendaciones.
// El modo aleatorio baraja una vez y conserva el orden original para restaurarlo.
// La persistencia entre sesiones se gestiona en session.js.

let items = [];
let index = -1;

/** Orden sin barajar. Solo se usa mientras el aleatorio está activo. */
let original = [];
let shuffled = false;

/** @type {"off"|"all"|"one"} */
let repeat = "off";

const listeners = [];

/** Avisa cuando cambia algo: la lista, la posición o los modos. */
export function onChange(callback) {
  listeners.push(callback);
}

function emit() {
  for (const callback of listeners) callback();
}

/**
 * Copia de la pista con su marca de origen. Siempre una copia: las pistas
 * llegan de las listas del usuario, y marcarlas en sitio contaminaría esas
 * listas con un `auto` que no es suyo.
 */
function entry(track, auto, queued = false) {
  return { ...track, auto, queued };
}

/**
 * Dónde acaba "Siguiente en la cola" en `list` si suena la de `from`: la
 * primera posición detrás de las `queued` seguidas que la siguen.
 */
function queueEnd(list, from) {
  let end = from + 1;
  while (end < list.length && list[end]?.queued) end += 1;
  return end;
}

/** Lo que queda en "Siguiente en la cola", en orden. */
export function upcomingQueued() {
  return items.slice(index + 1, queueEnd(items, index));
}

export function queuedCount() {
  return queueEnd(items, index) - (index + 1);
}

/**
 * La que pasa a sonar deja de estar "en la cola": ya salió de ella. Si se
 * vuelve atrás hasta ella, es una más de lo que ya sonó.
 */
function settle() {
  if (items[index]?.queued) items[index].queued = false;
}

/** Fisher–Yates sobre una copia: cada orden posible es igual de probable. */
function shuffle(tracks) {
  const out = [...tracks];

  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

/** Baraja dejando `first` delante: la que suena no debe moverse de sitio. */
function shuffleAround(tracks, first) {
  if (!first) return shuffle(tracks);
  return [first, ...shuffle(tracks.filter((track) => track.id !== first.id))];
}

/** Quita una pista de la cola sin avisar, ajustando el puntero. */
function detach(id) {
  const position = items.findIndex((track) => track.id === id);
  if (position !== -1) {
    items.splice(position, 1);
    if (position < index) index -= 1;
    else if (position === index) index -= 1;
  }

  if (shuffled) original = original.filter((track) => track.id !== id);
  return position;
}

/** Primera recomendación por delante de `from`, o el final de la lista. */
function firstAutoAfter(list, from) {
  for (let i = Math.max(from + 1, 0); i < list.length; i++) {
    if (list[i].auto) return i;
  }
  return list.length;
}

/**
 * Reemplaza la cola entera.
 *
 * No reproduce nada por sí sola: se llama justo antes o después de pedir la
 * reproducción, según de dónde venga. Separar las dos cosas evita que ajustar la
 * cola reinicie el audio sin querer.
 *
 * Con el aleatorio activo, la pista de `startIndex` va primera y el resto se
 * baraja detrás. Salvo con `ordered`: una mezcla o una radio ya vienen en el
 * orden que eligió el recomendador, y barajarlas otra vez solo haría que la
 * lista que se ve no coincida con lo que suena.
 *
 * @param {Array} tracks
 * @param {number} [startIndex]
 * @param {{ ordered?: boolean, auto?: boolean }} [opts]
 *        `auto`: son recomendaciones (una mezcla), no algo elegido a mano.
 */
export function load(tracks, startIndex = 0, { ordered = false, auto = false } = {}) {
  // "Siguiente en la cola" no se pierde al poner otra cosa (como en Spotify).
  // Lo que ya viene en la lista nueva sonará en su sitio de la lista.
  const incoming = new Set((tracks ?? []).map((t) => t?.id));
  const pending = upcomingQueued().filter((t) => !incoming.has(t.id));

  const list = (tracks ?? []).map((track) => entry(track, auto));
  const start = list.length === 0 ? -1 : Math.min(Math.max(startIndex, 0), list.length - 1);

  if (shuffled && ordered) {
    original = [...list];
    items = list;
    index = start;
  } else if (shuffled) {
    original = list;
    items = shuffleAround(list, list[start]);
    index = items.length === 0 ? -1 : 0;
  } else {
    items = list;
    index = start;
  }

  items.splice(index + 1, 0, ...pending);
  if (shuffled) original.splice(start + 1, 0, ...pending);

  settle();
  emit();
}

/** Coloca el puntero en la pista con ese id, si está en la cola. */
export function pointAt(id) {
  const found = items.findIndex((track) => track.id === id);
  if (found === -1) return false;

  index = found;
  settle();
  emit();
  return true;
}

/**
 * Mete la pista en "Siguiente en la cola". Si ya estaba en la cola, se mueve
 * ahí en vez de repetirse.
 *
 * @param {boolean} first  Delante de todo lo encolado ("reproducir a
 *                         continuación") o detrás ("añadir a la cola").
 */
function enqueue(track, first) {
  if (!track?.id || current()?.id === track.id) return false;

  detach(track.id);
  const fresh = entry(track, false, true);

  items.splice(first ? index + 1 : queueEnd(items, index), 0, fresh);
  if (shuffled) {
    const at = original.findIndex((t) => t.id === current()?.id);
    original.splice(first ? at + 1 : queueEnd(original, at), 0, fresh);
  }

  emit();
  return true;
}

/**
 * Añadir a la cola: suena después de la actual y de lo que ya habías
 * encolado, y antes que el resto de la lista y que las recomendaciones.
 *
 * @returns {boolean} false si es la que suena (no tiene sentido encolarla).
 */
export function add(track) {
  return enqueue(track, false);
}

/**
 * Reproducir a continuación: será la siguiente, delante incluso de lo que ya
 * estaba encolado.
 *
 * @returns {boolean} false si es la que suena.
 */
export function playNext(track) {
  return enqueue(track, true);
}

/** Vacía "Siguiente en la cola", sin tocar lo que suena ni el resto. */
export function clearQueued() {
  const gone = new Set(upcomingQueued().map((t) => t.id));
  if (gone.size === 0) return;

  items = items.filter((t, i) => i <= index || !gone.has(t.id));
  if (shuffled) original = original.filter((t) => !gone.has(t.id) || t.id === current()?.id);
  emit();
}

/**
 * La pone a sonar ya: entra justo después de la actual y el puntero salta a
 * ella. Lo que venía después sigue detrás, en el mismo orden.
 */
export function playNow(track) {
  if (!track?.id) return;

  if (current()?.id === track.id) return;

  detach(track.id);
  const fresh = entry(track, false);

  items.splice(index + 1, 0, fresh);
  if (shuffled) {
    const at = original.findIndex((t) => t.id === current()?.id);
    original.splice(at + 1, 0, fresh);
  }
  index += 1;

  settle();
  emit();
}

/** Añade recomendaciones al final, sin repetir ninguna que ya esté. */
export function appendAuto(tracks) {
  const present = new Set(items.map((t) => t.id));
  const fresh = [];

  for (const track of tracks ?? []) {
    if (!track?.id || present.has(track.id)) continue;
    present.add(track.id);
    fresh.push(entry(track, true));
  }

  items.push(...fresh);
  if (shuffled) original.push(...fresh);

  emit();
  return fresh.length;
}

/**
 * Cambia las recomendaciones que aún no han sonado por otras. Lo que eligió el
 * usuario, y lo que ya sonó, se queda donde estaba.
 */
export function replaceUpcomingAuto(tracks) {
  items = items.filter((track, i) => i <= index || !track.auto);
  if (shuffled) {
    const playingId = current()?.id;
    original = original.filter((track) => !track.auto || track.id === playingId || items.includes(track));
  }

  return appendAuto(tracks);
}

/**
 * Quita una pista.
 *
 * Si la quitada iba antes de la actual hay que retroceder el índice, o el
 * puntero acabaría señalando a la pista equivocada. Quitar la que suena no la
 * para: deja el puntero donde estaba, que es lo que la siguiente ocupará.
 */
export function remove(id) {
  const position = items.findIndex((track) => track.id === id);
  if (position === -1) return;

  items.splice(position, 1);
  if (shuffled) original = original.filter((track) => track.id !== id);

  if (position < index) index -= 1;
  if (index >= items.length) index = items.length - 1;

  emit();
}

export function clear() {
  items = [];
  original = [];
  index = -1;
  emit();
}

/** Todo el estado de la cola, para guardarlo entre sesiones. */
export function snapshot() {
  return { items: [...items], original: [...original], index, shuffled };
}

/**
 * Recupera una cola guardada. Si lo guardado no tiene la forma esperada (de
 * otra versión, o corrupto), la cola se queda como estaba.
 */
export function restore(state) {
  if (!state || !Array.isArray(state.items)) return false;

  const valid = (list) => (Array.isArray(list) ? list.filter((t) => t?.id) : []);

  items = valid(state.items);
  original = valid(state.original);
  shuffled = Boolean(state.shuffled) && original.length > 0;
  if (!shuffled) original = [];

  const at = Number.isInteger(state.index) ? state.index : -1;
  index = Math.min(Math.max(at, -1), items.length - 1);

  emit();
  return true;
}

export function all() {
  return items;
}

export function current() {
  return items[index] ?? null;
}

export function currentIndex() {
  return index;
}

/** Cuántas quedan por delante de la que suena. */
export function upcomingCount() {
  return Math.max(items.length - index - 1, 0);
}

/** Posición de la primera recomendación por delante, o -1 si no hay. */
export function firstUpcomingAuto() {
  const at = firstAutoAfter(items, index);
  return at < items.length ? at : -1;
}

// --- Modos ---------------------------------------------------------------

export function isShuffled() {
  return shuffled;
}

/**
 * Activa o desactiva el aleatorio sin cortar lo que suena.
 *
 * Al activarlo, la actual pasa a ser la primera y el resto se baraja detrás. Al
 * desactivarlo, vuelve el orden original y el puntero busca en él a la actual,
 * de modo que "siguiente" sigue desde ahí. Sin nada sonando, el puntero se
 * queda antes de la primera.
 */
export function setShuffle(on) {
  if (on === shuffled) return;

  const playing = current();
  // "Siguiente en la cola" no se baraja ni se reordena: sigue justo detrás.
  const pending = upcomingQueued();
  const pendingIds = new Set(pending.map((t) => t.id));
  shuffled = on;

  if (on) {
    original = [...items];
    const rest = shuffleAround(items.filter((t) => !pendingIds.has(t.id)), playing);
    items = playing ? [rest[0], ...pending, ...rest.slice(1)] : [...pending, ...rest];
    index = playing ? 0 : -1;
  } else {
    items = original.filter((t) => !pendingIds.has(t.id));
    original = [];
    index = playing ? items.findIndex((track) => track.id === playing.id) : -1;
    items.splice(index + 1, 0, ...pending);
  }

  emit();
}

/** @returns {"off"|"all"|"one"} */
export function repeatMode() {
  return repeat;
}

/** @param {"off"|"all"|"one"} mode */
export function setRepeat(mode) {
  repeat = ["off", "all", "one"].includes(mode) ? mode : "off";
  emit();
}

/** No → toda la cola → esta canción → no. El orden de casi cualquier reproductor. */
export function cycleRepeat() {
  setRepeat({ off: "all", all: "one", one: "off" }[repeat]);
  return repeat;
}

// --- Navegación ----------------------------------------------------------

/**
 * Si hay algo después. Con "repetir todo" siempre lo hay: la cola vuelve a
 * empezar. "Repetir esta canción" no afecta aquí: es cosa del final de pista,
 * y los botones de anterior y siguiente siguen moviéndose por la cola.
 */
export function hasNext() {
  if (index < items.length - 1) return true;
  return repeat === "all" && index >= 0 && items.length > 0;
}

export function hasPrev() {
  return index > 0 || (repeat === "all" && items.length > 1);
}

/**
 * La siguiente sin avanzar. Es la que se resuelve por adelantado.
 *
 * Al final de la cola con "repetir todo" y aleatorio, la siguiente aún no
 * existe —la vuelta nueva se baraja al llegar—, así que no hay nada que
 * adelantar.
 */
export function peekNext() {
  if (index < items.length - 1) return items[index + 1];
  if (repeat === "all" && !shuffled && index >= 0) return items[0] ?? null;
  return null;
}

/** Avanza y devuelve la nueva actual, o `null` si se acabó la cola. */
export function next() {
  if (!hasNext()) return null;

  if (index < items.length - 1) {
    index += 1;
  } else {
    // Vuelta nueva. Con aleatorio se baraja otra vez, para que cada vuelta
    // suene en un orden distinto.
    if (shuffled) reshuffleCycle();
    index = 0;
  }

  settle();
  emit();
  return items[index];
}

export function prev() {
  if (!hasPrev()) return null;

  index = index > 0 ? index - 1 : items.length - 1;

  settle();
  emit();
  return items[index];
}

/**
 * Baraja la cola para una vuelta nueva sin que la primera sea la última que
 * sonó: oír la misma canción dos veces seguidas delata el aleatorio.
 */
function reshuffleCycle() {
  const last = items[index];
  items = shuffle(items);

  if (items.length > 1 && items[0].id === last?.id) {
    const j = 1 + Math.floor(Math.random() * (items.length - 1));
    [items[0], items[j]] = [items[j], items[0]];
  }
}
