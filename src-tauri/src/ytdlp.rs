//! Localización, ejecución y lectura de la salida de yt-dlp.

use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

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

/// Modo rapido. El cliente `android` de InnerTube devuelve URLs sin el parametro
/// `n` cifrado, asi que yt-dlp se salta la descarga del JS del reproductor y su
/// interpretacion, que es lo mas caro de la extraccion. Medido: ~420 ms menos.
///
/// AVISO: YouTube endurece los requisitos de este cliente cada pocos meses. Puede
/// dejar de funcionar, o devolver una URL que luego el navegador rechaza con 403.
/// Por eso nunca se usa solo: siempre hay caida al modo seguro.
const EXTRACTOR_ARGS_FAST: &str = "youtube:skip=hls,dash;player_client=android";

/// Modo seguro: sin forzar cliente, dejando que yt-dlp elija. Mas lento pero es
/// el que aguanta cuando el rapido deja de servir.
const EXTRACTOR_ARGS_SAFE: &str = "youtube:skip=hls,dash";

/// Formato de audio: el mejor M4A (AAC ~128 kbps), que WebView2 reproduce
/// siempre.
const FORMAT_HIGH: &str = "bestaudio[ext=m4a]/bestaudio/best";

/// Ahorro de datos: el mejor audio que no pase de ~70 kbps (Opus 50-70 o AAC
/// 48), menos de la mitad de datos. Si no lo hay, el peor audio disponible.
const FORMAT_SAVER: &str = "bestaudio[abr<=72]/worstaudio/best";

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

fn audio_format() -> &'static str {
    if DATA_SAVER.load(Ordering::Relaxed) {
        FORMAT_SAVER
    } else {
        FORMAT_HIGH
    }
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

/// Plantilla de metadatos para `--print`.
///
/// `%(a,b|)s` significa "usa `a`, si no existe `b`, y si ninguno, cadena vacia".
/// Sin ese `|` yt-dlp escribiria literalmente `NA`, que luego habria que
/// distinguir de un titulo que de verdad diga NA.
fn metadata_template() -> String {
    [
        "%(title|)s",
        "%(channel,uploader|)s",
        "%(duration|)s",
        "%(thumbnail|)s",
        "%(id|)s",
    ]
    .join(FIELD_SEP)
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

/// Interpreta la salida de yt-dlp sin depender del orden de las lineas.
///
/// La URL de audio es la primera linea que empieza por http y NO lleva
/// separador; los metadatos son la linea que si lo lleva. Distinguirlas asi
/// importa porque la miniatura tambien es una URL, y va dentro de la linea de
/// metadatos.
fn parse_output(stdout: &[u8]) -> Option<TrackInfo> {
    let text = String::from_utf8_lossy(stdout);

    let url = text
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("http") && !line.contains(FIELD_SEP))?
        .to_string();

    let Some(meta) = text.lines().find(|line| line.contains(FIELD_SEP)) else {
        // Sin metadatos aun podemos reproducir; solo perdemos la caratula.
        return Some(TrackInfo::from_url(url));
    };

    let mut parts = meta.split(FIELD_SEP);

    let title = field(parts.next());
    let uploader = field(parts.next());
    let duration = field(parts.next()).and_then(|d| d.parse::<f64>().ok());
    let thumbnail = field(parts.next());
    let id = field(parts.next());

    Some(TrackInfo {
        url,
        title,
        uploader,
        duration,
        thumbnail,
        id,
    })
}

/// Convierte lo que escribio el usuario en el argumento que espera yt-dlp.
pub fn build_target(query: &str) -> String {
    let query = query.trim();

    if query.starts_with("http") {
        query.to_string()
    } else {
        format!("ytsearch1:{query}")
    }
}

/// Lanza yt-dlp y devuelve la pista completa: URL de audio y metadatos.
///
/// Los metadatos salen de la MISMA invocacion, no de una segunda: yt-dlp ya
/// tiene el titulo, el canal y la miniatura en memoria cuando resuelve la URL,
/// asi que pedirlos no cuesta ni una peticion HTTP mas. Una segunda llamada, en
/// cambio, volveria a pagar el arranque de PyInstaller (~1.000 ms medidos).
///
/// Sobre los argumentos:
///   --ignore-config   no lee tu yt-dlp.conf; arranca antes y es determinista
///   --no-playlist     con un enlace de "cancion dentro de playlist", solo el video
///   --quiet           silencia el progreso; --print sigue escribiendo en stdout
///   -4                fuerza IPv4; en redes con IPv6 roto ahorra segundos
///   --socket-timeout  corta antes un socket muerto en vez de colgarse
///   --print urls      es el equivalente moderno del antiguo -g
///
/// Deliberadamente NO usamos --no-cache-dir: ese directorio guarda el codigo del
/// reproductor de YouTube ya procesado, y desactivarlo hace cada llamada mas lenta.
pub async fn resolve_track(target: String, safe: bool) -> Result<TrackInfo, String> {
    let extractor_args = if safe { EXTRACTOR_ARGS_SAFE } else { EXTRACTOR_ARGS_FAST };
    let template = metadata_template();
    let format = audio_format();

    // `Command::output()` bloquea el hilo. Lo movemos a un hilo de bloqueo para
    // no congelar el runtime asincrono de Tauri mientras yt-dlp trabaja.
    tokio::task::spawn_blocking(move || {
        let output = command()
            .args([
                "--ignore-config",
                "--no-warnings",
                "--quiet",
                "--no-playlist",
                "-4",
                "--socket-timeout",
                "8",
                "--extractor-args",
                extractor_args,
                "-f",
                format,
                "--print",
                "urls",
                "--print",
                &template,
                &target,
            ])
            .output()
            .map_err(|e| match e.kind() {
                std::io::ErrorKind::NotFound => format!(
                    "No se encontro {YTDLP_BIN}. Dejalo en src-tauri/binaries/ \
                     (como sidecar) o instalalo en el PATH del sistema."
                ),
                _ => format!("No se pudo ejecutar yt-dlp: {e}"),
            })?;

        if !output.status.success() {
            return Err(format!("yt-dlp fallo: {}", extract_error(&output.stderr)));
        }

        parse_output(&output.stdout).ok_or_else(|| {
            "No encontré esa canción. Prueba con otras palabras.".to_string()
        })
    })
    .await
    .map_err(|e| format!("Fallo interno al ejecutar la tarea: {e}"))?
}

