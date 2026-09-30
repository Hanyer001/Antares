// Controles de ajustes para pestañas, secciones de Inicio, géneros y atajos.

import { els } from "./dom.js";
import { GENRES } from "./genres.js";
import { SHELF_LABELS } from "./home.js";
import { comboFromEvent, comboParts, conflicts, hasModifier } from "./keys.js";
import * as prefs from "./prefs.js";
import { failedGlobal, onGlobalStatus } from "./shortcuts.js";

const TAB_LABELS = {
  home: "Inicio",
  results: "Buscar",
  discover: "Descubrir",
  queue: "Cola",
  history: "Reciente",
  lists: "Listas",
  summary: "Resumen",
};

const ACTION_LABELS = {
  playPause: "Reproducir / pausar",
  next: "Siguiente canción",
  prev: "Canción anterior",
  seekForward: "Adelantar",
  seekBack: "Retroceder",
  volumeUp: "Subir el volumen",
  volumeDown: "Bajar el volumen",
  mute: "Silenciar",
  shuffle: "Aleatorio",
  repeat: "Repetir",
  like: "Me gusta",
  search: "Ir al buscador",
  focus: "Modo escucha",
  mini: "Modo mini",
  fullscreen: "Pantalla completa",
  show: "Mostrar Antares",
};

// --- Listas ordenables ---------------------------------------------------

/**
 * Una lista de elementos con casilla (se ven o no) y flechas para moverlos.
 *
 * @param {HTMLElement} container
 * @param {string} orderPath   preferencia con el orden (tipo "order")
 * @param {string} hiddenPath  preferencia con los ocultos (tipo "subset")
 * @param {Record<string,string>} labels
 * @param {number} [minVisible] cuántos tienen que quedar a la vista como mínimo
 */
function orderList(container, orderPath, hiddenPath, labels, minVisible = 0) {
  const move = (id, delta) => {
    const order = prefs.get(orderPath);
    const i = order.indexOf(id);
    const j = i + delta;
    if (j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    prefs.set(orderPath, order);
    // El foco sigue al elemento movido, para poder moverlo varias veces seguidas.
    requestAnimationFrame(() =>
      container.querySelector(`[data-id="${id}"] [data-move="${delta}"]`)?.focus(),
    );
  };

  const render = () => {
    const order = prefs.get(orderPath);
    const hidden = prefs.get(hiddenPath);
    const visibleCount = order.filter((id) => !hidden.includes(id)).length;

    container.replaceChildren(
      ...order.map((id, i) => {
        const li = document.createElement("li");
        li.className = "order-list__item";
        li.dataset.id = id;

        const label = document.createElement("label");
        label.className = "check";
        const box = document.createElement("input");
        box.type = "checkbox";
        box.checked = !hidden.includes(id);
        // La última que queda no se puede quitar.
        box.disabled = box.checked && visibleCount <= minVisible;
        box.addEventListener("change", () => {
          const now = prefs.get(hiddenPath).filter((h) => h !== id);
          prefs.set(hiddenPath, box.checked ? now : [...now, id]);
        });
        const name = document.createElement("span");
        name.textContent = labels[id] ?? id;
        label.append(box, name);

        const arrows = document.createElement("span");
        arrows.className = "order-list__arrows";
        for (const [delta, text, title] of [[-1, "↑", "Subir"], [1, "↓", "Bajar"]]) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "btn btn--icon btn--tiny";
          button.textContent = text;
          button.title = title;
          button.setAttribute("aria-label", `${title} ${labels[id] ?? id}`);
          button.dataset.move = String(delta);
          button.disabled = (delta < 0 && i === 0) || (delta > 0 && i === order.length - 1);
          button.addEventListener("click", () => move(id, delta));
          arrows.append(button);
        }

        li.append(label, arrows);
        return li;
      }),
    );
  };

  render();
  prefs.on(orderPath, render);
  prefs.on(hiddenPath, render);
}

// --- Géneros -------------------------------------------------------------

let detectedNames = [];

function renderGenres() {
  const chosen = prefs.get("home.genres");

  els.genreChips.replaceChildren(
    ...GENRES.map((genre) => {
      const chip = document.createElement("button");
      chip.type = "button";
      chip.className = "genre-chip";
      chip.textContent = genre.name;
      chip.setAttribute("aria-pressed", String(chosen.includes(genre.id)));
      chip.addEventListener("click", () => {
        const now = prefs.get("home.genres");
        prefs.set(
          "home.genres",
          now.includes(genre.id) ? now.filter((id) => id !== genre.id) : [...now, genre.id],
        );
      });
      return chip;
    }),
  );

  const auto = detectedNames.length
    ? `Según lo que escuchas: ${detectedNames.join(", ")}.`
    : "Aún no escuchas lo bastante para saberlo.";
  els.genresHint.textContent =
    chosen.length === 0
      ? `Automático. ${auto} Elige alguno para fijarlos tú.`
      : `Elegidos a mano. ${auto} Quítalos todos para volver al modo automático.`;
}

/** Los géneros deducidos, cuando Inicio los calcula. */
export function setDetectedGenres(genres) {
  detectedNames = genres.map((g) => g.name);
  renderGenres();
}

// --- Atajos --------------------------------------------------------------

let recording = null;

function stopRecording() {
  if (!recording) return;
  window.removeEventListener("keydown", recording.listener, true);
  recording.button.classList.remove("is-recording");
  recording = null;
  renderKeys();
}

