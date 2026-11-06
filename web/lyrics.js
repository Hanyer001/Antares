import { lyricIndex, prepareLyrics } from "./shared/lyrics-policy.js";

export function createLyrics(details, audio, request) {
  const status = details.querySelector("#lyrics-status");
  const content = details.querySelector("#lyrics-lines");
  let id = null;
  let lines = [];
  let active = -1;
  let loaded = false;
  let controller;

  function tick() {
    if (!details.open || !lines.length) return;
    const next = lyricIndex(lines, audio.currentTime);
    if (next === active) return;
    content.children[active]?.removeAttribute("aria-current");
    active = next;
    const verse = content.children[active];
    if (!verse) return;
    verse.setAttribute("aria-current", "true");
    content.scrollTop = Math.max(0, verse.offsetTop - (content.clientHeight - verse.offsetHeight) / 2);
  }

  async function load() {
    if (!details.open || !id || loaded || controller) return;
    const current = new AbortController();
    controller = current;
    status.textContent = "Buscando letra…";
    try {
      const lyrics = await request(id, current.signal);
      if (current.signal.aborted) return;
      loaded = true;
      lines = prepareLyrics(lyrics?.synced);
      status.textContent = lyrics?.instrumental ? "Pista instrumental."
        : !lines.length && !lyrics?.plain ? "Letra no disponible." : "";
      if (!lines.length) content.textContent = lyrics?.plain ?? "";
      else content.replaceChildren(...lines.map(line => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = line.text;
        button.addEventListener("click", () => {
          if (Number.isFinite(audio.duration)) audio.currentTime = Math.min(line.time, audio.duration);
        });
        return button;
      }));
      tick();
    } catch {
      if (!current.signal.aborted) status.textContent = "No se pudo cargar la letra. Vuelve a abrir esta sección para reintentar.";
    } finally {
      if (controller === current) controller = null;
    }
  }

  details.addEventListener("toggle", () => { if (loaded) tick(); else load(); });
  audio.addEventListener("timeupdate", tick);
  return track => {
    if ((track?.id ?? null) === id) return;
    controller?.abort();
    controller = null;
    id = track?.id ?? null;
    lines = [];
    active = -1;
    loaded = false;
    content.replaceChildren();
    status.textContent = id ? "" : "Reproduce una canción para ver la letra.";
    load();
  };
}
