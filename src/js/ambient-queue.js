// Una sola transición a la vez. Una descarga tardía nunca recupera una portada vieja.
export function ambientQueue({ load, present }) {
  let version = 0, requested = null, shown = null, running = false, wake = null;
  async function pump() {
    if (running) return;
    running = true;
    try {
      while (requested !== shown) {
        const mine = version, url = requested;
        try {
          if (url) {
            const changed = new Promise(resolve => { wake = resolve; });
            await Promise.race([Promise.resolve().then(() => load(url)), changed]);
            wake = null;
          }
          if (mine !== version) continue;
          await present(url);
          if (requested !== null || mine === version) shown = url;
        } catch {
          // La anterior sigue visible si falta red o la imagen es inválida.
          if (mine === version) break;
        }
      }
    } finally { running = false; }
  }
  return (url) => {
    requested = url || null;
    version++;
    wake?.();
    if (!requested) {
      // Limpiar no espera a una descarga ni a una animación pendiente.
      present(null, { immediate: true });
      shown = null;
    }
    return pump();
  };
}
