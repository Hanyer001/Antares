// Pruebas de qué se pegó en "Importar una lista" (importlist.js, sin DOM).
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, serviceName, isPlaylistLink, importSummary } from "../src/js/importlist.js";

test("un enlace suelto es un enlace; varias líneas son canciones", () => {
  assert.deepEqual(classify("  https://open.spotify.com/playlist/37i9dQ?si=1 "), {
    url: "https://open.spotify.com/playlist/37i9dQ?si=1",
  });
  assert.deepEqual(classify("spotify:playlist:37i9dQ"), { url: "spotify:playlist:37i9dQ" });
  assert.deepEqual(classify("Radiohead - Creep\nOasis - Wonderwall"), {
    text: "Radiohead - Creep\nOasis - Wonderwall",
  });
  // Una sola canción escrita a mano también vale.
  assert.deepEqual(classify("Radiohead - Creep"), { text: "Radiohead - Creep" });
  assert.equal(classify("   "), null);
});

test("de qué app es cada enlace", () => {
  assert.equal(serviceName("https://open.spotify.com/album/x"), "Spotify");
  assert.equal(serviceName("https://link.deezer.com/s/x"), "Deezer");
  assert.equal(serviceName("https://music.apple.com/cl/playlist/x"), "Apple Music");
  assert.equal(serviceName("https://music.youtube.com/playlist?list=x"), "YouTube Music");
  assert.equal(serviceName("https://www.youtube.com/playlist?list=x"), "YouTube");
  assert.equal(serviceName("https://example.com/x"), null);
});

test("enlaces de compartir, URI y enlaces sin protocolo mantienen su servicio", () => {
  for (const [link, service] of [
    ["open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc", "Spotify"],
    ["https://spoti.fi/example", "Spotify"],
    ["https://spotify.link/example", "Spotify"],
    ["https://deezer.page.link/example", "Deezer"],
    ["https://link.deezer.com/s/example", "Deezer"],
    ["music.apple.com/cl/playlist/mix/pl.u-abc", "Apple Music"],
    ["https://embed.music.apple.com/us/album/example/123", "Apple Music"],
    ["SPOTIFY:playlist:37i9dQZF1DXcBWIGoYBM5M", "Spotify"],
  ]) {
    assert.equal(serviceName(link), service, link);
    assert.equal(isPlaylistLink(link), true, link);
  }
  assert.deepEqual(classify("open.spotify.com/playlist/abc"), { url: "https://open.spotify.com/playlist/abc" });
  assert.deepEqual(classify("Radiohead - Spotify Sessions"), { text: "Radiohead - Spotify Sessions" });
});

test("solo las colecciones se desvían al importador, conservando enlaces de canciones", () => {
  assert.equal(isPlaylistLink("https://music.youtube.com/playlist?list=PLabc"), true);
  assert.equal(isPlaylistLink("https://www.youtube.com/watch?v=123&list=PLabc"), true);
  assert.equal(isPlaylistLink("spotify:user:example:playlist:37i9dQZF1DXcBWIGoYBM5M"), true);
  for (const value of [
    "https://www.youtube.com/watch?v=123", "https://youtu.be/123",
    "https://open.spotify.com/track/abc", "spotify:track:abc",
    "https://music.apple.com/us/artist/example/123", "https://www.deezer.com/track/123",
    "Radiohead - Creep", "https://example.com/?list=abc",
    "https://open.spotify.com/playlist/abc\nRadiohead - Creep",
  ]) assert.equal(isPlaylistLink(value), false, value);
});

test("el servicio se reconoce por el host, no por texto ajeno en la URL", () => {
  for (const link of [
    "https://example.com/spotify/playlist/abc", "https://spotify.com.example.com/playlist/abc",
    "https://open.spotify.com@example.com/playlist/abc", "https://example.com/?next=https://deezer.com/playlist/123",
    "file://music.apple.com/us/playlist/x/pl.abc", "https://music.apple.com.example.com/us/playlist/x/pl.abc",
  ]) {
    assert.equal(serviceName(link), null, link);
    assert.equal(isPlaylistLink(link), false, link);
  }
});

test("la importación muestra el total de origen aunque se supere la primera página", () => {
  assert.equal(importSummary({name:"Más de 100",count:205,source_count:205,duplicates:0,missing:[]}),
    "Importada «Más de 100» · 205 de 205 canciones");
  assert.equal(importSummary({name:"Mi lista",count:200,source_count:205,duplicates:2,missing:["A","B","C"]}),
    "Importada «Mi lista» · 200 de 205 canciones · 3 sin encontrar · 2 repetidas");
  assert.equal(importSummary({name:"Anterior",count:12,missing:[]}),
    "Importada «Anterior» · 12 de 12 canciones");
});
