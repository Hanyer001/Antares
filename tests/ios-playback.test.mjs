import { test } from "node:test";
import assert from "node:assert/strict";
import { iosQueueWindow, resolveIOSQueue } from "../src/js/ios-queue.js";
import { createPlaybackDiagnostics } from "../src/js/playback-diagnostics.js";

test("la cola nativa conserva el orden y respeta el modo de repetición", () => {
  const tracks = ["a", "b", "c", "d", "e"];
  assert.deepEqual(iosQueueWindow(tracks, 0, "off", false), ["b", "c", "d"]);
  assert.deepEqual(iosQueueWindow(tracks, 3, "all", false), ["e", "a", "b"]);
  assert.deepEqual(iosQueueWindow(tracks, 3, "all", true), ["e"]);
  assert.deepEqual(iosQueueWindow(tracks, 3, "one", false), []);
});

test("la preparación se detiene si el proveedor devuelve otra pista o cambia la cola", async () => {
  const tracks = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const attempts = [];
  const published = [];
  await resolveIOSQueue(tracks, async track => {
    attempts.push(track.id);
    return { id: track.id === "b" ? "mismatch" : track.id, url: "https://audio.test" };
  }, () => true, items => published.push(items.map(item => item.id)));
  assert.deepEqual(attempts, ["a", "b"]);
  assert.deepEqual(published, [["a"]]);
  await resolveIOSQueue(tracks, async () => assert.fail("a stale request must not fetch"), () => false, () => {});
});

test("el diagnóstico ignora credenciales y URLs y borra muestras al desactivarlo", () => {
  const monitor = createPlaybackDiagnostics();
  monitor.enable(true);
  monitor.note("offline", 0);
  monitor.note("https://audio.test/?token=secret");
  monitor.measure("audioStart", 199.8);
  monitor.measure("token=secret", 9000);
  const snapshot = {
    version: "https://audio.test/?token=secret", engine: "AVQueuePlayer", phase: "playing",
    online: true, visible: false, position: 12, duration: 100, buffered: 5, url: "https://audio.test/?token=secret",
  };
  const report = monitor.report(snapshot);
  assert.equal(report.version, null);
  assert.equal(report.lastInterruption.reason, "offline");
  assert.equal(report.milliseconds.audioStart, 200);
  assert.ok(!JSON.stringify(report).includes("secret"));
  monitor.enable(false);
  assert.deepEqual(monitor.report(snapshot).milliseconds, {});
  assert.equal(monitor.report(snapshot).lastInterruption, null);
});
