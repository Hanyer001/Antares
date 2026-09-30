// Convierte el volumen (0..1) a ganancia con una curva cúbica.
// Referencias: 100 % = 0 dB, 50 % ≈ −18 dB, 20 % ≈ −42 dB, 0 % = silencio.

/** @param {number} level 0..1, lo que marca el deslizador. */
export function gainFor(level) {
  const v = Math.min(Math.max(Number(level) || 0, 0), 1);
  return v ** 3;
}
