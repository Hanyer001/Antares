// Un elemento que pasa bajo el ratón al hacer scroll no expresa intención de
// reproducir. Solo el movimiento del puntero prepara una canción; rueda y
// desplazamiento cancelan la tarea, sin reiniciarla al quedarse quieto.
export function createHoverPrefetch({document: doc = globalThis.document, setTimer = setTimeout, clearTimer = clearTimeout} = {}) {
  let timer = null, pending = null;
  const cancel = () => { clearTimer(timer); timer = null; pending = null; };
  for (const name of ['wheel', 'scroll']) doc.addEventListener(name, cancel, {capture:true, passive:true});
  doc.defaultView?.addEventListener('blur', cancel);
  return {
    cancel,
    bind(element, callback, delay = 400) {
      element.addEventListener('pointermove', event => {
        if (event.pointerType === 'touch' || doc.documentElement.dataset.platform === 'android' || element.closest('.is-scrolling')) return;
        cancel(); pending = element;
        timer = setTimer(() => {
          timer = null;
          if (pending === element && element.isConnected && !doc.hidden) callback();
          pending = null;
        }, delay);
      });
      element.addEventListener('pointerleave', () => { if (pending === element) cancel(); });
    },
  };
}

const bound = new WeakSet();
export function bindScrollFeedback(element) {
  if (bound.has(element)) return;
  bound.add(element);
  let timer;
  const active = () => {
    if (!element.classList.contains('is-scrolling')) element.classList.add('is-scrolling');
    clearTimeout(timer);
    timer = setTimeout(() => element.classList.remove('is-scrolling'), 160);
  };
  for (const name of ['wheel', 'scroll']) element.addEventListener(name, active, {capture:true, passive:true});
}
