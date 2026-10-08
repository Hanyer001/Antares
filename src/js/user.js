// Usuario activo y claves de localStorage separadas por usuario.
// Rust selecciona la carpeta de datos; key() separa el estado del WebView.

const { invoke } = window.__TAURI__.core;

/** El usuario de siempre, cuyas claves no llevan sufijo (compatibles con antes). */
export const MAIN_ID = "main";

let state = { current: MAIN_ID, users: [{ id: MAIN_ID, name: "Principal" }] };

export async function initUser() {
  try {
    state = await invoke("get_users");
  } catch (error) {
    console.warn("No se pudo saber el usuario; se usa el principal.", error);
  }

  // Para boot-theme.js, que arranca antes que todo esto.
  try {
    localStorage.setItem("antares.user", state.current);
  } catch {
    // Sin almacenamiento: el arranque usará el tema del principal un instante.
  }
}

export function currentId() {
  return state.current;
}

export function isMain() {
  return state.current === MAIN_ID;
}

export function users() {
  return state.users;
}

export function currentUser() {
  return state.users.find((u) => u.id === state.current) ?? state.users[0];
}

/** Una clave de localStorage propia del usuario actual. */
export function key(base) {
  return isMain() ? base : `${base}.${state.current}`;
}

// --- Cambios -------------------------------------------------------------

async function update(command, args) {
  state = await invoke(command, args);
  return state;
}

export const create = (name) => update("create_user", { name });
export const rename = (id, name) => update("rename_user", { id, name });
export const remove = (id) => update("delete_user", { id });

/** Cambia de usuario: la app se reinicia con los datos del nuevo. */
export function switchTo(id) {
  if (document.documentElement.dataset.platform === "android") {
    return invoke("plugin:player|stop").then(() => invoke("switch_user",{id})).then(() => location.reload());
  }
  return invoke("switch_user", { id });
}
