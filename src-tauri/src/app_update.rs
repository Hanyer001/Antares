// Actualizaciones de Antares mediante el manifiesto latest.json de GitHub.
// La descarga se verifica con la clave pública de tauri.conf.json antes de instalar.
// En Windows, el instalador cierra y vuelve a abrir la app; los datos están en AppData.

use serde::Serialize;

/// Lo que el frontend enseña de una version nueva.
#[derive(Debug, Clone, Serialize)]
pub struct AppUpdate {
    pub version: String,
    pub current: String,
    /// Las novedades que se escribieron al publicarla.
    pub notes: Option<String>,
}

/// La actualizacion encontrada en la ultima comprobacion, para instalar esa
/// misma sin volver a preguntar.
#[derive(Default)]
pub struct Pending(
    #[cfg(desktop)] std::sync::Mutex<Option<tauri_plugin_updater::Update>>,
    #[cfg(mobile)] (),
);

/// La version que esta corriendo.
#[tauri::command]
pub fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// ¿Hay una version mas nueva publicada? `None` si ya es la ultima.
#[cfg(desktop)]
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, Pending>,
) -> Result<Option<AppUpdate>, String> {
    use tauri_plugin_updater::UpdaterExt;

    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(friendly)?;

    let info = update.as_ref().map(|u| AppUpdate {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
    });
    *pending.0.lock().map_err(|_| "estado bloqueado".to_string())? = update;
    Ok(info)
}

/// Descarga, comprueba la firma e instala la version encontrada. Mientras
/// baja, avisa al frontend ("app-update-progress": bajado y total en bytes).
/// En Windows no vuelve: el instalador cierra la app y la abre de nuevo.
#[cfg(desktop)]
#[tauri::command]
pub async fn install_app_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, Pending>,
) -> Result<(), String> {
    use tauri::Emitter;

    let update = pending
        .0
        .lock()
        .map_err(|_| "estado bloqueado".to_string())?
        .take()
        .ok_or("No hay ninguna actualización pendiente. Vuelve a buscarla.")?;

    let mut downloaded: u64 = 0;
    let progress = app.clone();
    // Descargar (y comprobar la firma) primero; instalar despues, que en
    // Windows cierra la app al momento.
    let bytes = update
        .download(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress.emit(
                    "app-update-progress",
                    serde_json::json!({ "downloaded": downloaded, "total": total }),
                );
            },
            || {},
        )
        .await
        .map_err(friendly)?;

    // El instalador cierra la app de golpe: el icono de la bandeja se quita
    // antes, o quedaria uno fantasma (ver `remove_tray`).
    crate::remove_tray(&app);
    update.install(bytes).map_err(friendly)?;

    // Fuera de Windows el instalador no cierra la app: se reinicia aqui.
    crate::restart_clean(&app);
}

/// Los errores del actualizador, en palabras de persona.
#[cfg(desktop)]
fn friendly(error: tauri_plugin_updater::Error) -> String {
    let text = error.to_string();
    let lower = text.to_lowercase();
    if lower.contains("valid release json") || lower.contains("release not found") {
        "Todavía no hay ninguna versión publicada.".to_string()
    } else if lower.contains("signature") {
        "La actualización no trae una firma válida: no se instala.".to_string()
    } else if lower.contains("network") || lower.contains("request") || lower.contains("dns") || lower.contains("connect") {
        "No se pudo conectar para buscar la actualización. Revisa tu internet.".to_string()
    } else {
        format!("No se pudo actualizar: {text}")
    }
}

#[cfg(test)]
mod tests {
    use base64::Engine;
    use serde_json::Value;

    fn decode(b64: &str) -> String {
        let bytes = base64::engine::general_purpose::STANDARD.decode(b64.trim()).expect("base64");
        String::from_utf8(bytes).expect("texto")
    }

    /// La clave publica de tauri.conf.json, tal como la lee el actualizador.
    fn public_key() -> minisign_verify::PublicKey {
        let conf: Value = serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let b64 = conf["plugins"]["updater"]["pubkey"].as_str().expect("falta la clave publica");
        minisign_verify::PublicKey::decode(&decode(b64)).expect("clave publica valida")
    }

    #[test]
    fn la_clave_publica_se_lee() {
        public_key();
    }

    /// Lo que la app de tus amigos hara al actualizar: comprobar que el
    /// instalador publicado lleva la firma de tu clave. Con la carpeta que deja
    /// `scripts/release-windows.ps1`:
    ///   $env:ANTARES_PUBLICAR="..\publicar\v0.3.0"; cargo test firma_publicada -- --ignored
    #[test]
    #[ignore]
    fn firma_publicada() {
        let dir = std::path::PathBuf::from(std::env::var("ANTARES_PUBLICAR").expect("ANTARES_PUBLICAR"));
        let latest: Value = serde_json::from_str(&std::fs::read_to_string(dir.join("latest.json")).unwrap()).unwrap();
        let entry = &latest["platforms"]["windows-x86_64"];
        let url = entry["url"].as_str().unwrap();
        let file = dir.join(url.rsplit('/').next().unwrap());
        let signature = minisign_verify::Signature::decode(&decode(entry["signature"].as_str().unwrap())).unwrap();

        let data = std::fs::read(&file).expect("el instalador");
        public_key().verify(&data, &signature, true).expect("la firma no coincide con la clave publica");

        // Y un solo byte cambiado ya no pasa.
        let mut tampered = data;
        tampered[1000] ^= 1;
        assert!(public_key().verify(&tampered, &signature, true).is_err());
    }
}

// En el movil no hay actualizador: la app se instala a mano desde el APK.

#[cfg(mobile)]
#[tauri::command]
pub async fn check_app_update() -> Result<Option<AppUpdate>, String> {
    Ok(None)
}

#[cfg(mobile)]
#[tauri::command]
pub async fn install_app_update() -> Result<(), String> {
    Err("En el móvil, la versión nueva se instala con su APK.".to_string())
}
