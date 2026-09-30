// Consulta nuevas versiones y muestra el aviso de actualización.
// Rust descarga, verifica la firma e instala tras la confirmación del usuario.

import * as dialog from "./dialog.js";
import * as prefs from "./prefs.js";
import { toast } from "./toast.js";

const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

/** Al abrir, se espera un poco: primero que arranque todo lo demás. */
const STARTUP_DELAY_MS = 6000;
/** Y si la app se queda abierta días, se vuelve a mirar cada tanto. */
const RECHECK_MS = 6 * 60 * 60 * 1000;

const $ = (id) => document.getElementById(id);

let beforeInstall = async () => {};
let busy = false;

function mb(bytes) {
  return `${(bytes / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

/** Descarga e instala. Si todo va bien, no vuelve: la app se reinicia. */
async function install(update) {
  const ok = await dialog.confirmAction({
    title: `Antares ${update.version}`,
    text:
      (update.notes ? `${update.notes}\n\n` : "") +
      "Se descarga, se instala y Antares se vuelve a abrir. Tus listas, historial y ajustes no se tocan.",
    confirmLabel: "Actualizar ahora",
    cancelLabel: "Más tarde",
  });
  if (!ok) return;

  busy = true;
  toast("Preparando la actualización…", { tone: "busy", key: "app-update" });
  const stop = await listen("app-update-progress", ({ payload: { downloaded, total } }) => {
    const text = total
      ? `Descargando Antares ${update.version}… ${Math.round((downloaded / total) * 100)} % (${mb(total)})`
      : `Descargando Antares ${update.version}… ${mb(downloaded)}`;
    toast(text, { tone: "busy", key: "app-update" });
  });

  try {
    // Lo que suena y la sesión se guardan antes: el instalador cierra la app.
    await beforeInstall();
    await invoke("install_app_update");
  } catch (error) {
    toast(String(error), { tone: "error", key: "app-update" });
  } finally {
    stop();
    busy = false;
  }
}

/**
 * Mira si hay una versión nueva.
 * @param {boolean} manual  Con el botón: también se dice si ya está al día o
 *   si falló. Al abrir, solo se habla si hay algo nuevo.
 */
export async function check(manual = false) {
  if (busy) return;
  const button = $("app-update-button");
  if (manual) {
    button.disabled = true;
    button.textContent = "Buscando…";
  }

  try {
    const update = await invoke("check_app_update");
    if (update) {
      toast(`Hay una versión nueva de Antares: ${update.version}`, {
        tone: "info",
        key: "app-update",
        ms: 30_000,
        action: { label: "Actualizar", onClick: () => install(update) },
      });
      $("app-version").textContent = `${update.current} · hay una nueva: ${update.version}`;
    } else if (manual) {
      toast("Antares ya está en la última versión.", { key: "app-update" });
    }
  } catch (error) {
    if (manual) toast(String(error), { tone: "error", key: "app-update" });
    else console.warn("Actualización de Antares:", error);
  } finally {
    if (manual) {
      button.disabled = false;
      button.textContent = "Buscar versión nueva";
    }
  }
}

/**
 * @param {object} opts
 * @param {() => Promise<void>} opts.beforeInstall  Guardar lo que haga falta.
 */
export async function initAppUpdate(opts = {}) {
  if (opts.beforeInstall) beforeInstall = opts.beforeInstall;

  $("app-update-button").addEventListener("click", () => check(true));
  invoke("app_version")
    .then((version) => ($("app-version").textContent = `Tienes la ${version}`))
    .catch(() => {});

  if (prefs.get("system.updateCheck")) setTimeout(() => check(false), STARTUP_DELAY_MS);
  setInterval(() => {
    if (prefs.get("system.updateCheck")) check(false);
  }, RECHECK_MS);
}
