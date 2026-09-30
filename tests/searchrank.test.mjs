// Pruebas del orden de "Buscar" (searchrank.js, sin DOM ni Tauri).
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import { matchesQuery, rankSearch } from "../src/js/searchrank.js";

// Lo que dio YouTube al buscar "Las mas bonitas son" (la captura del usuario).
const videos = [
  { id: "v1", title: "Anuel AA - Las Mas Bonitas Son P*tas (Video Oficial)", uploader: "Anuel AA" },
  { id: "v2", title: "Anuel AA - Las Mas Bonitas Son P*tas [Audio Oficial]", uploader: "TrapUrbanoTv Music" },
  { id: "v3", title: "LAS BONITAS SON PUT*S RKT - EZE REMIX X @djsnowsok (Viral TikTok)", uploader: "EZE REMIX and DJSNOWS" },
  { id: "v4", title: "La más bonita", uploader: "Camela" },
  { id: "v5", title: "camela- la mas bonita", uploader: "dale_a_tu_cuerpo_alegria_macarena" },
];

// Lo que dio YouTube Music (canciones).
const songs = [
  { id: "s1", title: "Las mas bonitas son p#tas", uploader: "Anuel AA", artists: [{ id: "UCa", name: "Anuel AA" }] },
  { id: "s2", title: "Ponte Bonita", uploader: "Los Dos de Tamaulipas", artists: [{ id: "UCt", name: "Los Dos de Tamaulipas" }] },
  { id: "s3", title: "Las mas bonitas son put4s (Special Version)", uploader: "Agus Mendoza", artists: [{ id: "UCm", name: "Agus Mendoza" }] },
];

test("primero lo del artista (la oficial, su canal, lo suyo subido por otros) y después lo demás", () => {
  const { tracks, artist, split } = rankSearch(videos, songs, "Las mas bonitas son");

  assert.equal(artist, "Anuel AA");
  assert.deepEqual(
    tracks.map((t) => t.id),
    ["s1", "v1", "v2", "v3", "v4", "v5", "s3"],
  );
  assert.equal(split, 3, "«Otros resultados» empieza en el remix");
});

test("las canciones que no son lo buscado no se cuelan", () => {
  const { tracks } = rankSearch(videos, songs, "Las mas bonitas son");
  assert.ok(!tracks.some((t) => t.id === "s2"), "«Ponte Bonita» no es lo buscado");
});

test("sin YouTube Music (o sin canción que encaje) el orden no cambia", () => {
  assert.deepEqual(rankSearch(videos, [], "Las mas bonitas son"), { tracks: videos, artist: null, split: -1 });
  assert.equal(rankSearch(videos, [songs[1]], "Las mas bonitas son").split, -1);
});

test("si todo es del artista no hay reparto", () => {
  const { tracks, split } = rankSearch(videos.slice(0, 2), songs.slice(0, 1), "Las mas bonitas son");
  assert.equal(tracks.length, 3);
  assert.equal(split, -1);
});

test("canales del artista con otro nombre: VEVO, - Topic, colaboraciones", () => {
  const vids = [
    { id: "a", title: "Otra cosa", uploader: "Random" },
    { id: "b", title: "Creep (Official)", uploader: "RadioheadVEVO" },
    { id: "c", title: "Creep (Live)", uploader: "Radiohead - Topic" },
    { id: "d", title: "Creep", uploader: "Radiohead - Topic" },
  ];
  const s = [{ id: "s", title: "Creep", uploader: "Radiohead", artists: [{ id: "UCr", name: "Radiohead" }] }];
  const { tracks } = rankSearch(vids, s, "radiohead creep");
  // "d" se vería igual que la oficial: no sale dos veces.
  assert.deepEqual(tracks.map((t) => t.id), ["s", "b", "c", "a"]);
});

test("el artista detrás del guion también cuenta, y no se repite lo idéntico a la oficial", () => {
  const vids = [
    { id: "x", title: "Las Mas Bonitas Son P*tas - Anuel| Letra-Lyrics", uploader: "Lyrion" },
    { id: "y", title: "Las mas bonitas son p#tas", uploader: "Anuel AA - Topic" },
    { id: "z", title: "Otra cosa", uploader: "Nadie" },
  ];
  const { tracks, split } = rankSearch(vids, songs.slice(0, 1), "Las mas bonitas son");
  assert.deepEqual(tracks.map((t) => t.id), ["s1", "x", "z"], "«y» se vería igual que la oficial");
  assert.equal(split, 2);
});

test("la misma canción oficial en dos álbumes sale una vez", () => {
  const soda = { id: "UCs", name: "Soda Stereo" };
  const dos = [
    { id: "o1", title: "De Música Ligera (Remasterizado 2007)", uploader: "Soda Stereo", artists: [soda] },
    { id: "o2", title: "De Música Ligera (Remasterizado 2007)", uploader: "Soda Stereo", artists: [soda] },
  ];
  assert.deepEqual(rankSearch([], dos, "de musica ligera").tracks.map((t) => t.id), ["o1"]);
});

test("qué títulos responden a lo buscado", () => {
  assert.equal(matchesQuery("Las mas bonitas son p#tas", "las más bonitas son"), true);
  assert.equal(matchesQuery("Creep", "radiohead creep"), true);
  assert.equal(matchesQuery("Ponte Bonita", "las mas bonitas son"), false);
  assert.equal(matchesQuery("", "algo"), false);
});
