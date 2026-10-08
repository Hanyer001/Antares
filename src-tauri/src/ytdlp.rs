//! Extraccion nativa de audio; yt-dlp se conserva para busquedas y listas.

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(desktop)]
use rusty_ytdl::{Video, VideoFormat};

use crate::track::{SearchResult, TrackInfo};

/// Separador entre metadatos. Usamos el "unit separator" de ASCII (0x1F) porque
/// es un caracter de control: no puede aparecer dentro de un titulo ni del
/// nombre de un canal, asi que el parseo nunca se rompe por el contenido.
const FIELD_SEP: &str = "\u{1f}";

/// Evita que Windows abra una ventana negra de consola en cada llamada.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(windows)]
pub const YTDLP_BIN: &str = "yt-dlp.exe";
#[cfg(not(windows))]
pub const YTDLP_BIN: &str = "yt-dlp";

/// Si se resuelve en modo ahorro de datos. Lo pone `save_settings` al cambiar
/// el ajuste (y el arranque), que ademas vacia la cache de URLs.
static DATA_SAVER: AtomicBool = AtomicBool::new(false);

pub fn set_data_saver(enabled: bool) {
    DATA_SAVER.store(enabled, Ordering::Relaxed);
}

/// Si esta puesto el ahorro de datos (tambien lo lee el cliente propio).
pub fn data_saver() -> bool {
    DATA_SAVER.load(Ordering::Relaxed)
}

/// Directorio de datos del usuario, puesto una vez al arrancar.
///
/// Lo necesita `find_ytdlp` para poder preferir la version que haya descargado
/// el actualizador. Es un `OnceLock` y no un parametro porque `find_ytdlp` se
/// llama desde sitios muy distintos y arrastrar la ruta por todos ensuciaria
/// media API por un dato que no cambia nunca.
static DATA_DIR: OnceLock<PathBuf> = OnceLock::new();

pub fn set_data_dir(dir: PathBuf) {
    let _ = DATA_DIR.set(dir);
}

/// Donde el actualizador deja la copia al dia.
///
/// Va en el directorio de datos del usuario y NO junto al ejecutable: una vez
/// instalada la app en Program Files, ahi no se puede escribir sin permisos de
/// administrador. Ese es tambien el motivo de no usar `yt-dlp -U`.
pub fn managed_path() -> Option<PathBuf> {
    Some(DATA_DIR.get()?.join("bin").join(YTDLP_BIN))
}

/// Version del binario que se esta usando ahora mismo.
///
/// Se le pregunta al propio ejecutable en vez de fiarnos de un numero guardado:
/// si el usuario cambio el sidecar a mano, esto lo refleja y un valor cacheado
/// no lo haria.
pub fn installed_version() -> Option<String> {
    let output = command().arg("--version").output().ok()?;

    if !output.status.success() {
        return None;
    }

    let version = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if version.is_empty() {
        None
    } else {
        Some(version)
    }
}

/// Busca el binario en el orden en que puede existir segun el entorno:
///
/// 0. La copia descargada por el actualizador. Va PRIMERA a proposito: es la
///    unica que se mantiene al dia, y si perdiera contra la del instalador, todo
///    el actualizador no serviria de nada.
/// 1. Junto al ejecutable de la app. Asi es como Tauri deja el sidecar en
///    produccion (al empaquetar le quita el sufijo del target-triple).
/// 2. `src-tauri/binaries/yt-dlp-<target-triple>.exe`, donde vive el sidecar
///    mientras desarrollas.
/// 3. `src-tauri/yt-dlp.exe`, por si lo dejaste suelto en la raiz.
/// 4. Como ultimo recurso, el nombre pelado para que lo resuelva el PATH.
fn find_ytdlp() -> PathBuf {
    if let Some(managed) = managed_path() {
        if managed.is_file() {
            return managed;
        }
    }

    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            let candidate = dir.join(YTDLP_BIN);
            if candidate.is_file() {
                return candidate;
            }
        }
    }

    let manifest_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"));

    // El sidecar en desarrollo lleva el target-triple pegado al nombre
    // (yt-dlp-x86_64-pc-windows-msvc.exe), asi que buscamos por prefijo en vez
    // de intentar adivinar el triple exacto.
    if let Ok(entries) = std::fs::read_dir(manifest_dir.join("binaries")) {
        for entry in entries.flatten() {
            let path = entry.path();
            let is_ytdlp = path
                .file_name()
                .and_then(|n| n.to_str())
                .map(|n| n.starts_with("yt-dlp"))
                .unwrap_or(false);

            if is_ytdlp && path.is_file() {
                return path;
            }
        }
    }

    let loose = manifest_dir.join(YTDLP_BIN);
    if loose.is_file() {
        return loose;
    }

    PathBuf::from("yt-dlp")
}

