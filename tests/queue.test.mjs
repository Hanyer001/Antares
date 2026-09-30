// Pruebas de la cola: aleatorio y repetir.
//
// queue.js es estado puro, sin DOM ni Tauri, así que se prueba en Node tal
// cual, con el runner que Node trae de serie:
//
//   npm test
//
// Va fuera de src/ para que no acabe empaquetado dentro de la app.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import * as q from "../src/js/queue.js";

const pistas = (n) => Array.from({ length: n }, (_, i) => ({ id: `t${i}` }));
const idsDe = (tracks) => tracks.map((t) => t.id);
const ids = () => idsDe(q.all());

// La cola es un módulo con estado: cada prueba empieza de cero.
beforeEach(() => {
  q.setShuffle(false);
  q.setRepeat("off");
  q.clear();
});

test("sin modos, next y prev recorren en orden y paran en los extremos", () => {
  q.load(pistas(3), 0);

  assert.equal(q.next().id, "t1");
  assert.equal(q.next().id, "t2");
  assert.equal(q.next(), null);
  assert.equal(q.hasNext(), false);
  assert.equal(q.prev().id, "t1");
});

test("activar aleatorio deja la actual primera y conserva todas las pistas", () => {
  q.load(pistas(20), 7);
  q.setShuffle(true);

  assert.equal(q.current().id, "t7");
  assert.equal(q.currentIndex(), 0);
  assert.deepEqual([...ids()].sort(), idsDe(pistas(20)).sort());
});

test("el aleatorio de verdad cambia el orden", () => {
  // Con 10 pistas, que el barajado deje el orden igual es 1 entre 362.880:
  // exigir 45 de 50 no falla por mala suerte.
  let distintos = 0;

  for (let i = 0; i < 50; i++) {
    q.setShuffle(false);
    q.load(pistas(10), 0);
    q.setShuffle(true);
    if (ids().join() !== idsDe(pistas(10)).join()) distintos++;
  }

  assert.ok(distintos >= 45, `solo ${distintos}/50 barajados`);
});

test("desactivar aleatorio recupera el orden original y sigue desde la actual", () => {
  q.load(pistas(10), 0);
  q.setShuffle(true);
  q.next();
  q.next();
  const suena = q.current().id;

  q.setShuffle(false);

  assert.deepEqual(ids(), idsDe(pistas(10)));
  assert.equal(q.current().id, suena);
});

test("con aleatorio, cargar una lista empieza por la elegida", () => {
  q.setShuffle(true);
  q.load(pistas(10), 4);

  assert.equal(q.current().id, "t4");
  assert.equal(q.all().length, 10);
});

test("una carga «ordered» respeta el orden aunque el aleatorio esté activo", () => {
  q.setShuffle(true);
  q.load(pistas(10), 0, { ordered: true });

  assert.deepEqual(ids(), idsDe(pistas(10)));
  assert.equal(q.current().id, "t0");

  // Y al quitar el aleatorio sigue igual: ese orden ya era el original.
  q.next();
  q.setShuffle(false);
  assert.deepEqual(ids(), idsDe(pistas(10)));
  assert.equal(q.current().id, "t1");
});

test("añadir y quitar con aleatorio también se reflejan al desactivarlo", () => {
  q.load(pistas(4), 0);
  q.setShuffle(true);
  q.add({ id: "nueva" });
  q.remove("t2");

  q.setShuffle(false);

  // Lo encolado sigue justo detrás de la que suena.
  assert.deepEqual(ids(), ["t0", "nueva", "t1", "t3"]);
});

test("repetir todo vuelve al principio al acabar", () => {
  q.setRepeat("all");
  q.load(pistas(3), 2);

  assert.equal(q.hasNext(), true);
  assert.equal(q.peekNext().id, "t0");
  assert.equal(q.next().id, "t0");
  assert.equal(q.prev().id, "t2", "anterior desde la primera va a la última");
});

