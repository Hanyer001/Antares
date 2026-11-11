import { matches_search_query, rank_search } from "./rust-core.js";

export function matchesQuery(title, query) {
  return matches_search_query(title ?? "", query ?? "");
}

export function rankSearch(videos, songs, query) {
  const all = [...(videos ?? []), ...(songs ?? [])];
  const { order, artist, split } = JSON.parse(rank_search(
    JSON.stringify(videos ?? []), JSON.stringify(songs ?? []), query ?? "",
  ));
  return { tracks: order.map(index => all[index]), artist, split };
}