/// `Command` ya configurado para el sistema operativo actual.
fn command() -> Command {
    let mut cmd = Command::new(find_ytdlp());

    // Sin esto, en Windows yt-dlp escribe en la pagina de codigos del sistema
    // (cp1252) cuando su salida va a un pipe, y cada tilde o eñe de un titulo
    // llega como "�" al leerla como UTF-8. Ni PYTHONIOENCODING ni PYTHONUTF8
    // lo cambian en el .exe de PyInstaller; esta opcion si.
    cmd.args(["--encoding", "utf-8"]);

    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);

    cmd
}

/// Se queda con la ultima linea util de stderr: yt-dlp escupe mucho ruido y el
/// mensaje que de verdad explica el fallo suele ser el del final.
fn extract_error(stderr: &[u8]) -> String {
    String::from_utf8_lossy(stderr)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .last()
        .unwrap_or("yt-dlp termino con un error desconocido.")
        .to_string()
}

/// Convierte un campo de la plantilla en `Option`: vacio o `NA` es "no hay".
fn field(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();

    if value.is_empty() || value == "NA" {
        None
    } else {
        Some(value.to_string())
    }
}

/// Conserva las busquedas por texto y pasa las URLs o IDs directamente.
pub fn build_target(query: &str) -> String {
    let query = query.trim();

    if query.starts_with("http") || crate::innertube::video_id(query).is_some() {
        query.to_string()
    } else {
        format!("ytsearch1:{query}")
    }
}

/// Solo audio primero; si no existe, permite un stream con audio y video.
#[cfg(desktop)]
fn select_audio(formats: &[VideoFormat], saver: bool) -> Result<&VideoFormat, String> {
    let playable = |format: &&VideoFormat| {
        format.has_audio
            && (format.url.starts_with("https://") || format.url.starts_with("http://"))
    };
    let audio_only = formats.iter().filter(playable).any(|f| !f.has_video);
    let candidates = || {
        formats
            .iter()
            .filter(playable)
            .filter(|f| !audio_only || !f.has_video)
    };
    // En formatos solo audio el bitrate total mide el stream real; en formatos
    // combinados, audio_bitrate esta expresado en kbps.
    let bitrate = |f: &&VideoFormat| {
        if f.has_video {
            f.audio_bitrate.unwrap_or(0).saturating_mul(1000)
        } else {
            f.bitrate
        }
    };

    if saver {
        if let Some(format) = candidates()
            .filter(|f| bitrate(f) > 0 && bitrate(f) <= 72_000)
            .max_by_key(bitrate)
        {
            return Ok(format);
        }
        return candidates()
            .min_by_key(bitrate)
            .ok_or_else(|| "El video no contiene un stream de audio disponible.".to_string());
    }

    candidates()
        .max_by_key(bitrate)
        .ok_or_else(|| "El video no contiene un stream de audio disponible.".to_string())
}

