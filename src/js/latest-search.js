/** Una nueva consulta cancela las peticiones de la anterior, manteniendo sus fuentes paralelas. */
export function createLatestSearch() {
  let query = null, controller = null;
  return {
    signal(text) {
      const next = text.trim().toLocaleLowerCase();
      if (next !== query) { controller?.abort(); query = next; controller = new AbortController(); }
      return controller.signal;
    },
    cancel() { controller?.abort(); query = null; controller = null; },
  };
}
