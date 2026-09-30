//! Actualiza yt-dlp en el directorio de datos del usuario para evitar permisos
//! de administrador. Verifica que el binario arranque antes de sustituirlo.
//! Si la actualización falla, conserva la versión instalada.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::store::{read_json, write_json_atomic};
use crate::ytdlp;

const RELEASES_URL: &str = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";

/// GitHub rechaza las peticiones a su API sin User-Agent.
const USER_AGENT: &str = "Antares/0.1 (music player; +https://github.com/yt-dlp/yt-dlp)";

/// Una comprobacion al dia basta: yt-dlp publica cada pocas semanas, y la API de
/// GitHub limita a 60 peticiones por hora sin autenticar.
const CHECK_INTERVAL_SECS: u64 = 24 * 60 * 60;

const METADATA_TIMEOUT: Duration = Duration::from_secs(20);
const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(300);

/// Descarta respuestas absurdamente pequenas antes de molestarse en verificarlas:
/// el binario real ronda los 18 MB, asi que menos de 5 no puede ser correcto.
const MIN_PLAUSIBLE_BYTES: usize = 5 * 1024 * 1024;

const STATE_FILE: &str = "updater.json";

/// Como se llama el binario dentro de la release de GitHub, que no coincide con
/// como se llama en disco en todas las plataformas.
#[cfg(windows)]
const ASSET_NAME: &str = "yt-dlp.exe";
#[cfg(target_os = "macos")]
const ASSET_NAME: &str = "yt-dlp_macos";
#[cfg(all(unix, not(target_os = "macos")))]
const ASSET_NAME: &str = "yt-dlp";

#[derive(Default, Serialize, Deserialize)]
struct UpdaterState {
    /// Cuando se miro por ultima vez, se encontrara algo o no.
    last_check: u64,
}

/// Solo los campos que usamos. Serde ignora el resto de la respuesta, que es
/// enorme.
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    #[serde(default)]
    assets: Vec<Asset>,
}

#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
}

/// Que paso en una comprobacion.
pub enum Outcome {
    /// Ya estaba al dia, o aun no tocaba mirar.
    UpToDate,
    /// Se instalo una version nueva.
    Updated(String),
}

// ---------------------------------------------------------------------------
// Comparacion de versiones
// ---------------------------------------------------------------------------

/// Las versiones de yt-dlp son fechas: `2025.08.11`, a veces con un cuarto
/// numero en las nocturnas. Comparamos numero a numero en vez de como texto,
/// porque `2025.9.1` y `2025.09.01` han existido las dos y como cadenas se
/// ordenan mal.
fn is_newer(candidate: &str, installed: &str) -> bool {
    let parse = |v: &str| -> Vec<u64> {
        v.trim()
            .split('.')
            .map(|part| part.trim().parse::<u64>().unwrap_or(0))
            .collect()
    };

    let a = parse(candidate);
    let b = parse(installed);

    // Si alguna no parece una version, no arriesgamos: nos quedamos con la que
    // ya funciona.
    if a.is_empty() || b.is_empty() || a.iter().all(|n| *n == 0) {
        return false;
    }

    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);

        if x != y {
            return x > y;
        }
    }

    false
}

fn pick_asset(release: &Release) -> Option<&Asset> {
    release.assets.iter().find(|a| a.name == ASSET_NAME)
}

// ---------------------------------------------------------------------------
// Estado en disco
// ---------------------------------------------------------------------------

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn state_path(dir: &Path) -> PathBuf {
    dir.join(STATE_FILE)
}

fn due_for_check(dir: &Path) -> bool {
    let state: UpdaterState = read_json(&state_path(dir)).unwrap_or_default();
    now_secs().saturating_sub(state.last_check) >= CHECK_INTERVAL_SECS
}

/// Se marca ANTES de descargar, no despues.
///
/// Si la descarga falla, no queremos reintentarla en cada arranque: con GitHub
/// caido o sin red, eso serian peticiones inutiles cada vez que abres la app.
/// Mejor esperar al dia siguiente.
fn mark_checked(dir: &Path) {
    let _ = write_json_atomic(
        &state_path(dir),
        &UpdaterState {
            last_check: now_secs(),
        },
    );
}

