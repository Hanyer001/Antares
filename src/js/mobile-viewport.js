export function viewportLayout(innerHeight, viewportHeight, offsetTop = 0) {
  const height = Math.max(1, viewportHeight || innerHeight);
  const inset = Math.max(0, innerHeight - height - offsetTop);
  return { height, keyboard: inset > 120 };
}
export function initMobileViewport() {
  const viewport = window.visualViewport;
  let frame;
  function update() {
    frame = null;
    const layout = viewportLayout(window.innerHeight, viewport?.height, viewport?.offsetTop);
    const root = document.documentElement;
    root.style.setProperty('--mobile-vh', `${layout.height}px`);
    root.toggleAttribute('data-keyboard-open', layout.keyboard);
  }
  const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
  viewport?.addEventListener('resize', schedule);
  viewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  update();
}
