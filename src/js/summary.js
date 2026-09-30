// Renderiza las estadísticas de escucha calculadas por Rust.
// Las canciones del resumen usan las mismas filas que el resto de la biblioteca.

import { els } from "./dom.js";

const { invoke } = window.__TAURI__.core;

export function loadSummary() {
  return invoke("get_summary");
}

/** Segundos → "12 h 30 min", "45 min" o "30 s". */
export function formatListened(seconds) {
  const total = Math.round(seconds);
  if (total < 60) return `${total} s`;

  const minutes = Math.round(total / 60);
  if (minutes < 60) return `${minutes} min`;

  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

function metric(label, value, hint = "") {
  const card = document.createElement("div");
  card.className = "metric";

  const l = document.createElement("span");
  l.className = "metric__label";
  l.textContent = label;

  const v = document.createElement("span");
  v.className = "metric__value";
  v.textContent = value;

  card.append(l, v);

  if (hint) {
    const h = document.createElement("span");
    h.className = "metric__hint";
    h.textContent = hint;
    card.append(h);
  }

  return card;
}

/** Pinta cifras y artistas. Devuelve las canciones para la lista. */
export function render(summary) {
  const completas = summary.plays ? Math.round((summary.completions / summary.plays) * 100) : 0;

  els.metrics.replaceChildren(
    metric("Tiempo escuchado", formatListened(summary.listened_secs)),
    metric("Reproducciones", String(summary.plays)),
    metric("Canciones distintas", String(summary.tracks), `${summary.liked} con me gusta`),
    metric("Escuchadas enteras", `${completas} %`, `${summary.skips} saltadas`),
  );

  const top = summary.top_artists[0]?.listened_secs || 1;

  const artists = summary.top_artists.map((artist) => {
    const li = document.createElement("li");
    li.className = "artist";

    const name = document.createElement("span");
    name.className = "artist__name";
    name.textContent = artist.name;

    const meta = document.createElement("span");
    meta.className = "artist__meta";
    meta.textContent = `${artist.tracks} ${artist.tracks === 1 ? "canción" : "canciones"} · ${formatListened(artist.listened_secs)}`;

    // Barra proporcional al más escuchado: se lee de un vistazo quién domina.
    const bar = document.createElement("span");
    bar.className = "artist__bar";
    bar.style.setProperty("--share", `${Math.max((artist.listened_secs / top) * 100, 3)}%`);

    li.append(name, meta, bar);
    return li;
  });

  if (artists.length === 0) {
    const li = document.createElement("li");
    li.className = "artist artist--empty";
    li.textContent = "Escucha algo y aquí aparecerán tus artistas.";
    artists.push(li);
  }

  els.artists.replaceChildren(...artists);

  // Las filas enseñan por qué están en el top, igual que una recomendación.
  return summary.top_tracks.map((t) => ({
    ...t,
    reason: `${t.plays} ${t.plays === 1 ? "escucha" : "escuchas"} · ${formatListened(t.listened_secs)}`,
  }));
}
