// Gestión de perfiles de ajustes y usuarios.
// Los perfiles se aplican al vuelo; cambiar de usuario reinicia la app
// para cargar su historial, biblioteca y preferencias.

import * as dialog from "./dialog.js";
import { els } from "./dom.js";
import { friendlyError } from "./format.js";
import { openMenu } from "./menu.js";
import * as prefs from "./prefs.js";
import * as user from "./user.js";

const handlers = {
  say: () => {},
  /** Antes de reiniciar por cambio de usuario: guardar la sesión y los ajustes. */
  beforeSwitch: async () => {},
  openSettings: () => {},
};

function initial(name) {
  return (name.trim()[0] ?? "?").toUpperCase();
}

function activeProfileName() {
  const id = prefs.activeProfileId();
  return prefs.listProfiles().find((p) => p.id === id)?.name ?? "";
}

// --- Botón de la barra lateral -------------------------------------------

function renderButton() {
  const me = user.currentUser();
  els.peopleAvatar.textContent = initial(me.name);
  els.peopleName.textContent = me.name;
  const profile = activeProfileName();
  els.peopleProfile.textContent = profile ? `Perfil: ${profile}` : "";
  els.peopleButton.title = profile ? `${me.name} · perfil «${profile}»` : me.name;
}

function openPeopleMenu() {
  const active = prefs.activeProfileId();
  const profiles = prefs.listProfiles();
  const others = user.users();

  openMenu(els.peopleButton, [
    { heading: "Perfil" },
    ...profiles.map((p) => ({
      label: `${p.id === active ? "✓ " : ""}${p.name}`,
      onSelect: () => useProfile(p.id),
    })),
    { label: "Guardar lo de ahora como perfil…", onSelect: newProfile },
    "sep",
    { heading: "Usuario" },
    ...others.map((u) => ({
      label: `${u.id === user.currentId() ? "✓ " : ""}${u.name}`,
      onSelect: () => (u.id === user.currentId() ? null : switchUser(u)),
    })),
    { label: "Añadir usuario…", onSelect: newUser },
    "sep",
    { label: "Gestionar perfiles y usuarios…", onSelect: () => handlers.openSettings() },
  ]);
}

// --- Perfiles ------------------------------------------------------------

function useProfile(id) {
  prefs.applyProfile(id);
  handlers.say(`Perfil «${activeProfileName()}» puesto.`);
}

async function newProfile() {
  const name = await dialog.ask({
    title: "Guardar como perfil",
    text: "Guarda cómo está todo ahora: aspecto, diseño, Inicio, sonido, recomendaciones y reproducción.",
    placeholder: "Nombre del perfil (p. ej. Trabajo)",
    confirmLabel: "Guardar",
  });
  if (!name) return;

  try {
    prefs.saveProfile(name);
    handlers.say(`Perfil «${name.trim()}» guardado.`);
  } catch (error) {
    handlers.say(error.message, "error");
  }
}

async function renameProfile(profile) {
  const name = await dialog.ask({ title: "Renombrar perfil", value: profile.name, confirmLabel: "Guardar" });
  if (name) prefs.renameProfile(profile.id, name);
}

async function deleteProfile(profile) {
  const ok = await dialog.confirmAction({
    title: `¿Borrar el perfil «${profile.name}»?`,
    text: "Los ajustes de ahora se quedan como están; solo se borra el perfil.",
    confirmLabel: "Borrar",
    danger: true,
  });
  if (ok) prefs.deleteProfile(profile.id);
}

function button(label, onClick, { danger = false, title = label } = {}) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = `btn btn--mini${danger ? " btn--danger" : ""}`;
  b.textContent = label;
  b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

function row(name, badge, actions, avatar = null) {
  const li = document.createElement("li");
  li.className = "people__item";

  const who = document.createElement("span");
  who.className = "people__name";
  if (avatar) {
    const a = document.createElement("span");
    a.className = "avatar";
    a.textContent = avatar;
    who.append(a);
  }
  who.append(name);
  if (badge) {
    const b = document.createElement("span");
    b.className = "people__badge";
    b.textContent = badge;
    who.append(b);
  }

  const wrap = document.createElement("span");
  wrap.className = "setting__actions";
  wrap.append(...actions);

  li.append(who, wrap);
  return li;
}