test("repetir todo con aleatorio rebaraja sin repetir la última como primera", () => {
  for (let i = 0; i < 200; i++) {
    q.setShuffle(false);
    q.setRepeat("all");
    q.load(pistas(3), 0);
    q.setShuffle(true);
    q.next();
    q.next();

    const ultima = q.current().id;
    assert.equal(q.peekNext(), null, "la vuelta nueva aún no existe");

    const primera = q.next().id;
    assert.notEqual(primera, ultima);
    assert.equal(q.all().length, 3);
  }
});

test("repetir esta canción no bloquea anterior y siguiente", () => {
  q.setRepeat("one");
  q.load(pistas(3), 0);

  assert.equal(q.hasNext(), true);
  assert.equal(q.next().id, "t1");
});

test("cycleRepeat va no → todo → una → no", () => {
  assert.equal(q.cycleRepeat(), "all");
  assert.equal(q.cycleRepeat(), "one");
  assert.equal(q.cycleRepeat(), "off");
});

test("un modo de repetir desconocido cae en «no»", () => {
  q.setRepeat("loquesea");
  assert.equal(q.repeatMode(), "off");
});

// --- Cola general: lo tuyo delante, las recomendaciones detrás -----------

const recs = (n) => Array.from({ length: n }, (_, i) => ({ id: `r${i}` }));

test("sin nada sonando, «siguiente» es la primera de la cola", () => {
  q.add({ id: "a" });
  q.add({ id: "b" });

  assert.equal(q.currentIndex(), -1);
  assert.equal(q.hasNext(), true);
  assert.equal(q.peekNext().id, "a");
  assert.equal(q.next().id, "a");
});

test("añadir a la cola va detrás de lo tuyo y delante de las recomendaciones", () => {
  q.load(pistas(1), 0);
  q.appendAuto(recs(3));

  q.add({ id: "mia1" });
  q.add({ id: "mia2" });

  assert.deepEqual(ids(), ["t0", "mia1", "mia2", "r0", "r1", "r2"]);
});

// --- "Siguiente en la cola", como en Spotify ------------------------------

test("con una lista sonando, añadir a la cola suena después de la actual, no al final de la lista", () => {
  q.load(pistas(4), 1);
  q.add({ id: "a" });
  q.add({ id: "b" });

  assert.deepEqual(ids(), ["t0", "t1", "a", "b", "t2", "t3"], "en el orden en que se añadieron");
  assert.equal(q.queuedCount(), 2);
  assert.equal(q.next().id, "a");
  assert.equal(q.queuedCount(), 1, "la que suena ya salió de la cola");
  assert.equal(q.next().id, "b");
  assert.equal(q.next().id, "t2", "y sigue la lista");
});

test("reproducir a continuación se pone delante de lo ya encolado", () => {
  q.load(pistas(3), 0);
  q.add({ id: "a" });
  q.playNext({ id: "ya" });

  assert.deepEqual(ids(), ["t0", "ya", "a", "t1", "t2"]);
  assert.deepEqual(idsDe(q.upcomingQueued()), ["ya", "a"]);
});

test("lo encolado sobrevive a poner otra lista", () => {
  q.load(pistas(3), 0);
  q.add({ id: "a" });
  q.add({ id: "t9" });

  q.load([{ id: "x0" }, { id: "x1" }, { id: "t9" }], 1);

  // "t9" ya viene en la lista nueva: suena en su sitio, no dos veces.
  assert.deepEqual(ids(), ["x0", "x1", "a", "t9"]);
  assert.equal(q.current().id, "x1");
  assert.deepEqual(idsDe(q.upcomingQueued()), ["a"]);
});

test("lo encolado no se baraja: sigue justo detrás al activar y quitar el aleatorio", () => {
  for (let i = 0; i < 50; i++) {
    q.setShuffle(false);
    q.load(pistas(8), 2);
    q.add({ id: "a" });
    q.add({ id: "b" });

    q.setShuffle(true);
    assert.deepEqual(ids().slice(0, 3), ["t2", "a", "b"]);

    q.setShuffle(false);
    assert.deepEqual(ids(), ["t0", "t1", "t2", "a", "b", "t3", "t4", "t5", "t6", "t7"]);
  }
});

