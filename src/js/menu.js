// Menú contextual anclado a un botón, sin desplazar el contenido de la vista.

import { icon } from "./icons.js";

/** Menú abierto: `{ menu, anchor, cleanup }`, o null. */
let current = null;

/** Separación con los bordes de la ventana y con el botón. */
const MARGIN = 8;
const GAP = 4;

/**
 * Abre un menú bajo el botón, o sobre él si abajo no cabe. Si ese mismo botón
 * ya tenía el menú abierto, lo cierra: el botón funciona como interruptor.
 *
 * @param {HTMLElement} anchor
 * @param {Array} items  `{ label, onSelect, danger?, checked?, hint? }`,
 *        `{ heading }` o `"sep"`. `checked` pone una marca delante (la lista
 *        ya tiene esa canción) y `hint` un texto tenue al final.
 */
export function openMenu(anchor, items) {
  const wasOpenHere = current?.anchor === anchor;
  closeMenu();
  if (wasOpenHere) return;

  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "menu");

  for (const item of items) {
    if (item === "sep") {
      const sep = document.createElement("div");
      sep.className = "menu__sep";
      menu.append(sep);
      continue;
    }

    if (item.heading) {
      const heading = document.createElement("div");
      heading.className = "menu__heading";
      heading.textContent = item.heading;
      menu.append(heading);
      continue;
    }

    const button = document.createElement("button");
    button.type = "button";
    button.className =
      "menu__item" + (item.danger ? " menu__item--danger" : "") + (item.checked ? " menu__item--checked" : "");
    button.setAttribute("role", "menuitem");
    button.title = item.hint ? `${item.label} · ${item.hint}` : item.label;

    if (item.checked !== undefined) {
      const mark = document.createElement("span");
      mark.className = "menu__check";
      if (item.checked) mark.append(icon("check"));
      button.append(mark);
    }

    const label = document.createElement("span");
    label.className = "menu__label";
    label.textContent = item.label;
    button.append(label);

    if (item.hint) {
      const hint = document.createElement("span");
      hint.className = "menu__hint";
      hint.textContent = item.hint;
      button.append(hint);
    }

    button.addEventListener("click", () => {
      closeMenu();
      item.onSelect();
    });

    menu.append(button);
  }

  const mobile = document.documentElement.dataset.platform === "android";
  const backdrop = mobile ? document.createElement("div") : null;
  if (backdrop) {
    backdrop.className = "mobile-menu-backdrop";
    backdrop.setAttribute("aria-hidden", "true"); document.body.append(backdrop);
  }
  document.body.append(menu);
  if (!mobile) place(menu, anchor);

  const buttons = [...menu.querySelectorAll(".menu__item")];
  buttons[0]?.focus();

  const onPointerDown = (event) => {
    // El propio botón se deja pasar: su clic ya alterna el menú.
    if (!menu.contains(event.target) && !anchor.contains(event.target)) {
      if (mobile) { event.preventDefault(); event.stopPropagation(); }
      closeMenu();
    }
  };

  const onKeyDown = (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      closeMenu();
      anchor.focus();
      return;
    }

    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    event.preventDefault();

    const at = buttons.indexOf(document.activeElement);
    const step = event.key === "ArrowDown" ? 1 : -1;
    buttons[(at + step + buttons.length) % buttons.length]?.focus();
  };

  // Un menú anclado que se queda quieto mientras su fila se desplaza queda
  // señalando a otra cosa: mejor cerrarlo.
  const onScroll = (event) => {
    if (!menu.contains(event.target)) closeMenu();
  };

  document.addEventListener("pointerdown", onPointerDown, true);
  menu.addEventListener("keydown", onKeyDown);
  document.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", closeMenu);

  anchor.setAttribute("aria-expanded", "true");
  anchor.classList.add("is-open");

  current = {
    menu,
    anchor,
    cleanup: () => {
      backdrop?.remove();
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", closeMenu);
    },
  };
}

export function closeMenu() {
  if (!current) return;

  const { menu, anchor, cleanup } = current;
  current = null;

  cleanup();
  menu.remove();
  anchor.setAttribute("aria-expanded", "false");
  anchor.classList.remove("is-open");
}

export function isMenuOpen() {
  return current !== null;
}

/** Alineado al borde derecho del botón, dentro de la ventana. */
function place(menu, anchor) {
  const a = anchor.getBoundingClientRect();
  const m = menu.getBoundingClientRect();

  let left = a.right - m.width;
  left = Math.min(left, window.innerWidth - m.width - MARGIN);
  left = Math.max(left, MARGIN);

  let top = a.bottom + GAP;
  if (top + m.height > window.innerHeight - MARGIN) {
    top = Math.max(MARGIN, a.top - m.height - GAP);
  }

  menu.style.left = `${left}px`;
  menu.style.top = `${top}px`;
}
