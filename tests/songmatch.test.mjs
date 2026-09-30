// Pruebas de "¿es la misma canción?" (songmatch.js, sin DOM ni Tauri).
//
//   npm test

import assert from "node:assert/strict";
import { test } from "node:test";

import { findDuplicates, findSame, sameSong } from "../src/js/songmatch.js";

let n = 0;
const pista = (title, uploader) => ({ id: `v${n++}`, title, uploader });

const creep = pista("Creep", "Radiohead - Topic");

test("el mismo vídeo es la misma canción", () => {
  assert.equal(sameSong(creep, { ...creep }), true);
});

test("la misma canción con añadidos en el título", () => {
  const iguales = [
    pista("Radiohead - Creep (Official Video)", "Radiohead"),
    pista("Radiohead - Creep (Subtitulada en Español - Lyrics)", "Kylian Dash"),
    pista("Radiohead - Creep (Video Oficial) // Español + Lyrics", "rayita"),
    pista("Creep - Radiohead [HD]", "Canal de letras"),
    pista("RADIOHEAD - CREEP (Remastered 2009)", "RadioheadVEVO"),
    pista("Creep", "Radiohead"),
  ];
  for (const otra of iguales) assert.equal(sameSong(creep, otra), true, otra.title);
});

test("tildes, mayúsculas y lo que va tras « | »", () => {
  const titi = pista("Tití Me Preguntó", "Bad Bunny");
  assert.equal(sameSong(titi, pista("Bad Bunny - Tití Me Preguntó (Official Video) | Un Verano Sin Ti", "Bad Bunny")), true);
  assert.equal(sameSong(titi, pista("Bad Bunny - Titi Me Pregunto (Letra)", "Rap Samurai")), true);
});

test("«ft.» y los artistas invitados no la hacen otra", () => {
  const a = pista("Despacito", "Luis Fonsi");
  assert.equal(sameSong(a, pista("Luis Fonsi - Despacito ft. Daddy Yankee", "LuisFonsiVEVO")), true);
});

test("un « - Remastered 2011» al final no la hace otra", () => {
  const a = pista("De Música Ligera", "Soda Stereo");
  assert.equal(sameSong(a, pista("De Música Ligera - Remasterizado 2007", "Soda Stereo - Topic")), true);
  assert.equal(sameSong(a, pista("Soda Stereo  - De Musica Ligera  (1990) [Full HD] [60fps]", "VOB FLAC")), true);
});

test("otra versión sí es otra canción", () => {
  for (const title of ["Creep (Acoustic)", "Creep - Live at Glastonbury", "Creep (En Vivo)", "Creep (Remix)", "Creep (Slowed + Reverb)"]) {
    assert.equal(sameSong(creep, pista(title, "Radiohead")), false, title);
  }
  assert.equal(sameSong(pista("Creep (Live)", "Radiohead"), pista("Radiohead - Creep (Live at Glastonbury)", "x")), true, "dos en vivo sí");
});

test("el mismo título de otro artista es otra canción", () => {
  assert.equal(sameSong(creep, pista("Creep", "TLC")), false);
  assert.equal(sameSong(creep, pista("TLC - Creep (Official Video)", "TLC")), false);
});

test("canciones distintas del mismo artista son distintas", () => {
  assert.equal(sameSong(creep, pista("Karma Police", "Radiohead")), false);
  assert.equal(sameSong(creep, pista("Radiohead - Creep Show", "Radiohead")), false);
});

test("buscar la misma en una lista y las repetidas de una lista", () => {
  const lista = [
    pista("Karma Police", "Radiohead"),
    creep,
    pista("Radiohead - Creep (Official Video)", "Radiohead"),
    pista("No Surprises", "Radiohead"),
    pista("Radiohead - Karma Police (Letra)", "Letras"),
  ];

  assert.equal(findSame(lista, pista("Creep [HD]", "Radiohead")), creep);
  assert.equal(findSame(lista, pista("Let Down", "Radiohead")), null);

  const dups = findDuplicates(lista);
  assert.deepEqual(
    dups.map((d) => [d.track.title, d.original.title]),
    [
      ["Radiohead - Creep (Official Video)", "Creep"],
      ["Radiohead - Karma Police (Letra)", "Karma Police"],
    ],
  );
});
