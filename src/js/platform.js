// Único límite entre el contenedor nativo y la aplicación web.
export const WEB = !globalThis.window?.__TAURI__;
export const runtime = WEB
  ? (await import("./web-runtime.js")).runtime
  : window.__TAURI__;
