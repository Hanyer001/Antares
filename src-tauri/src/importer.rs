// Importa listas públicas de Spotify, Deezer y Apple Music, o canciones de texto y CSV.
// Busca cada pista en YouTube Music y compara duraciones para elegir la versión.
// Las listas de YouTube se cargan directamente mediante source::playlist.

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value;

use crate::track::SearchResult;
use crate::ytmusic;

/// Tope de canciones por importacion, el mismo que con las de YouTube.
pub const LIMIT: usize = 500;

/// Busquedas a la vez en YouTube Music: bastante mas rapido que de una en
/// una, sin parecer un ataque.
const PARALLEL: usize = 6;

/// Diferencia de duracion que se acepta como "la misma cancion".
const SAME_LENGTH_SECS: f64 = 20.0;

/// Lo que se busca: una cancion segun la otra app.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Wanted {
    pub title: String,
    pub artist: String,
    /// En segundos.
    pub duration: Option<f64>,
}

impl Wanted {
    fn new(title: &str, artist: &str, duration: Option<f64>) -> Option<Self> {
        let title = title.trim();
        (!title.is_empty()).then(|| Wanted {
            title: title.to_string(),
            artist: artist.trim().to_string(),
            duration: duration.filter(|d| *d > 0.0),
        })
    }

    /// "Artista - Cancion", para contar cuales no se encontraron.
    pub fn label(&self) -> String {
        if self.artist.is_empty() {
            self.title.clone()
        } else {
            format!("{} - {}", self.artist, self.title)
        }
    }
}

/// Los servicios que se leen por enlace.
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Service {
    Spotify,
    Deezer,
    Apple,
}

impl Service {
    pub fn name(self) -> &'static str {
        match self {
            Service::Spotify => "Spotify",
            Service::Deezer => "Deezer",
            Service::Apple => "Apple Music",
        }
    }
}

/// De que servicio es un enlace (los cortos de compartir incluidos).
pub fn service_of(url: &str) -> Option<Service> {
    let url = url.trim().to_lowercase();
    if url.contains("spotify.com/") || url.contains("spotify.link/") || url.starts_with("spotify:") {
        Some(Service::Spotify)
    } else if url.contains("deezer.com/") || url.contains("deezer.page.link/") {
        Some(Service::Deezer)
    } else if url.contains("music.apple.com/") {
        Some(Service::Apple)
    } else {
        None
    }
}

// ---------------------------------------------------------------------------
// Leer la lista
// ---------------------------------------------------------------------------

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(crate::innertube::WEB_USER_AGENT)
            .timeout(Duration::from_secs(20))
            .build()
            .unwrap_or_default()
    })
}

/// La pagina (o el JSON) de una URL, y la URL final tras las redirecciones.
async fn fetch(url: &str) -> Result<(String, String), String> {
    let response = http()
        .get(url)
        .header("Accept-Language", "es,en;q=0.8")
        .send()
        .await
        .map_err(|e| format!("No se pudo abrir el enlace: {e}"))?;
    let status = response.status();
    let final_url = response.url().to_string();
    if status.as_u16() == 404 {
        return Err("Esa lista no existe o es privada.".to_string());
    }
    if !status.is_success() {
        return Err(format!("El servicio respondió con un error ({status})."));
    }
    let body = response.text().await.map_err(|e| format!("No se pudo leer la lista: {e}"))?;
    Ok((final_url, body))
}

