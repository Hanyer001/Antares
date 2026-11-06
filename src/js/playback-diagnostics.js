const phases = new Set(["idle", "loading", "buffering", "playing", "offline", "recovering", "paused", "error"]);
const interruptions = new Set(["offline", "buffering", "error", "audio-focus", "audio-route"]);
const engines = new Set(["AVQueuePlayer", "Media3", "HTMLMediaElement"]);
const metrics = new Set(["startup", "search", "resolution", "audioStart"]);
const seconds = value => Number.isFinite(value) ? Math.round(Math.max(0, value) * 10) / 10 : null;

export function createPlaybackDiagnostics() {
  let enabled = false;
  let lastInterruption = null;
  let times = {};
  return {
    enable(value) {
      enabled = Boolean(value);
      if (!enabled) { lastInterruption = null; times = {}; }
    },
    note(reason, now = Date.now()) {
      if (enabled && interruptions.has(reason) && Number.isFinite(now)) {
        lastInterruption = { reason, at: new Date(now).toISOString() };
      }
    },
    measure(name, elapsed) {
      if (enabled && metrics.has(name) && Number.isFinite(elapsed) && elapsed >= 0) {
        times[name] = Math.round(elapsed);
      }
    },
    report({ version, engine, phase, online, visible, position, duration, buffered }) {
      return {
        version: typeof version === "string" && /^(?:PWA · [0-9a-f]{12}|\d+\.\d+\.\d+(?:[-+.][\w.-]{1,24})?)$/.test(version) ? version : null,
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

export function initPlaybackDiagnostics(diagnostics, { snapshot, getVersion, startup }) {
  const toggle = document.getElementById("diagnostics-enable");
  const panel = document.getElementById("diagnostics-panel");
  const report = document.getElementById("diagnostics-report");
  const status = document.getElementById("diagnostics-status");
  let version = null;
  let timer;
  let generation = 0;

  function refresh() {
    report.value = JSON.stringify(diagnostics.report({ ...snapshot(), version }), null, 2);
  }

  toggle.addEventListener("change", async () => {
    const current = ++generation;
    diagnostics.enable(toggle.checked);
    clearInterval(timer);
    panel.hidden = !toggle.checked;
    if (!toggle.checked) { report.value = ""; return; }
    diagnostics.measure("startup", startup);
    refresh();
    timer = setInterval(() => { if (!document.hidden && report !== document.activeElement) refresh(); }, 1000);
    try {
      const value = await getVersion();
      if (current === generation) { version = value; refresh(); }
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
