// Finite private commands; cancellation must win before a late search plays.
export function createVoiceHandler({ search, play, control, status }) {
  return async (request, context = {}) => {
    const { command, query = "" } = request;
    const check = () => { if (context.cancelled?.()) throw new Error("Petición cancelada."); };
    check();
    if (command === "status") return { ok: true, ...status() };
    if (command === "play_query") {
      if (!query.trim() || query.length > 250 || /[\x00-\x1f]/.test(query)) throw new Error("Indica una canción.");
      const tracks = await search(query);
      check();
      const track = tracks.find(t => t?.id && t.watch_url);
      if (!track) throw new Error("No encontré esa canción en Antares.");
      if (!await play(track, request)) throw new Error("Antares no pudo iniciar el audio.");
      check();
      const state = status();
      if (!state.playing || state.id !== track.id) throw new Error("La reproducción no quedó confirmada.");
      return { ok: true, ...state };
    }
    if (!["pause", "resume", "next", "previous"].includes(command) || query) throw new Error("Orden multimedia no permitida.");
    if (!await control(command, request)) throw new Error("No hay una pista disponible para esa acción.");
    check();
    return { ok: true, ...status() };
  };
}

export async function initVoiceBridge({ invoke, listen, handle, onCancel = () => {} }) {
  let draining = false;
  const tokens = new Map();
  const cancelledIds = new Set();
  await listen("voice-cancelled", ({ payload: id }) => {
    cancelledIds.add(id);
    if (cancelledIds.size > 128) cancelledIds.delete(cancelledIds.values().next().value);
    tokens.get(id)?.cancel();
  });
  async function drain() {
    if (draining) return;
    draining = true;
    try {
      for (;;) {
        const request = await invoke("take_voice_request");
        if (!request) break;
        if (cancelledIds.delete(request.id)) continue;
        let resolveCancel;
        const abort = new Promise(resolve => { resolveCancel = resolve; });
        const token = { cancelled: false, cancel() {
          if (token.cancelled) return;
          token.cancelled = true;
          onCancel(request.id);
          resolveCancel({ ok: false, error: "Petición cancelada." });
        } };
        tokens.set(request.id, token);
        const result = await Promise.race([
          Promise.resolve().then(() => handle(request, { cancelled: () => token.cancelled }))
            .catch(error => ({ ok: false, error: String(error.message || error).slice(0,400) })),
          abort,
        ]);
        tokens.delete(request.id);cancelledIds.delete(request.id);
        if (!token.cancelled) {
          await invoke("finish_voice_request", { id: request.id, result }).catch(error => console.warn("Voice completion:", error));
        }
      }
    } finally { draining = false; }
  }
  await listen("voice-request", () => drain().catch(console.warn));
  await drain();
}