/// Nombre y canciones de una lista de Spotify, Deezer o Apple Music.
pub async fn read_link(url: &str) -> Result<(String, Vec<Wanted>), String> {
    let service = service_of(url).ok_or("Ese enlace no es de Spotify, Deezer ni Apple Music.")?;
    let url = url.trim();

    let (name, tracks) = match service {
        Service::Spotify => {
            let (kind, id) = match spotify_ref(url) {
                Some(r) => r,
                // Enlace corto de compartir: lleva a la pagina de verdad.
                None => spotify_ref(&fetch(url).await?.0).ok_or(NOT_A_LIST)?,
            };
            let (_, page) = fetch(&format!("https://open.spotify.com/embed/{kind}/{id}")).await?;
            parse_spotify(&page)?
        }
        Service::Deezer => {
            let (kind, id) = match deezer_ref(url) {
                Some(r) => r,
                None => {
                    let (final_url, body) = fetch(url).await?;
                    deezer_ref(&final_url).or_else(|| deezer_ref(&body)).ok_or(NOT_A_LIST)?
                }
            };
            read_deezer(kind, &id).await?
        }
        Service::Apple => {
            let (_, page) = fetch(url).await?;
            parse_apple(&page)?
        }
    };

    if tracks.is_empty() {
        return Err(format!("No encontré canciones en esa lista de {}. ¿Es privada?", service.name()));
    }
    Ok((name, tracks.into_iter().take(LIMIT).collect()))
}

const NOT_A_LIST: &str = "Ese enlace no es de una lista ni de un álbum.";

/// ("playlist" | "album", id) de un enlace de Spotify.
fn spotify_ref(url: &str) -> Option<(&'static str, String)> {
    for kind in ["playlist", "album"] {
        for sep in ['/', ':'] {
            let key = format!("{kind}{sep}");
            if let Some(pos) = url.find(&key) {
                let id: String = url[pos + key.len()..]
                    .chars()
                    .take_while(|c| c.is_ascii_alphanumeric())
                    .collect();
                if id.len() >= 10 {
                    return Some((kind, id));
                }
            }
        }
    }
    None
}

/// El reproductor incrustado de Spotify trae la lista en `__NEXT_DATA__`
/// (hasta 100 canciones: para mas, el CSV).
fn parse_spotify(page: &str) -> Result<(String, Vec<Wanted>), String> {
    let data = json_script(page, r#"<script id="__NEXT_DATA__" type="application/json">"#)
        .ok_or("Spotify no dejó ver esa lista. ¿Es privada?")?;
    let entity = &data["props"]["pageProps"]["state"]["data"]["entity"];
    let name = entity["name"].as_str().or(entity["title"].as_str()).unwrap_or("De Spotify");

    let tracks = entity["trackList"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|t| {
                    Wanted::new(
                        t["title"].as_str()?,
                        t["subtitle"].as_str().unwrap_or(""),
                        t["duration"].as_f64().map(|ms| ms / 1000.0),
                    )
                })
                .collect()
        })
        .unwrap_or_default();
    Ok((name.to_string(), tracks))
}

/// ("playlist" | "album", id) de un enlace de Deezer (o de una pagina que lo
/// contenga, como la de un enlace corto).
fn deezer_ref(text: &str) -> Option<(&'static str, String)> {
    for kind in ["playlist", "album"] {
        let key = format!("/{kind}/");
        let mut rest = text;
        while let Some(pos) = rest.find(&key) {
            let after = &rest[pos + key.len()..];
            let id: String = after.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !id.is_empty() && rest[..pos].ends_with(|c: char| c.is_ascii_alphanumeric()) {
                return Some((kind, id));
            }
            rest = after;
        }
    }
    None
}

/// La API abierta de Deezer, pagina a pagina.
async fn read_deezer(kind: &str, id: &str) -> Result<(String, Vec<Wanted>), String> {
    let (_, body) = fetch(&format!("https://api.deezer.com/{kind}/{id}")).await?;
    let head: Value = serde_json::from_str(&body).map_err(|_| "Deezer respondió algo raro.".to_string())?;
    if head.get("error").is_some() {
        return Err("Esa lista de Deezer no existe o es privada.".to_string());
    }
    let name = head["title"].as_str().unwrap_or("De Deezer").to_string();

    let mut tracks = deezer_tracks(&head["tracks"]);
    let mut next = head["tracks"]["next"].as_str().map(str::to_string);
    while let Some(url) = next.take() {
        if tracks.len() >= LIMIT {
            break;
        }
        let (_, body) = fetch(&url).await?;
        let page: Value = serde_json::from_str(&body).unwrap_or_default();
        tracks.extend(deezer_tracks(&page));
        next = page["next"].as_str().map(str::to_string);
    }
    Ok((name, tracks))
}

