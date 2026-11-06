// La categoría de música debe elegirse antes de crear Web Audio o reproducir.
// La capacidad es opcional: los demás navegadores conservan su ruta de audio.
export function configurePlaybackSession(browser = globalThis.navigator) {
  try {
    if (!browser?.audioSession) return false;
    browser.audioSession.type = "playback";
    return browser.audioSession.type === "playback";
  } catch { return false; }
}

export async function resumeAudioContext(context) {
  if (!context) return false;
  if (context.state === "running") return true;
  if (!["suspended", "interrupted"].includes(context.state)) return false;
  try { await context.resume(); return context.state === "running"; }
  catch { return false; }
}
