import { test } from "node:test";
import assert from "node:assert/strict";
import { IDBFactory, IDBKeyRange } from "fake-indexeddb";
import { createLibrarySync, overlayLibrary, pendingRating } from "../src/js/web-library-sync.js";
import { acknowledgeOperation, pendingOperations, readWebCache, writeWebCache } from "../src/js/web-storage.js";

globalThis.indexedDB = new IDBFactory();
globalThis.IDBKeyRange = IDBKeyRange;
const track = { id: "abcdefghijk", title: "Canción" };
const accept = (op, scope) => acknowledgeOperation(op, { library: scope }, lists => overlayLibrary(lists, [op]));

test("una lista y su favorito sobreviven una nueva instancia offline y se reenvían en orden", async () => {
  let online = false;
  const calls = [];
  const create = () => createLibrarySync({
    scope: () => "account:main", available: () => online, update() {},
    async rpc(command, args) { calls.push([command, args]); return null; },
    accept,
  });
  const id = await create().save("create_playlist", { name: "  Mi lista ", tracks: [] });
  await create().save("add_to_playlist", { id, track });
  await create().save("set_rating", { track, rating: "like" });

  const snapshot = await create().pending();
  const view = overlayLibrary([], snapshot);
  assert.equal(view.find(list => list.id === id).name, "Mi lista");
  assert.equal(view.find(list => list.id === id).tracks[0].id, track.id);
  assert.equal(pendingRating(track.id, snapshot), "like");
  assert.deepEqual(await pendingOperations("other:main"), []);
  assert.deepEqual(calls, []);

  online = true;
  await create().flush();
  assert.deepEqual(calls.map(([command]) => command), ["create_playlist", "add_to_playlist", "set_rating"]);
  assert.equal(calls[0][1].operationId, snapshot[0].args.operationId);
  assert.deepEqual(await create().pending(), []);
});

test("un cambio rechazado queda visible y puede descartarse sin perder el resto", async () => {
  let online = false;
  let state;
  const sync = createLibrarySync({
    scope: () => "account:secondary", available: () => online, update(value) { state = value; },
    async rpc(command) { if (command === "add_to_playlist") throw new Error("Esa lista ya no existe."); },
    accept,
  });
  await sync.save("add_to_playlist", { id: "deleted", track });
  await sync.save("create_playlist", { name: "Otra lista" });
  online = true;
  await sync.flush();
  assert.match(state.blocked.message, /ya no existe/);
  assert.equal((await sync.pending()).length, 2);
  await sync.discard(state.blocked.key);
  assert.deepEqual(await sync.pending(), []);
  assert.equal(state.blocked, null);
});

test("la caché de biblioteca se conserva y las operaciones optimistas no alteran la copia base", async () => {
  const lists = [{ id: "likes", name: "Me gusta", system: true, tracks: [] }];
  await writeWebCache("account:main:playlists", lists);
  const persisted = await readWebCache("account:main:playlists");
  const view = overlayLibrary(persisted, [{ command: "set_rating", args: { track, rating: "like" } }]);
  assert.equal(view[0].tracks.length, 1);
  assert.deepEqual(await readWebCache("account:main:playlists"), lists);
  assert.equal(await readWebCache("other:main:playlists"), undefined);
});