fn deezer_tracks(page: &Value) -> Vec<Wanted> {
    page["data"]
        .as_array()
        .map(|list| {
            list.iter()
                .filter_map(|t| {
                    Wanted::new(
                        t["title"].as_str()?,
                        t["artist"]["name"].as_str().unwrap_or(""),
                        t["duration"].as_f64(),
                    )
                })
                .collect()
        })
        .unwrap_or_default()
}

/// La pagina de Apple Music lleva sus datos en `serialized-server-data`.
fn parse_apple(page: &str) -> Result<(String, Vec<Wanted>), String> {
    let data = json_script(page, r#"<script type="application/json" id="serialized-server-data">"#)
        .ok_or("Apple Music no dejó ver esa lista. ¿Es privada?")?;
    let root = &data["data"][0]["data"];
    let sections = root["sections"].as_array().cloned().unwrap_or_default();

    let header = sections
        .iter()
        .find(|s| s["itemKind"].as_str() == Some("containerDetailHeaderLockup"))
        .map(|s| &s["items"][0]);
    let name = header
        .and_then(|h| h["title"].as_str())
        .unwrap_or("De Apple Music")
        .to_string();
    // En un album las canciones no repiten el artista: es el de la cabecera.
    let album_artist = header
        .and_then(|h| h["subtitleLinks"][0]["title"].as_str())
        .unwrap_or("")
        .to_string();

    let tracks = sections
        .iter()
        .filter(|s| s["itemKind"].as_str() == Some("trackLockup"))
        .flat_map(|s| s["items"].as_array().cloned().unwrap_or_default())
        .filter_map(|t| {
            let artist = t["artistName"]
                .as_str()
                .or(t["subtitleLinks"][0]["title"].as_str())
                .unwrap_or(&album_artist)
                .to_string();
            Wanted::new(t["title"].as_str()?, &artist, t["duration"].as_f64().map(|ms| ms / 1000.0))
        })
        .collect();
    Ok((name, tracks))
}

/// El JSON de un `<script>` de la pagina, a partir de su etiqueta de apertura.
fn json_script(page: &str, open_tag: &str) -> Option<Value> {
    let start = page.find(open_tag)? + open_tag.len();
    let end = page[start..].find("</script>")? + start;
    serde_json::from_str(&page[start..end]).ok()
}

// ---------------------------------------------------------------------------
// Canciones pegadas o de un CSV
// ---------------------------------------------------------------------------

/// Canciones escritas a mano ("Artista - Cancion", una por linea) o un CSV
/// exportado (Exportify, TuneMyMusic, Soundiiz...: se buscan las columnas de
/// titulo, artista y duracion por su nombre).
pub fn parse_text(text: &str) -> Vec<Wanted> {
    let text = text.trim_start_matches('\u{feff}');
    let mut lines = text.lines().filter(|l| !l.trim().is_empty()).peekable();

    let Some(first) = lines.peek() else {
        return Vec::new();
    };
    if let Some(columns) = csv_columns(first) {
        lines.next();
        return lines
            .filter_map(|line| {
                let cells = csv_cells(line);
                let cell = |i: Option<usize>| i.and_then(|i| cells.get(i)).map(String::as_str).unwrap_or("");
                let duration = parse_duration(cell(columns.duration));
                // "Artista 1, Artista 2" o "Artista 1;Artista 2": basta el primero
                // para buscar, pero se dejan todos por si ayuda.
                Wanted::new(cell(Some(columns.title)), &cell(columns.artist).replace(';', ", "), duration)
            })
            .take(LIMIT)
            .collect();
    }

    lines.filter_map(parse_line).take(LIMIT).collect()
}

struct Columns {
    title: usize,
    artist: Option<usize>,
    duration: Option<usize>,
}

/// Si la primera linea es la cabecera de un CSV, donde esta cada cosa.
fn csv_columns(header: &str) -> Option<Columns> {
    if !header.contains(',') && !header.contains(';') {
        return None;
    }
    let names: Vec<String> = csv_cells(header).iter().map(|c| c.to_lowercase()).collect();
    let find = |keys: &[&str]| names.iter().position(|n| keys.iter().any(|k| n.contains(k)));

    let title = find(&["track name", "track title", "song", "título", "titulo", "title", "canción", "cancion", "name", "nombre"])?;
    let artist = find(&["artist", "artista", "intérprete"]).filter(|a| *a != title);
    let duration = find(&["duration", "duración", "duracion", "length", "time"]);
    Some(Columns { title, artist, duration })
}

/// Las celdas de una linea CSV (comas o puntos y coma, con comillas).
fn csv_cells(line: &str) -> Vec<String> {
    let sep = if line.matches(';').count() > line.matches(',').count() { ';' } else { ',' };
    let mut cells = Vec::new();
    let mut cell = String::new();
    let mut quoted = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '"' if quoted && chars.peek() == Some(&'"') => {
                cell.push('"');
                chars.next();
            }
            '"' => quoted = !quoted,
            c if c == sep && !quoted => cells.push(std::mem::take(&mut cell).trim().to_string()),
            c => cell.push(c),
        }
    }
    cells.push(cell.trim().to_string());
    cells
}

