// El host mide el motor Wasm real. Rust calcula mediana y p95.
// Opcional: dos rutas absolutas a glue JS y Wasm de una compilación anterior.
import { readFile, stat, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import * as core from "../src/js/rust-core.js";
const [output, oldGlue, oldWasm] = process.argv.slice(2);
if (!output) throw new Error("Indica un archivo JSON de salida y, opcionalmente, glue JS y Wasm anteriores.");
const tracks = Array.from({ length: 1000 }, (_, i) => ({
  title: `Canción número ${i}`, uploader: `Artista ${i % 15}`,
}));
const input = JSON.stringify(tracks);
const query = "cancion artista 7";
const cpuStart = process.cpuUsage();
const measurements = new core.PerformanceSamples();
function sample(name, callback) {
  // Primera llamada y 20 muestras posteriores se registran por separado.
  const started = performance.now();
  callback();
  const firstMs = performance.now() - started;
  for (let i = 0; i < 20; i++) {
    const start = performance.now();
    for (let repetition = 0; repetition < 20; repetition++) callback();
    measurements.record(name, (performance.now() - start) / 20);
  }
  return firstMs;
}
const currentFilter = core.TrackFilter ? new core.TrackFilter() : null;
const firstCurrentMs = sample("libraryFilter", () =>
  currentFilter ? currentFilter.filter(input, query) : core.filter_track_indices(input, query));
const current = JSON.parse(measurements.report()).libraryFilter;
let baseline = null;
if (oldGlue && oldWasm) {
  const previous = await import(pathToFileURL(oldGlue));
  await previous.default({ module_or_path: await readFile(oldWasm) });
  measurements.clear();
  const firstMs = sample("libraryFilter", () => previous.filter_track_indices(input, query));
  baseline = { firstMs, ...JSON.parse(measurements.report()).libraryFilter };
}
const report = {
  scope: "Filtrado Wasm de 1000 pistas en Node. Excluye render DOM, red y arranque de la app.",
  system: process.platform, architecture: process.arch, node: process.version,
  samples: 20, operationsPerSample: 20,
  current: { firstMs: firstCurrentMs, ...current },
  baseline,
  wasmBytes: (await stat(new URL("../src/engine/antares_core_bg.wasm", import.meta.url))).size,
  processCpuMicroseconds: process.cpuUsage(cpuStart),
  processMemory: process.memoryUsage(),
};
currentFilter?.free();
measurements.free();
await writeFile(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