function startRecording(button, path, requireModifier) {
  stopRecording();

  const note = button.closest("li").querySelector(".keys__note");
  button.classList.add("is-recording");
  button.replaceChildren("Pulsa las teclas…");

  const listener = (event) => {
    event.preventDefault();
    event.stopPropagation();

    if (event.key === "Escape") return stopRecording();

    const plain = !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey;
    if (plain && (event.code === "Delete" || event.code === "Backspace")) {
      prefs.set(path, "");
      return stopRecording();
    }

    const combo = comboFromEvent(event);
    if (!combo) return; // solo un modificador: aún no ha terminado

    if (requireModifier && !hasModifier(combo)) {
      note.textContent = "En todo Windows hace falta Ctrl, Alt o Win.";
      note.hidden = false;
      return;
    }

    prefs.set(path, combo);
    stopRecording();
  };

  recording = { button, listener };
  window.addEventListener("keydown", listener, true);
}

function keyCaps(combo) {
  if (!combo) {
    const none = document.createElement("span");
    none.className = "keys__none";
    none.textContent = "Sin atajo";
    return [none];
  }
  return comboParts(combo).map((part) => {
    const kbd = document.createElement("kbd");
    kbd.textContent = part;
    return kbd;
  });
}

function renderKeyList(container, group, requireModifier, failed = []) {
  const bindings = prefs.get(`shortcuts.${group}`);
  const clashes = conflicts(bindings);

  container.replaceChildren(
    ...Object.entries(bindings).map(([action, combo]) => {
      const li = document.createElement("li");
      li.className = "keys__item";

      const name = document.createElement("span");
      name.className = "keys__name";
      name.textContent = ACTION_LABELS[action] ?? action;

      const button = document.createElement("button");
      button.type = "button";
      button.className = "keys__combo";
      button.title = "Cambiar el atajo";
      button.append(...keyCaps(combo));
      button.addEventListener("click", () =>
        startRecording(button, `shortcuts.${group}.${action}`, requireModifier),
      );

      const note = document.createElement("span");
      note.className = "keys__note";
      if (clashes[action]) {
        note.textContent = `Repetido con «${ACTION_LABELS[clashes[action]]}»`;
      } else if (failed.includes(action)) {
        note.textContent = "Windows no lo deja usar: lo tiene otro programa";
      }
      note.hidden = !note.textContent;

      li.append(name, note, button);
      return li;
    }),
  );
}

function renderKeys() {
  if (recording) return;
  renderKeyList(els.localKeys, "local", false);
  renderKeyList(els.globalKeys, "global", true, failedGlobal());
}

// --- Listas de palabras y canales ----------------------------------------

/**
 * Una lista de etiquetas con su × y un campo para añadir más (Intro o coma).
 *
 * @param {HTMLElement} container
 * @param {string} path   preferencia de tipo "list" de textos
 * @param {string} placeholder
 */
function tagList(container, path, placeholder) {
  const input = document.createElement("input");
  input.className = "tags__input";
  input.type = "text";
  input.placeholder = placeholder;
  input.spellcheck = false;
  input.setAttribute("aria-label", placeholder);

  const add = () => {
    const words = input.value.split(",").map((w) => w.trim()).filter(Boolean);
    if (words.length === 0) return;
    prefs.set(path, [...prefs.get(path), ...words]);
    input.value = "";
  };

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      add();
    } else if (event.key === "Backspace" && !input.value) {
      // Borrar con el campo vacío quita la última, como en cualquier campo de etiquetas.
      prefs.set(path, prefs.get(path).slice(0, -1));
    }
  });
  input.addEventListener("blur", add);

  const render = () => {
    const chips = prefs.get(path).map((word) => {
      const chip = document.createElement("span");
      chip.className = "tag";
      chip.textContent = word;

      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "tag__remove";
      remove.textContent = "×";
      remove.title = `Quitar «${word}»`;
      remove.setAttribute("aria-label", `Quitar ${word}`);
      remove.addEventListener("click", () => prefs.set(path, prefs.get(path).filter((w) => w !== word)));

      chip.append(remove);
      return chip;
    });
    container.replaceChildren(...chips, input);
  };

  render();
  prefs.on(path, render);
}

/** "3 h", "1 día", "3 días y 12 h". */
function formatHours(hours) {
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  const rest = hours % 24;
  const d = `${days} ${days === 1 ? "día" : "días"}`;
  return rest ? `${d} y ${rest} h` : d;
}

function formatSeconds(seconds) {
  if (seconds === 0) return "Sin mínimo";
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s ? `${m} min ${s} s` : `${m} min`;
}

function renderRecLabels() {
  const { freshHours, minSeconds } = prefs.get("discovery");
  els.freshHoursValue.textContent = formatHours(freshHours);
  els.minSecondsValue.textContent = formatSeconds(minSeconds);
}

// --- Arranque ------------------------------------------------------------

export function initCustomize() {
  tagList(els.excludeWords, "discovery.excludeWords", "Añadir palabra…");
  tagList(els.blockedChannels, "discovery.blockedChannels", "Añadir canal…");
  renderRecLabels();
  prefs.on("discovery", renderRecLabels);

  orderList(els.tabOrder, "layout.tabOrder", "layout.hiddenTabs", TAB_LABELS, 1);
  orderList(els.shelfOrder, "home.shelfOrder", "home.hiddenShelves", SHELF_LABELS);

  renderGenres();
  prefs.on("home.genres", renderGenres);

  renderKeys();
  prefs.on("shortcuts", renderKeys);
  onGlobalStatus(renderKeys);
}