/// "215000" (milisegundos), "215" (segundos) o "3:35".
fn parse_duration(text: &str) -> Option<f64> {
    let text = text.trim();
    if text.contains(':') {
        let mut secs = 0.0;
        for part in text.split(':') {
            secs = secs * 60.0 + part.trim().parse::<f64>().ok()?;
        }
        return Some(secs);
    }
    let n: f64 = text.parse().ok()?;
    Some(if n > 10_000.0 { n / 1000.0 } else { n })
}

/// Una linea escrita a mano: "Artista - Cancion", con o sin numero delante
/// ("1. ", "01 ") y duracion detras ("3:35").
fn parse_line(line: &str) -> Option<Wanted> {
    let mut line = line.trim();

    // Numero de orden delante.
    let digits = line.chars().take_while(|c| c.is_ascii_digit()).count();
    if digits > 0 && digits < 4 {
        let rest = line[digits..].trim_start_matches(['.', ')', '-', ' ', '\t']);
        if rest.len() < line.len() - digits {
            line = rest;
        }
    }

    // Duracion detras: "... 3:35" o "... (3:35)".
    let mut duration = None;
    if let Some((head, tail)) = line.rsplit_once(char::is_whitespace) {
        let tail = tail.trim_matches(['(', ')', '[', ']']);
        if tail.contains(':') {
            if let Some(d) = parse_duration(tail) {
                duration = Some(d);
                line = head.trim_end();
            }
        }
    }

    for sep in [" - ", " – ", " — ", " | "] {
        if let Some((artist, title)) = line.split_once(sep) {
            return Wanted::new(title, artist, duration);
        }
    }
    Wanted::new(line, "", duration)
}

// ---------------------------------------------------------------------------
// Buscar en YouTube Music
// ---------------------------------------------------------------------------

/// Lo encontrado, en el orden de la lista, y lo que no.
pub struct Found {
    pub tracks: Vec<SearchResult>,
    pub missing: Vec<Wanted>,
}

