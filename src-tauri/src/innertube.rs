//! Cliente de la API interna de YouTube usado para el audio en Android.
//!
//! Usa ANDROID_VR para player, WEB para búsquedas, next para Mix y browse
//! para listas. visitorData se obtiene de YouTube y se conserva temporalmente.
//! Los parsers buscan objetos por nombre para tolerar cambios de estructura.

use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde_json::{json, Value};

use crate::store::now_secs;
use crate::track::{SearchResult, TrackInfo};

const API: &str = "https://www.youtube.com/youtubei/v1";

/// Cliente de audio: ANDROID_VR (el de las gafas Quest).
const VR_NAME: &str = "ANDROID_VR";
const VR_ID: &str = "28";
const VR_VERSION: &str = "1.65.10";
/// El User-Agent de ese cliente. Las URLs de audio que da se piden con el
/// mismo: el reproductor de Android lo usa tambien (ver PlayerPlugin.kt).
pub const VR_USER_AGENT: &str =
    "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";

/// Cliente WEB para buscar y leer listas. La version real sale de la pagina
/// (ver `Session`); esta es la de respaldo.
const WEB_VERSION_FALLBACK: &str = "2.20260901.00.00";
pub(crate) const WEB_USER_AGENT: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/150.0.0.0 Safari/537.36";

/// Aceptar las cookies por defecto: sin esto, en Europa YouTube redirige a la
/// pagina de consentimiento en vez de dar la pagina.
const CONSENT_COOKIE: &str = "SOCS=CAI; PREF=hl=es&gl=ES";

/// Cuanto se reutiliza un visitorData antes de pedir otro.
const SESSION_TTL_SECS: u64 = 6 * 3600;

/// Formato de audio por calidad, igual que con yt-dlp: el mejor AAC, o en
/// ahorro de datos lo mejor que no pase de ~72 kbps.
const SAVER_MAX_BPS: u64 = 72_000;

/// Lo que hace falta para hablar con un sitio de YouTube: el visitorData y la
/// version de su cliente web, sacados de su pagina de inicio.
#[derive(Clone)]
pub(crate) struct Session {
    pub(crate) visitor: String,
    pub(crate) web_version: String,
    fetched_at: u64,
}

fn http() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .expect("cliente HTTP")
    })
}

fn session_slot() -> &'static Mutex<Option<Session>> {
    static SLOT: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

/// El visitorData y la version del cliente WEB, de la pagina de inicio.
async fn session(force: bool) -> Result<Session, String> {
    site_session("https://www.youtube.com/", session_slot(), WEB_VERSION_FALLBACK, force).await
}

/// La sesion de un sitio (`page`), guardada en `slot` unas horas.
pub(crate) async fn site_session(
    page: &str,
    slot: &Mutex<Option<Session>>,
    version_fallback: &str,
    force: bool,
) -> Result<Session, String> {
    if !force {
        if let Some(s) = slot.lock().ok().and_then(|s| s.clone()) {
            if now_secs().saturating_sub(s.fetched_at) < SESSION_TTL_SECS {
                return Ok(s);
            }
        }
    }

    let html = http()
        .get(page)
        .header("User-Agent", WEB_USER_AGENT)
        .header("Accept-Language", "es-ES,es;q=0.9")
        .header("Cookie", CONSENT_COOKIE)
        .send()
        .await
        .map_err(net_error)?
        .text()
        .await
        .map_err(net_error)?;

    let visitor = ytcfg_value(&html, "VISITOR_DATA")
        .ok_or_else(|| "No se pudo conectar con YouTube.".to_string())?;
    let web_version =
        ytcfg_value(&html, "INNERTUBE_CLIENT_VERSION").unwrap_or_else(|| version_fallback.to_string());

    let s = Session { visitor, web_version, fetched_at: now_secs() };
    if let Ok(mut slot) = slot.lock() {
        *slot = Some(s.clone());
    }
    Ok(s)
}

/// `"CLAVE":"valor"` dentro del ytcfg de la pagina.
fn ytcfg_value(html: &str, key: &str) -> Option<String> {
    let needle = format!("\"{key}\":\"");
    let start = html.find(&needle)? + needle.len();
    let end = html[start..].find('"')? + start;
    let value = &html[start..end];
    (!value.is_empty()).then(|| value.replace("\\u003d", "=").replace("%3D", "="))
}

fn net_error(e: reqwest::Error) -> String {
    format!("network error: {e}")
}

