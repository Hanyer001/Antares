/** Intercala listas largas con fotogramas y descarta trabajos de una vista anterior. */
export function createBatchRenderer({ schedule = requestAnimationFrame, cancel = cancelAnimationFrame } = {}) {
  let generation = 0, frame = null;
  function stop() { generation++; if (frame !== null) cancel(frame); frame = null; }
  return {
    stop,
    render(items, append, { size = 60, progress = () => {} } = {}) {
      stop(); const current = generation; let position = 0;
      const draw = () => {
        frame = null;
        if (current !== generation) return;
        const start = position; position = Math.min(items.length, start + size);
        append(items.slice(start, position), start);
        if (current !== generation) return;
        progress(position, items.length);
        if (position < items.length) frame = schedule(draw);
      };
      draw();
    },
  };
}
