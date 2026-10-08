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
    if url.trim().to_ascii_lowercase().starts_with("spotify:") {
        return Some(Service::Spotify);
    }
    let url = web_url(url)?;
    match url.host_str()? {
        "open.spotify.com" | "spotify.com" | "www.spotify.com" | "spotify.link" | "spoti.fi" => Some(Service::Spotify),
        "deezer.com" | "www.deezer.com" | "link.deezer.com" | "deezer.page.link" => Some(Service::Deezer),
        "music.apple.com" | "embed.music.apple.com" => Some(Service::Apple),
        _ => None,
    }
}

fn web_url(text: &str) -> Option<reqwest::Url> {
    let text = text.trim();
    let url = reqwest::Url::parse(text).or_else(|_| reqwest::Url::parse(&format!("https://{text}"))).ok()?;
    (matches!(url.scheme(), "http" | "https") && url.username().is_empty() && url.password().is_none()).then_some(url)
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
    let mut attempt = 0;
    let response = loop {
        let response = http().get(url).header("Accept-Language", "es,en;q=0.8").send().await;
        match response {
            Ok(response) if response.status().is_server_error() && attempt == 0 => {},
            Ok(response) => break response,
            Err(error) if attempt > 0 => return Err(format!("No se pudo abrir el enlace. Revisa la conexión y vuelve a intentarlo: {error}")),
            Err(_) => {},
        }
        // Un fallo transitorio de red no debe cancelar una lista completa.
        // Los rechazos por privacidad o límite de solicitudes no se reintentan.
        attempt += 1;
        tokio::time::sleep(Duration::from_millis(350)).await;
    };
    let status = response.status();
    let final_url = response.url().to_string();
    if let Some(message) = status_error(status.as_u16()) {
        return Err(message);
    }
    let body = response.text().await.map_err(|e| format!("No se pudo leer la lista: {e}"))?;
    Ok((final_url, body))
}

fn status_error(status: u16) -> Option<String> {
    match status {
        200..=299 => None,
        401 | 403 => Some("El servicio no permite leer esa lista sin iniciar sesión. Comprueba que sea pública o importa sus canciones desde un CSV.".into()),
        404 | 410 => Some("Ese enlace ya no está disponible o la lista es privada. Copia el enlace completo de la lista pública.".into()),
        429 => Some("El servicio está limitando las solicitudes. Espera un momento y vuelve a importar la lista.".into()),
        _ => Some(format!("El servicio respondió con un error ({status}). Inténtalo de nuevo más tarde.")),
    }
}