async fn post(endpoint: &str, body: Value, headers: &[(&str, &str)]) -> Result<Value, String> {
    post_to("https://www.youtube.com", API, endpoint, body, headers).await
}

/// Una llamada a la API de un sitio (`origin`, con la API en `api`).
pub(crate) async fn post_to(
    origin: &str,
    api: &str,
    endpoint: &str,
    body: Value,
    headers: &[(&str, &str)],
) -> Result<Value, String> {
    let mut request = http()
        .post(format!("{api}/{endpoint}?prettyPrint=false"))
        .header("Content-Type", "application/json")
        .header("Origin", origin)
        .header("Cookie", CONSENT_COOKIE);
    for (name, value) in headers {
        request = request.header(*name, *value);
    }

    let response = request.body(body.to_string()).send().await.map_err(net_error)?;
    let status = response.status();
    let text = response.text().await.map_err(net_error)?;
    if !status.is_success() {
        return Err(format!("HTTP {status} en {endpoint}"));
    }
    serde_json::from_str(&text).map_err(|e| format!("respuesta no valida de {endpoint}: {e}"))
}

async fn post_web(endpoint: &str, mut body: Value, s: &Session) -> Result<Value, String> {
    body["context"] = json!({
        "client": {
            "clientName": "WEB",
            "clientVersion": s.web_version,
            "hl": "es",
            "gl": "ES",
            "visitorData": s.visitor,
        }
    });
    post(
        endpoint,
        body,
        &[
            ("User-Agent", WEB_USER_AGENT),
            ("X-YouTube-Client-Name", "1"),
            ("X-YouTube-Client-Version", &s.web_version),
            ("X-Goog-Visitor-Id", &s.visitor),
        ],
    )
    .await
}

// ---------------------------------------------------------------------------
// Utilidades de JSON
// ---------------------------------------------------------------------------

/// Todos los objetos que cuelgan de una clave, a cualquier profundidad.
fn collect<'a>(value: &'a Value, key: &str, out: &mut Vec<&'a Value>) {
    match value {
        Value::Object(map) => {
            for (k, v) in map {
                if k == key {
                    out.push(v);
                } else {
                    collect(v, key, out);
                }
            }
        }
        Value::Array(items) => {
            for v in items {
                collect(v, key, out);
            }
        }
        _ => {}
    }
}

pub(crate) fn find_all<'a>(value: &'a Value, key: &str) -> Vec<&'a Value> {
    let mut out = Vec::new();
    collect(value, key, &mut out);
    out
}

/// Un texto de YouTube: `{"simpleText": "..."}` o `{"runs": [{"text": "..."}]}`.
pub(crate) fn text(value: &Value) -> Option<String> {
    if let Some(s) = value.get("simpleText").and_then(Value::as_str) {
        return Some(s.to_string());
    }
    let runs = value.get("runs")?.as_array()?;
    let joined: String = runs.iter().filter_map(|r| r.get("text")?.as_str()).collect();
    (!joined.is_empty()).then_some(joined)
}

/// "3:57" o "1:02:03" → segundos.
pub(crate) fn clock_to_secs(clock: &str) -> Option<f64> {
    clock
        .trim()
        .split(':')
        .try_fold(0.0, |acc, part| part.trim().parse::<f64>().ok().map(|n| acc * 60.0 + n))
}

fn thumbnail_for(id: &str) -> String {
    format!("https://i.ytimg.com/vi/{id}/mqdefault.jpg")
}

pub(crate) fn track(id: &str, title: Option<String>, uploader: Option<String>, duration: Option<f64>) -> SearchResult {
    SearchResult {
        id: id.to_string(),
        title,
        uploader,
        duration,
        thumbnail: Some(thumbnail_for(id)),
        watch_url: SearchResult::watch_url_for(id),
    }
}

/// Quita repetidos conservando el orden.
pub(crate) fn dedupe(mut tracks: Vec<SearchResult>) -> Vec<SearchResult> {
    let mut seen = std::collections::HashSet::new();
    tracks.retain(|t| seen.insert(t.id.clone()));
    tracks
}

// ---------------------------------------------------------------------------
// Audio
// ---------------------------------------------------------------------------