// ---------------------------------------------------------------------------
// Busqueda de candidatos
// ---------------------------------------------------------------------------

/// Plantilla para la busqueda plana. El orden importa: lo lee `parse_search`.
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

            Some(SearchResult {
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

#[cfg(test)]
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

    /// Reproduce la salida real de yt-dlp: una linea con la URL de audio y otra
    /// con los metadatos separados por 0x1F.
    fn salida(url: &str, campos: &[&str]) -> Vec<u8> {
        format!("{url}\n{}\n", campos.join(FIELD_SEP)).into_bytes()
    }

    #[test]
    fn extrae_url_y_metadatos_completos() {
        let stdout = salida(
            "https://r.googlevideo.com/videoplayback?expire=1",
            &["Weird Fishes", "Radiohead", "319.0", "https://i.ytimg.com/vi/x/hq.jpg", "abc123"],
        );

        let track = parse_output(&stdout).expect("deberia parsear");

        assert_eq!(track.url, "https://r.googlevideo.com/videoplayback?expire=1");
        assert_eq!(track.title.as_deref(), Some("Weird Fishes"));
        assert_eq!(track.uploader.as_deref(), Some("Radiohead"));
        assert_eq!(track.duration, Some(319.0));
        assert_eq!(track.thumbnail.as_deref(), Some("https://i.ytimg.com/vi/x/hq.jpg"));
        assert_eq!(track.id.as_deref(), Some("abc123"));
    }

    #[test]
    fn no_confunde_la_miniatura_con_la_url_de_audio() {
        // La miniatura tambien empieza por http: si el parseo se guiara solo por
        // eso, podria devolverla como audio. Va dentro de la linea de metadatos,
        // que es justo lo que la distingue.
        let stdout = salida(
            "https://r.googlevideo.com/videoplayback",
            &["T", "C", "10", "https://i.ytimg.com/vi/x/hq.jpg", "id"],
        );

        let track = parse_output(&stdout).unwrap();
        assert_eq!(track.url, "https://r.googlevideo.com/videoplayback");
    }

    #[test]
    fn los_campos_vacios_quedan_en_none() {
        let stdout = salida("https://audio.example/x", &["Solo titulo", "", "", "", ""]);
        let track = parse_output(&stdout).unwrap();

        assert_eq!(track.title.as_deref(), Some("Solo titulo"));
        assert_eq!(track.uploader, None);
        assert_eq!(track.duration, None);
        assert_eq!(track.thumbnail, None);
    }

    #[test]
    fn un_na_de_yt_dlp_cuenta_como_ausente() {
        let stdout = salida("https://audio.example/x", &["T", "NA", "NA", "NA", "id"]);
        let track = parse_output(&stdout).unwrap();

        assert_eq!(track.uploader, None);
        assert_eq!(track.duration, None);
    }

    #[test]
    fn una_duracion_no_numerica_no_rompe_el_parseo() {
        // Los directos no tienen duracion; el resto debe seguir llegando.
        let stdout = salida("https://audio.example/x", &["Directo", "Canal", "sin fin", "", "id"]);
        let track = parse_output(&stdout).unwrap();

        assert_eq!(track.duration, None);
        assert_eq!(track.title.as_deref(), Some("Directo"));
    }

    #[test]
    fn sin_linea_de_metadatos_al_menos_reproduce() {
        let stdout = b"https://audio.example/x\n";
        let track = parse_output(stdout).expect("la URL sola basta");

        assert_eq!(track.url, "https://audio.example/x");
        assert_eq!(track.title, None);
    }

    #[test]
    fn sin_urls_en_la_salida_no_devuelve_nada() {
        assert!(parse_output(b"ERROR: algo salio mal\n").is_none());
    }

    #[test]
    fn un_titulo_con_barras_verticales_sobrevive() {
        // Por esto el separador es un caracter de control y no algo como "|".
        let stdout = salida("https://audio.example/x", &["A | B | C", "Canal", "1", "", "id"]);
        let track = parse_output(&stdout).unwrap();

        assert_eq!(track.title.as_deref(), Some("A | B | C"));
        assert_eq!(track.uploader.as_deref(), Some("Canal"));
    }

    #[test]
    fn la_plantilla_lleva_los_cinco_campos() {
        assert_eq!(metadata_template().split(FIELD_SEP).count(), 5);
        assert_eq!(search_template().split(FIELD_SEP).count(), 5);
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