/// Nombre y canciones de una lista de Spotify, Deezer o Apple Music.
pub async fn read_link(url: &str) -> Result<(String, Vec<Wanted>), String> {
    let service = service_of(url).ok_or("Ese enlace no es de Spotify, Deezer ni Apple Music.")?;
    let url = url.trim();
    let normalized = web_url(url).map(|u| u.to_string());
    let url = normalized.as_deref().unwrap_or(url);

    let (name, tracks) = match service {
        Service::Spotify => {
            let (kind, id) = match spotify_ref(url) {
                Some(r) => r,
                // Enlace corto de compartir: lleva a la pagina de verdad.
                None => {
                    let (final_url, body) = fetch(url).await?;
                    spotify_ref(&final_url).or_else(|| shared_ref(&body, Service::Spotify, spotify_ref)).ok_or(NOT_A_LIST)?
                }
            };
            let (_, page) = fetch(&format!("https://open.spotify.com/embed/{kind}/{id}")).await?;
            if kind == "playlist" {
                read_spotify_playlist(&id, &page).await?
            } else {
                parse_spotify(&page)?
            }
        }
        Service::Deezer => {
            let (kind, id) = match deezer_ref(url) {
                Some(r) => r,
                None => {
                    let (final_url, body) = fetch(url).await?;
                    deezer_ref(&final_url).or_else(|| shared_ref(&body, Service::Deezer, deezer_ref)).ok_or(NOT_A_LIST)?
                }
            };
            read_deezer(kind, &id).await?
        }
        Service::Apple => {
            let mut apple = web_url(url).ok_or(NOT_A_LIST)?;
            if !apple.path().split('/').any(|part| matches!(part, "playlist" | "album")) {
                return Err(NOT_A_LIST.into());
            }
            // La página completa contiene las canciones y sus duraciones.
            if apple.host_str() == Some("embed.music.apple.com") {
                let _ = apple.set_host(Some("music.apple.com"));
            }
            let (_, page) = fetch(apple.as_str()).await?;
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
    if service_of(url) != Some(Service::Spotify) { return None; }
    let parts: Vec<String> = if url.trim().to_ascii_lowercase().starts_with("spotify:") {
        url.trim().split(':').map(str::to_string).collect()
    } else {
        web_url(url)?.path_segments()?.map(str::to_string).collect()
    };
    collection_ref(&parts, |id| id.len() >= 10 && id.chars().all(|c| c.is_ascii_alphanumeric()))
}

/// El reproductor incrustado de Spotify trae la lista en `__NEXT_DATA__`
/// (solo la primera página). Las playlists se leen completas con paginación.
fn parse_spotify(page: &str) -> Result<(String, Vec<Wanted>), String> {
    let data = json_script(page, "__NEXT_DATA__")
        .ok_or("Spotify no dejó ver las canciones. Comprueba que la lista sea pública; si pide iniciar sesión, usa un CSV exportado.")?;
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

const SPOTIFY_PAGE_SIZE: usize = 100;
const SPOTIFY_PARTIAL: &str = "Spotify no permitió leer la lista completa. No se ha creado una lista incompleta. Vuelve a intentarlo o importa el CSV completo desde «Abrir CSV…».";

/// La sesión anónima del reproductor público vive solo durante esta importación.
/// No se guarda, imprime ni incluye ninguna credencial en los archivos de la app.
async fn read_spotify_playlist(id: &str, embed: &str) -> Result<(String, Vec<Wanted>), String> {
    let data = json_script(embed, "__NEXT_DATA__").ok_or(SPOTIFY_PARTIAL)?;
    let token = data.pointer("/props/pageProps/state/settings/session/accessToken")
        .and_then(Value::as_str).filter(|t| !t.is_empty()).ok_or(SPOTIFY_PARTIAL)?;
    let query_hash = spotify_query_hash(id).await?;
    let pages = spotify_pages(id, token, &query_hash).await?;
    if pages.revision_changed {
        // Las listas editoriales pueden devolver revisiones distintas con el
        // mismo contenido. Confirmar las entradas evita un falso rechazo y,
        // si realmente cambió el orden o las canciones, evita mezclar páginas.
        let confirmed = spotify_pages(id, token, &query_hash).await?;
        if !pages.same_content(&confirmed) { return Err(SPOTIFY_CHANGED.into()); }
    }
    Ok((pages.name, pages.tracks))
}

const SPOTIFY_CHANGED: &str = "La lista de Spotify cambió durante la importación. Vuelve a intentarlo para leerla completa.";

async fn spotify_pages(id: &str, token: &str, hash: &str) -> Result<SpotifyPages, String> {
    let mut pages = SpotifyPages::default();
    loop {
        let page = spotify_page(id, token, hash, pages.offset).await?;
        if pages.push(&page)? {
            return Ok(pages);
        }
    }
}

/// Spotify cambia el identificador de su consulta pública con las versiones del
/// reproductor web. Se lee del código oficial y se reutiliza durante una hora;
/// es un ID de consulta, no una clave API. No se descarga por cada canción.
async fn spotify_query_hash(id: &str) -> Result<String, String> {
    type CachedQuery = Option<(std::time::Instant, String)>;
    static CACHE: tokio::sync::Mutex<CachedQuery> = tokio::sync::Mutex::const_new(None);
    let mut cached = CACHE.lock().await;
    if let Some((when, hash)) = cached.as_ref() {
        if when.elapsed() < Duration::from_secs(3600) { return Ok(hash.clone()); }
    }
    let (_, page) = fetch(&format!("https://open.spotify.com/playlist/{id}")).await?;
    let script = spotify_web_script(&page).ok_or(SPOTIFY_PARTIAL)?;
    let (_, source) = fetch(&script).await?;
    let hash = spotify_query_in(&source).ok_or(SPOTIFY_PARTIAL)?.to_string();
    *cached = Some((std::time::Instant::now(), hash.clone()));
    Ok(hash)
}

fn spotify_web_script(page: &str) -> Option<String> {
    html_tags(page).find_map(|(tag, _)| {
        if !tag.split_whitespace().next()?.eq_ignore_ascii_case("script") { return None; }
        let url = web_url(attribute(tag, "src")?)?;
        (url.scheme() == "https" && url.host_str() == Some("open.spotifycdn.com")
            && url.path().starts_with("/cdn/build/web-player/web-player.")
            && url.path().ends_with(".js") && url.query().is_none())
            .then(|| url.to_string())
    })
}

fn spotify_query_in(source: &str) -> Option<&str> {
    for quote in ['"', '\''] {
        let marker = format!("{quote}fetchPlaylist{quote},{quote}query{quote},{quote}");
        let Some((_, rest)) = source.split_once(&marker) else { continue; };
        let hash = rest.split(quote).next()?;
        if hash.len() == 64 && hash.bytes().all(|c| c.is_ascii_hexdigit()) { return Some(hash); }
    }
    None
}

async fn spotify_page(id: &str, token: &str, hash: &str, offset: usize) -> Result<Value, String> {
    let body = serde_json::to_vec(&serde_json::json!({
        "operationName": "fetchPlaylist",
        "variables": {"uri": format!("spotify:playlist:{id}"), "offset": offset,
            "limit": SPOTIFY_PAGE_SIZE, "enableWatchFeedEntrypoint": false,
            "includeEpisodeContentRatingsV2": false},
        "extensions": {"persistedQuery": {"version": 1, "sha256Hash": hash}}
    })).map_err(|_| SPOTIFY_PARTIAL)?;
    let mut attempt = 0;
    let response = loop {
        let response = http().post("https://api-partner.spotify.com/pathfinder/v2/query")
            .bearer_auth(token).header("Content-Type", "application/json")
            .body(body.clone()).send().await;
        match response {
            Ok(response) if response.status().is_server_error() && attempt == 0 => {},
            Ok(response) => break response,
            Err(_) if attempt > 0 => return Err(SPOTIFY_PARTIAL.into()),
            Err(_) => {},
        }
        attempt += 1;
        tokio::time::sleep(Duration::from_millis(350)).await;
    };
    if response.status().as_u16() == 429 {
        return Err("Spotify está limitando las solicitudes. Espera un momento y vuelve a intentarlo. No se ha creado una lista incompleta.".into());
    }
    if !response.status().is_success() { return Err(SPOTIFY_PARTIAL.into()); }
    let body = response.text().await.map_err(|_| SPOTIFY_PARTIAL)?;
    serde_json::from_str(&body).map_err(|_| SPOTIFY_PARTIAL.into())
}

/// Se avanza por entradas de origen, no por coincidencias de YouTube. Solo se
/// entrega la lista cuando el número recibido coincide con el total de Spotify.
#[derive(Default)]
struct SpotifyPages {
    name: String,
    tracks: Vec<Wanted>,
    offset: usize,
    total: Option<usize>,
    revision: Option<String>,
    revision_changed: bool,
    entry_ids: Vec<Option<String>>,
    seen_entries: std::collections::HashSet<String>,
}

impl SpotifyPages {
    fn push(&mut self, page: &Value) -> Result<bool, String> {
        if page["errors"].as_array().is_some_and(|e| !e.is_empty()) { return Err(SPOTIFY_PARTIAL.into()); }
        let playlist = &page["data"]["playlistV2"];
        if playlist["__typename"].as_str() != Some("Playlist") { return Err(SPOTIFY_PARTIAL.into()); }
        let content = &playlist["content"];
        let total = content["totalCount"].as_u64().and_then(|n| usize::try_from(n).ok()).ok_or(SPOTIFY_PARTIAL)?;
        if total > LIMIT {
            return Err(format!("La lista de Spotify tiene {total} canciones. El máximo por importación es {LIMIT}; divídela en listas más pequeñas. No se ha creado una lista incompleta."));
        }
        let revision = playlist["revisionId"].as_str();
        if self.total.is_some_and(|previous| previous != total) {
            return Err(SPOTIFY_CHANGED.into());
        }
        self.revision_changed |= self.revision.as_deref().zip(revision).is_some_and(|(a, b)| a != b);
        if content["pagingInfo"]["offset"].as_u64() != Some(self.offset as u64) { return Err(SPOTIFY_PARTIAL.into()); }
        let items = content["items"].as_array().ok_or(SPOTIFY_PARTIAL)?;
        if items.len() > SPOTIFY_PAGE_SIZE || self.offset + items.len() > total
            || (items.is_empty() && self.offset < total) { return Err(SPOTIFY_PARTIAL.into()); }
        if self.total.is_none() {
            self.name = playlist["name"].as_str().unwrap_or("De Spotify").to_string();
            self.total = Some(total);
            self.revision = revision.map(str::to_string);
        }
        for item in items {
            // La UID identifica una aparición, incluso si se repite la canción.
            if let Some(uid) = item["uid"].as_str().filter(|u| !u.is_empty()) {
                if !self.seen_entries.insert(uid.to_string()) { return Err(SPOTIFY_PARTIAL.into()); }
            }
            self.entry_ids.push(item["uid"].as_str().map(str::to_string));
            let wanted = spotify_track(item).ok_or_else(|| format!(
                "Spotify no permitió leer la canción {} de {total}. No se ha creado una lista incompleta. Importa el CSV completo desde «Abrir CSV…».", self.offset + 1))?;
            self.tracks.push(wanted);
            self.offset += 1;
        }
        Ok(self.offset == total)
    }

    fn same_content(&self, other: &Self) -> bool {
        self.offset == self.total.unwrap_or(0) && other.offset == other.total.unwrap_or(0)
            && self.total == other.total && self.entry_ids == other.entry_ids && self.tracks == other.tracks
    }
}

fn spotify_track(item: &Value) -> Option<Wanted> {
    ["itemV2", "itemV3"].into_iter().find_map(|key| {
        let track = &item[key]["data"];
        if !matches!(track["__typename"].as_str(), Some("Track" | "LocalTrack") | None) { return None; }
        let artist = track["artists"]["items"].as_array().map(|artists| artists.iter()
            .filter_map(|a| a["profile"]["name"].as_str()).collect::<Vec<_>>().join(", "))
            .filter(|a| !a.is_empty()).unwrap_or_else(|| track["artistName"].as_str().unwrap_or("").to_string());
        Wanted::new(track["name"].as_str()?, &artist,
            track["trackDuration"]["totalMilliseconds"].as_f64()
                .or_else(|| track["localTrackDuration"]["totalMilliseconds"].as_f64()).map(|ms| ms / 1000.0))
    })
}

/// ("playlist" | "album", id) de un enlace completo o localizado de Deezer.
fn deezer_ref(url: &str) -> Option<(&'static str, String)> {
    if service_of(url) != Some(Service::Deezer) { return None; }
    let parts: Vec<String> = web_url(url)?.path_segments()?.map(str::to_string).collect();
    collection_ref(&parts, |id| !id.is_empty() && id.chars().all(|c| c.is_ascii_digit()))
}

fn collection_ref(parts: &[String], valid_id: impl Fn(&str) -> bool) -> Option<(&'static str, String)> {
    let pair = parts.windows(2).find(|pair| matches!(pair[0].to_ascii_lowercase().as_str(), "playlist" | "album") && valid_id(&pair[1]))?;
    let kind = if pair[0].eq_ignore_ascii_case("playlist") { "playlist" } else { "album" };
    Some((kind, pair[1].clone()))
}

/// Algunas páginas de compartir conservan el enlace completo en sus metadatos.
fn shared_ref(page: &str, service: Service, parse: impl Fn(&str) -> Option<(&'static str, String)>) -> Option<(&'static str, String)> {
    for (tag, _) in html_tags(page) {
        for attr in ["href", "content", "data-href"] {
            let Some(value) = attribute(tag, attr) else { continue; };
            let value = value.replace("&amp;", "&");
            if service_of(&value) == Some(service) {
                if let Some(reference) = parse(&value) { return Some(reference); }
            }
        }
    }
    None
}

/// La API abierta de Deezer, pagina a pagina.
async fn read_deezer(kind: &str, id: &str) -> Result<(String, Vec<Wanted>), String> {
    let (_, body) = fetch(&format!("https://api.deezer.com/{kind}/{id}")).await?;
    let head: Value = serde_json::from_str(&body).map_err(|_| "Deezer respondió algo raro.".to_string())?;
    check_deezer(&head)?;
    let name = head["title"].as_str().unwrap_or("De Deezer").to_string();

    // El resumen puede cortar a 100 canciones SIN incluir `next`.
    // El endpoint de canciones sí informa la paginación completa.
    let mut tracks = Vec::new();
    let mut next = Some(format!("https://api.deezer.com/{kind}/{id}/tracks?limit=100"));
    let mut visited = std::collections::HashSet::new();
    while let Some(url) = next.take() {
        if tracks.len() >= LIMIT {
            break;
        }
        let url = deezer_page_url(&url)?;
        if !visited.insert(url.clone()) {
            return Err("Deezer repitió una página de canciones. Inténtalo de nuevo.".into());
        }
        let (_, body) = fetch(&url).await?;
        let page: Value = serde_json::from_str(&body).map_err(|_| "No se pudo leer una página de canciones de Deezer.")?;
        check_deezer(&page)?;
        if !page["data"].is_array() || (page["data"].as_array().is_some_and(Vec::is_empty) && page["next"].is_string()) {
            return Err("Deezer no devolvió las canciones de una página. Inténtalo de nuevo o importa un CSV.".into());
        }
        tracks.extend(deezer_tracks(&page).into_iter().take(LIMIT - tracks.len()));
        next = page["next"].as_str().map(str::to_string);
    }
    Ok((name, tracks))
}

fn check_deezer(data: &Value) -> Result<(), String> {
    if data.get("error").is_none() { return Ok(()); }
    match data["error"]["code"].as_u64() {
        Some(4) => Err("Deezer está limitando las solicitudes. Espera un momento y vuelve a importar.".into()),
        _ => Err("Esa lista de Deezer no existe, es privada o no está disponible en tu región.".into()),
    }
}

fn deezer_page_url(text: &str) -> Result<String, String> {
    let mut url = web_url(text).ok_or("Deezer devolvió un enlace de paginación inválido.")?;
    if url.host_str() != Some("api.deezer.com") || url.port().is_some() {
        return Err("Deezer devolvió un enlace de paginación inválido.".into());
    }
    // Algunos enlaces de la API todavía llevan http.
    let _ = url.set_scheme("https");
    Ok(url.to_string())
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
    let data = json_script(page, "serialized-server-data")
        .ok_or("Apple Music no dejó ver las canciones. Comprueba que la lista sea pública; si pide iniciar sesión, usa un CSV exportado.")?;
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

/// Lee el script por su ID: orden, comillas y atributos extra pueden cambiar.
fn json_script(page: &str, id: &str) -> Option<Value> {
    for (tag, end) in html_tags(page) {
        if !tag.get(..6).is_some_and(|name| name.eq_ignore_ascii_case("script")) || attribute(tag, "id") != Some(id) {
            continue;
        }
        let body = &page[end..];
        let close = body.to_ascii_lowercase().find("</script")?;
        if let Ok(data) = serde_json::from_str(body[..close].trim()) { return Some(data); }
    }
    None
}

/// Etiquetas de apertura y la posición del primer byte después de `>`.
fn html_tags(page: &str) -> impl Iterator<Item = (&str, usize)> {
    let mut offset = 0;
    std::iter::from_fn(move || {
        let start = offset + page[offset..].find('<')? + 1;
        let end = start + page[start..].find('>')?;
        offset = end + 1;
        Some((&page[start..end], offset))
    })
}

fn attribute<'a>(tag: &'a str, wanted: &str) -> Option<&'a str> {
    let bytes = tag.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        while i < bytes.len() && (bytes[i].is_ascii_whitespace() || bytes[i] == b'/') { i += 1; }
        let start = i;
        while i < bytes.len() && !bytes[i].is_ascii_whitespace() && !matches!(bytes[i], b'=' | b'/') { i += 1; }
        let name = &tag[start..i];
        while i < bytes.len() && bytes[i].is_ascii_whitespace() { i += 1; }
        if bytes.get(i) != Some(&b'=') { continue; }
        i += 1;
        while i < bytes.len() && bytes[i].is_ascii_whitespace() { i += 1; }
        let quote = bytes.get(i).copied().filter(|q| matches!(q, b'\'' | b'"'));
        if quote.is_some() { i += 1; }
        let start = i;
        while i < bytes.len() && if let Some(q) = quote { bytes[i] != q } else { !bytes[i].is_ascii_whitespace() } { i += 1; }
        let value = &tag[start..i];
        if quote.is_some() && i < bytes.len() { i += 1; }
        if name.eq_ignore_ascii_case(wanted) { return Some(value); }
    }
    None
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

    fn spotify_test_page(offset: usize, count: usize, total: usize) -> Value {
        serde_json::json!({"data":{"playlistV2":{
            "__typename":"Playlist", "name":"Lista completa", "revisionId":"test-revision",
            "content":{"totalCount":total,"pagingInfo":{"offset":offset,"limit":100},
                "items":(offset..offset+count).map(|i| serde_json::json!({
                    "uid":format!("entry-{i}"),"itemV2":{"data":{
                        "name":format!("Canción {i}"),"artists":{"items":[{"profile":{"name":"Artista"}}]},
                        "trackDuration":{"totalMilliseconds":210000}}}
                })).collect::<Vec<_>>()}
        }}})
    }

    #[test]
    fn spotify_205_canciones_en_tres_paginas_sin_corte_a_100() {
        let mut pages = SpotifyPages::default();
        assert!(!pages.push(&spotify_test_page(0, 100, 205)).unwrap());
        assert!(!pages.push(&spotify_test_page(pages.offset, 100, 205)).unwrap());
        assert!(pages.push(&spotify_test_page(pages.offset, 5, 205)).unwrap());
        assert_eq!(pages.name, "Lista completa");
        assert_eq!(pages.tracks.len(), 205);
        for (i, track) in pages.tracks.iter().enumerate() {
            assert_eq!(track.title, format!("Canción {i}"));
            assert_eq!(track.artist, "Artista");
            assert_eq!(track.duration, Some(210.0));
        }
    }

    #[test]
    fn spotify_cien_exactas_y_una_mas() {
        let mut pages = SpotifyPages::default();
        assert!(pages.push(&spotify_test_page(0, 100, 100)).unwrap());
        let mut pages = SpotifyPages::default();
        assert!(!pages.push(&spotify_test_page(0, 100, 101)).unwrap());
        assert!(pages.push(&spotify_test_page(100, 1, 101)).unwrap());
        assert_eq!(pages.tracks[100].title, "Canción 100");
        let mut pages = SpotifyPages::default();
        assert!(pages.push(&spotify_test_page(0, 0, 0)).unwrap());
    }

    #[test]
    fn spotify_fallo_en_segunda_pagina_no_se_confunde_con_lista_completa() {
        let first = spotify_test_page(0, 100, 205);
        let mut repeated = first.clone();
        repeated["data"]["playlistV2"]["content"]["pagingInfo"]["offset"] = 100.into();
        let mut unavailable = spotify_test_page(100, 100, 205);
        unavailable["data"]["playlistV2"]["content"]["items"][0]["itemV2"]["data"] = Value::Null;
        for next in [
            serde_json::json!({"errors":[{"message":"test error"}]}),
            serde_json::json!({"data":{"playlistV2":{"__typename":"NotFound"}}}),
            first.clone(), repeated, unavailable,
            spotify_test_page(100, 0, 205), spotify_test_page(100, 100, 206),
        ] {
            let mut pages = SpotifyPages::default();
            assert!(!pages.push(&first).unwrap());
            assert!(pages.push(&next).is_err(), "No debe aceptar una segunda página incompleta");
        }
    }

    #[test]
    fn spotify_limite_500_explicito_y_canciones_repetidas_de_origen() {
        let mut pages = SpotifyPages::default();
        for offset in (0..500).step_by(100) {
            assert_eq!(pages.push(&spotify_test_page(offset, 100, 500)).unwrap(), offset == 400);
        }
        assert_eq!(pages.tracks.len(), 500);
        let mut pages = SpotifyPages::default();
        let error = pages.push(&spotify_test_page(0, 100, 501)).unwrap_err();
        assert!(error.contains("501") && error.contains("500"));
        assert!(pages.tracks.is_empty());
        let mut page = spotify_test_page(0, 2, 2);
        page["data"]["playlistV2"]["content"]["items"][1]["itemV2"] =
            page["data"]["playlistV2"]["content"]["items"][0]["itemV2"].clone();
        let mut pages = SpotifyPages::default();
        assert!(pages.push(&page).unwrap());
        assert_eq!(pages.tracks.len(), 2, "Una canción repetida no cambia el offset de origen");
    }

    #[test]
    fn spotify_consulta_publica_solo_desde_el_codigo_oficial() {
        let page = r#"<script src="https://example.com/web-player.js"></script>
            <script src="https://open.spotifycdn.com.evil.test/cdn/build/web-player/web-player.x.js"></script>
            <script src="https://open.spotifycdn.com/cdn/build/web-player/vendor~web-player.x.js"></script>
            <script src='https://open.spotifycdn.com/cdn/build/web-player/web-player.test.js'></script>"#;
        assert_eq!(spotify_web_script(page).as_deref(), Some("https://open.spotifycdn.com/cdn/build/web-player/web-player.test.js"));
        let hash = "0".repeat(64);
        assert_eq!(spotify_query_in(&format!(r#"new Query("fetchPlaylist","query","{hash}",null)"#)), Some(hash.as_str()));
        assert!(spotify_query_in(r#"new Query("fetchPlaylist","query","invalid",null)"#).is_none());
        assert!(spotify_query_in(&format!(r#"new Query("anotherQuery","query","{hash}",null)"#)).is_none());
    }

    #[test]
    fn spotify_archivos_locales_conservan_artista_y_duracion_para_buscar() {
        let local = serde_json::json!({"itemV2":{"data":{
            "__typename":"LocalTrack", "name":"Canción local", "artistName":"Artista local",
            "localTrackDuration":{"totalMilliseconds":210000}}}});
        assert_eq!(spotify_track(&local), Some(Wanted {
            title:"Canción local".into(), artist:"Artista local".into(), duration:Some(210.0)}));
        let alternative = serde_json::json!({"itemV2":{"data":null},"itemV3":local["itemV2"]});
        assert_eq!(spotify_track(&alternative), spotify_track(&local));
        assert!(spotify_track(&serde_json::json!({"itemV2":{"data":{"__typename":"Episode","name":"Podcast"}}})).is_none());
    }

    #[test]
    fn spotify_revisiones_distintas_requieren_confirmar_el_contenido() {
        let mut first = SpotifyPages::default();
        first.push(&spotify_test_page(0, 100, 101)).unwrap();
        let mut last = spotify_test_page(100, 1, 101);
        last["data"]["playlistV2"]["revisionId"] = "another-revision".into();
        assert!(first.push(&last).unwrap());
        assert!(first.revision_changed);
        let mut confirmed = SpotifyPages::default();
        confirmed.push(&spotify_test_page(0, 100, 101)).unwrap();
        assert!(!first.same_content(&confirmed), "No basta confirmar la primera página");
        confirmed.push(&last).unwrap();
        assert!(first.same_content(&confirmed), "Las mismas canciones son válidas aunque varíe la revisión");
        confirmed.entry_ids.swap(0, 1);
        assert!(!first.same_content(&confirmed), "Cambiar el orden invalida la confirmación");
        confirmed.entry_ids.swap(0, 1);
        confirmed.tracks[100].title = "Otra canción".into();
        assert!(!first.same_content(&confirmed), "Una canción distinta no debe pasar la confirmación");
    }

    #[test]
    fn enlaces_compartidos_y_hosts_reales() {
        assert_eq!(service_of("https://spoti.fi/abc"), Some(Service::Spotify));
        assert_eq!(service_of("open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M"), Some(Service::Spotify));
        assert_eq!(service_of("https://deezer.page.link/abc"), Some(Service::Deezer));
        assert_eq!(service_of("https://embed.music.apple.com/us/album/x/123"), Some(Service::Apple));
        for url in [
            "https://example.com/spotify.com/playlist/1234567890123456789012",
            "https://open.spotify.com.example.com/playlist/1234567890123456789012",
            "https://open.spotify.com@example.com/playlist/1234567890123456789012",
            "https://example.com/?next=https://deezer.com/playlist/123",
            "file://music.apple.com/us/playlist/x/pl.abc",
        ] {
            assert_eq!(service_of(url), None, "{url}");
        }
        assert_eq!(spotify_ref("SPOTIFY:playlist:37i9dQZF1DXcBWIGoYBM5M"), Some(("playlist", "37i9dQZF1DXcBWIGoYBM5M".into())));
        assert_eq!(spotify_ref("spotify:user:example:playlist:37i9dQZF1DXcBWIGoYBM5M"), Some(("playlist", "37i9dQZF1DXcBWIGoYBM5M".into())));
        assert_eq!(spotify_ref("https://open.spotify.com/track/abc?next=playlist/37i9dQZF1DXcBWIGoYBM5M"), None);
        assert_eq!(deezer_ref("https://www.deezer.com/track/123?next=/playlist/456"), None);
        assert_eq!(deezer_ref("https://www.deezer.com/playlist/123abc"), None);
    }

    #[test]
    fn redireccion_compartida_en_metadatos() {
        let page = r#"<link data-extra="1" rel='canonical' href='https://www.deezer.com/es/playlist/3155776842?utm=1&amp;from=share'>"#;
        assert_eq!(shared_ref(page, Service::Deezer, deezer_ref), Some(("playlist", "3155776842".into())));
        let page = r#"<meta property="og:url" content="https://open.spotify.com/intl-es/album/6dVIqQ8qmQ5GBnJ9shOYGE">"#;
        assert_eq!(shared_ref(page, Service::Spotify, spotify_ref), Some(("album", "6dVIqQ8qmQ5GBnJ9shOYGE".into())));
        assert_eq!(shared_ref(page, Service::Deezer, deezer_ref), None);
    }

    #[test]
    fn json_de_paginas_con_atributos_reordenados() {
        let spotify = r#"<script nonce='public-placeholder' type='application/json'
            data-extra='test' id = '__NEXT_DATA__'>
            {"props":{"pageProps":{"state":{"data":{"entity":{"title":"Mi lista","trackList":[{"title":"Creep","subtitle":"Radiohead","duration":238640}]}}}}}}
            </script>"#;
        let (name, songs) = parse_spotify(spotify).unwrap();
        assert_eq!(name, "Mi lista");
        assert_eq!(songs[0].duration, Some(238.64));
        let apple = r#"<script id='serialized-server-data' data-extra='test' type='application/json'>
            {"data":[{"data":{"sections":[{"itemKind":"containerDetailHeaderLockup","items":[{"title":"Mix"}]},
            {"itemKind":"trackLockup","items":[{"title":"Creep","artistName":"Radiohead","duration":238640}]},
            {"itemKind":"squareLockup","items":[{"title":"Un álbum recomendado"}]}]}}]}</script>"#;
        let (name, songs) = parse_apple(apple).unwrap();
        assert_eq!(name, "Mix");
        assert_eq!(songs.len(), 1);
        assert_eq!(songs[0].artist, "Radiohead");
        assert_eq!(songs[0].duration, Some(238.64));
        assert!(json_script("<script data-id='__NEXT_DATA__'>{}</script>", "__NEXT_DATA__").is_none());
        assert!(json_script("<script id='__NEXT_DATA__'>not-json</script>", "__NEXT_DATA__").is_none());
    }

    #[test]
    fn paginas_de_deezer_y_errores_del_servicio() {
        assert_eq!(deezer_page_url("http://api.deezer.com/playlist/123/tracks?index=100&limit=100").unwrap(), "https://api.deezer.com/playlist/123/tracks?index=100&limit=100");
        for url in ["https://example.com/page", "https://api.deezer.com@example.com/page", "file://api.deezer.com/page"] {
            assert!(deezer_page_url(url).is_err());
        }
        let page = serde_json::json!({"data":[{"title":"Creep","artist":{"name":"Radiohead"},"duration":238},{"title":""}]});
        assert_eq!(deezer_tracks(&page), vec![Wanted { title: "Creep".into(), artist: "Radiohead".into(), duration: Some(238.0) }]);
        assert!(check_deezer(&serde_json::json!({"error":{"code":800}})).is_err());
        assert!(check_deezer(&serde_json::json!({"error":{"code":4}})).unwrap_err().contains("limitando"));
        assert!(status_error(403).unwrap().contains("CSV"));
        assert!(status_error(429).unwrap().contains("limitando"));
        assert!(status_error(410).unwrap().contains("completo"));
        assert!(status_error(200).is_none());
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

    /// Lectura real de enlaces localizados, URI y álbumes; conversión de una muestra.
    #[tokio::test]
    #[ignore]
    async fn en_vivo_enlaces_desktop() {
        for (url, minimum, match_sample) in [
            ("https://open.spotify.com/intl-es/playlist/37i9dQZF1DXcBWIGoYBM5M?si=public-test", 20, false),
            ("spotify:album:6dVIqQ8qmQ5GBnJ9shOYGE", 12, true),
            ("https://www.deezer.com/es/playlist/3155776842", 20, false),
            ("https://www.deezer.com/es/album/302127", 14, true),
            ("https://music.apple.com/cl/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb", 20, false),
            ("https://embed.music.apple.com/us/album/ok-computer/1097861387", 12, true),
        ] {
            let (name, wanted) = read_link(url).await.unwrap();
            assert!(wanted.len() >= minimum, "{name}: {}", wanted.len());
            println!("{}: {name}, {} canciones", service_of(url).unwrap().name(), wanted.len());
            if match_sample {
                let sample: Vec<_> = wanted.into_iter().take(3).collect();
                let found = find_all(sample, |_, _| {}).await;
                assert_eq!(found.tracks.len(), 3, "{name}: faltan {:?}", found.missing);
                println!("  3 de 3 canciones encontradas en YouTube Music");
            }
        }
    }

    #[tokio::test]
    #[ignore]
    async fn en_vivo_deezer_paginada() {
        let (_, body) = fetch("https://api.deezer.com/playlist/1306978785").await.unwrap();
        let head: Value = serde_json::from_str(&body).unwrap();
        let expected = head["nb_tracks"].as_u64().unwrap() as usize;
        assert!(expected > 100, "La lista de prueba debe necesitar más de una página");
        let (name, wanted) = read_link("https://www.deezer.com/playlist/1306978785").await.unwrap();
        assert_eq!(wanted.len(), expected.min(LIMIT));
        println!("Deezer paginada: {name}, {} de {expected} canciones", wanted.len());
    }

    #[tokio::test]
    #[ignore]
    async fn en_vivo_spotify_paginada() {
        for id in ["37i9dQZF1DX5trt9i14X7j", "37i9dQZF1DWXRqgorJj26U"] {
            let (_, embed) = fetch(&format!("https://open.spotify.com/embed/playlist/{id}")).await.unwrap();
            let (_, first) = parse_spotify(&embed).unwrap();
            let data = json_script(&embed, "__NEXT_DATA__").unwrap();
            let token = data.pointer("/props/pageProps/state/settings/session/accessToken").and_then(Value::as_str).unwrap();
            let hash = spotify_query_hash(id).await.unwrap();
            let head = spotify_page(id, token, &hash, 0).await.unwrap();
            let expected = head["data"]["playlistV2"]["content"]["totalCount"].as_u64().unwrap() as usize;
            assert!(expected > 100 && expected <= LIMIT, "La lista debe necesitar varias páginas");
            let (name, all) = read_link(&format!("https://open.spotify.com/playlist/{id}")).await.unwrap();
            assert_eq!(all.len(), expected);
            assert!(all.len() > first.len());
            // El embed separa algunos artistas con espacios no separables.
            // Comparar metadatos normalizados, sin exigir su formato visual.
            let normalized = |text: &str| text.split_whitespace().collect::<Vec<_>>().join(" ");
            for (actual, embedded) in all.iter().zip(&first) {
                assert_eq!(normalized(&actual.title), normalized(&embedded.title));
                assert_eq!(normalized(&actual.artist), normalized(&embedded.artist));
                assert_eq!(actual.duration, embedded.duration);
            }
            let tail_page = spotify_page(id, token, &hash, (expected / 100) * 100).await.unwrap();
            let tail: Vec<_> = tail_page["data"]["playlistV2"]["content"]["items"].as_array().unwrap()
                .iter().filter_map(spotify_track).collect();
            assert_eq!(&all[(expected / 100) * 100..], tail.as_slice());
            println!("Spotify paginada: {name}, {} de {expected} canciones, embed {}. Metadatos y última página completos.", all.len(), first.len());
        }
    }

    #[tokio::test]
    #[ignore]
    async fn en_vivo_spotify_lista_desktop() {
        let url = std::env::var("ANTARES_TEST_PLAYLIST")
            .unwrap_or_else(|_| "https://open.spotify.com/playlist/37i9dQZF1DWXRqgorJj26U".into());
        let (kind, id) = spotify_ref(&url).unwrap();
        assert_eq!(kind, "playlist");
        let (_, embed) = fetch(&format!("https://open.spotify.com/embed/playlist/{id}")).await.unwrap();
        let data = json_script(&embed, "__NEXT_DATA__").unwrap();
        let token = data.pointer("/props/pageProps/state/settings/session/accessToken").and_then(Value::as_str).unwrap();
        let hash = spotify_query_hash(&id).await.unwrap();
        let head = spotify_page(&id, token, &hash, 0).await.unwrap();
        let expected = head["data"]["playlistV2"]["content"]["totalCount"].as_u64().unwrap() as usize;
        let (name, wanted) = read_link(&url).await.unwrap();
        assert_eq!(wanted.len(), expected);
        assert!(expected > 100 && expected <= LIMIT);
        let progress = Arc::new(std::sync::Mutex::new(Vec::new()));
        let observed = progress.clone();
        let found = find_all(wanted, move |done, total| { observed.lock().unwrap().push((done, total)); }).await;
        let progress = progress.lock().unwrap();
        assert_eq!(progress.len(), expected, "Se debe buscar cada canción, también después de la 100");
        assert!(progress.iter().all(|(_, total)| *total == expected));
        assert_eq!(progress.iter().map(|(done, _)| *done).max(), Some(expected));
        let duplicates = expected - found.tracks.len() - found.missing.len();
        assert!(!found.tracks.is_empty());
        assert!(found.tracks.len() + duplicates > 100, "La conversión también debe superar las 100 canciones");
        let count = found.tracks.len();
        let dir = std::env::temp_dir().join(format!("antares-spotify-test-{}-{}", std::process::id(),
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&dir).unwrap();
        let lists = crate::playlists::Playlists::load(dir.clone());
        let imported = lists.create(&name, found.tracks).unwrap();
        assert_eq!(imported.tracks.len(), count, "Guardar la lista tampoco debe cortar a 100");
        let restored = crate::playlists::Playlists::load(dir);
        assert_eq!(restored.all().iter().find(|p| p.id == imported.id).unwrap().tracks.len(), count);
        println!("Spotify lista Desktop: {name}. Leídas {expected} de {expected}; encontradas {}; sin encontrar {}; repetidas {duplicates}; búsquedas completadas {} de {expected}.",
            count, found.missing.len(), progress.len());
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
