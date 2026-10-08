import * as prefs from "./prefs.js";
import { openMenu } from "./menu.js";
import { primaryTabs } from "./mobile-policy.js";
import { icon } from "./icons.js";
import { currentUser } from "./user.js";
import { openGroup } from "./settings.js";
import { bindMiniSwipe } from "./mobile-interactions.js";

/** Conserva el orden personal; las secciones restantes se abren desde «Más». */
export function initMobile({ openTab, next, previous, canSwipe }) {
  bindMiniSwipe(document.querySelector('.console'),{enabled:canSwipe,next,previous});
  const root = document.documentElement;
  const nav = document.querySelector(".nav");
  const exit = document.querySelector("#mode-exit");
  exit.replaceChildren(icon("back"));
  exit.querySelector("svg").style.transform = "rotate(-90deg)";
  exit.setAttribute("aria-label", "Cerrar reproductor"); exit.title = "Cerrar reproductor";
  const header = document.createElement("header"); header.className = "mobile-header";
  const wordmark = document.createElement("span"); wordmark.className = "mobile-wordmark";
  wordmark.append(icon("spark"), document.createTextNode("ANTARES"));
  const profile = document.createElement("button"); profile.type = "button"; profile.className = "mobile-profile";
  profile.textContent = (currentUser()?.name?.trim()[0] ?? "A").toUpperCase();
  profile.setAttribute("aria-label", "Tu usuario y perfiles");
  profile.addEventListener("click", () => { openTab("settings"); openGroup("people"); });
  header.append(wordmark,profile); document.querySelector(".main").prepend(header);
  const tabs = [...nav.querySelectorAll("[data-tab]")];
  const more = document.createElement("button");
  more.type = "button"; more.className = "tab mobile-more";
  more.innerHTML = '<span aria-hidden="true">•••</span><span>Más</span>';
  more.setAttribute("aria-label","Más secciones y ajustes");
  nav.append(more);
  const search = document.createElement("button");
  search.type = "button"; search.className = "mobile-search-entry";
  search.append(icon("search"), document.createTextNode("Buscar música"));
  search.addEventListener("click", () => { openTab("results"); document.querySelector("#search-input").focus(); });
  document.querySelector("#search-form").after(search);
  document.querySelector("#search-input").placeholder = "Canción, artista o enlace";
  function render() {
    const layout = prefs.get("layout");
    const active = document.querySelector('.sidebar [data-tab][aria-current="page"]')?.dataset.tab;
    root.dataset.mobileTab = active ?? "detail";
    const primary = primaryTabs(layout.tabOrder,layout.hiddenTabs,active);
    for (const tab of tabs) tab.classList.toggle("mobile-overflow", !primary.includes(tab.dataset.tab));
    nav.append(more);
    more.classList.toggle("is-active",active === "settings");
  }
  more.addEventListener("click",() => {
    const hidden = prefs.get("layout.hiddenTabs");
    openMenu(more,[{heading:"Tus secciones"},...tabs.filter(t => !hidden.includes(t.dataset.tab)).map(t => ({
      label:t.textContent.trim(),onSelect:() => openTab(t.dataset.tab)
    })),{label:"Ajustes y personalización",onSelect:() => openTab("settings")}]);
  });
  prefs.on("layout",render);
  new MutationObserver(render).observe(document.querySelector(".sidebar"),{subtree:true,attributes:true,attributeFilter:["aria-current"]});
  function energy() { root.toggleAttribute("data-energy-saver",prefs.get("mobile.energySaver")); }
  energy(); prefs.on("mobile",energy); render();
  const visibility = () => root.toggleAttribute("data-ui-hidden",document.hidden);
  document.addEventListener("visibilitychange",visibility); visibility();
}
