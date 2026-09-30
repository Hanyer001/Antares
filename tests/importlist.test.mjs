// Pruebas de qué se pegó en "Importar una lista" (importlist.js, sin DOM).
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import { classify, serviceName } from "../src/js/importlist.js";

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
