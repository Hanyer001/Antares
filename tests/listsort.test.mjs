// Pruebas de "Ordenar por…" de una lista (listsort.js, sin DOM ni Tauri).
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import { sortDoneText, sortTracks, SORTS } from "../src/js/listsort.js";

const lista = [
  { id: "a", title: "Zombie", uploader: "The Cranberries", duration: 306 },
  { id: "b", title: "ángel", uploader: "Robbie Williams - Topic", duration: 264 },
  { id: "c", title: "Creep", uploader: "Radiohead", duration: 238 },
  { id: "d", title: "Karma Police", uploader: "Radiohead", duration: null },
  { id: "e", title: null, uploader: null, duration: 10 },
];

const ids = (tracks) => tracks.map((t) => t.id);

test("por título: sin mirar tildes ni mayúsculas, y los sin título al final", () => {
  assert.deepEqual(ids(sortTracks(lista, "title")), ["b", "c", "d", "a", "e"]);
});

test("por artista: sin el « - Topic», y dentro de cada artista por título", () => {
  assert.deepEqual(ids(sortTracks(lista, "artist")), ["c", "d", "b", "a", "e"]);
});

test("por duración: las más cortas primero y las que no la tienen al final", () => {
  assert.deepEqual(ids(sortTracks(lista, "duration")), ["e", "c", "b", "a", "d"]);
});

test("invertir el orden", () => {
  assert.deepEqual(ids(sortTracks(lista, "reverse")), ["e", "d", "c", "b", "a"]);
});

test("los números se ordenan como números", () => {
  const partes = [{ id: "10", title: "Parte 10" }, { id: "2", title: "Parte 2" }];
  assert.deepEqual(ids(sortTracks(partes, "title")), ["2", "10"]);
});

test("no toca la lista original y un criterio desconocido la deja igual", () => {
  const copia = [...lista];
  sortTracks(lista, "title");
  assert.deepEqual(lista, copia);
  assert.deepEqual(ids(sortTracks(lista, "otro")), ids(lista));
});

test("cada criterio tiene su nombre para el menú y para el aviso", () => {
  for (const { label } of SORTS) assert.ok(label);
  assert.equal(sortDoneText("title"), "Lista ordenada por título.");
  assert.equal(sortDoneText("reverse"), "Lista ordenada al revés.");
});
