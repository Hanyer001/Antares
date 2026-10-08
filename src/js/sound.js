// Cadena de Web Audio y controles de sonido:
//
// audio A → ganancia A ─┐
//                       ├→ ecualizador → nivelador → volumen → salida
// audio B → ganancia B ─┘
//
// sourceFor usa el proxy stream:// para disponer de las cabeceras CORS
// necesarias. Si Web Audio no está disponible, usa audio directo sin efectos.

import * as dialog from "./dialog.js";
import { els } from "./dom.js";
import { EQ_BANDS } from "./prefs-schema.js";
import * as store from "./prefs.js";

/**
 * Ganancia extra tras el nivelador, en dB. Cero: el compresor de Chromium ya
 * sube por su cuenta lo que comprime (su "makeup" automático). Con +5 dB y un
 * umbral de −26, todo acababa a −4..−9 dB RMS, casi al máximo, y el volumen
 * parecía no bajar.
 */
const MAKEUP_DB = 0;

/** Anchura de cada banda intermedia: una octava, sin pisar mucho a las vecinas. */
const BAND_Q = 1.1;

/** Preajustes de serie, en dB por banda (31 Hz … 16 kHz). */
export const PRESETS = {
  flat: { name: "Plano", bands: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  clarity: { name: "Claridad", bands: [-1, -1, -2, -1, 0, 1, 2, 1, 0, 0] },
  bass: { name: "Más graves", bands: [6, 5, 4, 2, 0, 0, 0, 0, -1, -1] },
  vocal: { name: "Voces", bands: [-2, -2, -1, 0, 2, 4, 4, 3, 1, 0] },
  treble: { name: "Más agudos", bands: [-1, -1, 0, 0, 0, 1, 2, 4, 5, 5] },
  rock: { name: "Rock", bands: [4, 3, 1, -1, -1, 1, 2, 3, 4, 4] },
  electronic: { name: "Electrónica", bands: [5, 4, 1, 0, -2, 1, 1, 2, 4, 5] },
  urban: { name: "Urbano", bands: [6, 5, 3, 1, -1, 0, 1, 1, 2, 2] },
  acoustic: { name: "Acústico", bands: [2, 2, 1, 1, 0, 1, 2, 2, 2, 1] },
  // Graves suaves y agudos apagados: para escuchar bajito de noche.
  night: { name: "Noche", bands: [3, 3, 2, 1, 0, 0, -1, -2, -4, -5] },
};

const USER_PREFIX = "user:";

/** La sección "sound" de las preferencias; se relee cada vez que cambia. */
let prefs = store.get("sound");

let ctx = null;
let native = null;
let capabilities = {equalizer:false,leveler:false};
let effectsTimer;
let filters = [];
let leveler = null;
let makeup = null;
let master = null;
const deckGains = new Map();

// --- Cadena de audio -----------------------------------------------------

function dbToGain(db) {
  return 10 ** (db / 20);
}

/** Crea la cadena. Devuelve false si el navegador no la deja crear. */
function build() {
  try {
    ctx = new AudioContext();
  } catch (error) {
    console.warn("Sin Web Audio: el audio suena sin efectos.", error);
    ctx = null;
    return false;
  }

  // La primera y la última son "estanterías" (suben o bajan todo lo que queda
  // por debajo o por encima); las de en medio, campanas de una octava.
  filters = EQ_BANDS.map((hz, i) => {
    const filter = ctx.createBiquadFilter();
    filter.type = i === 0 ? "lowshelf" : i === EQ_BANDS.length - 1 ? "highshelf" : "peaking";
    filter.frequency.value = hz;
    if (filter.type === "peaking") filter.Q.value = BAND_Q;
    return filter;
  });
  filters.reduce((prev, next) => prev.connect(next));

  // Un compresor suave hace de nivelador: lo flojo queda más cerca de lo
  // fuerte sin subir lo fuerte. Medido con un tono (RMS de entrada → salida):
  // −30 → −25, −20 → −15, −14 → −10,5, −9 → −8, −6 → −7 dB.
  leveler = ctx.createDynamicsCompressor();
  leveler.threshold.value = -18;
  leveler.knee.value = 12;
  leveler.ratio.value = 3;
  leveler.attack.value = 0.005;
  leveler.release.value = 0.3;

  makeup = ctx.createGain();
  makeup.gain.value = dbToGain(MAKEUP_DB);

  master = ctx.createGain();

  leveler.connect(makeup).connect(master);
  master.connect(ctx.destination);

  applyLevel();
  applyEq();
  return true;
}

/** Conecta o salta el nivelador según el ajuste. */
function applyLevel() {
  if (!ctx) return;

  const last = filters[filters.length - 1];
  last.disconnect();
  last.connect(prefs.level ? leveler : master);
}

function applyEq() {
  if (!ctx) return;

  const now = ctx.currentTime;
  filters.forEach((filter, i) => filter.gain.setTargetAtTime(prefs.bands[i] ?? 0, now, 0.05));
}

/** Si el audio pasa por la cadena (y por tanto por el proxy). */
export function active() {
  return ctx !== null;
}

/**
 * Conecta un plato a la cadena. Solo una vez por elemento: la Web Audio API no
 * deja crear dos fuentes del mismo <audio>.
 */
export function attach(deck) {
  if (!ctx || deckGains.has(deck)) return;

  // Imprescindible para que el proxy pueda dar permiso con CORS.
  deck.crossOrigin = "anonymous";

  const source = ctx.createMediaElementSource(deck);
  const gain = ctx.createGain();
  source.connect(gain).connect(filters[0]);
  deckGains.set(deck, gain);
}

/**
 * La URL que hay que darle al <audio>: la del proxy si hay cadena, la de
 * YouTube tal cual si no.
 */
export function sourceFor(url) {
  if (!ctx) return url;
  return window.__TAURI__.core.convertFileSrc(url, "stream");
}

/**
 * Lleva la ganancia de un plato a `value` en `seconds`. Es lo que hace las
 * transiciones y el fundido del temporizador.
 *
 * @returns {boolean} false si no hay cadena (quien llama usa el volumen del <audio>).
 */
export function rampDeck(deck, value, seconds) {
  const gain = deckGains.get(deck);
  if (!ctx || !gain) return false;

  const now = ctx.currentTime;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(gain.gain.value, now);

  if (seconds > 0) gain.gain.linearRampToValueAtTime(value, now + seconds);
  else gain.gain.setValueAtTime(value, now);

  return true;
}

/** Volumen general (0..1). @returns {boolean} false si no hay cadena. */
export function setMaster(volume) {
  if (!ctx) return false;

  const now = ctx.currentTime;
  master.gain.cancelScheduledValues(now);
  // Con el contexto parado (al arrancar) el cambio va directo: con la rampa,
  // lo primero que sonara saldría un instante a toda potencia.
  if (ctx.state === "running") master.gain.setTargetAtTime(volume, now, 0.015);
  else master.gain.setValueAtTime(volume, now);
  return true;
}

/**
 * Un contexto de audio creado antes de que el usuario toque nada puede nacer
 * suspendido. Se reanuda al reproducir.
 */
export function resume() {
  if (ctx?.state === "suspended") ctx.resume().catch(() => {});
}

// --- Preferencias --------------------------------------------------------

/** Sin cadena de audio (Android, donde suena el sistema) no hay fundidos. */
let enabled = true;

export function crossfadeSeconds() {
  return enabled ? prefs.crossfade : 0;
}

function formatDb(db) {
  return `${db > 0 ? "+" : ""}${db}`;
}

function formatHz(hz) {
  return hz >= 1000 ? `${hz / 1000}k` : String(hz);
}

/** Las bandas de un preajuste, de serie o propio; null si no existe. */
function presetBands(value) {
  if (value.startsWith(USER_PREFIX)) {
    const name = value.slice(USER_PREFIX.length);
    return prefs.userPresets.find((p) => p.name === name)?.bands ?? null;
  }
  return PRESETS[value]?.bands ?? null;
}

/** Las opciones del desplegable: las de serie, las tuyas y "Personalizado". */
function renderPresetOptions() {
  const option = (value, text) => {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = text;
    return o;
  };

  const groups = [];
  const builtIn = document.createElement("optgroup");
  builtIn.label = "De serie";
  builtIn.append(...Object.entries(PRESETS).map(([id, p]) => option(id, p.name)));
  groups.push(builtIn);

  if (prefs.userPresets.length > 0) {
    const mine = document.createElement("optgroup");
    mine.label = "Tuyos";
    mine.append(...prefs.userPresets.map((p) => option(`${USER_PREFIX}${p.name}`, p.name)));
    groups.push(mine);
  }

  els.eqPreset.replaceChildren(...groups, option("custom", "Personalizado"));
}

/** Diez deslizadores verticales, de graves a agudos. */
function buildBands() {
  const nodes = EQ_BANDS.map((hz, i) => {
    const band = document.createElement("label");
    band.className = "eq10__band";

    const value = document.createElement("span");
    value.className = "eq10__value";

    // Un deslizador normal, girado: el mismo aspecto que el resto, en vertical.
    const track = document.createElement("span");
    track.className = "eq10__track";

    const input = document.createElement("input");
    input.type = "range";
    input.className = "range eq10__slider";
    input.min = "-12";
    input.max = "12";
    input.step = "1";
    input.setAttribute("aria-label", `${formatHz(hz)} Hz`);
    input.addEventListener("input", () => {
      const bands = [...prefs.bands];
      bands[i] = Number(input.value);
      store.set("sound.bands", bands);
      store.set("sound.preset", "custom");
    });

    const name = document.createElement("span");
    name.className = "eq10__hz";
    name.textContent = formatHz(hz);

    track.append(input);
    band.append(value, track, name);
    return band;
  });

  els.eqBands.replaceChildren(...nodes);
}

function render() {
  els.levelToggle.checked = prefs.level;

  renderPresetOptions();
  // Un preajuste propio que ya no existe (borrado, o de otra copia) se ve como
  // "Personalizado".
  els.eqPreset.value = presetBands(prefs.preset) ? prefs.preset : "custom";
  els.eqDelete.hidden = !prefs.preset.startsWith(USER_PREFIX);

  els.eqBands.querySelectorAll(".eq10__band").forEach((band, i) => {
    const db = prefs.bands[i] ?? 0;
    const input = band.querySelector("input");
    if (document.activeElement !== input) input.value = String(db);
    input.style.setProperty("--level", `${((db + 12) / 24) * 100}%`);
    band.querySelector(".eq10__value").textContent = formatDb(db);
  });

  els.crossfade.value = String(prefs.crossfade);
  els.crossfade.style.setProperty("--level", `${(prefs.crossfade / 12) * 100}%`);
  els.crossfadeValue.textContent =
    prefs.crossfade === 0 ? "Sin transición" : `${prefs.crossfade} s fundiendo una con la siguiente`;

  // Sin cadena de audio, nivelar y ecualizar no tienen efecto: mejor decirlo
  // que dejar controles que no hacen nada.
  const disabled = !ctx && !capabilities.equalizer;
  for (const input of [els.levelToggle, els.eqPreset, els.eqSave, ...els.eqBands.querySelectorAll("input")]) {
    input.disabled = input === els.levelToggle ? !ctx && !capabilities.leveler : disabled;
  }
  if (native) {
    els.crossfade.disabled = store.get("mobile.energySaver");
    if (els.crossfade.disabled) els.crossfadeValue.textContent = "Desactiva «Ahorrar batería» para usar transiciones.";
    document.getElementById("native-effects-status").textContent = capabilities.equalizer
      ? `Sonido del sistema · ${capabilities.bands} bandas${capabilities.leveler ? " y nivelador" : " · este dispositivo no admite nivelador"}`
      : "Los efectos se activan al reproducir, si el dispositivo los admite.";
  }
}

/** Guarda las bandas de ahora como un preajuste con nombre. */
async function savePreset() {
  const name = await dialog.ask({
    title: "Guardar ecualización",
    placeholder: "Nombre del preajuste",
    confirmLabel: "Guardar",
  });
  const clean = name?.trim().slice(0, 40);
  if (!clean) return;

  // Con el mismo nombre, se sobrescribe: es lo que se espera al "guardar".
  const others = prefs.userPresets.filter((p) => p.name.toLowerCase() !== clean.toLowerCase());
  store.set("sound.userPresets", [...others, { name: clean, bands: [...prefs.bands] }]);
  store.set("sound.preset", `${USER_PREFIX}${clean}`);
}

async function deletePreset() {
  const name = prefs.preset.slice(USER_PREFIX.length);
  const ok = await dialog.confirmAction({
    title: `¿Borrar «${name}»?`,
    text: "El ecualizador se queda como está; solo se borra el preajuste.",
    confirmLabel: "Borrar",
    danger: true,
  });
  if (!ok) return;

  store.set("sound.userPresets", prefs.userPresets.filter((p) => p.name !== name));
  store.set("sound.preset", "custom");
}

/**
 * @param {object} [opts]
 * @param {boolean} [opts.enabled] false en Android: el audio lo reproduce el
 *   sistema, no un <audio> de la página, y no hay cadena que montar.
 */
export function initSound({ enabled: on = true, native: adapter = null } = {}) {
  native = adapter;
  const applyNative = () => {
    if (!native) return;
    clearTimeout(effectsTimer);
    effectsTimer = setTimeout(() => native("setEffects",{bands:prefs.bands,level:prefs.level})
      .then(() => native("setPlaybackOptions",{crossfade:prefs.crossfade,energySaver:store.get("mobile.energySaver")}))
      .then(() => native("effectsState")).then(state => { capabilities = state; render(); }).catch(console.warn),150);
  };
  enabled = on;
  prefs = store.get("sound");
  if (enabled) build();
  applyNative();
  if (native) store.on("mobile",applyNative);
  if (native) window.__TAURI__.core.addPluginListener("player","state",applyNative).catch(console.warn);
  buildBands();
  render();

  // Cualquier cambio —de estos controles, de restablecer o de importar— pasa
  // por aquí: se relee todo y se aplica.
  store.on("sound", (sound) => {
    const levelChanged = sound.level !== prefs.level;
    prefs = sound;
    if (levelChanged) applyLevel();
    applyEq();
    applyNative();
    render();
  });

  els.levelToggle.addEventListener("change", () => {
    store.set("sound.level", els.levelToggle.checked);
  });

  els.eqPreset.addEventListener("change", () => {
    const value = els.eqPreset.value;
    const bands = presetBands(value);
    if (bands) store.set("sound.bands", bands);
    store.set("sound.preset", value);
  });

  els.eqSave.addEventListener("click", savePreset);
  els.eqDelete.addEventListener("click", deletePreset);

  els.crossfade.addEventListener("input", () => {
    store.set("sound.crossfade", Number(els.crossfade.value));
  });
}
