// Diálogos de texto y confirmación. showModal() gestiona el foco, Escape
// y el bloqueo del contenido de fondo.

import { els } from "./dom.js";

/** La petición en curso: `{ input, resolve }`, o null. */
let pending = null;

function open({
  title,
  text = "",
  input = false,
  value = "",
  placeholder = "",
  confirmLabel = "Aceptar",
  cancelLabel = "Cancelar",
  danger = false,
}) {
  // Si había otro abierto (no debería), se da por cancelado.
  if (pending) els.dialog.close();

  els.dialogTitle.textContent = title;
  els.dialogText.textContent = text;
  els.dialogCancel.textContent = cancelLabel;

  els.dialogInput.hidden = !input;
  els.dialogInput.value = value;
  els.dialogInput.placeholder = placeholder;

  els.dialogOk.textContent = confirmLabel;
  els.dialogOk.classList.toggle("btn--danger-solid", danger);
  els.dialogOk.disabled = input && !value.trim();

  els.dialog.returnValue = "";
  els.dialog.showModal();

  if (input) {
    els.dialogInput.focus();
    els.dialogInput.select();
  } else {
    els.dialogOk.focus();
  }

  return new Promise((resolve) => {
    pending = { input, resolve };
  });
}

/**
 * Pide un texto.
 * @returns {Promise<string|null>} El texto sin espacios en los extremos, o null si se canceló.
 */
export function ask(options) {
  return open({ ...options, input: true });
}

/**
 * Pide confirmación.
 * @returns {Promise<boolean>}
 */
export function confirmAction(options) {
  return open({ ...options, input: false });
}

export function isOpen() {
  return els.dialog.open;
}

export function initDialog() {
  // Aceptar sin texto no tiene sentido: el botón se apaga en vez de dejar que
  // Rust devuelva un error después.
  els.dialogInput.addEventListener("input", () => {
    els.dialogOk.disabled = !els.dialogInput.value.trim();
  });

  els.dialogCancel.addEventListener("click", () => els.dialog.close("cancel"));

  // Clic en el fondo oscuro: el propio <dialog> recibe el clic fuera de la caja.
  els.dialog.addEventListener("click", (event) => {
    if (event.target === els.dialog) els.dialog.close("cancel");
  });

  // `method="dialog"` cierra solo al enviar, con el `value` del botón; Escape
  // cierra con `returnValue` vacío. Las dos rutas acaban aquí.
  els.dialog.addEventListener("close", () => {
    if (!pending) return;

    const { input, resolve } = pending;
    pending = null;

    const accepted = els.dialog.returnValue === "ok";

    if (input) resolve(accepted ? els.dialogInput.value.trim() || null : null);
    else resolve(accepted);
  });
}