/// Busca cada cancion en YouTube Music, varias a la vez. `progress` se llama
/// con (hechas, total) cada vez que termina una.
pub async fn find_all(wanted: Vec<Wanted>, progress: impl Fn(usize, usize) + Send + Sync + 'static) -> Found {
    let total = wanted.len();
    let done = Arc::new(AtomicUsize::new(0));
    let progress = Arc::new(progress);
    let gate = Arc::new(tokio::sync::Semaphore::new(PARALLEL));

    let mut tasks = tokio::task::JoinSet::new();
    for (index, w) in wanted.iter().cloned().enumerate() {
        let (done, progress, gate) = (done.clone(), progress.clone(), gate.clone());
        tasks.spawn(async move {
            let _permit = gate.acquire_owned().await;
            let hit = find_one(&w).await;
            progress(done.fetch_add(1, Ordering::SeqCst) + 1, total);
            (index, hit)
        });
    }

    let mut hits: Vec<Option<SearchResult>> = vec![None; total];
    while let Some(Ok((index, hit))) = tasks.join_next().await {
        hits[index] = hit;
    }

    let mut found = Found { tracks: Vec::new(), missing: Vec::new() };
    let mut seen = std::collections::HashSet::new();
    for (w, hit) in wanted.into_iter().zip(hits) {
        match hit {
            // La misma cancion dos veces en la lista de origen: una basta.
            Some(track) if !seen.insert(track.id.clone()) => {}
            Some(track) => found.tracks.push(track),
            None => found.missing.push(w),
        }
    }
    found
}

async fn find_one(w: &Wanted) -> Option<SearchResult> {
    let query = if w.artist.is_empty() {
        w.title.clone()
    } else {
        // Con varios artistas, el primero basta y confunde menos.
        let main = w.artist.split([',', '&']).next().unwrap_or(&w.artist).trim();
        format!("{main} {}", w.title)
    };

    // Un reintento: con varias a la vez, alguna puede fallar por la red.
    let mut hits = Vec::new();
    for _ in 0..2 {
        match ytmusic::search_songs(&query, 5).await {
            Ok(h) => {
                hits = h;
                break;
            }
            Err(_) => tokio::time::sleep(Duration::from_millis(600)).await,
        }
    }
    pick(w, hits.into_iter().map(|h| h.track).collect())
}

/// Entre los resultados que se parecen a lo buscado, el primero de duracion
/// parecida; si ninguno la tiene (o no se sabe), el primero sin mas.
fn pick(w: &Wanted, hits: Vec<SearchResult>) -> Option<SearchResult> {
    let hits: Vec<SearchResult> = hits.into_iter().filter(|h| resembles(w, h)).collect();
    if let Some(want) = w.duration {
        if let Some(close) = hits
            .iter()
            .find(|h| h.duration.is_some_and(|d| (d - want).abs() <= SAME_LENGTH_SECS))
        {
            return Some(close.clone());
        }
    }
    hits.into_iter().next()
}

/// YouTube Music siempre contesta algo, aunque lo buscado no exista: un
/// resultado solo vale si comparte alguna palabra del titulo, o del artista
/// con quien la sube. Lo segundo cubre titulos que cambian de un servicio a
/// otro (traducidos, en otro alfabeto) pero siguen siendo del mismo artista.
fn resembles(w: &Wanted, hit: &SearchResult) -> bool {
    let title = words(hit.title.as_deref().unwrap_or(""));
    if !words(&w.title).is_disjoint(&title) {
        return true;
    }
    let uploader = words(hit.uploader.as_deref().unwrap_or(""));
    !w.artist.is_empty() && !words(&w.artist).is_disjoint(&uploader)
}

