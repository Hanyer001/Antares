import { swipeDirection, dropPosition } from "./interaction-policy.js";

/** Un solo grupo de listeners por lista; la lista solo cambia al soltar. */
export function bindTouchSort(container, { rowSelector, handleSelector, onMove }) {
  let drag = null, frame = null, suppressUntil = 0;
  const clearMarks = () => container.querySelectorAll('.is-drop-before,.is-drop-after').forEach(e => e.classList.remove('is-drop-before','is-drop-after'));
  function finish(commit = false) {
    const state = drag; drag = null;
    if (frame !== null) cancelAnimationFrame(frame); frame = null;
    clearMarks();
    if (!state) return;
    state.row.classList.remove('is-touch-dragging');
    if (state.handle.hasPointerCapture?.(state.pointer)) state.handle.releasePointerCapture(state.pointer);
    if (!state.moved) return;
    suppressUntil = performance.now() + 450;
    if (commit && state.row.isConnected && state.target?.isConnected && state.row !== state.target) {
      onMove(state.row, state.target, state.after);
    }
  }
  function targetAtPointer() {
    if (!drag) return;
    const hit = document.elementFromPoint(drag.x, drag.y)?.closest(rowSelector);
    if (!hit || !container.contains(hit)) { drag.target=null;clearMarks();return; }
    if(hit===drag.row){drag.target=hit;clearMarks();return;}
    const rect = hit.getBoundingClientRect();
    drag.target = hit; drag.after = drag.y > rect.top + rect.height / 2;
    clearMarks(); hit.classList.add(drag.after ? 'is-drop-after' : 'is-drop-before');
  }
  function edgeScroll() {
    frame = null;
    if (!drag || document.hidden || !drag.row.isConnected) return finish();
    const rect = container.getBoundingClientRect();
    const top = Math.max(rect.top, 0), bottom = Math.min(rect.bottom, innerHeight);
    const speed = drag.y < top + 36 ? -10 : drag.y > bottom - 36 ? 10 : 0;
    if (!speed) return;
    const before = container.scrollTop;
    container.scrollTop += speed;
    targetAtPointer();
    if (container.scrollTop !== before) frame = requestAnimationFrame(edgeScroll);
  }
  container.addEventListener('pointerdown', event => {
    if (drag) { finish(); return; }
    const handle = event.target.closest(handleSelector), row = handle?.closest(rowSelector);
    if (!handle || !row || !container.contains(row) || event.button !== 0 || event.isPrimary === false) return;
    drag = {row,handle,pointer:event.pointerId,x:event.clientX,y:event.clientY,startY:event.clientY,moved:false,target:null};
    handle.setPointerCapture(event.pointerId);
  });
  container.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointer) return;
    drag.x = event.clientX; drag.y = event.clientY;
    if (!drag.moved && Math.abs(drag.y - drag.startY) < 8) return;
    drag.moved = true; drag.row.classList.add('is-touch-dragging'); event.preventDefault();
    targetAtPointer();
    if (frame === null) edgeScroll();
  });
  container.addEventListener('pointerup', event => { if (drag?.pointer === event.pointerId) finish(true); });
  for (const name of ['pointercancel','lostpointercapture']) container.addEventListener(name, event => { if (drag?.pointer === event.pointerId) finish(); });
  container.addEventListener('click', event => {
    if (performance.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });
  window.addEventListener('blur', () => finish());
}

export function bindMiniSwipe(console, { enabled, next, previous }) {
  let gesture = null, suppressUntil = 0;
  function finish(commit = false) {
    const state = gesture; gesture = null;
    console.style.removeProperty('--swipe-x'); console.classList.remove('is-swiping');
    if (!state) return;
    if (console.hasPointerCapture?.(state.pointer)) console.releasePointerCapture(state.pointer);
    if (!state.horizontal) return;
    suppressUntil = performance.now() + 450;
    if (commit && enabled()) {
      const direction = swipeDirection(state.dx,state.dy,console.clientWidth);
      if (direction === 'next') next();
      else if (direction === 'previous') previous();
    }
  }
  console.addEventListener('pointerdown', event => {
    if (gesture) { finish(); return; }
    if (!enabled() || event.button !== 0 || event.isPrimary === false || event.target.closest('button,input,a,[role="slider"]')) return;
    gesture = {pointer:event.pointerId,x:event.clientX,y:event.clientY,dx:0,dy:0,horizontal:false};
  });
  console.addEventListener('pointermove', event => {
    if (!gesture || event.pointerId !== gesture.pointer) return;
    gesture.dx = event.clientX - gesture.x; gesture.dy = event.clientY - gesture.y;
    if (!gesture.horizontal) {
      if (Math.abs(gesture.dy) > 12 && Math.abs(gesture.dy) >= Math.abs(gesture.dx)) return finish();
      if (Math.abs(gesture.dx) < 12 || Math.abs(gesture.dx) < Math.abs(gesture.dy)*1.8) return;
      gesture.horizontal = true; console.setPointerCapture(event.pointerId);
    }
    event.preventDefault(); console.classList.add('is-swiping');
    console.style.setProperty('--swipe-x', `${Math.max(-70,Math.min(70,gesture.dx*.4))}px`);
  });
  console.addEventListener('pointerup', event => { if (gesture?.pointer === event.pointerId) finish(true); });
  for (const name of ['pointercancel','lostpointercapture']) console.addEventListener(name, event => { if (gesture?.pointer === event.pointerId) finish(); });
  console.addEventListener('click', event => {
    if (performance.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  document.addEventListener('visibilitychange', () => { if (document.hidden) finish(); });
  window.addEventListener('blur', () => finish());
}

export { dropPosition };