function renderProfiles() {
  const active = prefs.activeProfileId();
  const list = prefs.listProfiles();

  if (list.length === 0) {
    const empty = document.createElement("li");
    empty.className = "people__empty";
    empty.textContent = "Aún no hay perfiles. Deja todo como te guste y guárdalo con un nombre.";
    els.profileList.replaceChildren(empty);
    return;
  }

  els.profileList.replaceChildren(
    ...list.map((p) =>
      row(p.name, p.id === active ? "En uso" : "", [
        button("Usar", () => useProfile(p.id)),
        button("Actualizar", () => {
          prefs.updateProfile(p.id);
          handlers.say(`Perfil «${p.name}» actualizado con los ajustes de ahora.`);
        }, { title: "Guardar en este perfil los ajustes de ahora" }),
        button("Renombrar", () => renameProfile(p)),
        button("Borrar", () => deleteProfile(p), { danger: true }),
      ]),
    ),
  );
}

// --- Usuarios ------------------------------------------------------------

async function switchUser(target) {
  const ok = await dialog.confirmAction({
    title: `¿Cambiar a «${target.name}»?`,
    text: "La app se reinicia con su historial, sus listas y sus ajustes. Lo que suena ahora se guarda para cuando vuelvas.",
    confirmLabel: "Cambiar",
  });
  if (!ok) return;

  await handlers.beforeSwitch();
  try {
    await user.switchTo(target.id);
  } catch (error) {
    handlers.say(friendlyError(error, "No se pudo cambiar de usuario."), "error");
  }
}

async function newUser() {
  const name = await dialog.ask({
    title: "Añadir usuario",
    text: "Tendrá su propio historial, sus listas, sus gustos y sus ajustes.",
    placeholder: "Nombre",
    confirmLabel: "Añadir",
  });
  if (!name) return;

  try {
    const state = await user.create(name);
    renderUsers();
    renderButton();
    const created = state.users[state.users.length - 1];
    handlers.say(`Usuario «${created.name}» añadido.`);
    switchUser(created);
  } catch (error) {
    handlers.say(friendlyError(error), "error");
  }
}

async function renameUser(u) {
  const name = await dialog.ask({ title: "Renombrar usuario", value: u.name, confirmLabel: "Guardar" });
  if (!name || name === u.name) return;
  try {
    await user.rename(u.id, name);
    renderUsers();
    renderButton();
  } catch (error) {
    handlers.say(friendlyError(error), "error");
  }
}

async function deleteUser(u) {
  const ok = await dialog.confirmAction({
    title: `¿Borrar a «${u.name}»?`,
    text: "Se borran su historial, sus listas, sus gustos y sus ajustes. No se puede deshacer.",
    confirmLabel: "Borrar",
    danger: true,
  });
  if (!ok) return;

  try {
    await user.remove(u.id);
    // Lo suyo de localStorage, también.
    for (const base of ["antares.session", "antares.look", "antares.wallpaper"]) {
      try {
        localStorage.removeItem(`${base}.${u.id}`);
      } catch {
        // Nada que limpiar.
      }
    }
    renderUsers();
    handlers.say(`Usuario «${u.name}» borrado.`);
  } catch (error) {
    handlers.say(friendlyError(error), "error");
  }
}

function renderUsers() {
  const me = user.currentId();

  els.userList.replaceChildren(
    ...user.users().map((u) => {
      const actions = [];
      if (u.id !== me) actions.push(button("Cambiar", () => switchUser(u)));
      actions.push(button("Renombrar", () => renameUser(u)));
      if (u.id !== me && u.id !== user.MAIN_ID) {
        actions.push(button("Borrar", () => deleteUser(u), { danger: true }));
      }
      return row(u.name, u.id === me ? "Tú" : "", actions, initial(u.name));
    }),
  );
}

// --- Arranque ------------------------------------------------------------

/** `{ say(texto, tono), beforeSwitch(), openSettings() }` */
export function initPeople(callbacks) {
  Object.assign(handlers, callbacks);

  renderButton();
  renderProfiles();
  renderUsers();

  prefs.onProfiles(() => {
    renderProfiles();
    renderButton();
  });

  els.peopleButton.addEventListener("click", openPeopleMenu);
  els.profileNew.addEventListener("click", newProfile);
  els.userNew.addEventListener("click", newUser);
}