/// Las palabras de un texto, en minusculas y sin tildes.
fn words(text: &str) -> std::collections::HashSet<String> {
    text.chars()
        .flat_map(char::to_lowercase)
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' | 'å' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            c => c,
        })
        .collect::<String>()
        .split(|c: char| !c.is_alphanumeric())
        .filter(|w| !w.is_empty() && !matches!(*w, "the" | "a" | "el" | "la" | "de" | "y" | "and" | "feat" | "ft"))
        .map(str::to_string)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hit(id: &str, duration: f64) -> SearchResult {
        SearchResult {
            id: id.into(),
            title: Some(format!("Creep {id}")),
            uploader: None,
            duration: Some(duration),
            thumbnail: None,
            watch_url: SearchResult::watch_url_for(id),
        }
    }

    #[test]
    fn de_que_servicio_es_cada_enlace() {
        assert_eq!(service_of("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M?si=x"), Some(Service::Spotify));
        assert_eq!(service_of("https://spotify.link/AbCd"), Some(Service::Spotify));
        assert_eq!(service_of("https://www.deezer.com/es/playlist/3155776842"), Some(Service::Deezer));
        assert_eq!(service_of("https://link.deezer.com/s/30ABC"), Some(Service::Deezer));
        assert_eq!(service_of("https://music.apple.com/us/playlist/x/pl.f4d1"), Some(Service::Apple));
        assert_eq!(service_of("https://www.youtube.com/playlist?list=PL1"), None);
    }

    #[test]
    fn ids_de_spotify_y_deezer() {
        assert_eq!(
            spotify_ref("https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M?si=abc"),
            Some(("playlist", "37i9dQZF1DXcBWIGoYBM5M".into()))
        );
        assert_eq!(spotify_ref("spotify:album:4aawyAB9vmqN3uQ7FjRGTy"), Some(("album", "4aawyAB9vmqN3uQ7FjRGTy".into())));
        assert_eq!(spotify_ref("https://open.spotify.com/track/abc"), None);
        assert_eq!(deezer_ref("https://www.deezer.com/es/playlist/3155776842?utm=1"), Some(("playlist", "3155776842".into())));
        assert_eq!(deezer_ref("https://www.deezer.com/album/302127"), Some(("album", "302127".into())));
    }

    #[test]
    fn lista_de_spotify() {
        let page = r#"<html><script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"state":{"data":{"entity":{"name":"Mi lista","trackList":[{"title":"Creep","subtitle":"Radiohead","duration":238640},{"title":"","subtitle":"x"}]}}}}}}</script></html>"#;
        let (name, tracks) = parse_spotify(page).unwrap();
        assert_eq!(name, "Mi lista");
        assert_eq!(tracks, vec![Wanted { title: "Creep".into(), artist: "Radiohead".into(), duration: Some(238.64) }]);
    }

    #[test]
    fn album_de_apple_music_con_el_artista_en_la_cabecera() {
        let page = r#"<script type="application/json" id="serialized-server-data">{"data":[{"data":{"sections":[
            {"itemKind":"containerDetailHeaderLockup","items":[{"title":"OK Computer","subtitleLinks":[{"title":"Radiohead"}]}]},
            {"itemKind":"trackLockup","items":[{"title":"Airbag","duration":287000},{"title":"Karma Police","artistName":"Radiohead","duration":264000}]}
        ]}}]}</script>"#;
        let (name, tracks) = parse_apple(page).unwrap();
        assert_eq!(name, "OK Computer");
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0].artist, "Radiohead");
        assert_eq!(tracks[1].duration, Some(264.0));
    }

    #[test]
    fn canciones_escritas_a_mano() {
        let text = "1. Radiohead - Creep 3:58\nSoda Stereo – De Música Ligera\n\n  Wonderwall  \n02) Oasis - Live Forever (4:36)";
        let tracks = parse_text(text);
        assert_eq!(tracks.len(), 4);
        assert_eq!(tracks[0], Wanted { title: "Creep".into(), artist: "Radiohead".into(), duration: Some(238.0) });
        assert_eq!(tracks[1].artist, "Soda Stereo");
        assert_eq!(tracks[2], Wanted { title: "Wonderwall".into(), artist: "".into(), duration: None });
        assert_eq!(tracks[3].title, "Live Forever");
        assert_eq!(tracks[3].duration, Some(276.0));
    }

    #[test]
    fn csv_de_exportify_y_de_tunemymusic() {
        let exportify = "\u{feff}\"Track URI\",\"Track Name\",\"Artist Name(s)\",\"Album Name\",\"Track Duration (ms)\"\n\
            \"spotify:track:1\",\"Creep\",\"Radiohead\",\"Pablo Honey\",\"238640\"\n\
            \"spotify:track:2\",\"Tusa\",\"KAROL G,Nicki Minaj\",\"Tusa\",\"200960\"";
        let tracks = parse_text(exportify);
        assert_eq!(tracks.len(), 2);
        assert_eq!(tracks[0], Wanted { title: "Creep".into(), artist: "Radiohead".into(), duration: Some(238.64) });
        assert_eq!(tracks[1].artist, "KAROL G,Nicki Minaj");

        let tmm = "Track name,Artist name,Album,Playlist name\n\"Hello, Goodbye\",The Beatles,Magical Mystery Tour,Mix";
        let tracks = parse_text(tmm);
        assert_eq!(tracks, vec![Wanted { title: "Hello, Goodbye".into(), artist: "The Beatles".into(), duration: None }]);
    }

    #[test]
    fn se_elige_la_de_duracion_parecida() {
        let w = Wanted { title: "Creep".into(), artist: "Radiohead".into(), duration: Some(238.0) };
        let picked = pick(&w, vec![hit("directo", 400.0), hit("album", 239.0)]).unwrap();
        assert_eq!(picked.id, "album");

        // Ninguna parecida: la primera.
        let picked = pick(&w, vec![hit("a", 100.0), hit("b", 500.0)]).unwrap();
        assert_eq!(picked.id, "a");
        assert!(pick(&w, vec![]).is_none());
    }

    #[test]
    fn lo_que_no_se_parece_no_entra() {
        let song = |title: &str, uploader: &str| SearchResult {
            id: "x".into(),
            title: Some(title.into()),
            uploader: Some(uploader.into()),
            duration: None,
            thumbnail: None,
            watch_url: String::new(),
        };
        let inventada = Wanted { title: "Zzqxvyt Fghjkl".into(), artist: "Qxzvbnq".into(), duration: None };
        assert!(pick(&inventada, vec![song("Dame Tu Cosita", "El Chombo")]).is_none());

        // Tildes y mayúsculas no importan.
        let ligera = Wanted { title: "De Musica Ligera".into(), artist: "Soda Stereo".into(), duration: None };
        assert!(pick(&ligera, vec![song("De Música Ligera (Remasterizado 2007)", "Soda Stereo")]).is_some());

        // Título en otro alfabeto, mismo artista: vale.
        let kpop = Wanted { title: "봄날".into(), artist: "BTS".into(), duration: None };
        assert!(pick(&kpop, vec![song("Spring Day", "BTS")]).is_some());
    }

    /// Contra los servicios de verdad: `cargo test importer -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn en_vivo() {
        for url in [
            "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
            "https://www.deezer.com/playlist/3155776842",
            "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb",
        ] {
            let (name, tracks) = read_link(url).await.unwrap();
            println!("{name}: {} canciones, la primera {:?}", tracks.len(), tracks.first());
            assert!(tracks.len() >= 20, "{url}");
        }
        let found = find_all(parse_text("Radiohead - Creep\nSoda Stereo - De Música Ligera"), |_, _| {}).await;
        println!("{:?}", found.tracks.iter().map(|t| (&t.title, &t.uploader)).collect::<Vec<_>>());
        assert_eq!(found.tracks.len(), 2);
    }

    /// Una lista entera: cuantas encuentra y cuanto tarda.
    /// `cargo test importer::tests::lista_entera -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn lista_entera() {
        for url in [
            "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
            "https://www.deezer.com/playlist/3155776842",
            "https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb",
        ] {
            lista_entera_de(url).await;
        }
    }

    async fn lista_entera_de(url: &str) {
        let (_, wanted) = read_link(url).await.unwrap();
        let start = std::time::Instant::now();
        let labels: Vec<String> = wanted.iter().map(Wanted::label).collect();
        let found = find_all(wanted, |_, _| {}).await;
        println!(
            "{} de {} en {:.1} s; sin encontrar: {:?}",
            found.tracks.len(),
            labels.len(),
            start.elapsed().as_secs_f64(),
            found.missing.iter().map(Wanted::label).collect::<Vec<_>>()
        );
        assert!(found.tracks.len() * 10 >= labels.len() * 9, "al menos el 90 %");
    }
}