/// El id de video de lo que haya escrito el usuario o venga de una lista.
pub fn video_id(query: &str) -> Option<String> {
    let q = query.trim();
    let valid = |id: &str| id.len() == 11 && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');

    if valid(q) {
        return Some(q.to_string());
    }
    if !q.starts_with("http") {
        return None;
    }

    // watch?v=ID, youtu.be/ID, /shorts/ID, music.youtube.com/watch?v=ID
    if let Some(i) = q.find("v=") {
        let id: String = q[i + 2..].chars().take(11).collect();
        if valid(&id) {
            return Some(id);
        }
    }
    for marker in ["youtu.be/", "/shorts/", "/embed/", "/live/"] {
        if let Some(i) = q.find(marker) {
            let id: String = q[i + marker.len()..].chars().take(11).collect();
            if valid(&id) {
                return Some(id);
            }
        }
    }
    None
}

/// Elige el formato de audio de la respuesta de `player`.
fn pick_audio(player: &Value, saver: bool) -> Option<(String, u64)> {
    let formats = player.pointer("/streamingData/adaptiveFormats")?.as_array()?;
    let mut audio: Vec<(&str, u64, bool)> = formats
        .iter()
        .filter_map(|f| {
            let mime = f.get("mimeType")?.as_str()?;
            if !mime.starts_with("audio/") {
                return None;
            }
            // Sin `url` directa (con `signatureCipher`) habria que descifrar.
            let url = f.get("url")?.as_str()?;
            let bitrate = f.get("bitrate").and_then(Value::as_u64).unwrap_or(0);
            Some((url, bitrate, mime.starts_with("audio/mp4")))
        })
        .collect();

    if audio.is_empty() {
        return None;
    }

    let chosen = if saver {
        audio.sort_by_key(|(_, b, _)| *b);
        audio
            .iter()
            .rev()
            .find(|(_, b, _)| *b <= SAVER_MAX_BPS)
            .or_else(|| audio.first())
    } else {
        // El mejor AAC: lo reproduce cualquier Android. Si no lo hay, el mejor.
        audio.sort_by_key(|(_, b, _)| std::cmp::Reverse(*b));
        audio.iter().find(|(_, _, mp4)| *mp4).or_else(|| audio.first())
    }?;

    Some((chosen.0.to_string(), chosen.1))
}

fn player_error(player: &Value) -> Option<String> {
    let status = player.pointer("/playabilityStatus/status")?.as_str()?;
    if status == "OK" {
        return None;
    }
    let reason = player
        .pointer("/playabilityStatus/reason")
        .and_then(Value::as_str)
        .unwrap_or("");
    Some(format!("{status}: {reason}"))
}

async fn player(id: &str, s: &Session) -> Result<Value, String> {
    let body = json!({
        "context": {
            "client": {
                "clientName": VR_NAME,
                "clientVersion": VR_VERSION,
                "deviceMake": "Oculus",
                "deviceModel": "Quest 3",
                "androidSdkVersion": 32,
                "userAgent": VR_USER_AGENT,
                "osName": "Android",
                "osVersion": "12L",
                "hl": "es",
                "gl": "ES",
                "visitorData": s.visitor,
            }
        },
        "videoId": id,
        "contentCheckOk": true,
        "racyCheckOk": true,
    });
    post(
        "player",
        body,
        &[
            ("User-Agent", VR_USER_AGENT),
            ("X-YouTube-Client-Name", VR_ID),
            ("X-YouTube-Client-Version", VR_VERSION),
            ("X-Goog-Visitor-Id", &s.visitor),
        ],
    )
    .await
}

/// La URL de audio y los metadatos de un video (o de lo primero que salga al
/// buscar el texto, como hace yt-dlp con `ytsearch1:`).
pub async fn resolve_track(query: &str, saver: bool) -> Result<TrackInfo, String> {
    let id = match video_id(query) {
        Some(id) => id,
        None => search_tracks(query, 1)
            .await?
            .into_iter()
            .next()
            .map(|t| t.id)
            .ok_or_else(|| "No encontré esa canción. Prueba con otras palabras.".to_string())?,
    };

    let mut s = session(false).await?;
    let mut response = player(&id, &s).await?;

    // "Confirma que no eres un bot": un visitorData nuevo suele bastar.
    if player_error(&response).is_some_and(|e| e.contains("LOGIN_REQUIRED")) {
        s = session(true).await?;
        response = player(&id, &s).await?;
    }
    if let Some(error) = player_error(&response) {
        return Err(format!("ERROR: {error}"));
    }

    let (url, _bitrate) = pick_audio(&response, saver)
        .ok_or_else(|| "ERROR: el video no trae audio directo".to_string())?;

    let details = response.get("videoDetails");
    let field = |k: &str| details.and_then(|d| d.get(k)).and_then(Value::as_str).map(str::to_string);

    Ok(TrackInfo {
        url,
        title: field("title"),
        uploader: field("author"),
        duration: field("lengthSeconds").and_then(|s| s.parse().ok()),
        thumbnail: Some(format!("https://i.ytimg.com/vi/{id}/hqdefault.jpg")),
        id: Some(id),
    })
}

