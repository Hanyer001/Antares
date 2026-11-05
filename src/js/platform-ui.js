// Ajustes disponibles en la adaptación inicial de Linux. No cambia preferencias guardadas.
export async function initPlatformUi() {
  const platform = await window.__TAURI__.core.invoke("get_platform");
  if (platform !== "linux") return;
  document.documentElement.dataset.platform = "linux";
  const unavailable = [
    ["system.closeToTray", "En Linux, cerrar la ventana guarda la sesión y sale de Antares."],
    ["system.startHidden", "En Linux, Antares inicia con su ventana visible."],
    ["system.updateCheck", "El canal de actualizaciones para Linux todavía está pendiente."],
  ];
  if (!await window.__TAURI__.core.invoke("global_shortcuts_available")) {
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
