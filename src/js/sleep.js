// Temporizador por duración o fin de canción.
// Avisa a main.js para aplicar el fundido y pausar.

import { els } from "./dom.js";
import { openMenu } from "./menu.js";

const OPTIONS_MIN = [15, 30, 45, 60, 90];

/** "off", "track" (al acabar la canción) o "time" (a una hora). */
let mode = "off";
let endsAt = 0;
let ticker = null;
let onExpire = () => {};
let onChange = () => {};

function pad(n) {
  return String(n).padStart(2, "0");
}

function render() {
  els.sleepButton.classList.toggle("is-active", mode !== "off");

  if (mode === "off") {
    els.sleepLabel.textContent = "Temporizador";
  } else if (mode === "track") {
    els.sleepLabel.textContent = "Al acabar esta";
  } else {
    const left = Math.max(Math.round((endsAt - Date.now()) / 1000), 0);
    els.sleepLabel.textContent = `${Math.floor(left / 60)}:${pad(left % 60)}`;
  }
}

function stop() {
  mode = "off";
  clearInterval(ticker);
  ticker = null;
  render();
}

function set(newMode, minutes = 0) {
  stop();
  mode = newMode;

  if (newMode === "time") {
    endsAt = Date.now() + minutes * 60 * 1000;
    ticker = setInterval(() => {
      if (Date.now() >= endsAt) {
        stop();
        onExpire();
        return;
      }
      render();
    }, 1000);
  }

  render();
  onChange(describe());
}

/** Qué hará el temporizador, para la barra de estado. */
function describe() {
  if (mode === "off") return "Temporizador desactivado.";
  if (mode === "track") return "La música se parará al acabar esta canción.";
  return `La música se parará en ${Math.round((endsAt - Date.now()) / 60000)} min.`;
}

/** Si hay que parar al acabar la canción que suena. */
export function stopsAfterTrack() {
  return mode === "track";
}

/**
 * Llamar al acabar una canción. Devuelve true si el temporizador pedía parar
 * ahí; en ese caso se desactiva (ya ha cumplido).
 */
export function consumeTrackEnd() {
  if (mode !== "track") return false;
  stop();
  return true;
}

/**
 * @param {object} callbacks
 * @param {Function} callbacks.expire  Se acabó el tiempo: fundir y pausar.
 * @param {Function} callbacks.change  Cambió el ajuste (con un texto que lo dice).
 */
export function initSleep({ expire, change }) {
  onExpire = expire;
  onChange = change;
  render();

  els.sleepButton.addEventListener("click", () => {
    openMenu(els.sleepButton, [
      { heading: "Parar la música" },
      { label: "Al acabar esta canción", onSelect: () => set("track") },
      ...OPTIONS_MIN.map((m) => ({ label: `Dentro de ${m} min`, onSelect: () => set("time", m) })),
      ...(mode === "off" ? [] : ["sep", { label: "Desactivar", onSelect: () => set("off") }]),
    ]);
  });
}
