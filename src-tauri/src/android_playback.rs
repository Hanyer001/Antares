//! Puente JNI: resolver y registrar escuchas sin depender del WebView.
use std::sync::OnceLock;
use jni::{JNIEnv, objects::{JClass, JString}, sys::{jstring, jboolean}};
use tauri::{AppHandle, Manager};
use crate::{cache::AppCache, stats::Stats, store::Store, track::SearchResult};

static APP: OnceLock<AppHandle> = OnceLock::new();
pub fn init(app: AppHandle) { let _ = APP.set(app); }

#[no_mangle]
pub extern "system" fn Java_com_hanyer_antares_PlaybackResolver_resolve(
    mut env: JNIEnv, _class: JClass, input: JString, fresh: jboolean,
) -> jstring {
    // Nunca propagar un panic a través de JNI. El hilo de carga de Media3
    // espera aquí; no se bloquean ni la UI ni el hilo principal de Android.
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| -> Result<String, String> {
        let id: String = env.get_string(&input).map_err(|_| "ID inválido")?.into();
        if id.len() != 11 || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-') {
            return Err("ID de YouTube inválido".into());
        }
        let app = APP.get().ok_or("Reproductor no inicializado")?;
        let query = SearchResult::watch_url_for(&id);
        let cache = app.state::<AppCache>();
        tauri::async_runtime::block_on(async {
            if fresh != 0 { crate::commands::resolve_fresh(&query, &cache, false).await }
            else { crate::commands::resolve(&query, &cache, false).await }
        }).map(|(track, _)| track.url)
    })).unwrap_or_else(|_| Err("Error al resolver el audio".into()));
    let json = match result {
        Ok(url) => serde_json::json!({"url": url}),
        // No incluir URLs firmadas, cabeceras ni credenciales en los errores.
        Err(_) => serde_json::json!({"error": "No se pudo resolver el audio de YouTube"}),
    };
    env.new_string(json.to_string()).map(|s| s.into_raw()).unwrap_or(std::ptr::null_mut())
}

#[no_mangle]
pub extern "system" fn Java_com_hanyer_antares_PlaybackResolver_record(
    mut env: JNIEnv, _class: JClass, input: JString,
) {
    let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let Ok(raw) = env.get_string(&input) else { return };
        let Ok(event) = serde_json::from_str::<serde_json::Value>(&String::from(raw)) else { return };
        let Some(app) = APP.get() else { return };
        let Ok(track) = serde_json::from_value::<SearchResult>(event["track"].clone()) else { return };
        if event["incognito"].as_bool().unwrap_or(true) { return; }
        if event["started"].as_bool().unwrap_or(false) {
            app.state::<Store>().record(track);
        } else {
            app.state::<Stats>().record_context(track, event["listened"].as_f64().unwrap_or(0.0),
                event["ended"].as_bool().unwrap_or(false), event["learn"].as_bool().unwrap_or(false));
        }
    }));
}
