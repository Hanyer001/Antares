import { runtime } from "./platform.js";
// Ajustes disponibles en la adaptación inicial de Linux. No cambia preferencias guardadas.
export async function initPlatformUi(platform) {
  if (platform === "macos" || platform === "windows") {
    const capabilities = await runtime.core.invoke("desktop_capabilities");
    for (const [key, available, explanation] of [
      ["system.closeToTray", capabilities.tray, "La bandeja no está disponible en esta sesión. Cerrar la ventana saldrá de Antares."],
      ["system.startHidden", capabilities.tray, "Antares abrirá su ventana para que puedas acceder a los controles."],
      ["shortcuts.globalEnabled", capabilities.globalShortcuts, "Los atajos globales no están disponibles en esta sesión."],
    ]) {
      if (available) continue;
      const input = document.querySelector(`[data-pref="${key}"]`);
      if (!input) continue;
      input.disabled = true;
      input.closest(".setting")?.querySelector(".setting__value")?.replaceChildren(explanation);
    }
  }
  if (platform === "macos") {
    const rows = [
      ["system.closeToTray", "Barra de menús", "Al cerrar la ventana, la música sigue y puedes controlarla desde la barra de menús."],
      ["system.startHidden", "Iniciar en la barra de menús", "Abre Antares en segundo plano al iniciar sesión."],
      ["shortcuts.globalEnabled", "Fuera de Antares", "Funcionan aunque Antares esté en segundo plano. Necesitan Control, Opción o Comando."],
      ["behavior.notify", "Avisar al cambiar de canción", "Una notificación de macOS cuando Antares está en segundo plano."],
    ];
    for (const [key, label, description] of rows) {
      if (document.querySelector(`[data-pref="${key}"]`)?.disabled) continue;
      const row = document.querySelector(`[data-pref="${key}"]`)?.closest(".setting");
      row?.querySelector(".setting__label")?.replaceChildren(label);
      row?.querySelector(".setting__value")?.replaceChildren(description);
      row?.querySelector(".sr-only")?.replaceChildren(label);
    }
    document.querySelector('[data-theme="system"] .theme-card__name')?.replaceChildren("Según el sistema");
    return;
  }
  if (platform === "web") {
    for (const [key, explanation] of [
      ["system.autostart", "El inicio automático pertenece a la aplicación de escritorio."],
      ["system.closeToTray", "En la web, usa el ícono de Inicio y los controles multimedia del teléfono."],
      ["system.startHidden", "El navegador controla cómo se abre la aplicación web."],
      ["shortcuts.globalEnabled", "Los atajos funcionan dentro de Antares; los controles del sistema usan Media Session."],
      ["behavior.notify", "La pista y los controles se muestran mediante Media Session."],
    ]) {
      const input = document.querySelector(`[data-pref="${key}"]`);
      if (!input) continue;
      input.disabled = true;
      input.title = explanation;
      const note = input.closest(".setting")?.querySelector(".setting__value");
      if (note) note.textContent = explanation;
    }
    return;
  }
  if (platform !== "linux") return;
  document.documentElement.dataset.platform = "linux";
  const unavailable = [
    ["system.closeToTray", "En Linux, cerrar la ventana guarda la sesión y sale de Antares."],
    ["system.startHidden", "En Linux, Antares inicia con su ventana visible."],
    ["system.updateCheck", "El canal de actualizaciones para Linux todavía está pendiente."],
  ];
  if (!await runtime.core.invoke("global_shortcuts_available")) {
    unavailable.push(["shortcuts.globalEnabled", "Los atajos globales todavía no están disponibles en Wayland. Los atajos dentro de Antares siguen funcionando."]);
  }
  for (const [key, explanation] of unavailable) {
    const input = document.querySelector('[data-pref="' + key + '"]');
    if (!input) continue;
    input.disabled = true;
    input.title = explanation;
    const row = input.closest(".setting");
    const note = row?.querySelector(".setting__value");
    if (note) note.textContent = explanation;
  }
  for (const [key, label, description] of [
    ["system.autostart", "Abrir al iniciar sesión", "Inicia Antares automáticamente al entrar a Linux. El HDD debe estar montado."],
    ["shortcuts.globalEnabled", "Fuera de Antares", null],
    ["behavior.notify", "Avisar al cambiar de canción", "Una notificación del sistema cuando Antares está en segundo plano."],
  ]) {
    const row = document.querySelector('[data-pref="' + key + '"]')?.closest(".setting");
    const title = row?.querySelector(".setting__label");
    if (title) title.textContent = label;
    if (description) row?.querySelector(".setting__value")?.replaceChildren(description);
  }
  document.querySelector('[data-theme="system"] .theme-card__name')?.replaceChildren("Según el sistema");
}