/// Devuelve la misma URL directa y metadatos usando rusty_ytdl, sin procesos.
/// `safe` se conserva por compatibilidad: el reintento vuelve a extraer el video.
#[cfg(desktop)]
pub async fn resolve_track(target: String, _safe: bool) -> Result<TrackInfo, String> {
    let target = target.trim();
    // El backend tambien permite reproducir el primer resultado de un texto.
    // Esa compatibilidad usa la busqueda nativa existente, sin lanzar yt-dlp.
    let target = if let Some(query) = target.strip_prefix("ytsearch1:") {
        crate::innertube::search_tracks(query, 1)
            .await?
            .into_iter()
            .next()
            .map(|track| track.id)
            .ok_or_else(|| "No encontré esa canción. Prueba con otras palabras.".to_string())?
    } else {
        target.to_string()
    };
    let video = Video::new(&target)
        .map_err(|e| format!("No se pudo abrir el video con rusty_ytdl: {e}"))?;
    let info = tokio::time::timeout(std::time::Duration::from_secs(30), video.get_info())
        .await
        .map_err(|_| "Se agotó el tiempo al extraer el audio de YouTube.".to_string())?
        .map_err(|e| format!("No se pudo extraer el audio con rusty_ytdl: {e}"))?;
    let url = select_audio(&info.formats, data_saver())?.url.clone();
    let details = info.video_details;

    Ok(TrackInfo {
        url,
        title: field(Some(&details.title)),
        uploader: details
            .author
            .as_ref()
            .and_then(|author| field(Some(&author.name)))
            .or_else(|| field(Some(&details.owner_channel_name))),
        duration: if details.is_live_content {
            None
        } else {
            details.length_seconds.parse().ok()
        },
        thumbnail: details
            .thumbnails
            .iter()
            .max_by_key(|t| (t.width, t.height))
            .and_then(|t| field(Some(&t.url))),
        id: field(Some(&details.video_id)),
    })
}

// ---------------------------------------------------------------------------
// Busqueda de candidatos
// ---------------------------------------------------------------------------

/// Plantilla para la busqueda plana. El orden importa: lo lee `parse_search`.
#[cfg(mobile)]
pub async fn resolve_track(target: String, _safe: bool) -> Result<TrackInfo, String> {
    crate::innertube::resolve_track(target.strip_prefix("ytsearch1:").unwrap_or(&target), data_saver()).await
}

fn search_template() -> String {
    [
        "%(id|)s",
        "%(title|)s",
        "%(channel,uploader|)s",
        "%(duration|)s",
        "%(thumbnail|)s",
    ]
    .join(FIELD_SEP)
}

/// Miniatura por convencion cuando la busqueda plana no la trae.
///
/// YouTube sirve todas las miniaturas bajo el mismo patron de ruta, asi que con
/// el id basta. `mqdefault` (320x180) es de sobra para una fila de 36 px y pesa
/// una decima parte que la grande.
fn thumbnail_for(id: &str) -> String {
    format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg")
}

fn parse_search(stdout: &[u8]) -> Vec<SearchResult> {
    String::from_utf8_lossy(stdout)
        .lines()
        .filter(|line| line.contains(FIELD_SEP))
        .filter_map(|line| {
            let mut parts = line.split(FIELD_SEP);

            // Sin id no hay nada que reproducir despues: la fila se descarta.
            let id = field(parts.next())?;

            let title = field(parts.next());
            let uploader = field(parts.next());
            let duration = field(parts.next()).and_then(|d| d.parse::<f64>().ok());
            let thumbnail = field(parts.next()).or_else(|| Some(thumbnail_for(&id)));

            Some(SearchResult { is_music: None,
                watch_url: SearchResult::watch_url_for(&id),
                id,
                title,
                uploader,
                duration,
                thumbnail,
            })
        })
        .collect()
}

/// Lista los primeros `limit` resultados de YouTube para una busqueda.
///
/// La clave del rendimiento es `--flat-playlist`: yt-dlp se queda con lo que le
/// devolvio la pagina de resultados y NO entra en cada video a extraer formatos.
/// Por eso pedir cinco candidatos cuesta casi lo mismo que pedir uno, y bastante
/// menos que una resolucion completa: es una sola peticion y sin reto de
/// JavaScript.
///
/// Tampoco pasamos `-f` ni `--extractor-args`: no hay seleccion de formato que
/// hacer aqui, y cada argumento de mas es trabajo que yt-dlp no necesita.
pub async fn search_tracks(query: String, limit: usize) -> Result<Vec<SearchResult>, String> {
    let target = format!("ytsearch{limit}:{}", query.trim());
    let stdout = run_flat(target, search_template(), Vec::new()).await?;

    Ok(parse_search(&stdout))
}

