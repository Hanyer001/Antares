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
pub struct Pending {
    #[cfg(all(desktop, not(target_os = "linux")))]
    update: std::sync::Mutex<Option<tauri_plugin_updater::Update>>,
    #[cfg(all(desktop, not(target_os = "linux")))]
    prepared: std::sync::Mutex<Option<(tauri_plugin_updater::Update, Vec<u8>)>>,
    #[cfg(all(desktop, not(target_os = "linux")))]
    busy: std::sync::atomic::AtomicBool,
    #[cfg(all(desktop, not(target_os = "linux")))]
    cancel: tokio::sync::Notify,
}

#[cfg(all(desktop, not(target_os = "linux")))]
struct Operation<'a>(&'a std::sync::atomic::AtomicBool);

#[cfg(all(desktop, not(target_os = "linux")))]
impl Drop for Operation<'_> {
    fn drop(&mut self) { self.0.store(false, std::sync::atomic::Ordering::Release); }
}

#[cfg(all(desktop, not(target_os = "linux")))]
impl Pending {
    fn operation(&self) -> Result<Operation<'_>, String> {
        self.busy.compare_exchange(false, true, std::sync::atomic::Ordering::AcqRel, std::sync::atomic::Ordering::Acquire)
            .map_err(|_| "Hay una operación de actualización en curso.")?;
        Ok(Operation(&self.busy))
    }
}

/// La version que esta corriendo.
#[tauri::command]
pub fn app_version(app: tauri::AppHandle) -> String {
    app.package_info().version.to_string()
}

/// ¿Hay una version mas nueva publicada? `None` si ya es la ultima.
#[cfg(all(desktop, not(target_os = "linux")))]
#[tauri::command]
pub async fn check_app_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, Pending>,
) -> Result<Option<AppUpdate>, String> {
    use tauri_plugin_updater::UpdaterExt;

    let _operation = pending.operation()?;
    *pending.update.lock().map_err(|_| "estado bloqueado")? = None;
    *pending.prepared.lock().map_err(|_| "estado bloqueado")? = None;
    let before_exit = app.clone();
    let result = app.updater_builder()
        .on_before_exit(move || crate::remove_tray(&before_exit))
        .timeout(std::time::Duration::from_secs(30))
        .build().map_err(friendly)?.check().await;
    let update = match result {
        Ok(update) => update,
        Err(error) => return Err(friendly(error)),
    };

    let info = update.as_ref().map(|u| AppUpdate {
        version: u.version.clone(),
        current: u.current_version.clone(),
        notes: u.body.clone().filter(|b| !b.trim().is_empty()),
    });
    *pending.update.lock().map_err(|_| "estado bloqueado".to_string())? = update;
    Ok(info)
}

/// Descarga verificada, cancelable y reutilizable si falla la instalación.
#[cfg(all(desktop, not(target_os = "linux")))]
#[tauri::command]
pub async fn download_app_update(
    app: tauri::AppHandle,
    pending: tauri::State<'_, Pending>,
) -> Result<(), String> {
    use tauri::Emitter;
    let _operation = pending.operation()?;
    let update = pending.update.lock().map_err(|_| "estado bloqueado")?.clone()
        .ok_or("No hay ninguna actualización pendiente. Vuelve a buscarla.")?;
    *pending.prepared.lock().map_err(|_| "estado bloqueado")? = None;
    let cancelled = pending.cancel.notified();
    tokio::pin!(cancelled);
    cancelled.as_mut().enable();
    let mut downloaded = 0u64;
    let bytes = tokio::select! {
        result = update.download(
            |chunk, total| {
                downloaded += chunk as u64;
                let _ = app.emit("app-update-progress", serde_json::json!({"downloaded":downloaded,"total":total}));
            },
            || {},
        ) => result.map_err(friendly)?,
        _ = &mut cancelled => return Err("Descarga cancelada. Puedes volver a intentarlo.".into()),
    };
    *pending.prepared.lock().map_err(|_| "estado bloqueado")? = Some((update, bytes));
    Ok(())
}

#[cfg(all(desktop, not(target_os = "linux")))]
#[tauri::command]
pub fn cancel_app_update(pending: tauri::State<'_, Pending>) {
    pending.cancel.notify_waiters();
}

/// Instalar después de que la interfaz guarde la sesión más reciente.
#[cfg(all(desktop, not(target_os = "linux")))]
#[tauri::command]
pub fn install_app_update(app: tauri::AppHandle, pending: tauri::State<'_, Pending>) -> Result<(), String> {
    let _operation = pending.operation()?;
    let prepared = pending.prepared.lock().map_err(|_| "estado bloqueado")?.take()
        .ok_or("Descarga y verifica la actualización antes de instalarla.")?;
    let (update, bytes) = prepared;
    crate::commands::flush_data(&app)?;
    update.install(bytes).map_err(friendly)?;
    *pending.update.lock().map_err(|_| "estado bloqueado")? = None;
    crate::restart_clean(&app)
}

/// Los errores del actualizador, en palabras de persona.
#[cfg(all(desktop, not(target_os = "linux")))]
fn friendly(error: tauri_plugin_updater::Error) -> String {
    #[cfg(target_os = "macos")]
    if matches!(
        error,
        tauri_plugin_updater::Error::TargetNotFound(_) | tauri_plugin_updater::Error::TargetsNotFound(_)
    ) {
        return "La publicación consultada no incluye un paquete de Antares para macOS.".into();
    }

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

    #[cfg(all(desktop, not(target_os = "linux")))]
    #[tokio::test]
    async fn concurrent_update_operations_and_cancel_retry() {
        let pending = super::Pending::default();
        let operation = pending.operation().unwrap();
        assert!(pending.operation().is_err());
        let cancelled = pending.cancel.notified();
        tokio::pin!(cancelled);
        cancelled.as_mut().enable();
        pending.cancel.notify_waiters();
        tokio::time::timeout(std::time::Duration::from_millis(100), &mut cancelled).await.unwrap();
        drop(operation);
        assert!(pending.operation().is_ok());
        // Una cancelación finalizada no queda pendiente para el siguiente intento.
        assert!(tokio::time::timeout(std::time::Duration::ZERO, pending.cancel.notified()).await.is_err());
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

// El canal publicado actualmente solo contiene paquetes de Windows.
#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn check_app_update() -> Result<Option<AppUpdate>, String> {
    Err("Todavía no hay un canal de actualizaciones para Linux.".to_string())
}

#[cfg(target_os = "linux")]
#[tauri::command]
pub async fn install_app_update() -> Result<(), String> {
    Err("La versión Linux se actualiza desde su código o paquete de Linux.".to_string())
}

#[cfg(any(mobile, target_os = "linux"))]
#[tauri::command]
pub async fn download_app_update() -> Result<(), String> {
    Err("Este sistema no tiene un canal de actualizaciones de escritorio.".into())
}
#[cfg(any(mobile, target_os = "linux"))]
#[tauri::command]
pub fn cancel_app_update() {}
