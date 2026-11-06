import { icon } from "./shared/icons.js";

/** Usa la navegación inferior de Antares para los flujos disponibles en web. */
export function initMobileShell() {
  const buttons = [...document.querySelectorAll(".mobile-navigation button")];
  const panels = {
    search: document.getElementById("query"),
    queue: document.getElementById("queue-title"),
    player: document.getElementById("play-toggle"),
  };
  const icons = { search: "search", queue: "list", player: "music" };
  for (const button of buttons) {
    const view = button.dataset.view;
    button.prepend(icon(icons[view]));
    button.addEventListener("click", () => {
      document.documentElement.dataset.view = view;
      for (const item of buttons) item.removeAttribute("aria-current");
      button.setAttribute("aria-current", "page");
      if (view === "search") panels.search.focus({ preventScroll: true });
      else panels[view].scrollIntoView({ block: "nearest" });
    });
  }
}