/// Lanza yt-dlp en modo plano (`--flat-playlist`) y devuelve su stdout.
///
/// Es el modo que comparten la busqueda y la importacion de listas: yt-dlp se
/// queda con lo que le da la pagina de resultados o de la lista, sin entrar en
/// cada video.
async fn run_flat(target: String, template: String, extra: Vec<&'static str>) -> Result<Vec<u8>, String> {
    tokio::task::spawn_blocking(move || {
        let output = command()
            .args([
                "--ignore-config",
                "--no-warnings",
                "--quiet",
                "--flat-playlist",
                "-4",
                "--socket-timeout",
                "8",
            ])
            .args(extra)
            .args(["--print", &template, &target])
            .output()
            .map_err(|e| format!("No se pudo ejecutar yt-dlp: {e}"))?;

        if !output.status.success() {
            return Err(format!("yt-dlp fallo: {}", extract_error(&output.stderr)));
        }

        Ok(output.stdout)
    })
    .await
    .map_err(|e| format!("Fallo interno al ejecutar la tarea: {e}"))?
}

// ---------------------------------------------------------------------------
// Importacion de listas de YouTube
// ---------------------------------------------------------------------------

/// Tope de pistas al importar. Cubre cualquier lista personal razonable, y corta
/// los "Mix" de YouTube, que son practicamente infinitos.
pub const PLAYLIST_LIMIT: &str = "500";

/// La plantilla de busqueda mas el titulo de la lista al final. Asi
/// `parse_search` sirve tal cual: lee los cinco primeros campos e ignora el
/// sexto, que recogemos aparte.
fn playlist_template() -> String {
    format!("{}{FIELD_SEP}%(playlist_title|)s", search_template())
}

/// El titulo de la lista, que yt-dlp repite en cada linea: basta con la primera.
fn parse_playlist_title(stdout: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(stdout);
    let line = text.lines().find(|line| line.contains(FIELD_SEP))?;

    field(line.split(FIELD_SEP).nth(5))
}

/// YouTube conserva en las listas los videos que ya no existen, con un titulo
/// de marcador y sin nada que reproducir.
fn is_unavailable(track: &SearchResult) -> bool {
    matches!(
        track.title.as_deref(),
        Some("[Private video]" | "[Deleted video]" | "[Unavailable video]")
    )
}

/// Lee una lista de YouTube: su titulo, si lo tiene, y sus primeras `limit`
/// pistas.
pub async fn list_playlist(
    url: String,
    limit: &'static str,
) -> Result<(Option<String>, Vec<SearchResult>), String> {
    let stdout = run_flat(
        url.trim().to_string(),
        playlist_template(),
        // Un enlace de video dentro de una lista (`watch?v=X&list=Y`) debe
        // traer la lista entera, no solo el video.
        vec!["--yes-playlist", "--playlist-end", limit],
    )
    .await?;

    let title = parse_playlist_title(&stdout);
    let tracks = parse_search(&stdout)
        .into_iter()
        .filter(|t| !is_unavailable(t))
        .collect();

    Ok((title, tracks))
}

