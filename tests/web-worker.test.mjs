import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";

const scope = "https://example.test/Antares/";
const prefix = `antares-web:${scope}:`;
const source = (await readFile(new URL("../web/sw.js", import.meta.url), "utf8"))
  .replace("__VERSION__", "current")
  .replace("__ASSETS__", JSON.stringify(["./", "./index.html", "./assets/bootstrap-NEW.js"]));

function worker() {
  const handlers = {};
  const shell = new Response("Antares offline");
  const previousScript = new Response("Módulo anterior");
  const caches = new Map([
    [prefix + "oldest", new Map()],
    [prefix + "previous", new Map([
      [scope + "assets/chunk-OLD.js", previousScript],
      [scope + "engine/antares_core_bg-a1b2.wasm", new Response("Rust anterior")],
    ])],
    [prefix + "current", new Map([["./index.html", shell]])],
    ["other-app", new Map()],
  ]);
  let claimed = false;
  runInNewContext(source, {
    URL,
    fetch: async () => new Response("Servidor detenido", { status: 503 }),
    caches: {
      keys: async () => [...caches.keys()],
      delete: async key => caches.delete(key),
      open: async name => ({ match: async request => caches.get(name)?.get(request.url ?? request) }),
    },
    self: {
      registration: { scope },
      location: { origin: "https://example.test" },
      clients: { claim: async () => { claimed = true; } },
      addEventListener: (name, callback) => { handlers[name] = callback; },
    },
  });
  return { handlers, caches, claimed: () => claimed };
}

function responseFor(w, path, options = {}) {
  let result;
  w.handlers.fetch({
    request: { method: "GET", url: scope + path, headers: new Headers(), ...options },
    respondWith: promise => { result = promise; },
  });
  return result;
}

test("la navegación recupera la app en caché con la API caída y nunca intercepta el audio", async () => {
  const w = worker();
  const html = await responseFor(w, "", { mode: "navigate" });
  assert.equal(await html.text(), "Antares offline");
  assert.equal(responseFor(w, "api/audio/abcdefghijk", { headers: new Headers({ Range: "bytes=0-1" }) }), undefined);
  assert.equal(responseFor(w, "api/command/get_playlists", { method: "POST" }), undefined);
});

test("al activar una versión, una pestaña anterior conserva acceso a sus módulos", async () => {
  const w = worker();
  let activation;
  w.handlers.activate({ waitUntil: result => { activation = result; } });
  await activation;
  assert.equal(w.claimed(), true);
  assert.equal(w.caches.has(prefix + "oldest"), false);
  assert.equal(w.caches.has("other-app"), true);
  const script = await responseFor(w, "assets/chunk-OLD.js", { destination: "script" });
  assert.equal(await script.text(), "Módulo anterior");
  const wasm = await responseFor(w, "engine/antares_core_bg-a1b2.wasm");
  assert.equal(await wasm.text(), "Rust anterior");
});
