//! Identidad de compilación para informes locales.
use serde::Serialize;
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BuildInfo {
    system: &'static str,
    architecture: &'static str,
    webview: &'static str,
    revision: &'static str,
    modified: bool,
}

#[tauri::command]
pub fn desktop_build_info() -> BuildInfo {
    BuildInfo {
        system: std::env::consts::OS,
        architecture: std::env::consts::ARCH,
        webview: if cfg!(target_os = "macos") {
            "WKWebView"
        } else if cfg!(windows) {
            "WebView2"
        } else {
            "WebKitGTK"
        },
        revision: env!("ANTARES_REVISION"),
        modified: env!("ANTARES_MODIFIED") == "true",
    }
}

use antares_core::diagnostics::Measurements;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    LazyLock, Mutex,
};
static ENABLED: AtomicBool = AtomicBool::new(false);
static SAMPLES: LazyLock<Mutex<Measurements>> = LazyLock::new(Mutex::default);

#[tauri::command]
pub fn set_desktop_diagnostics(enabled: bool) {
    ENABLED.store(enabled, Ordering::Release);
    if !enabled {
        if let Ok(mut samples) = SAMPLES.lock() {
            *samples = Measurements::default();
        }
    }
}

pub fn first_byte(elapsed: std::time::Duration) {
    if ENABLED.load(Ordering::Acquire) {
        if let Ok(mut samples) = SAMPLES.lock() {
            if ENABLED.load(Ordering::Acquire) {
                samples.record("firstByte", elapsed.as_secs_f64() * 1000.0);
            }
        }
    }
}

#[tauri::command]
pub fn desktop_audio_samples() -> serde_json::Value {
    SAMPLES
        .lock()
        .ok()
        .map(|samples| serde_json::to_value(samples.summaries()).unwrap_or_default())
        .unwrap_or_else(|| serde_json::json!({}))
}

pub struct Startup {
    pub started: std::time::Instant,
    pub reported: AtomicBool,
}

#[tauri::command]
pub fn desktop_ui_ready(app: tauri::AppHandle, startup: tauri::State<'_, Startup>) -> f64 {
    let milliseconds = startup.started.elapsed().as_secs_f64() * 1000.0;
    if !startup.reported.swap(true, Ordering::AcqRel)
        && app.config().identifier.contains(".desktopqa")
        && std::env::var_os("ANTARES_MEASURE_STARTUP").is_some()
    {
        println!("ANTARES_BENCHMARK_READY={milliseconds}");
    }
    milliseconds
}
