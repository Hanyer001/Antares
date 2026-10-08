// Diseños visuales: solo apariencia, sin modificar música, listas ni ahorro.
export const DESIGNS = [
  { id: "minimal", name: "Minimal", description: "Negro, acento suave y espacio limpio",
    appearance: { theme: "oled", accentColor: "#b8c2d2", density: "normal", corners: "soft", font: "inter" } },
  { id: "midnight", name: "Medianoche", description: "Azul profundo y controles amplios",
    appearance: { theme: "midnight", accentColor: "#b59ae6", density: "comfortable", corners: "soft", font: "inter" } },
  { id: "mint", name: "Menta", description: "Verdes tranquilos y formas redondeadas",
    appearance: { theme: "custom", custom: { bg: "#0b1714", surface: "#152720", text: "#e5f2ec" },
      accentColor: "#7fc8a9", density: "normal", corners: "round", font: "inter" } },
  { id: "light", name: "Claro", description: "Fondos claros y lectura cómoda",
    appearance: { theme: "light", accentColor: "#477ab3", density: "comfortable", corners: "soft", font: "system" } },
];

/** Compatibilidad con ajustes y perfiles antiguos de Android. */
export function mobileAppearance(appearance) {
  return { ...appearance,
    theme: appearance.theme === "artwork" ? "dark" : appearance.theme,
    accentMode: appearance.accentMode === "artwork" ? "fixed" : appearance.accentMode,
    background: appearance.background === "artwork" ? "plain" : appearance.background,
  };
}

export function applyDesign(appearance, id) {
  const design = DESIGNS.find(d => d.id === id);
  if (!design) return structuredClone(appearance);
  return { ...structuredClone(appearance), ...structuredClone(design.appearance),
    accentMode: "fixed", background: "plain" };
}

/** Identificar el aspecto real; un retoque manual deja de marcarlo como aplicado. */
export function matchingDesign(appearance) {
  return DESIGNS.find(design => {
    const expected = applyDesign(appearance, design.id);
    return [...Object.keys(design.appearance), "accentMode", "background"]
      .every(key => JSON.stringify(appearance[key]) === JSON.stringify(expected[key]));
  })?.id ?? null;
}
