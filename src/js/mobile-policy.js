// Decisiones puras compartidas por la UI y sus pruebas.
export function queuePayload(items, currentId, repeat = "off") {
  const seen = new Set();
  const tracks = items.filter(t => /^[\w-]{11}$/.test(t?.id ?? "") && !seen.has(t.id) && seen.add(t.id));
  if (!tracks.some(t => t.id === currentId)) return null;
  return { currentId, repeat: ["off","all","one"].includes(repeat) ? repeat : "off",
    items: tracks.map(({id,title,uploader,duration}) => ({id,title,uploader,duration})) };
}
export function primaryTabs(order, hidden, active) {
  const visible = order.filter(id => !hidden.includes(id));
  const primary = visible.slice(0, 4);
  if (visible.includes(active) && !primary.includes(active)) primary[3] = active;
  return primary;
}