/// El .exe de yt-dlp es un bundle de PyInstaller que se descomprime en %TEMP% en
/// cada arranque, y en Windows encima pasa por el antivirus: ~1.000 ms medidos.
///
/// Lanzar un `--version` en segundo plano al abrir la app deja la cache de disco
/// caliente para que la primera busqueda real no lo pague.
pub fn warm_up() {
    std::thread::spawn(|| {
        let _ = command().arg("--version").output();
    });
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[test]
    fn un_texto_normal_se_convierte_en_busqueda() {
        assert_eq!(build_target("radiohead creep"), "ytsearch1:radiohead creep");
    }

    #[test]
    fn un_enlace_se_pasa_tal_cual() {
        let url = "https://www.youtube.com/watch?v=XFkzRNyygfk";
        assert_eq!(build_target(url), url);
    }

    #[test]
    fn los_espacios_de_los_extremos_se_recortan() {
        assert_eq!(build_target("  creep  "), "ytsearch1:creep");
    }

    #[test]
    fn un_id_se_pasa_directamente() {
        assert_eq!(build_target("  XFkzRNyygfk  "), "XFkzRNyygfk");
    }

    fn format(bitrate: u64, audio: bool, video: bool) -> VideoFormat {
        serde_json::from_value(serde_json::json!({
            "itag": 1, "mimeType": "audio/webm; codecs=\"opus\"",
            "bitrate": bitrate, "url": format!("https://audio.example/{bitrate}"),
            "hasAudio": audio, "hasVideo": video,
            "isLive": false, "isHLS": false, "isDashMPD": false
        }))
        .unwrap()
    }

    #[test]
    fn prioriza_solo_audio_y_el_mayor_bitrate() {
        let formats = [
            format(128_000, true, false),
            format(160_000, true, false),
            format(1_000_000, true, true),
            format(2_000_000, false, true),
        ];
        assert_eq!(select_audio(&formats, false).unwrap().bitrate, 160_000);
    }

    #[test]
    fn ahorro_elige_el_mejor_hasta_72_kbps_o_el_menor() {
        let formats = [
            format(48_000, true, false),
            format(64_000, true, false),
            format(160_000, true, false),
        ];
        assert_eq!(select_audio(&formats, true).unwrap().bitrate, 64_000);
        let formats = [format(128_000, true, false), format(160_000, true, false)];
        assert_eq!(select_audio(&formats, true).unwrap().bitrate, 128_000);
    }

    #[test]
    fn admite_audio_con_video_si_no_hay_solo_audio() {
        let mut low = format(1_000_000, true, true);
        low.audio_bitrate = Some(96);
        let mut high = format(800_000, true, true);
        high.audio_bitrate = Some(128);
        let formats = [low, high];
        assert_eq!(
            select_audio(&formats, false).unwrap().audio_bitrate,
            Some(128)
        );
    }

    #[test]
    fn rechaza_formatos_sin_audio_o_sin_url_directa() {
        let mut invalid = format(160_000, true, false);
        invalid.url.clear();
        let formats = [format(1_000_000, false, true), invalid];
        assert!(select_audio(&formats, false).is_err());
        assert!(select_audio(&[], false).is_err());
    }

    #[tokio::test]
    async fn rechaza_una_url_invalida_sin_panic() {
        let error = resolve_track("https://example.com/invalid".to_string(), false)
            .await
            .err()
            .expect("debe rechazar una URL ajena a YouTube");
        assert!(error.contains("rusty_ytdl"));
    }

    // --- Busqueda ---------------------------------------------------------

    fn linea_busqueda(campos: &[&str]) -> String {
        campos.join(FIELD_SEP)
    }

    #[test]
    fn parsea_varios_resultados_de_busqueda() {
        let stdout = [
            linea_busqueda(&["aaa11111111", "Creep", "Radiohead", "238", ""]),
            linea_busqueda(&["bbb22222222", "Creep (Live)", "Otro", "245", ""]),
        ]
        .join("\n")
        .into_bytes();

        let results = parse_search(&stdout);

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].id, "aaa11111111");
        assert_eq!(results[0].title.as_deref(), Some("Creep"));
        assert_eq!(results[0].uploader.as_deref(), Some("Radiohead"));
        assert_eq!(results[0].duration, Some(238.0));
        assert_eq!(results[1].title.as_deref(), Some("Creep (Live)"));
    }

    #[test]
    fn construye_la_url_de_reproduccion_desde_el_id() {
        let stdout = linea_busqueda(&["XFkzRNyygfk", "T", "C", "1", ""]).into_bytes();
        let results = parse_search(&stdout);

        assert_eq!(
            results[0].watch_url,
            "https://www.youtube.com/watch?v=XFkzRNyygfk"
        );
    }

    #[test]
    fn sin_miniatura_la_deduce_del_id() {
        // La busqueda plana no siempre trae miniatura; el patron de ytimg si es
        // predecible, asi que no dejamos la fila sin imagen por eso.
        let stdout = linea_busqueda(&["XFkzRNyygfk", "T", "C", "1", ""]).into_bytes();
        let results = parse_search(&stdout);

        assert_eq!(
            results[0].thumbnail.as_deref(),
            Some("https://i.ytimg.com/vi/XFkzRNyygfk/mqdefault.jpg")
        );
    }

    #[test]
    fn respeta_la_miniatura_que_si_venga() {
        let propia = "https://i.ytimg.com/vi/x/maxres.jpg";
        let stdout = linea_busqueda(&["XFkzRNyygfk", "T", "C", "1", propia]).into_bytes();

        assert_eq!(parse_search(&stdout)[0].thumbnail.as_deref(), Some(propia));
    }

    #[test]
    fn descarta_las_filas_sin_id() {
        // Sin id no hay nada que resolver despues, asi que esa fila no sirve.
        let stdout = [
            linea_busqueda(&["", "Sin id", "C", "1", ""]),
            linea_busqueda(&["bueno111111", "Con id", "C", "1", ""]),
        ]
        .join("\n")
        .into_bytes();

        let results = parse_search(&stdout);

        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "bueno111111");
    }

    #[test]
    fn ignora_lineas_que_no_son_resultados() {
        let stdout = b"Downloading playlist\nWARNING: algo\n";
        assert!(parse_search(stdout).is_empty());
    }

    // --- Importacion de listas --------------------------------------------

    #[test]
    fn la_plantilla_de_listas_anade_el_titulo_al_final() {
        let campos: Vec<String> = playlist_template()
            .split(FIELD_SEP)
            .map(String::from)
            .collect();

        assert_eq!(campos.len(), 6);
        assert_eq!(campos[5], "%(playlist_title|)s");
    }

    #[test]
    fn lee_el_titulo_y_las_pistas_de_una_lista() {
        let stdout = [
            linea_busqueda(&["aaa11111111", "Uno", "C", "100", "", "Para correr"]),
            linea_busqueda(&["bbb22222222", "Dos", "C", "200", "", "Para correr"]),
        ]
        .join("\n")
        .into_bytes();

        assert_eq!(parse_playlist_title(&stdout).as_deref(), Some("Para correr"));

        // El sexto campo no molesta al parseo de pistas.
        let pistas = parse_search(&stdout);
        assert_eq!(pistas.len(), 2);
        assert_eq!(pistas[1].title.as_deref(), Some("Dos"));
    }

    #[test]
    fn una_lista_sin_titulo_da_none() {
        let stdout = linea_busqueda(&["aaa11111111", "Uno", "C", "100", "", ""]).into_bytes();
        assert_eq!(parse_playlist_title(&stdout), None);
    }

    #[test]
    fn descarta_los_videos_borrados_o_privados() {
        let mut pista = parse_search(
            linea_busqueda(&["aaa11111111", "[Private video]", "", "", ""]).as_bytes(),
        )
        .remove(0);

        assert!(is_unavailable(&pista));

        pista.title = Some("Cancion normal".to_string());
        assert!(!is_unavailable(&pista));
    }

    #[test]
    fn el_error_es_la_ultima_linea_util_de_stderr() {
        let stderr = b"WARNING: ruido\n\nERROR: Video unavailable\n\n";
        assert_eq!(extract_error(stderr), "ERROR: Video unavailable");
    }

    #[test]
    fn un_stderr_vacio_da_un_mensaje_por_defecto() {
        assert!(!extract_error(b"").is_empty());
    }
}