// ---------------------------------------------------------------------------
// Instalacion
// ---------------------------------------------------------------------------

/// Comprueba que lo descargado es de verdad un yt-dlp que arranca en esta
/// maquina.
///
/// Es la red de seguridad contra descargas truncadas y contra bajarse el binario
/// de otra arquitectura: si esto falla, el fichero se tira y la app sigue con el
/// que ya tenia.
fn binary_works(path: &Path) -> bool {
    let mut cmd = std::process::Command::new(path);

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000);
    }

    let Ok(output) = cmd.arg("--version").output() else {
        return false;
    };

    if !output.status.success() {
        return false;
    }

    // Una version de yt-dlp siempre empieza por el ano.
    String::from_utf8_lossy(&output.stdout)
        .trim()
        .starts_with(|c: char| c.is_ascii_digit())
}

fn install(bytes: &[u8], target: &Path) -> Result<(), String> {
    if bytes.len() < MIN_PLAUSIBLE_BYTES {
        return Err(format!(
            "la descarga son solo {} bytes, no puede ser el binario",
            bytes.len()
        ));
    }

    let parent = target
        .parent()
        .ok_or_else(|| "ruta de destino sin directorio".to_string())?;

    std::fs::create_dir_all(parent).map_err(|e| format!("no se pudo crear {parent:?}: {e}"))?;

    // Se escribe aparte y solo se pone en su sitio si arranca. Mientras tanto, la
    // version anterior sigue siendo la que usa la app.
    let staged = target.with_extension("part");
    std::fs::write(&staged, bytes).map_err(|e| format!("no se pudo escribir: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&staged, std::fs::Permissions::from_mode(0o755));
    }

    if !binary_works(&staged) {
        let _ = std::fs::remove_file(&staged);
        return Err("lo descargado no se ejecuta; se descarta".to_string());
    }

    // El renombrado sustituye al anterior de golpe. Puede fallar si justo ahora
    // hay una resolucion en curso usando ese fichero; no pasa nada, se reintenta
    // manana.
    std::fs::rename(&staged, target).map_err(|e| {
        let _ = std::fs::remove_file(&staged);
        format!("no se pudo reemplazar el binario: {e}")
    })
}

// ---------------------------------------------------------------------------
// Comprobacion
// ---------------------------------------------------------------------------

/// Mira si hay version nueva y, si la hay, la instala.
///
/// `force` salta el limite de una comprobacion al dia, para el boton manual.
pub fn check(dir: &Path, force: bool) -> Result<Outcome, String> {
    if !force && !due_for_check(dir) {
        return Ok(Outcome::UpToDate);
    }

    mark_checked(dir);

    let client = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(METADATA_TIMEOUT)
        .build()
        .map_err(|e| format!("no se pudo crear el cliente HTTP: {e}"))?;

    let body = client
        .get(RELEASES_URL)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.text())
        .map_err(|e| format!("no se pudo consultar GitHub: {e}"))?;

    let release: Release =
        serde_json::from_str(&body).map_err(|e| format!("respuesta de GitHub ilegible: {e}"))?;

    let latest = release.tag_name.trim().to_string();

    // Sin version instalada legible (primer arranque sin sidecar, o binario roto)
    // instalamos igualmente: es la unica forma de salir de ese agujero.
    let installed = ytdlp::installed_version();

    if let Some(current) = &installed {
        if !is_newer(&latest, current) {
            return Ok(Outcome::UpToDate);
        }
    }

    let asset = pick_asset(&release)
        .ok_or_else(|| format!("la release {latest} no trae {ASSET_NAME}"))?;

    let target = ytdlp::managed_path()
        .ok_or_else(|| "no hay directorio de datos configurado".to_string())?;

    let downloader = reqwest::blocking::Client::builder()
        .user_agent(USER_AGENT)
        .timeout(DOWNLOAD_TIMEOUT)
        .build()
        .map_err(|e| format!("no se pudo crear el cliente de descarga: {e}"))?;

    let bytes = downloader
        .get(&asset.browser_download_url)
        .send()
        .and_then(|r| r.error_for_status())
        .and_then(|r| r.bytes())
        .map_err(|e| format!("no se pudo descargar yt-dlp: {e}"))?;

    install(&bytes, &target)?;

    Ok(Outcome::Updated(latest))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn una_fecha_posterior_es_mas_nueva() {
        assert!(is_newer("2025.08.11", "2025.07.21"));
        assert!(is_newer("2026.01.02", "2025.12.31"));
    }

    #[test]
    fn la_misma_version_no_es_mas_nueva() {
        assert!(!is_newer("2025.08.11", "2025.08.11"));
    }

    #[test]
    fn no_se_degrada_a_una_version_anterior() {
        assert!(!is_newer("2025.07.21", "2025.08.11"));
    }

    #[test]
    fn compara_numeros_y_no_texto() {
        // Como cadenas, "2025.9.1" < "2025.10.1" seria falso: '9' > '1'. Por eso
        // la comparacion va segmento a segmento y como numero.
        assert!(is_newer("2025.10.1", "2025.9.1"));
        assert!(!is_newer("2025.9.1", "2025.10.1"));
    }

    #[test]
    fn una_nocturna_con_cuarto_segmento_gana_a_la_estable_del_dia() {
        assert!(is_newer("2025.08.11.232919", "2025.08.11"));
        assert!(!is_newer("2025.08.11", "2025.08.11.232919"));
    }

    #[test]
    fn una_version_ilegible_no_dispara_actualizacion() {
        // Ante la duda, nos quedamos con lo que ya funciona.
        assert!(!is_newer("no-es-una-version", "2025.08.11"));
        assert!(!is_newer("", "2025.08.11"));
    }

    #[test]
    fn elige_el_asset_de_esta_plataforma() {
        let release = Release {
            tag_name: "2025.08.11".to_string(),
            assets: vec![
                Asset {
                    name: "yt-dlp_linux".to_string(),
                    browser_download_url: "https://example/linux".to_string(),
                },
                Asset {
                    name: ASSET_NAME.to_string(),
                    browser_download_url: "https://example/correcto".to_string(),
                },
            ],
        };

        assert_eq!(
            pick_asset(&release).map(|a| a.browser_download_url.as_str()),
            Some("https://example/correcto")
        );
    }

    #[test]
    fn sin_el_asset_correcto_no_elige_ninguno() {
        let release = Release {
            tag_name: "2025.08.11".to_string(),
            assets: vec![Asset {
                name: "yt-dlp_otra_cosa".to_string(),
                browser_download_url: "https://example/no".to_string(),
            }],
        };

        assert!(pick_asset(&release).is_none());
    }

    #[test]
    fn una_descarga_diminuta_se_rechaza_sin_tocar_el_binario() {
        let dir = std::env::temp_dir().join(format!("antares-upd-{}", now_secs()));
        let target = dir.join("yt-dlp-falso");

        let error = install(b"cuatro bytes no son un binario", &target).unwrap_err();

        assert!(error.contains("bytes"), "mensaje inesperado: {error}");
        assert!(!target.exists(), "no debe dejar nada instalado");
        assert!(
            !target.with_extension("part").exists(),
            "ni temporales sueltos"
        );
    }

    #[test]
    fn el_intervalo_respeta_una_comprobacion_al_dia() {
        let dir = std::env::temp_dir().join(format!("antares-upd-int-{}", now_secs()));
        std::fs::create_dir_all(&dir).unwrap();

        assert!(due_for_check(&dir), "sin estado previo, toca mirar");

        mark_checked(&dir);
        assert!(!due_for_check(&dir), "recien mirado, no toca");

        let _ = std::fs::remove_dir_all(&dir);
    }
}
