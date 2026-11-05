/** La ventana activa responde a cada evento; en segundo plano basta 1 Hz. */
export function shouldPaintProgress({hidden, focused, time, last}) {
  return !hidden && (focused || time - last >= 1000);
}
