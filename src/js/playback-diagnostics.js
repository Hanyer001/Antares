import { PerformanceSamples } from "./rust-core.js";

const phases = new Set(["idle", "loading", "buffering", "playing", "offline", "recovering", "paused", "error"]);
const interruptions = new Set(["offline", "buffering", "error", "audio-focus", "audio-route"]);
const engines = new Set(["AVQueuePlayer", "Media3", "HTMLMediaElement"]);
const metrics = new Set(["startup", "search", "resolution", "audioStart", "firstByte", "libraryRender", "libraryFilter"]);
const seconds = value => Number.isFinite(value) ? Math.round(Math.max(0, value) * 10) / 10 : null;

export function createPlaybackDiagnostics() {
  let enabled = false;
  let lastInterruption = null;
  let times = {};
  const samples = new PerformanceSamples();
  return {
    enable(value) {
      enabled = Boolean(value);
      if (!enabled) { lastInterruption = null; times = {}; samples.clear(); }
    },
    note(reason, now = Date.now()) {
      if (enabled && interruptions.has(reason) && Number.isFinite(now)) {
        lastInterruption = { reason, at: new Date(now).toISOString() };
      }
    },
    measure(name, elapsed) {
      if (enabled && metrics.has(name) && Number.isFinite(elapsed) && elapsed >= 0) {
        times[name] = Math.round(elapsed);
        samples.record(name, elapsed);
      }
    },
    report({ version, engine, phase, online, visible, position, duration, buffered, system, architecture, webview, revision, modified }) {
      return {
        version: typeof version === "string" && /^(?:PWA · [0-9a-f]{12}|\d+\.\d+\.\d+(?:[-+.][\w.-]{1,24})?)$/.test(version) ? version : null,
        system: ["macos", "windows", "linux", "ios", "android", "web"].includes(system) ? system : null,
        architecture: ["aarch64", "x86_64", "arm", "x86"].includes(architecture) ? architecture : null,
        webview: ["WKWebView", "WebView2", "WebKitGTK", "Browser"].includes(webview) ? webview : null,
        revision: typeof revision === "string" && /^[0-9a-f]{40}$/.test(revision) ? revision : null,
        modified: modified === true,
        samples: JSON.parse(samples.report()),
        engine: engines.has(engine) ? engine : null,
        phase: phases.has(phase) ? phase : "idle",
        online: online === true,
        visible: visible === true,
        positionSeconds: seconds(position),
        durationSeconds: seconds(duration),
        bufferedAheadSeconds: seconds(buffered),
        lastInterruption,
        milliseconds: { ...times },
      };
    },
  };
}

export function initPlaybackDiagnostics(diagnostics, {
  snapshot, getVersion, getBuildInfo = async () => ({}),
  setNativeEnabled = async () => {}, getNativeSamples = async () => ({}), startup,
}) {
  const toggle = document.getElementById("diagnostics-enable");
  const panel = document.getElementById("diagnostics-panel");
  const report = document.getElementById("diagnostics-report");
  const status = document.getElementById("diagnostics-status");
  let version = null;
  let buildInfo = {};
  let proxySamples = {};
  let timer;
  let generation = 0;

  function refresh() {
    report.value = JSON.stringify({
      ...diagnostics.report({ ...snapshot(), ...buildInfo, version }),
      proxyMilliseconds: proxySamples,
    }, null, 2);
  }

  toggle.addEventListener("change", async () => {
    const current = ++generation;
    diagnostics.enable(toggle.checked);
    setNativeEnabled(toggle.checked).catch(() => {});
    proxySamples = {};
    clearInterval(timer);
    panel.hidden = !toggle.checked;
    if (!toggle.checked) { report.value = ""; return; }
    diagnostics.measure("startup", startup);
    refresh();
    timer = setInterval(async () => {
      if (document.hidden || report === document.activeElement) return;
      try {
        const samples = await getNativeSamples();
        if (current !== generation) return;
        proxySamples = samples;
      } catch { /* El resto de las medidas sigue disponible. */ }
      if (current === generation) refresh();
    }, 1000);
    try {
      const [value, info] = await Promise.all([getVersion(), getBuildInfo()]);
      if (current === generation) { version = value; buildInfo = info; refresh(); }
    } catch { /* El resto del diagnóstico sigue disponible. */ }
  });

  document.getElementById("diagnostics-copy").addEventListener("click", async () => {
    refresh();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(report.value);
      status.textContent = "Informe copiado.";
    } catch {
      report.focus();
      report.select();
      status.textContent = "Seleccionado para copiar.";
    }
  });
}
