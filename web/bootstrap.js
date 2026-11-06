const panel = document.createElement("p");
panel.id = "web-startup"; panel.setAttribute("role", "status");
panel.textContent = "Abriendo Antares…";
document.body.append(panel);
try {
  // La actualización se descarga en paralelo. El navegador activa el
  // worker cuando la versión anterior deja de tener pestañas abiertas.
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(error => console.warn("PWA:", error));
  }
  const storage = await import("./js/web-storage.js");
  storage.bindWebDevice();
  await storage.hydrateSession();
  await import("./main.js");
  const { flushPendingEvents } = await import("./js/web-runtime.js");
  flushPendingEvents().catch(console.warn);
  panel.remove();
  const { API } = await import("./config.js");
  fetch(new URL("health", new URL(API, location.href))).then(response => response.json()).then(health => {
    if (!health.demo) return;
    const notice = document.createElement("aside");
    notice.id = "web-demo-notice";
    notice.setAttribute("role", "status");
    notice.textContent = "Prueba gratuita. La biblioteca del servidor puede reiniciarse. Guarda una copia desde Ajustes.";
    const close = document.createElement("button");
    close.type = "button";
    close.textContent = "Entendido";
    close.addEventListener("click", () => notice.remove());
    notice.append(close);
    document.body.append(notice);
  }).catch(() => {});

} catch (error) {
  console.error("Arranque de Antares:", error);
  panel.setAttribute("role", "alert");
  panel.textContent = `No se pudo abrir Antares: ${error.message || error}. `;
  const retry = document.createElement("button"); retry.textContent = "Reintentar";
  retry.addEventListener("click", () => location.reload()); panel.append(retry);
}