test("borrar la cola quita solo lo encolado", () => {
  q.load(pistas(3), 0);
  q.appendAuto(recs(1));
  q.add({ id: "a" });
  q.add({ id: "b" });

  q.clearQueued();

  assert.deepEqual(ids(), ["t0", "t1", "t2", "r0"]);
  assert.equal(q.queuedCount(), 0);
  assert.equal(q.current().id, "t0");
});

test("reproducir a continuación la pone justo detrás de la que suena", () => {
  q.load(pistas(3), 0);
  q.playNext({ id: "ya" });

  assert.deepEqual(ids(), ["t0", "ya", "t1", "t2"]);
  assert.equal(q.current().id, "t0", "lo que suena no cambia");
  assert.equal(q.peekNext().id, "ya");
});

test("reproducir ahora salta a ella y deja el resto detrás", () => {
  q.load(pistas(3), 0);
  q.playNow({ id: "ahora" });

  assert.equal(q.current().id, "ahora");
  assert.deepEqual(ids(), ["t0", "ahora", "t1", "t2"]);
});

test("una pista que ya estaba se mueve en vez de repetirse", () => {
  q.load(pistas(4), 0);
  q.playNext({ id: "t3" });

  assert.deepEqual(ids(), ["t0", "t3", "t1", "t2"]);
});

test("cambiar las recomendaciones no toca lo tuyo ni lo que ya sonó", () => {
  q.load(pistas(1), 0);
  q.appendAuto(recs(2));
  q.next(); // suena r0: una recomendación que ya está sonando
  q.add({ id: "mia" });

  q.replaceUpcomingAuto([{ id: "n0" }, { id: "n1" }]);

  assert.deepEqual(ids(), ["t0", "r0", "mia", "n0", "n1"]);
  assert.equal(q.current().id, "r0");
});

test("las recomendaciones no repiten lo que ya está en la cola", () => {
  q.load(pistas(2), 0);
  const nuevas = q.appendAuto([{ id: "t1" }, { id: "x" }, { id: "x" }]);

  assert.equal(nuevas, 1);
  assert.deepEqual(ids(), ["t0", "t1", "x"]);
});

test("la cola marca sus copias y no toca las pistas originales", () => {
  const original = { id: "a" };
  q.load([original], 0, { auto: true });

  assert.equal(q.current().auto, true);
  assert.equal(original.auto, undefined, "la lista del usuario no se contamina");
  assert.equal(q.firstUpcomingAuto(), -1, "la que suena no cuenta como próxima");
});

// --- Entre sesiones ------------------------------------------------------

test("la cola guardada se recupera igual, con su posición y su aleatorio", () => {
  q.load(pistas(5), 2);
  q.appendAuto(recs(2));
  q.setShuffle(true);
  const guardada = JSON.parse(JSON.stringify(q.snapshot()));
  const orden = ids();

  q.setShuffle(false);
  q.clear();
  assert.equal(q.restore(guardada), true);

  assert.deepEqual(ids(), orden);
  assert.equal(q.current().id, "t2");
  assert.equal(q.isShuffled(), true);

  // Y al quitar el aleatorio vuelve el orden original, recomendaciones incluidas.
  q.setShuffle(false);
  assert.deepEqual(ids(), ["t0", "t1", "t2", "t3", "t4", "r0", "r1"]);
});

test("una cola guardada corrupta no rompe nada", () => {
  q.load(pistas(2), 0);

  assert.equal(q.restore(null), false);
  assert.equal(q.restore({ items: "no es una lista" }), false);
  assert.deepEqual(ids(), ["t0", "t1"], "la cola sigue como estaba");

  q.restore({ items: [{ id: "a" }, null, { sin: "id" }], index: 99 });
  assert.deepEqual(ids(), ["a"], "se descartan las entradas sin id");
  assert.equal(q.currentIndex(), 0, "el índice se ajusta a lo que hay");
});

test("repetir todo con una sola pista la repite", () => {
  q.setRepeat("all");
  q.load(pistas(1), 0);

  assert.equal(q.hasNext(), true);
  assert.equal(q.next().id, "t0");
  assert.equal(q.hasPrev(), false);
});
