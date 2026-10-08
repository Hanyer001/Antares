// Iconos SVG creados desde JavaScript. Los trazados con prefijo "fill:"
// usan relleno; los demás usan contorno.

const PATHS = {
  spark: ["fill:M12 2l2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7z"],
  search: ["M18 18l3 3", "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z"],
  plus: ["M12 6v12M6 12h12"],
  close: ["M7 7l10 10M17 7L7 17"],
  back: ["m15 18-6-6 6-6"],
  listPlus: ["M11 12H3", "M16 6H3", "M16 18H3", "M18 9v6", "M21 12h-6"],
  list: ["M8 6h13", "M8 12h13", "M8 18h13", "M3 6h.01", "M3 12h.01", "M3 18h.01"],
  more: [
    "fill:M6 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
    "fill:M12 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
    "fill:M18 10.4a1.6 1.6 0 1 1 0 3.2 1.6 1.6 0 0 1 0-3.2z",
  ],
  play: ["fill:M8 5.5v13l11-6.5z"],
  // Una lista con un play delante del primer renglón: "la siguiente".
  playNext: ["M3 6h11", "M3 12h7", "M3 18h7", "fill:M14 10v8l6.5-4z"],
  heart: [
    "M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.3 1.5 4.05 3 5.5l7 7Z",
  ],
  shuffle: [
    "M2 18h1.4c1.3 0 2.5-.6 3.3-1.7l6.1-8.6c.7-1.1 2-1.7 3.3-1.7H22",
    "m18 2 4 4-4 4",
    "M2 6h1.9c1.5 0 2.9.9 3.6 2.2",
    "M22 18h-5.9c-1.3 0-2.6-.7-3.3-1.8l-.5-.8",
    "m18 14 4 4-4 4",
  ],
  // Seis puntos: "de aquí se arrastra".
  grip: [
    "fill:M9 5.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
    "fill:M15 5.4a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
    "fill:M9 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
    "fill:M15 10.6a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
    "fill:M9 15.8a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
    "fill:M15 15.8a1.4 1.4 0 1 1 0 2.8 1.4 1.4 0 0 1 0-2.8z",
  ],
  check: ["m5 12.5 4.5 4.5L19 7.5"],
  // Flechas arriba y abajo con renglones: ordenar.
  sort: ["M3 7h10", "M3 12h7", "M3 17h4", "M18 5v14", "m15 16 3 3 3-3"],
  radio: [
    "M4.9 19.1a10 10 0 0 1 0-14.2",
    "M7.8 16.2a6 6 0 0 1 0-8.4",
    "M16.2 7.8a6 6 0 0 1 0 8.4",
    "M19.1 4.9a10 10 0 0 1 0 14.2",
    "fill:M12 10a2 2 0 1 1 0 4 2 2 0 0 1 0-4z",
  ],
  // Guardar (un álbum o una lista de YouTube como lista propia).
  save: ["M12 3v12", "m7 10 5 5 5-5", "M5 21h14"],
};

const NS = "http://www.w3.org/2000/svg";

/** Un `<svg>` listo para meter en un botón. */
export function icon(name) {
  const svg = document.createElementNS(NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");

  for (const raw of PATHS[name] ?? []) {
    const path = document.createElementNS(NS, "path");
    const filled = raw.startsWith("fill:");

    path.setAttribute("d", filled ? raw.slice(5) : raw);
    if (filled) path.setAttribute("class", "icon-fill");

    svg.append(path);
  }

  return svg;
}

/**
 * Un botón con icono y, opcionalmente, texto.
 *
 * @param {object} opts
 * @param {string} opts.icon       Nombre del icono.
 * @param {string} opts.label      Texto accesible (y visible si `text`).
 * @param {string} opts.className  Clases del botón.
 * @param {boolean} [opts.text]    Si el texto se ve junto al icono.
 * @param {Function} [opts.onClick]
 */
export function iconButton({ icon: name, label, className, text = false, onClick }) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = className;
  button.setAttribute("aria-label", label);
  button.title = label;
  button.append(icon(name));

  if (text) {
    const span = document.createElement("span");
    span.textContent = label;
    button.append(span);
  }

  if (onClick) button.addEventListener("click", (event) => onClick(event, button));
  return button;
}
