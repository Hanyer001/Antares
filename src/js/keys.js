// Normaliza atajos como "Ctrl+Alt+KeyL". Usa KeyboardEvent.code para conservar
// la tecla física entre distribuciones y coincidir con los atajos de Tauri.

const MODIFIERS = ["Ctrl", "Alt", "Shift", "Super"];

/** Teclas que solas no son un atajo: son la mitad de uno. */
const MODIFIER_CODES = new Set([
  "ControlLeft", "ControlRight", "AltLeft", "AltRight",
  "ShiftLeft", "ShiftRight", "MetaLeft", "MetaRight", "OSLeft", "OSRight",
]);

/**
 * La combinación de una pulsación, o null si solo se pulsó un modificador
 * (todavía no ha terminado).
 */
export function comboFromEvent(event) {
  if (MODIFIER_CODES.has(event.code) || !event.code) return null;

  const mods = [];
  if (event.ctrlKey) mods.push("Ctrl");
  if (event.altKey) mods.push("Alt");
  if (event.shiftKey) mods.push("Shift");
  if (event.metaKey) mods.push("Super");
  return [...mods, event.code].join("+");
}

/** Si una pulsación es exactamente esa combinación. */
export function matches(event, combo) {
  return Boolean(combo) && comboFromEvent(event) === combo;
}

/** Si la combinación lleva Ctrl, Alt o Super (lo que exige un atajo global). */
export function hasModifier(combo) {
  return combo.split("+").some((part) => part === "Ctrl" || part === "Alt" || part === "Super");
}

const KEY_LABELS = {
  Space: "Espacio",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Enter: "Intro",
  Backspace: "Retroceso",
  Delete: "Supr",
  Escape: "Esc",
  PageUp: "RePág",
  PageDown: "AvPág",
  Home: "Inicio",
  End: "Fin",
  Insert: "Insert",
  Tab: "Tab",
  Slash: "/",
  Backslash: "\\",
  Minus: "-",
  Equal: "=",
  Comma: ",",
  Period: ".",
  Semicolon: "ñ",
  Quote: "´",
  Backquote: "º",
  BracketLeft: "`",
  BracketRight: "+",
};

const MOD_LABELS = { Ctrl: "Ctrl", Alt: "Alt", Shift: "Mayús", Super: "Win" };

function keyLabel(code) {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad/.test(code)) return `Num ${code.slice(6)}`;
  return code;
}

/** "Ctrl+Alt+ArrowRight" → ["Ctrl", "Alt", "→"], para pintar cada tecla. */
export function comboParts(combo) {
  if (!combo) return [];
  return combo.split("+").map((part) => MOD_LABELS[part] ?? keyLabel(part));
}

/** "Ctrl+Alt+ArrowRight" → "Ctrl + Alt + →". */
export function comboLabel(combo) {
  return combo ? comboParts(combo).join(" + ") : "Sin atajo";
}

/**
 * Las acciones que comparten combinación con otra: `{ acción: otraAcción }`.
 * Un atajo repetido solo haría una de las dos cosas.
 */
export function conflicts(bindings) {
  const byCombo = new Map();
  const clashes = {};

  for (const [action, combo] of Object.entries(bindings)) {
    if (!combo) continue;
    if (byCombo.has(combo)) {
      const other = byCombo.get(combo);
      clashes[action] = other;
      clashes[other] = action;
    } else {
      byCombo.set(combo, action);
    }
  }
  return clashes;
}

export { MODIFIERS };
