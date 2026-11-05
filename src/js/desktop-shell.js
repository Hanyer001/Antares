import { shellLayout } from "./shell-layout.js";
import { enterSurface } from "./motion.js";

let shell = null;
export function refreshDesktopShell() { shell?.refresh(); }
export function openContextPanel(tab, trigger = document.activeElement) { shell?.open(tab, trigger); }

/** Mantiene los paneles en su DOM: cambiar de ancho no reconstruye vistas,
 * listas, letras ni reproductores. El estado abierto es solo de esta sesión. */
export function initDesktopShell({ getLayout, selectTab }) {
  const root = document.documentElement;
  if (shell || root.dataset.platform === "android") return;
  const app = document.querySelector(".app");
  const panel = document.querySelector(".nowplaying");
  const main = document.querySelector(".main");
  const sidebar = document.querySelector(".sidebar");
  const toggle = document.getElementById("context-toggle");
  const close = document.getElementById("context-close");
  const scrim = document.getElementById("context-scrim");
  const bar = document.getElementById("playerbar");
  // Al plegar los textos, los iconos conservan un nombre accesible estable.
  for (const button of sidebar.querySelectorAll(".tab")) {
    if (!button.hasAttribute("aria-label")) button.setAttribute("aria-label", button.title || button.textContent.replace(/\s+/g, " ").trim());
  }
  let dockedVisible = true, drawerOpen = false, modal = false, contextRequested = false;
  let returnTo = toggle, geometry = null;
  const inertBefore = new Map();
  const protectedNodes = [main, sidebar, bar, ...document.querySelectorAll(".resizer")].filter(Boolean);

  function setModal(enabled) {
    if (enabled === modal) return;
    modal = enabled;
    if (enabled) {
      for (const node of protectedNodes) { inertBefore.set(node, node.inert); node.inert = true; }
      panel.setAttribute("role", "dialog");
      panel.setAttribute("aria-modal", "true");
    } else {
      for (const [node, inert] of inertBefore) node.inert = inert;
      inertBefore.clear();
      panel.removeAttribute("role");
      panel.removeAttribute("aria-modal");
    }
  }

  function refresh() {
    const layout = getLayout();
    const next = shellLayout(app.clientWidth, {
      ...layout,
      sidebarWidth: parseFloat(root.style.getPropertyValue("--sidebar-pref")) || layout.sidebarWidth,
      nowplayingWidth: parseFloat(root.style.getPropertyValue("--nowplaying-pref")) || layout.nowplayingWidth,
    });
    // Durante el arrastre, mantener el tirador bajo el puntero. Al soltar se
    // vuelve a decidir si cabe el panel, con la preferencia ya actualizada.
    if (root.classList.contains("is-resizing") && geometry) next.docked = geometry.docked;
    geometry = next;
    const special = root.hasAttribute("data-focus") || root.hasAttribute("data-mini");
    const overlay = !geometry.docked && !special;
    const visible = special || (geometry.docked ? dockedVisible : drawerOpen);
    const focusedInside = panel.contains(document.activeElement);
    root.dataset.shell = geometry.docked ? "docked" : "overlay";
    root.dataset.shellNav = geometry.icons ? "icons" : "full";
    root.toggleAttribute("data-context-open", visible && !special);
    root.toggleAttribute("data-context-requested", contextRequested && visible && !special);
    root.style.setProperty("--shell-navigation", `${geometry.navigation}px`);
    root.style.setProperty("--shell-context", `${geometry.context}px`);
    setModal(overlay && visible);
    panel.hidden = !visible;
    toggle.setAttribute("aria-expanded", String(visible && !special));
    toggle.classList.toggle("is-active", visible && !special);
    toggle.setAttribute("aria-label", visible && !special ? "Ocultar reproducción, cola y letras" : "Mostrar reproducción, cola y letras");
    scrim.hidden = !(overlay && visible);
    if (!visible && focusedInside) toggle.focus({ preventScroll: true });
    if (modal && (!panel.contains(document.activeElement) || !document.activeElement.getClientRects().length)) close.focus({ preventScroll: true });
  }

  function closePanel() {
    contextRequested = false;
    if (geometry.docked) dockedVisible = false;
    else drawerOpen = false;
    refresh();
    const target = returnTo?.isConnected && !returnTo.closest("[inert]") ? returnTo : toggle;
    target.focus({ preventScroll: true });
  }

  function open(tab, trigger) {
    const wasVisible = root.hasAttribute('data-context-open');
    contextRequested = true;
    if (tab) selectTab(tab);
    returnTo = trigger?.isConnected ? trigger : toggle;
    if (geometry.docked) dockedVisible = true;
    else drawerOpen = true;
    refresh();
    if (!wasVisible && modal) enterSurface(panel, 'panel');
    if (modal) close.focus({ preventScroll: true });
  }

  toggle.addEventListener("click", () => {
    if (geometry.docked ? dockedVisible : drawerOpen) closePanel();
    else open(null, toggle);
  });
  close.addEventListener("click", closePanel);
  scrim.addEventListener("click", closePanel);
  document.getElementById("upnext-more").addEventListener("click", () => {
    if (modal) closePanel();
  });
  // Las pestañas permiten flechas, Inicio y Fin sin añadir dos paradas de Tab.
  const tabs = [...panel.querySelectorAll('.side-tab[role="tab"]')];
  for (const tab of tabs) tab.addEventListener("keydown", event => {
    const index = tabs.indexOf(tab);
    const next = { ArrowRight: (index + 1) % tabs.length, ArrowLeft: (index + tabs.length - 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    tabs[next].focus();
    tabs[next].click();
  });
  document.addEventListener("keydown", event => {
    if (!modal || event.target.closest?.('.menu, dialog[open]')) return;
    if (event.key === "Escape") {
      event.preventDefault(); event.stopImmediatePropagation(); closePanel(); return;
    }
    if (event.key !== "Tab") return;
    const nodes = [...panel.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
      .filter(node => node.tabIndex >= 0 && node.getClientRects().length && !node.closest("[hidden], [inert]"));
    const first = nodes[0], last = nodes.at(-1);
    if ((event.shiftKey && document.activeElement === first) || (!event.shiftKey && document.activeElement === last) || !panel.contains(document.activeElement)) {
      event.preventDefault(); (event.shiftKey ? last : first)?.focus();
    }
  }, true);

  shell = { refresh, open };
  new ResizeObserver(refresh).observe(app);
  refresh();
}
