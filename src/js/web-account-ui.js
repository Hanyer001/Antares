import { confirmAction } from "./dialog.js";
import { toast } from "./toast.js";
import { discardLibraryChange, librarySyncState, linkAccount, recoveryAvailable, recoveryKey, runtime, syncLibrary } from "./web-runtime.js";

export function initWebAccount({ beforeSwitch, refresh }) {
  const panel = document.getElementById("web-account");
  panel.hidden = false;
  const status = document.getElementById("web-account-status");
  const retry = document.getElementById("web-account-sync");
  const discard = document.getElementById("web-account-discard");
  const exportKey = document.getElementById("web-account-key");
  const enterKey = document.getElementById("web-account-link");
  const dialog = document.getElementById("web-account-dialog");
  const field = dialog.querySelector("input");
  const title = dialog.querySelector("h3");
  const description = dialog.querySelector("p");
  const submit = dialog.querySelector('button[value="ok"]');
  const copy = dialog.querySelector('button[data-copy]');
  const secure = recoveryAvailable();
  exportKey.disabled = enterKey.disabled = !secure;

  function render(state = librarySyncState()) {
    const network = navigator.onLine === false ? "Sin conexión. " : "";
    const pending = state.pending ? `${state.pending} cambio(s) pendientes. ` : "";
    const result = state.blocked ? `Sincronización detenida: ${state.blocked.message}`
      : secure ? "Usa la misma clave en tus otros dispositivos." : "El acceso a la cuenta requiere HTTPS.";
    status.textContent = network + pending + result;
    discard.hidden = !state.blocked;
  }

  async function synchronize() {
    retry.disabled = true;
    try { await syncLibrary(); await refresh(); }
    catch (error) { status.textContent = error.message; }
    finally { retry.disabled = false; }
  }

  exportKey.addEventListener("click", async () => {
    exportKey.disabled = true;
    try {
      field.value = await recoveryKey();
      title.textContent = "Clave de recuperación";
      description.textContent = "Guárdala en tu gestor de contraseñas. Quien tenga esta clave puede abrir tu biblioteca.";
      field.type = "text";
      field.readOnly = true;
      submit.hidden = true;
      copy.hidden = !navigator.clipboard?.writeText;
      dialog.showModal();
      field.select();
      navigator.storage?.persist?.().catch(() => {});
    } catch (error) { toast(error.message, { tone: "error" }); }
    finally { exportKey.disabled = false; }
  });

  copy.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(field.value); toast("Clave copiada."); }
    catch { field.select(); }
  });

  enterKey.addEventListener("click", () => {
    title.textContent = "Abrir otra biblioteca";
    description.textContent = "Guarda primero la clave de esta biblioteca para poder volver a ella. Luego pega la clave del otro dispositivo.";
    field.type = "password";
    field.readOnly = false;
    field.value = "";
    submit.hidden = false;
    copy.hidden = true;
    dialog.returnValue = "";
    dialog.showModal();
    field.focus();
  });

  dialog.addEventListener("close", async () => {
    const key = !field.readOnly && dialog.returnValue === "ok" ? field.value : "";
    field.value = "";
    if (!key) return;
    try {
      if (await linkAccount(key, beforeSwitch)) location.reload();
      else toast("Ya estás usando esta cuenta.");
    } catch (error) { toast(error.message, { tone: "error" }); }
  });

  retry.addEventListener("click", synchronize);
  discard.addEventListener("click", async () => {
    const blocked = librarySyncState().blocked;
    if (!blocked) return;
    if (!await confirmAction({ title: "Descartar este cambio", text: blocked.message, confirmLabel: "Descartar" })) return;
    try { await discardLibraryChange(blocked.key); await refresh(); }
    catch (error) { toast(error.message, { tone: "error" }); }
  });
  runtime.event.listen("library-sync", ({ payload }) => render(payload));
  window.addEventListener("offline", () => render());
  window.addEventListener("online", synchronize);
  let lastRefresh = Date.now();
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !navigator.onLine || Date.now() - lastRefresh < 10_000) return;
    lastRefresh = Date.now();
    synchronize();
  });
  render();
  syncLibrary().then(results => { if (results.size) return refresh(); }).catch(console.warn);
}
