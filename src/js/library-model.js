export function normalize(text) { return String(text ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase(); }
export function filterTracks(tracks, query) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return tracks.filter(t => words.every(word => normalize(`${t.title ?? ""} ${t.uploader ?? ""}`).includes(word)));
}
export function groupLists(lists, query = "", folder = "") {
  const q = normalize(query).trim();
  return lists.filter(l => (!q || normalize(`${l.name} ${l.description || ""} ${l.folder || ""}`).includes(q)) && (!folder || (folder === "__none" ? !l.folder : l.folder === folder)))
    .sort((a,b) => Number(Boolean(b.system))-Number(Boolean(a.system)) || Number(Boolean(b.pinned))-Number(Boolean(a.pinned)) || (a.folder||"").localeCompare(b.folder||"") || b.updated_at-a.updated_at);
}
