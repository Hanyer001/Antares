// Política de espacio de escritorio, independiente del DOM y de reproducción.
export function shellLayout(width, { sidebar = "full", sidebarWidth = 236, nowplayingWidth = 360 } = {}) {
  const available = Number.isFinite(width) ? Math.max(0, width) : 1280;
  const icons = sidebar === "icons" || available < 1040;
  const navigation = icons ? 68 : Math.min(360, Math.max(180, Number.isFinite(sidebarWidth) ? sidebarWidth : 236));
  const context = Math.min(560, Math.max(300, Number.isFinite(nowplayingWidth) ? nowplayingWidth : 360));
  return {
    icons,
    navigation,
    context,
    // Reservar al menos 480 px para contenido, además de un umbral estable.
    docked: available >= 1080 && available - navigation - context >= 480,
  };
}
