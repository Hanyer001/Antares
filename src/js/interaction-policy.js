/** Los gestos cortos o verticales nunca cambian una canción. */
export function swipeDirection(dx,dy,width) {
  if (![dx,dy,width].every(Number.isFinite) || width <= 0) return null;
  if (Math.abs(dx) < Math.max(56,Math.min(96,width*.18)) || Math.abs(dx) < Math.abs(dy)*1.8) return null;
  return dx < 0 ? 'next' : 'previous';
}

export function dropPosition(from,target,after,count) {
  if (![from,target,count].every(Number.isInteger) || from<0 || target<0 || from>=count || target>=count) return from;
  let to = target + (after ? 1 : 0);
  if (from < to) to -= 1;
  return Math.max(0,Math.min(count-1,to));
}

export function orderedShelves(order,pinned) {
  const pins = new Set(pinned);
  return [...order.filter(id=>pins.has(id)),...order.filter(id=>!pins.has(id))];
}

/** Deshacer una preferencia puntual conserva cambios posteriores en otras entradas. */
export function undoAddedValue(current,value,wasPresent) {
  return wasPresent ? current : current.filter(item=>item!==value);
}
