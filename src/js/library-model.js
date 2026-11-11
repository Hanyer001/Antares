import { TrackFilter, group_list_indices } from "./rust-core.js";

const filter = new TrackFilter();

export function filterTracks(tracks, query) {
  query = String(query ?? "");
  if (!query.trim()) return tracks.slice();
  const text = tracks.map(({ title, uploader }) => ({ title, uploader }));
  return Array.from(filter.filter(JSON.stringify(text), query), index => tracks[index]);
}

export function groupLists(lists, query = "", folder = "") {
  const order = lists.map(({ name, description, folder, pinned, system, updated_at }) => ({
    name, description, folder, pinned: Boolean(pinned), system: Boolean(system), updated_at,
  }));
  return Array.from(group_list_indices(JSON.stringify(order), String(query ?? ""), folder), index => lists[index]);
}