// ---------------------------------------------------------------------------
// Busqueda
// ---------------------------------------------------------------------------

/// Filtro "solo videos" de la busqueda de YouTube.
const ONLY_VIDEOS: &str = "EgIQAQ==";

fn parse_video_renderers(response: &Value) -> Vec<SearchResult> {
    find_all(response, "videoRenderer")
        .into_iter()
        .filter_map(|v| {
            let id = v.get("videoId")?.as_str()?;
            let title = v.get("title").and_then(text);
            let uploader = v
                .get("ownerText")
                .or_else(|| v.get("longBylineText"))
                .or_else(|| v.get("shortBylineText"))
                .and_then(text);
            let duration = v.get("lengthText").and_then(text).and_then(|t| clock_to_secs(&t));
            Some(track(id, title, uploader, duration))
        })
        .collect()
}

pub async fn search_tracks(query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
    let s = session(false).await?;
    let response = post_web("search", json!({ "query": query.trim(), "params": ONLY_VIDEOS }), &s).await?;

    let mut results = dedupe(parse_video_renderers(&response));
    results.truncate(limit);
    Ok(results)
}

// ---------------------------------------------------------------------------
// Listas y Mix
// ---------------------------------------------------------------------------

/// El id de lista de un enlace (`list=...`).
pub fn playlist_id(url: &str) -> Option<String> {
    let i = url.find("list=")? + 5;
    let id: String = url[i..]
        .chars()
        .take_while(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .collect();
    (!id.is_empty()).then_some(id)
}

fn parse_panel_videos(response: &Value) -> Vec<SearchResult> {
    find_all(response, "playlistPanelVideoRenderer")
        .into_iter()
        .filter_map(|v| {
            let id = v.get("videoId")?.as_str()?;
            let title = v.get("title").and_then(text);
            let uploader = v
                .get("longBylineText")
                .or_else(|| v.get("shortBylineText"))
                .and_then(text);
            let duration = v.get("lengthText").and_then(text).and_then(|t| clock_to_secs(&t));
            Some(track(id, title, uploader, duration))
        })
        .collect()
}

fn parse_playlist_videos(response: &Value) -> Vec<SearchResult> {
    find_all(response, "playlistVideoRenderer")
        .into_iter()
        .filter_map(|v| {
            let id = v.get("videoId")?.as_str()?;
            let title = v.get("title").and_then(text);
            let uploader = v.get("shortBylineText").and_then(text);
            let duration = v
                .get("lengthSeconds")
                .and_then(|l| l.as_str().and_then(|s| s.parse().ok()).or_else(|| l.as_f64()))
                .or_else(|| v.get("lengthText").and_then(text).and_then(|t| clock_to_secs(&t)));
            Some(track(id, title, uploader, duration))
        })
        .collect()
}

fn continuation_token(response: &Value) -> Option<String> {
    find_all(response, "continuationCommand")
        .into_iter()
        .find_map(|c| c.get("token")?.as_str().map(str::to_string))
}

fn playlist_title(response: &Value) -> Option<String> {
    response
        .pointer("/metadata/playlistMetadataRenderer/title")
        .and_then(Value::as_str)
        .map(str::to_string)
        .or_else(|| find_all(response, "playlistHeaderRenderer").first().and_then(|h| h.get("title")).and_then(text))
        .or_else(|| {
            find_all(response, "pageHeaderViewModel")
                .first()
                .and_then(|h| h.pointer("/title/dynamicTextViewModel/text/content"))
                .and_then(Value::as_str)
                .map(str::to_string)
        })
}

/// Un Mix (`RD...`): la lista "a continuacion" del video que lo empieza.
async fn list_mix(list: &str, limit: usize, s: &Session) -> Result<(Option<String>, Vec<SearchResult>), String> {
    let seed = list.strip_prefix("RD").filter(|id| id.len() == 11).unwrap_or("");
    let mut body = json!({ "playlistId": list });
    if !seed.is_empty() {
        body["videoId"] = json!(seed);
    }
    let response = post_web("next", body, s).await?;
    let title = response
        .pointer("/contents/twoColumnWatchNextResults/playlist/playlist/title")
        .and_then(Value::as_str)
        .map(str::to_string);

    let mut tracks = dedupe(parse_panel_videos(&response));
    tracks.truncate(limit);
    Ok((title, tracks))
}

/// Una lista normal, pagina a pagina hasta `limit`.
async fn list_browse(list: &str, limit: usize, s: &Session) -> Result<(Option<String>, Vec<SearchResult>), String> {
    let first = post_web("browse", json!({ "browseId": format!("VL{list}") }), s).await?;
    let title = playlist_title(&first);
    let mut tracks = parse_playlist_videos(&first);
    let mut token = continuation_token(&first);

    // Cada pagina trae ~100; el tope evita dar vueltas con una respuesta rara.
    let mut pages = 0;
    while let Some(t) = token.take() {
        if tracks.len() >= limit || pages >= 20 {
            break;
        }
        let next = post_web("browse", json!({ "continuation": t }), s).await?;
        let more = parse_playlist_videos(&next);
        if more.is_empty() {
            break;
        }
        tracks.extend(more);
        token = continuation_token(&next);
        pages += 1;
    }

    let mut tracks = dedupe(tracks);
    tracks.truncate(limit);
    Ok((title, tracks))
}

/// Las canciones de una lista o un Mix de YouTube, y su titulo.
pub async fn list_playlist(url: &str, limit: usize) -> Result<(Option<String>, Vec<SearchResult>), String> {
    let list = playlist_id(url).ok_or_else(|| "Pega el enlace de una lista de YouTube (lleva «list=»).".to_string())?;
    let s = session(false).await?;

    if list.starts_with("RD") {
        list_mix(&list, limit, &s).await
    } else {
        list_browse(&list, limit, &s).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ids_de_video() {
        assert_eq!(video_id("XFkzRNyygfk").as_deref(), Some("XFkzRNyygfk"));
        assert_eq!(video_id("https://www.youtube.com/watch?v=XFkzRNyygfk&list=RDx").as_deref(), Some("XFkzRNyygfk"));
        assert_eq!(video_id("https://youtu.be/XFkzRNyygfk?t=3").as_deref(), Some("XFkzRNyygfk"));
        assert_eq!(video_id("https://youtube.com/shorts/XFkzRNyygfk").as_deref(), Some("XFkzRNyygfk"));
        assert_eq!(video_id("radiohead creep"), None);
    }

    #[test]
    fn ids_de_lista() {
        assert_eq!(playlist_id("https://www.youtube.com/playlist?list=PLabc-_1&si=x").as_deref(), Some("PLabc-_1"));
        assert_eq!(playlist_id("https://www.youtube.com/watch?v=a&list=RDXFkzRNyygfk").as_deref(), Some("RDXFkzRNyygfk"));
        assert_eq!(playlist_id("https://www.youtube.com/watch?v=a"), None);
    }

    #[test]
    fn relojes() {
        assert_eq!(clock_to_secs("3:57"), Some(237.0));
        assert_eq!(clock_to_secs("1:02:03"), Some(3723.0));
        assert_eq!(clock_to_secs("EN DIRECTO"), None);
    }

    #[test]
    fn valores_del_ytcfg() {
        let html = r#"ytcfg.set({"VISITOR_DATA":"CgtABC==","INNERTUBE_CLIENT_VERSION":"2.2026"});"#;
        assert_eq!(ytcfg_value(html, "VISITOR_DATA").as_deref(), Some("CgtABC=="));
        assert_eq!(ytcfg_value(html, "INNERTUBE_CLIENT_VERSION").as_deref(), Some("2.2026"));
        assert_eq!(ytcfg_value(html, "NADA"), None);
    }

    #[test]
    fn elige_el_audio() {
        let player = json!({ "streamingData": { "adaptiveFormats": [
            { "mimeType": "video/mp4", "bitrate": 900000, "url": "v" },
            { "mimeType": "audio/mp4; codecs=\"mp4a\"", "bitrate": 131000, "url": "aac128" },
            { "mimeType": "audio/mp4; codecs=\"mp4a\"", "bitrate": 50000, "url": "aac48" },
            { "mimeType": "audio/webm; codecs=\"opus\"", "bitrate": 154000, "url": "opus160" },
            { "mimeType": "audio/webm; codecs=\"opus\"", "bitrate": 65000, "url": "opus70" },
            { "mimeType": "audio/webm", "bitrate": 999999, "signatureCipher": "s=..." }
        ]}});

        assert_eq!(pick_audio(&player, false).unwrap().0, "aac128", "el mejor AAC, aunque haya un Opus mejor");
        assert_eq!(pick_audio(&player, true).unwrap().0, "opus70", "ahorro: lo mejor que no pase de 72 kbps");
        assert!(pick_audio(&json!({}), false).is_none());
    }

    #[test]
    fn errores_del_reproductor() {
        assert_eq!(player_error(&json!({ "playabilityStatus": { "status": "OK" } })), None);
        let e = player_error(&json!({ "playabilityStatus": { "status": "LOGIN_REQUIRED", "reason": "bot" } }));
        assert_eq!(e.as_deref(), Some("LOGIN_REQUIRED: bot"));
    }

    #[test]
    fn lee_resultados_de_busqueda() {
        let response = json!({ "contents": { "a": [ { "itemSectionRenderer": { "contents": [
            { "videoRenderer": {
                "videoId": "XFkzRNyygfk",
                "title": { "runs": [ { "text": "Radiohead - " }, { "text": "Creep" } ] },
                "ownerText": { "runs": [ { "text": "Radiohead" } ] },
                "lengthText": { "simpleText": "3:57" }
            } },
            { "adSlotRenderer": {} },
            { "videoRenderer": { "videoId": "abcdefghijk", "title": { "simpleText": "Otra" } } }
        ] } } ] } });

        let results = parse_video_renderers(&response);
        assert_eq!(results.len(), 2);
        assert_eq!(results[0].title.as_deref(), Some("Radiohead - Creep"));
        assert_eq!(results[0].uploader.as_deref(), Some("Radiohead"));
        assert_eq!(results[0].duration, Some(237.0));
        assert_eq!(results[0].watch_url, "https://www.youtube.com/watch?v=XFkzRNyygfk");
        assert_eq!(results[1].duration, None);
    }

    #[test]
    fn lee_un_mix_y_una_lista() {
        let mix = json!({ "x": [ { "playlistPanelVideoRenderer": {
            "videoId": "XFkzRNyygfk", "title": { "simpleText": "Creep" },
            "longBylineText": { "runs": [ { "text": "Radiohead" } ] }, "lengthText": { "simpleText": "3:57" }
        } } ] });
        assert_eq!(parse_panel_videos(&mix)[0].uploader.as_deref(), Some("Radiohead"));

        let list = json!({
            "metadata": { "playlistMetadataRenderer": { "title": "Mi lista" } },
            "c": [ { "playlistVideoRenderer": {
                "videoId": "XFkzRNyygfk", "title": { "runs": [ { "text": "Creep" } ] },
                "shortBylineText": { "runs": [ { "text": "Radiohead" } ] }, "lengthSeconds": "237"
            } },
            { "continuationItemRenderer": { "continuationEndpoint": { "continuationCommand": { "token": "TOK" } } } } ]
        });
        assert_eq!(playlist_title(&list).as_deref(), Some("Mi lista"));
        assert_eq!(parse_playlist_videos(&list)[0].duration, Some(237.0));
        assert_eq!(continuation_token(&list).as_deref(), Some("TOK"));
    }

    /// Contra YouTube de verdad: `cargo test innertube -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn en_vivo() {
        let t = resolve_track("https://www.youtube.com/watch?v=XFkzRNyygfk", false).await.unwrap();
        println!("audio: {:?} · {:?} · {} …", t.title, t.duration, &t.url[..60]);
        assert!(t.url.contains("googlevideo.com"));

        let found = search_tracks("radiohead creep", 5).await.unwrap();
        println!("búsqueda: {:?}", found.iter().map(|f| &f.title).collect::<Vec<_>>());
        assert!(!found.is_empty());

        let (title, mix) = list_playlist("https://www.youtube.com/watch?v=XFkzRNyygfk&list=RDXFkzRNyygfk", 25).await.unwrap();
        println!("mix: {title:?} · {} canciones", mix.len());
        assert!(mix.len() > 5);

        let t = resolve_track("radiohead karma police", true).await.unwrap();
        println!("por texto (ahorro): {:?}", t.title);
    }
}
