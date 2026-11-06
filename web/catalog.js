import { createCatalogClient } from "./shared/catalog-client.js";

export function createWebCatalog(request) {
  const paths = {
    artist_page: ({ id }) => `v1/artists/${encodeURIComponent(id)}`,
    artist_songs: ({ id }) => `v1/artists/${encodeURIComponent(id)}/songs`,
    album_page: ({ id }) => `v1/albums/${encodeURIComponent(id)}`,
    youtube_list: ({ id }) => `v1/collections/${encodeURIComponent(id)}`,
    artist_for_query: ({ query }) => `v1/artist?${new URLSearchParams({ q: query })}`,
    search_songs: ({ query }) => `v1/songs?${new URLSearchParams({ q: query })}`,
    shelf_more: ({ browseId, params }) => `v1/shelves/${encodeURIComponent(browseId)}?${new URLSearchParams(params ? { params } : {})}`,
  };
  return createCatalogClient((command, args) => request(paths[command](args)));
}

export function collectionId(input) {
  let url;
  try { url = new URL(input); } catch { return null; }
  const hosts = ["youtube.com", "www.youtube.com", "m.youtube.com", "music.youtube.com", "youtu.be"];
  if (!["http:", "https:"].includes(url.protocol) || !hosts.includes(url.hostname)) return null;
  const id = url.searchParams.get("list");
  return /^[-\w]{1,128}$/.test(id ?? "") ? id : null;
}

export function createCatalogView(section, catalog, { makeTrack, play, error }) {
  const title = section.querySelector("h2");
  const tracks = section.querySelector("ul");
  const shelves = section.querySelector(".catalog-shelves");
  const actions = section.querySelector(".catalog-actions");
  const back = section.querySelector("#catalog-back");
  const stack = [];
  let generation = 0;

  function button(label, onClick) {
    const node = document.createElement("button");
    node.type = "button";
    node.textContent = label;
    node.addEventListener("click", onClick);
    return node;
  }

  function render(entry) {
    const { type, page } = entry;
    title.textContent = page.name ?? page.title ?? "Colección de YouTube";
    const songs = type === "artist" ? (page.songs ?? []).slice(0, 5) : page.tracks ?? [];
    tracks.replaceChildren(...songs.map((track, index) =>
      makeTrack(track, () => play(songs, index, { ordered: true }))));
    actions.replaceChildren();
    shelves.replaceChildren();
    if (songs.length) actions.append(
      button("Reproducir", () => play(songs, 0, { ordered: true })),
      button("Aleatorio", () => play(songs, 0, { shuffle: true })),
    );
    if (type === "artist") actions.append(button("Solo este artista", async event => {
      const current = generation;
      const action = event.currentTarget;
      action.disabled = true;
      try {
        const complete = await catalog.fetchArtistSongs(page.id);
        if (current === generation && complete.length) play(complete, 0, { artistOnly: true, ordered: true });
      } catch (failure) {
        if (current === generation) error(failure);
      } finally { action.disabled = false; }
    }));
    for (const shelf of page.shelves ?? []) {
      const supported = shelf.items.filter(card => ["album", "artist", "playlist", "video"].includes(card.kind));
      if (!supported.length) continue;
      const heading = document.createElement("h3");
      heading.textContent = shelf.title;
      const buttons = document.createElement("div");
      buttons.className = "catalog-actions";
      const cardButton = card => button(card.title, () => {
        if (card.kind === "video") {
          play([{ id: card.id, title: card.title, uploader: page.name ?? card.subtitle,
            thumbnail: card.thumbnail }], 0, { ordered: true });
          return;
        }
        const id = card.kind === "playlist" ? card.playlist_id ?? card.id.replace(/^VL/, "") : card.id;
        open(card.kind === "playlist" ? "list" : card.kind, id);
      });
      for (const card of supported) buttons.append(cardButton(card));
      if (shelf.more) {
        const more = button("Ver todo", async () => {
          const { browse_id: id, params } = shelf.more;
          if (id.startsWith("VL")) { open("list", id.slice(2)); return; }
          const current = generation;
          more.disabled = true;
          try {
            const cards = await catalog.fetchMore(id, params);
            if (current !== generation) return;
            buttons.replaceChildren(...cards.map(cardButton));
            more.remove();
          } catch (failure) { if (current === generation) error(failure); }
          finally { more.disabled = false; }
        });
        buttons.append(more);
      }
      shelves.append(heading, buttons);
    }
    back.textContent = stack.length > 1 ? "Volver" : "Cerrar catálogo";
    section.hidden = false;
  }

  async function open(type, id) {
    const current = ++generation;
    const load = { artist: catalog.fetchArtist, album: catalog.fetchAlbum, list: catalog.fetchList }[type];
    section.hidden = false;
    title.textContent = "Cargando catálogo…";
    back.textContent = stack.length ? "Volver" : "Cerrar catálogo";
    actions.replaceChildren();
    tracks.replaceChildren();
    shelves.replaceChildren();
    try {
      const page = await load(id);
      if (current !== generation) return;
      const entry = { type, page };
      stack.push(entry);
      render(entry);
    } catch (failure) {
      if (current !== generation) return;
      title.textContent = "Catálogo no disponible";
      error(failure);
    }
  }

  back.addEventListener("click", () => {
    generation++;
    if (!actions.hasChildNodes() && title.textContent === "Cargando catálogo…") {
      const previous = stack.at(-1);
      if (previous) render(previous);
      else section.hidden = true;
      return;
    }
    stack.pop();
    const previous = stack.at(-1);
    if (previous) render(previous);
    else section.hidden = true;
  });
  open.cancel = () => {
    generation++;
    stack.length = 0;
    section.hidden = true;
  };
  return open;
}
