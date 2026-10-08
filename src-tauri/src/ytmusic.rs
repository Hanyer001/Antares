//! Metadatos de artistas, álbumes y listas mediante la API de YouTube Music.
//! Usa next para identificar artista y álbum de una pista, y browse para sus páginas.
//! El audio se resuelve por separado a partir del identificador del vídeo.

use std::sync::{Mutex, OnceLock};

use serde::Serialize;
use serde_json::{json, Value};

use crate::innertube::{self, clock_to_secs, dedupe, find_all, text, Session};
use crate::track::SearchResult;

const ORIGIN: &str = "https://music.youtube.com";
const API: &str = "https://music.youtube.com/youtubei/v1";
/// Id del cliente WEB_REMIX (el de music.youtube.com) en las cabeceras.
const CLIENT_ID: &str = "67";
/// La version real sale de la pagina (ver `innertube::site_session`).
const VERSION_FALLBACK: &str = "1.20260927.17.00";

/// Filtro "solo artistas" de la busqueda de YouTube Music.
const ONLY_ARTISTS: &str = "EgWKAQIgAWoKEAMQBBAJEAoQBQ%3D%3D";
/// Filtro "solo canciones": las oficiales, con su artista y su album.
const ONLY_SONGS: &str = "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D";

/// Tamano de las caratulas cuadradas de las filas y tarjetas.
const COVER_PX: u32 = 226;

// ---------------------------------------------------------------------------
// Tipos
// ---------------------------------------------------------------------------

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct ArtistRef {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct AlbumRef {
    pub id: String,
    pub title: String,
}

/// A quien y a que album lleva una cancion.
#[derive(Debug, Default, Serialize)]
pub struct TrackLinks {
    pub artists: Vec<ArtistRef>,
    pub album: Option<AlbumRef>,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum CardKind {
    Album,
    Artist,
    Playlist,
    Video,
}

/// Una tarjeta de una estanteria: un album, un artista, una lista o un video.
#[derive(Clone, Debug, Serialize)]
pub struct Card {
    pub kind: CardKind,
    /// `MPREb_...`, `UC...` o `VL...` para abrir; el id del video si es un video.
    pub id: String,
    pub title: String,
    pub subtitle: Option<String>,
    pub thumbnail: Option<String>,
    /// La lista que suena al darle al play de un album, sin abrirlo.
    pub playlist_id: Option<String>,
}

/// Como pedir el resto de una estanteria ("Mas").
#[derive(Clone, Debug, Serialize)]
pub struct More {
    pub browse_id: String,
    pub params: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct Shelf {
    pub title: String,
    pub items: Vec<Card>,
    pub more: Option<More>,
}

#[derive(Debug, Serialize)]
pub struct ArtistPage {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    /// Imagen ancha de cabecera o, si no hay, su foto.
    pub image: Option<String>,
    /// "5,4 M": el frontend pone la palabra.
    pub subscribers: Option<String>,
    /// Las mas escuchadas (unas pocas).
    pub songs: Vec<SearchResult>,
    /// La lista con todas sus canciones populares, para "Ver todas".
    pub songs_playlist: Option<String>,
    /// Endpoint completo: algunos catálogos necesitan también `params`.
    pub songs_more: Option<More>,
    pub shelves: Vec<Shelf>,
}

#[derive(Debug, Serialize)]
pub struct AlbumPage {
    pub id: String,
    pub title: String,
    /// "Álbum", "Single", "EP"...
    pub kind: Option<String>,
    pub year: Option<String>,
    pub artists: Vec<ArtistRef>,
    pub thumbnail: Option<String>,
    pub playlist_id: Option<String>,
    pub tracks: Vec<SearchResult>,
}

/// Una cancion oficial encontrada al buscar: la pista, mas de quien es.
#[derive(Debug, Serialize)]
pub struct SongHit {
    #[serde(flatten)]
    pub track: SearchResult,
    pub artists: Vec<ArtistRef>,
    pub album: Option<AlbumRef>,
}

/// Un artista encontrado al buscar.
#[derive(Debug, Serialize)]
pub struct ArtistHit {
    pub id: String,
    pub name: String,
    pub subtitle: Option<String>,
    pub thumbnail: Option<String>,
}

// ---------------------------------------------------------------------------
// Conexion
// ---------------------------------------------------------------------------

fn session_slot() -> &'static Mutex<Option<Session>> {
    static SLOT: OnceLock<Mutex<Option<Session>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

async fn call(endpoint: &str, mut body: Value) -> Result<Value, String> {
    let s = innertube::site_session("https://music.youtube.com/", session_slot(), VERSION_FALLBACK, false).await?;
    body["context"] = json!({
        "client": {
            "clientName": "WEB_REMIX",
            "clientVersion": s.web_version,
            "hl": "es",
            "gl": "ES",
            "visitorData": s.visitor,
        }
    });
    innertube::post_to(
        ORIGIN,
        API,
        endpoint,
        body,
        &[
            ("User-Agent", innertube::WEB_USER_AGENT),
            ("X-YouTube-Client-Name", CLIENT_ID),
            ("X-YouTube-Client-Version", &s.web_version),
            ("X-Goog-Visitor-Id", &s.visitor),
        ],
    )
    .await
}

// ---------------------------------------------------------------------------
// Piezas comunes
// ---------------------------------------------------------------------------

fn str_at<'a>(value: &'a Value, pointer: &str) -> Option<&'a str> {
    value.pointer(pointer).and_then(Value::as_str)
}

fn page_type(browse_endpoint: &Value) -> &str {
    str_at(
        browse_endpoint,
        "/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType",
    )
    .unwrap_or("")
}

fn is_artist_page(page_type: &str) -> bool {
    page_type == "MUSIC_PAGE_TYPE_ARTIST" || page_type == "MUSIC_PAGE_TYPE_USER_CHANNEL"
}

/// La imagen mas grande de lo que cuelgue de `value`.
fn best_thumb(value: Option<&Value>) -> Option<String> {
    let thumbs = find_all(value?, "thumbnails").into_iter().next()?.as_array()?;
    thumbs.last()?.get("url")?.as_str().map(str::to_string)
}

/// Pide una imagen de Google a otro tamano (`...=w544-h544-l90-rj`).
fn resize(url: &str, w: u32, h: u32) -> String {
    if !url.contains("googleusercontent.com") {
        return url.to_string();
    }
    match url.rfind("=w") {
        Some(i) => format!("{}=w{w}-h{h}-p-l90-rj", &url[..i]),
        None => url.to_string(),
    }
}

fn cover(url: Option<String>) -> Option<String> {
    url.map(|u| resize(&u, COVER_PX, COVER_PX))
}

/// Los artistas enlazados en unos `runs` (el "Radiohead • 2021" de debajo).
fn artists_in(runs_owner: Option<&Value>) -> Vec<ArtistRef> {
    let Some(runs) = runs_owner.and_then(|v| v.get("runs")).and_then(Value::as_array) else {
        return Vec::new();
    };
    runs.iter()
        .filter_map(|run| {
            let endpoint = run.pointer("/navigationEndpoint/browseEndpoint")?;
            if !is_artist_page(page_type(endpoint)) {
                return None;
            }
            Some(ArtistRef {
                id: endpoint.get("browseId")?.as_str()?.to_string(),
                name: run.get("text")?.as_str()?.to_string(),
            })
        })
        .collect()
}

/// El primer id de lista de album (`OLAK5uy_...`) que aparezca.
fn album_playlist(value: &Value) -> Option<String> {
    ["watchPlaylistEndpoint", "watchEndpoint"]
        .iter()
        .flat_map(|key| find_all(value, key))
        .filter_map(|e| e.get("playlistId")?.as_str())
        .find(|id| id.starts_with("OLAK5uy_"))
        .map(str::to_string)
}

/// Una fila de cancion (`musicResponsiveListItemRenderer`).
///
/// `artist` se usa cuando la fila no lo dice: en un album, las pistas no
/// repiten el artista del album.
fn parse_row(row: &Value, artist: Option<&str>, fallback_cover: Option<&str>) -> Option<SearchResult> {
    let id = str_at(row, "/playlistItemData/videoId").or_else(|| {
        find_all(row, "watchEndpoint")
            .into_iter()
            .find_map(|e| e.get("videoId")?.as_str())
    })?;

    let columns: Vec<&Value> = row
        .get("flexColumns")
        .and_then(Value::as_array)
        .map(|cols| cols.iter().filter_map(|c| c.pointer("/musicResponsiveListItemFlexColumnRenderer/text")).collect())
        .unwrap_or_default();

    let title = columns.first().and_then(|c| text(c));
    let by = columns
        .get(1)
        .and_then(|c| text(c))
        .filter(|s| !s.trim().is_empty())
        .or_else(|| artist.map(str::to_string));
    let duration = row
        .get("fixedColumns")
        .and_then(|cols| find_all(cols, "text").into_iter().find_map(text))
        .and_then(|t| clock_to_secs(&t));

    let mut track = innertube::track(id, title, by, duration);
    if let Some(art) = cover(best_thumb(row.get("thumbnail"))).or_else(|| fallback_cover.map(str::to_string)) {
        track.thumbnail = Some(art);
    }
    Some(track)
}

/// Una tarjeta (`musicTwoRowItemRenderer`).
fn parse_card(item: &Value) -> Option<Card> {
    let title = item.get("title").and_then(text)?;
    let subtitle = item.get("subtitle").and_then(text).map(|s| s.trim_end_matches(" • ").to_string());
    let thumbnail = best_thumb(item.get("thumbnailRenderer"));
    let nav = item.get("navigationEndpoint")?;

    if let Some(video) = nav.pointer("/watchEndpoint/videoId").and_then(Value::as_str) {
        return Some(Card {
            kind: CardKind::Video,
            id: video.to_string(),
            title,
            subtitle,
            thumbnail,
            playlist_id: None,
        });
    }

    let endpoint = nav.get("browseEndpoint")?;
    let id = endpoint.get("browseId")?.as_str()?.to_string();
    let kind = match page_type(endpoint) {
        "MUSIC_PAGE_TYPE_ALBUM" | "MUSIC_PAGE_TYPE_AUDIOBOOK" => CardKind::Album,
        "MUSIC_PAGE_TYPE_PLAYLIST" => CardKind::Playlist,
        t if is_artist_page(t) => CardKind::Artist,
        _ if id.starts_with("MPREb") => CardKind::Album,
        _ if id.starts_with("VL") => CardKind::Playlist,
        _ if id.starts_with("UC") => CardKind::Artist,
        _ => return None,
    };

    let playlist_id = match kind {
        CardKind::Album => album_playlist(item),
        CardKind::Playlist => id.strip_prefix("VL").map(str::to_string),
        _ => None,
    };

    Some(Card {
        kind,
        id,
        title,
        subtitle,
        thumbnail: if kind == CardKind::Artist { thumbnail } else { cover(thumbnail) },
        playlist_id,
    })
}

fn parse_more(header: Option<&Value>) -> Option<More> {
    let header = header?;
    let endpoint = header
        .pointer("/moreContentButton/buttonRenderer/navigationEndpoint/browseEndpoint")
        .or_else(|| header.pointer("/title/runs/0/navigationEndpoint/browseEndpoint"))?;
    Some(More {
        browse_id: endpoint.get("browseId")?.as_str()?.to_string(),
        params: endpoint.get("params").and_then(Value::as_str).map(str::to_string),
    })
}

/// "…\n\nFuente: Wikipedia (https://…)" → solo el texto.
fn clean_description(description: &str) -> String {
    let cut = ["\n\nFuente:", "\nFuente:", "\n\nFrom Wikipedia", "\nFrom Wikipedia"]
        .iter()
        .filter_map(|marker| description.find(marker))
        .min()
        .unwrap_or(description.len());
    description[..cut].trim().to_string()
}

// ---------------------------------------------------------------------------
// De una cancion a su artista
// ---------------------------------------------------------------------------

fn parse_links(response: &Value, video_id: &str) -> (TrackLinks, Option<ArtistRef>) {
    let panels = find_all(response, "playlistPanelVideoRenderer");
    let Some(panel) = panels
        .iter()
        .find(|p| p.get("videoId").and_then(Value::as_str) == Some(video_id))
        .or_else(|| panels.first())
    else {
        return (TrackLinks::default(), None);
    };

    let mut links = TrackLinks::default();
    let mut channel = None;

    let runs = panel.pointer("/longBylineText/runs").and_then(Value::as_array);
    for run in runs.into_iter().flatten() {
        let Some(endpoint) = run.pointer("/navigationEndpoint/browseEndpoint") else { continue };
        let (Some(id), Some(name)) = (
            endpoint.get("browseId").and_then(Value::as_str),
            run.get("text").and_then(Value::as_str),
        ) else {
            continue;
        };

        match page_type(endpoint) {
            "MUSIC_PAGE_TYPE_ARTIST" => links.artists.push(ArtistRef { id: id.into(), name: name.into() }),
            "MUSIC_PAGE_TYPE_USER_CHANNEL" if channel.is_none() => {
                channel = Some(ArtistRef { id: id.into(), name: name.into() })
            }
            "MUSIC_PAGE_TYPE_ALBUM" if links.album.is_none() => {
                links.album = Some(AlbumRef { id: id.into(), title: name.into() })
            }
            _ => {}
        }
    }

    (links, channel)
}

/// Minusculas, sin tildes y solo letras y numeros: "Beyoncé" y "beyonce"
/// son el mismo nombre.
fn normalize(name: &str) -> String {
    name.to_lowercase()
        .chars()
        .map(|c| match c {
            'á' | 'à' | 'ä' | 'â' | 'ã' => 'a',
            'é' | 'è' | 'ë' | 'ê' => 'e',
            'í' | 'ì' | 'ï' | 'î' => 'i',
            'ó' | 'ò' | 'ö' | 'ô' | 'õ' => 'o',
            'ú' | 'ù' | 'ü' | 'û' => 'u',
            'ñ' => 'n',
            'ç' => 'c',
            other => other,
        })
        .filter(|c| c.is_alphanumeric())
        .collect()
}

/// El nombre de artista que hay en el nombre de un canal de YouTube.
fn artist_from_channel(uploader: &str) -> String {
    let name = uploader.trim();
    let name = name.strip_suffix(" - Topic").unwrap_or(name);
    let name = name.strip_suffix("VEVO").unwrap_or(name);
    let name = name.strip_suffix(" Official").unwrap_or(name);
    name.trim().to_string()
}

fn parse_artist_hits(response: &Value) -> Vec<ArtistHit> {
    find_all(response, "musicResponsiveListItemRenderer")
        .into_iter()
        .filter_map(|row| {
            let endpoint = row.pointer("/navigationEndpoint/browseEndpoint")?;
            if page_type(endpoint) != "MUSIC_PAGE_TYPE_ARTIST" {
                return None;
            }
            let columns = row.get("flexColumns")?.as_array()?;
            let column = |i: usize| columns.get(i)?.pointer("/musicResponsiveListItemFlexColumnRenderer/text").and_then(text);
            Some(ArtistHit {
                id: endpoint.get("browseId")?.as_str()?.to_string(),
                name: column(0)?,
                subtitle: column(1),
                thumbnail: best_thumb(row.get("thumbnail")).map(|u| resize(&u, COVER_PX, COVER_PX)),
            })
        })
        .collect()
}

/// Las filas de una busqueda de canciones: titulo, y debajo "Artista y Otro •
/// Album • 2:40".
fn parse_song_hits(response: &Value) -> Vec<SongHit> {
    find_all(response, "musicResponsiveListItemRenderer")
        .into_iter()
        .filter_map(|row| {
            let byline = row.pointer("/flexColumns/1/musicResponsiveListItemFlexColumnRenderer/text");
            let artists = artists_in(byline);
            let album = byline
                .and_then(|b| b.get("runs"))
                .and_then(Value::as_array)
                .and_then(|runs| {
                    runs.iter().find_map(|run| {
                        let endpoint = run.pointer("/navigationEndpoint/browseEndpoint")?;
                        if page_type(endpoint) != "MUSIC_PAGE_TYPE_ALBUM" {
                            return None;
                        }
                        Some(AlbumRef {
                            id: endpoint.get("browseId")?.as_str()?.to_string(),
                            title: run.get("text")?.as_str()?.to_string(),
                        })
                    })
                });

            let mut track = parse_row(row, None, None)?;
            track.uploader = (!artists.is_empty()).then(|| join_names(&artists));
            // La duracion va al final de la segunda linea ("… • 2:40").
            if track.duration.is_none() {
                track.duration = byline
                    .and_then(text)
                    .and_then(|t| t.rsplit(" • ").next().and_then(clock_to_secs));
            }
            Some(SongHit { track, artists, album })
        })
        .collect()
}

/// "Anuel AA", "Anuel AA y Ozuna", "A, B y C".
fn join_names(artists: &[ArtistRef]) -> String {
    match artists {
        [] => String::new(),
        [one] => one.name.clone(),
        [rest @ .., last] => format!(
            "{} y {}",
            rest.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", "),
            last.name
        ),
    }
}

/// Canciones oficiales que coinciden con lo buscado, de la mejor a la peor.
pub async fn search_songs(query: &str, limit: usize) -> Result<Vec<SongHit>, String> {
    let response = call("search", json!({ "query": query.trim(), "params": ONLY_SONGS })).await?;
    let mut seen = std::collections::HashSet::new();
    let mut hits: Vec<SongHit> = parse_song_hits(&response)
        .into_iter()
        .filter(|h| seen.insert(h.track.id.clone()))
        .collect();
    hits.truncate(limit);
    Ok(hits)
}

/// El artista que se llama exactamente `name` (sin mirar mayusculas ni
/// tildes), si YouTube Music lo conoce.
pub async fn find_artist_named(name: &str) -> Result<Option<ArtistHit>, String> {
    let wanted = normalize(name);
    if wanted.is_empty() {
        return Ok(None);
    }
    let response = call("search", json!({ "query": name.trim(), "params": ONLY_ARTISTS })).await?;
    Ok(parse_artist_hits(&response)
        .into_iter()
        .take(5)
        .find(|hit| normalize(&hit.name) == wanted))
}

/// Si lo que escribio el usuario empieza por el nombre entero de `name`, en
/// palabras completas: "radiohead creep" empieza por Radiohead, "radioheads" no.
fn query_names(query: &str, name: &str) -> bool {
    let name = normalize(name);
    if name.is_empty() {
        return false;
    }
    let words: Vec<&str> = query.split_whitespace().collect();
    (1..=words.len()).any(|k| normalize(&words[..k].join(" ")) == name)
}

/// El artista que busca el usuario, si lo que escribio empieza por su nombre
/// ("radiohead" o "radiohead creep" → Radiohead).
pub async fn artist_for_query(query: &str) -> Result<Option<ArtistHit>, String> {
    if normalize(query).chars().count() < 2 {
        return Ok(None);
    }
    let response = call("search", json!({ "query": query.trim(), "params": ONLY_ARTISTS })).await?;
    Ok(parse_artist_hits(&response)
        .into_iter()
        .next()
        .filter(|hit| query_names(query, &hit.name)))
}

/// Los artistas y el album de una cancion.
///
/// YouTube Music lo sabe para las canciones "de verdad". Para un video subido
/// por cualquiera (una letra, un directo) solo sabe el canal, asi que se busca
/// un artista con lo que haya antes del guion en el titulo ("Artista -
/// Cancion") o, si no, con el nombre del canal; y solo si nada de eso da con
/// uno, el canal. El titulo va primero: quien sube la letra de una cancion
/// casi nunca es el artista, y su canal puede llamarse como otro.
pub async fn track_links(
    video_id: Option<&str>,
    uploader: Option<&str>,
    title: Option<&str>,
) -> Result<TrackLinks, String> {
    let (mut links, channel) = match video_id.filter(|id| !id.is_empty()) {
        Some(id) => parse_links(&call("next", json!({ "videoId": id, "isAudioOnly": true })).await?, id),
        None => (TrackLinks::default(), None),
    };

    if links.artists.is_empty() {
        let mut names = Vec::new();
        if let Some((before, _)) = title.and_then(|t| t.split_once(" - ")) {
            names.push(before.trim().to_string());
        }
        if let Some(uploader) = uploader {
            names.push(artist_from_channel(uploader));
        }

        for name in names.into_iter().filter(|n| !n.is_empty()) {
            if let Some(hit) = find_artist_named(&name).await? {
                links.artists.push(ArtistRef { id: hit.id, name: hit.name });
                break;
            }
        }
    }

    if links.artists.is_empty() {
        links.artists.extend(channel);
    }
    Ok(links)
}

// ---------------------------------------------------------------------------
// Paginas
// ---------------------------------------------------------------------------

fn parse_artist(id: &str, response: &Value) -> ArtistPage {
    let header = ["musicImmersiveHeaderRenderer", "musicVisualHeaderRenderer", "musicHeaderRenderer"]
        .iter()
        .find_map(|key| find_all(response, key).into_iter().next());

    let name = header
        .and_then(|h| h.get("title"))
        .and_then(text)
        .unwrap_or_else(|| "Artista".to_string());

    let description = header
        .and_then(|h| h.get("description"))
        .and_then(text)
        .or_else(|| {
            find_all(response, "musicDescriptionShelfRenderer")
                .first()
                .and_then(|d| d.get("description"))
                .and_then(text)
        })
        .map(|d| clean_description(&d))
        .filter(|d| !d.is_empty());

    let image = header.and_then(|h| {
        best_thumb(h.get("thumbnail"))
            .map(|u| resize(&u, 1440, 600))
            .or_else(|| best_thumb(h.get("foregroundThumbnail")).map(|u| resize(&u, 544, 544)))
    });

    let subscribers = header
        .and_then(|h| h.pointer("/subscriptionButton/subscribeButtonRenderer/subscriberCountText"))
        .and_then(text);

    let mut page = ArtistPage {
        id: id.to_string(),
        name: name.clone(),
        description,
        image,
        subscribers,
        songs: Vec::new(),
        songs_playlist: None,
        songs_more: None,
        shelves: Vec::new(),
    };

    let sections = find_all(response, "sectionListRenderer")
        .into_iter()
        .next()
        .and_then(|s| s.get("contents"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();

    for section in &sections {
        if let Some(shelf) = section.get("musicShelfRenderer") {
            if page.songs.is_empty() {
                let rows = shelf.get("contents").and_then(Value::as_array).cloned().unwrap_or_default();
                page.songs = dedupe(
                    rows.iter()
                        .filter_map(|r| r.get("musicResponsiveListItemRenderer"))
                        .filter_map(|r| parse_row(r, Some(&name), None))
                        .collect(),
                );
                if let Some(endpoint) = shelf.pointer("/bottomEndpoint/browseEndpoint")
                    .or_else(|| shelf.pointer("/title/runs/0/navigationEndpoint/browseEndpoint"))
                {
                    if let Some(id) = endpoint.get("browseId").and_then(Value::as_str) {
                        page.songs_playlist = id.strip_prefix("VL").map(str::to_string);
                        page.songs_more = Some(More {
                            browse_id: id.to_string(),
                            params: endpoint.get("params").and_then(Value::as_str).map(str::to_string),
                        });
                    }
                }
            }
        } else if let Some(carousel) = section.get("musicCarouselShelfRenderer") {
            let head = carousel.pointer("/header/musicCarouselShelfBasicHeaderRenderer");
            let title = head.and_then(|h| h.get("title")).and_then(text).unwrap_or_default();
            let items: Vec<Card> = carousel
                .get("contents")
                .and_then(Value::as_array)
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|i| i.get("musicTwoRowItemRenderer"))
                        .filter_map(parse_card)
                        .collect()
                })
                .unwrap_or_default();

            if !title.is_empty() && !items.is_empty() {
                page.shelves.push(Shelf { title, items, more: parse_more(head) });
            }
        }
    }

    page
}

pub async fn artist(id: &str) -> Result<ArtistPage, String> {
    let response = call("browse", json!({ "browseId": id })).await?;
    Ok(parse_artist(id, &response))
}

/// Solo la estantería de canciones de esta colección, sin recomendaciones.
fn song_shelf(response: &Value) -> Option<&Value> {
    ["musicPlaylistShelfRenderer", "musicShelfRenderer", "musicPlaylistShelfContinuation", "musicShelfContinuation", "appendContinuationItemsAction"]
        .iter()
        .find_map(|key| find_all(response, key).into_iter().next())
}

fn shelf_tracks(shelf: &Value, artist: Option<&str>, cover: Option<&str>) -> Vec<SearchResult> {
    shelf.get("contents").or_else(|| shelf.get("continuationItems"))
        .and_then(Value::as_array)
        .into_iter().flatten()
        .filter_map(|row| row.get("musicResponsiveListItemRenderer"))
        .filter_map(|row| parse_row(row, artist, cover))
        .collect()
}

fn song_continuation(shelf: &Value) -> Option<String> {
    find_all(shelf, "nextContinuationData").into_iter()
        .find_map(|data| data.get("continuation").and_then(Value::as_str))
        .or_else(|| find_all(shelf, "continuationCommand").into_iter()
            .find_map(|data| data.get("token").and_then(Value::as_str)))
        .map(str::to_string)
}

/// Lee todas las páginas. Un fallo nunca se presenta como una lista completa.
async fn complete_songs(response: &Value, artist: Option<&str>, cover: Option<&str>) -> Result<Vec<SearchResult>, String> {
    let Some(shelf) = song_shelf(response) else { return Ok(Vec::new()) };
    let mut tracks = shelf_tracks(shelf, artist, cover);
    let mut next = song_continuation(shelf);
    let mut seen = std::collections::HashSet::new();
    while let Some(token) = next {
        if seen.len() >= 50 || !seen.insert(token.clone()) {
            return Err("YouTube Music no permitió completar esta colección. Vuelve a intentarlo.".into());
        }
        let response = call("browse", json!({ "continuation": token })).await?;
        let shelf = song_shelf(&response)
            .ok_or("YouTube Music no devolvió la siguiente página de canciones.")?;
        tracks.extend(shelf_tracks(shelf, artist, cover));
        next = song_continuation(shelf);
    }
    Ok(tracks)
}

/// Principales primero, seguidas de las demás canciones del propio artista.
pub async fn artist_songs(id: &str) -> Result<Vec<SearchResult>, String> {
    let page = artist(id).await?;
    let mut tracks = page.songs;
    if let Some(more) = page.songs_more {
        let mut body = json!({ "browseId": more.browse_id });
        if let Some(params) = more.params { body["params"] = json!(params); }
        let response = call("browse", body).await?;
        let rest = complete_songs(&response, Some(&page.name), None).await?;
        if rest.is_empty() {
            return Err("No se pudo cargar la lista de canciones del artista. Vuelve a intentarlo.".into());
        }
        tracks.extend(rest);
    }
    Ok(dedupe(tracks))
}

fn parse_album(id: &str, response: &Value) -> AlbumPage {
    let header = ["musicResponsiveHeaderRenderer", "musicDetailHeaderRenderer"]
        .iter()
        .find_map(|key| find_all(response, key).into_iter().next());

    let title = header
        .and_then(|h| h.get("title"))
        .and_then(text)
        .unwrap_or_else(|| "Álbum".to_string());

    let subtitle_runs: Vec<String> = header
        .and_then(|h| h.pointer("/subtitle/runs"))
        .and_then(Value::as_array)
        .map(|runs| runs.iter().filter_map(|r| r.get("text")?.as_str().map(str::to_string)).collect())
        .unwrap_or_default();
    let kind = subtitle_runs.first().map(|k| k.trim().to_string()).filter(|k| !k.is_empty() && k != "•");
    let year = subtitle_runs
        .iter()
        .map(|r| r.trim())
        .find(|r| r.len() == 4 && r.chars().all(|c| c.is_ascii_digit()))
        .map(str::to_string);

    let mut artists = artists_in(header.and_then(|h| h.get("straplineTextOne")));
    if artists.is_empty() {
        artists = artists_in(header.and_then(|h| h.get("subtitle")));
    }

    let thumbnail = best_thumb(header.and_then(|h| h.get("thumbnail")));
    let row_cover = thumbnail.as_deref().map(|u| resize(u, COVER_PX, COVER_PX));
    let by = (!artists.is_empty()).then(|| artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", "));

    // Las pistas son la primera estanteria de canciones; las demas (otras
    // versiones del album) son tarjetas y no se mezclan. Tampoco su lista: se
    // saca de las pistas, porque las otras versiones traen la suya.
    let shelf = song_shelf(response);
    let playlist_id = shelf.and_then(album_playlist).or_else(|| header.and_then(album_playlist));
    let tracks = shelf.map(|s| shelf_tracks(s, by.as_deref(), row_cover.as_deref())).unwrap_or_default();

    AlbumPage {
        id: id.to_string(),
        title,
        kind,
        year,
        artists,
        thumbnail: thumbnail.map(|u| resize(&u, 544, 544)),
        playlist_id,
        tracks,
    }
}

pub async fn album(id: &str) -> Result<AlbumPage, String> {
    let response = call("browse", json!({ "browseId": id })).await?;
    let mut page = parse_album(id, &response);
    let by = page.artists.iter().map(|a| a.name.as_str()).collect::<Vec<_>>().join(", ");
    page.tracks = complete_songs(&response, (!by.is_empty()).then_some(by.as_str()), page.thumbnail.as_deref()).await?;
    Ok(page)
}

/// El resto de una estanteria (la discografia entera, por ejemplo).
pub async fn more(browse_id: &str, params: Option<&str>) -> Result<Vec<Card>, String> {
    let mut body = json!({ "browseId": browse_id });
    if let Some(params) = params {
        body["params"] = json!(params);
    }
    let response = call("browse", body).await?;
    Ok(find_all(&response, "musicTwoRowItemRenderer")
        .into_iter()
        .filter_map(parse_card)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artist_run(name: &str, id: &str, page: &str) -> Value {
        json!({ "text": name, "navigationEndpoint": { "browseEndpoint": {
            "browseId": id,
            "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": page } }
        } } })
    }

    #[test]
    fn nombres_normalizados() {
        assert_eq!(normalize("Beyoncé"), "beyonce");
        assert_eq!(normalize("  AC/DC "), "acdc");
        assert_eq!(normalize("Mägo de Oz"), "magodeoz");
    }

    #[test]
    fn la_busqueda_empieza_por_el_artista() {
        assert!(query_names("radiohead", "Radiohead"));
        assert!(query_names("Radiohead creep", "Radiohead"));
        assert!(query_names("guns n roses november rain", "Guns N' Roses"));
        assert!(query_names("beyonce halo", "Beyoncé"));
        assert!(!query_names("radioheads", "Radiohead"));
        assert!(!query_names("creep radiohead", "Radiohead"), "tiene que empezar por él");
    }

    #[test]
    fn artista_del_nombre_del_canal() {
        assert_eq!(artist_from_channel("Radiohead - Topic"), "Radiohead");
        assert_eq!(artist_from_channel("TaylorSwiftVEVO"), "TaylorSwift");
        assert_eq!(artist_from_channel("Queen Official"), "Queen");
    }

    #[test]
    fn imagenes_a_otro_tamano() {
        assert_eq!(
            resize("https://lh3.googleusercontent.com/abc=w2880-h1200-p-l90-rj", 1440, 600),
            "https://lh3.googleusercontent.com/abc=w1440-h600-p-l90-rj"
        );
        assert_eq!(resize("https://i.ytimg.com/vi/x/hq.jpg", 1, 1), "https://i.ytimg.com/vi/x/hq.jpg");
    }

    #[test]
    fn quita_la_fuente_de_la_descripcion() {
        assert_eq!(clean_description("Una banda.\n\nFuente: Wikipedia (https://x)"), "Una banda.");
        assert_eq!(clean_description("Sin fuente"), "Sin fuente");
    }

    #[test]
    fn enlaces_de_una_cancion() {
        let response = json!({ "x": [
            { "playlistPanelVideoRenderer": { "videoId": "otroVideo00", "longBylineText": { "runs": [
                artist_run("Otro", "UCotro", "MUSIC_PAGE_TYPE_ARTIST") ] } } },
            { "playlistPanelVideoRenderer": { "videoId": "XFkzRNyygfk", "longBylineText": { "runs": [
                artist_run("Radiohead", "UCradio", "MUSIC_PAGE_TYPE_ARTIST"),
                { "text": " & " },
                artist_run("Thom Yorke", "UCthom", "MUSIC_PAGE_TYPE_ARTIST"),
                { "text": " • " },
                artist_run("Pablo Honey", "MPREb_abc", "MUSIC_PAGE_TYPE_ALBUM"),
            ] } } }
        ] });

        let (links, channel) = parse_links(&response, "XFkzRNyygfk");
        assert_eq!(
            links.artists,
            vec![
                ArtistRef { id: "UCradio".into(), name: "Radiohead".into() },
                ArtistRef { id: "UCthom".into(), name: "Thom Yorke".into() },
            ]
        );
        assert_eq!(links.album, Some(AlbumRef { id: "MPREb_abc".into(), title: "Pablo Honey".into() }));
        assert_eq!(channel, None);
    }

    #[test]
    fn un_video_cualquiera_solo_trae_el_canal() {
        let response = json!({ "playlistPanelVideoRenderer": { "videoId": "abcdefghijk", "longBylineText": { "runs": [
            artist_run("Letras HD", "UCletras", "MUSIC_PAGE_TYPE_USER_CHANNEL") ] } } });
        let (links, channel) = parse_links(&response, "abcdefghijk");
        assert!(links.artists.is_empty());
        assert_eq!(channel.unwrap().name, "Letras HD");
    }

    fn song_row(id: &str, title: &str, by: Option<&str>, duration: Option<&str>) -> Value {
        let mut row = json!({
            "playlistItemData": { "videoId": id },
            "flexColumns": [
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [ { "text": title } ] } } },
                { "musicResponsiveListItemFlexColumnRenderer": { "text":
                    by.map(|b| json!({ "runs": [ { "text": b } ] })).unwrap_or(json!({})) } }
            ]
        });
        if let Some(d) = duration {
            row["fixedColumns"] = json!([ { "musicResponsiveListItemFixedColumnRenderer": { "text": { "runs": [ { "text": d } ] } } } ]);
        }
        json!({ "musicResponsiveListItemRenderer": row })
    }

    fn two_row(title: &str, subtitle: &str, id: &str, page: &str, playlist: Option<&str>) -> Value {
        let mut item = json!({
            "title": { "runs": [ { "text": title } ] },
            "subtitle": { "runs": [ { "text": subtitle } ] },
            "thumbnailRenderer": { "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [
                { "url": "https://lh3.googleusercontent.com/p=w60-h60-l90-rj" },
                { "url": "https://lh3.googleusercontent.com/p=w544-h544-l90-rj" } ] } } },
            "navigationEndpoint": { "browseEndpoint": {
                "browseId": id,
                "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": page } } } }
        });
        if let Some(p) = playlist {
            item["thumbnailOverlay"] = json!({ "musicItemThumbnailOverlayRenderer": { "content": { "musicPlayButtonRenderer": {
                "playNavigationEndpoint": { "watchPlaylistEndpoint": { "playlistId": p } } } } } });
        }
        json!({ "musicTwoRowItemRenderer": item })
    }

    #[test]
    fn lee_la_pagina_de_un_artista() {
        let response = json!({
            "header": { "musicImmersiveHeaderRenderer": {
                "title": { "runs": [ { "text": "Radiohead" } ] },
                "description": { "runs": [ { "text": "Banda británica.\n\nFuente: Wikipedia (" }, { "text": "https://x)" } ] },
                "thumbnail": { "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [
                    { "url": "https://lh3.googleusercontent.com/b=w2880-h1200-p-l90-rj" } ] } } },
                "subscriptionButton": { "subscribeButtonRenderer": { "subscriberCountText": { "runs": [ { "text": "5,4 M" } ] } } }
            } },
            "contents": { "singleColumnBrowseResultsRenderer": { "tabs": [ { "tabRenderer": { "content": { "sectionListRenderer": { "contents": [
                { "musicShelfRenderer": {
                    "contents": [ song_row("zFYEYRcjK2g", "Creep", Some("Radiohead"), None), song_row("zFYEYRcjK2g", "Creep", None, None) ],
                    "bottomEndpoint": { "browseEndpoint": { "browseId": "VLOLAK5uy_top" } }
                } },
                { "musicCarouselShelfRenderer": {
                    "header": { "musicCarouselShelfBasicHeaderRenderer": {
                        "title": { "runs": [ { "text": "Álbumes" } ] },
                        "moreContentButton": { "buttonRenderer": { "navigationEndpoint": { "browseEndpoint": {
                            "browseId": "MPADUCradio", "params": "P1" } } } } } },
                    "contents": [ two_row("OK Computer", "1997", "MPREb_ok", "MUSIC_PAGE_TYPE_ALBUM", Some("OLAK5uy_ok")) ]
                } },
                { "musicCarouselShelfRenderer": {
                    "header": { "musicCarouselShelfBasicHeaderRenderer": { "title": { "runs": [ { "text": "Puede que también te guste" } ] } } },
                    "contents": [ two_row("Mazzy Star", "16,7 M usuarios mensuales", "UCmazzy", "MUSIC_PAGE_TYPE_ARTIST", None) ]
                } },
                { "musicCarouselShelfRenderer": { "header": { "musicCarouselShelfBasicHeaderRenderer": {
                    "title": { "runs": [ { "text": "Vacía" } ] } } }, "contents": [] } }
            ] } } } } ] } }
        });

        let page = parse_artist("UCradio", &response);
        assert_eq!(page.name, "Radiohead");
        assert_eq!(page.description.as_deref(), Some("Banda británica."));
        assert_eq!(page.image.as_deref(), Some("https://lh3.googleusercontent.com/b=w1440-h600-p-l90-rj"));
        assert_eq!(page.subscribers.as_deref(), Some("5,4 M"));
        assert_eq!(page.songs.len(), 1, "sin repetidas");
        assert_eq!(page.songs[0].uploader.as_deref(), Some("Radiohead"));
        assert_eq!(page.songs_playlist.as_deref(), Some("OLAK5uy_top"));

        assert_eq!(page.shelves.len(), 2, "la vacía no sale");
        let albums = &page.shelves[0];
        assert_eq!(albums.title, "Álbumes");
        assert_eq!(albums.items[0].kind, CardKind::Album);
        assert_eq!(albums.items[0].playlist_id.as_deref(), Some("OLAK5uy_ok"));
        assert_eq!(albums.items[0].thumbnail.as_deref(), Some("https://lh3.googleusercontent.com/p=w226-h226-p-l90-rj"));
        assert_eq!(albums.more.as_ref().unwrap().browse_id, "MPADUCradio");
        assert_eq!(albums.more.as_ref().unwrap().params.as_deref(), Some("P1"));
        assert_eq!(page.shelves[1].items[0].kind, CardKind::Artist);
    }

    #[test]
    fn lee_un_album() {
        let response = json!({ "contents": { "twoColumnBrowseResultsRenderer": {
            "tabs": [ { "tabRenderer": { "content": { "sectionListRenderer": { "contents": [ { "musicResponsiveHeaderRenderer": {
                "title": { "runs": [ { "text": "OK Computer" } ] },
                "subtitle": { "runs": [ { "text": "Álbum" }, { "text": " • " }, { "text": "1997" } ] },
                "straplineTextOne": { "runs": [ artist_run("Radiohead", "UCradio", "MUSIC_PAGE_TYPE_ARTIST") ] },
                "thumbnail": { "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [
                    { "url": "https://lh3.googleusercontent.com/c=w544-h544-l90-rj" } ] } } }
            } } ] } } } } ],
            "secondaryContents": { "sectionListRenderer": { "contents": [
                { "musicShelfRenderer": { "contents": [
                    song_row("aaaaaaaaaaa", "Airbag", None, Some("4:44")),
                    song_row("bbbbbbbbbbb", "Paranoid Android", None, Some("6:23"))
                ] } },
                { "musicCarouselShelfRenderer": { "contents": [ song_row("ccccccccccc", "Otra versión", None, None),
                    { "watchPlaylistEndpoint": { "playlistId": "OLAK5uy_otra" } } ] } }
            ] } }
        } } });
        // La lista del álbum va en el enlace de cada pista.
        let mut response = response;
        response["contents"]["twoColumnBrowseResultsRenderer"]["secondaryContents"]["sectionListRenderer"]["contents"][0]
            ["musicShelfRenderer"]["contents"][0]["musicResponsiveListItemRenderer"]["flexColumns"][0]
            ["musicResponsiveListItemFlexColumnRenderer"]["text"]["runs"][0]["navigationEndpoint"] =
            json!({ "watchEndpoint": { "videoId": "aaaaaaaaaaa", "playlistId": "OLAK5uy_ok" } });

        let album = parse_album("MPREb_ok", &response);
        assert_eq!(album.title, "OK Computer");
        assert_eq!(album.kind.as_deref(), Some("Álbum"));
        assert_eq!(album.year.as_deref(), Some("1997"));
        assert_eq!(album.artists, vec![ArtistRef { id: "UCradio".into(), name: "Radiohead".into() }]);
        assert_eq!(album.playlist_id.as_deref(), Some("OLAK5uy_ok"));
        assert_eq!(album.tracks.len(), 2, "las de otras estanterías no cuentan");
        assert_eq!(album.tracks[1].title.as_deref(), Some("Paranoid Android"));
        assert_eq!(album.tracks[1].uploader.as_deref(), Some("Radiohead"), "el artista del álbum");
        assert_eq!(album.tracks[1].duration, Some(383.0));
        assert_eq!(
            album.tracks[0].thumbnail.as_deref(),
            Some("https://lh3.googleusercontent.com/c=w226-h226-p-l90-rj"),
            "la carátula del álbum"
        );
    }

    #[test]
    fn tarjetas_de_video_y_de_lista() {
        let video = json!({
            "title": { "runs": [ { "text": "Creep" } ] },
            "navigationEndpoint": { "watchEndpoint": { "videoId": "XFkzRNyygfk" } }
        });
        let card = parse_card(&video).unwrap();
        assert_eq!(card.kind, CardKind::Video);
        assert_eq!(card.id, "XFkzRNyygfk");

        let list = two_row("Esenciales", "Lista", "VLPLabc", "MUSIC_PAGE_TYPE_PLAYLIST", None);
        let card = parse_card(&list["musicTwoRowItemRenderer"]).unwrap();
        assert_eq!(card.kind, CardKind::Playlist);
        assert_eq!(card.playlist_id.as_deref(), Some("PLabc"));
    }

    #[test]
    fn canciones_encontradas_al_buscar() {
        let response = json!({ "x": [ { "musicResponsiveListItemRenderer": {
            "playlistItemData": { "videoId": "5xJP3p4LSKw" },
            "thumbnail": { "musicThumbnailRenderer": { "thumbnail": { "thumbnails": [
                { "url": "https://lh3.googleusercontent.com/a=w120-h120-l90-rj" } ] } } },
            "flexColumns": [
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [ { "text": "Las mas bonitas son p#tas" } ] } } },
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                    artist_run("Anuel AA", "UCanuel", "MUSIC_PAGE_TYPE_ARTIST"),
                    { "text": " y " },
                    artist_run("Ozuna", "UCozuna", "MUSIC_PAGE_TYPE_ARTIST"),
                    { "text": " • " },
                    artist_run("Real Hasta La Muerte", "MPREb_rhlm", "MUSIC_PAGE_TYPE_ALBUM"),
                    { "text": " • " },
                    { "text": "2:40" }
                ] } } }
            ]
        } } ] });

        let hits = parse_song_hits(&response);
        assert_eq!(hits.len(), 1);
        let hit = &hits[0];
        assert_eq!(hit.track.id, "5xJP3p4LSKw");
        assert_eq!(hit.track.title.as_deref(), Some("Las mas bonitas son p#tas"));
        assert_eq!(hit.track.uploader.as_deref(), Some("Anuel AA y Ozuna"));
        assert_eq!(hit.track.duration, Some(160.0));
        assert_eq!(hit.artists.len(), 2);
        assert_eq!(hit.album.as_ref().unwrap().title, "Real Hasta La Muerte");
        assert_eq!(
            hit.track.thumbnail.as_deref(),
            Some("https://lh3.googleusercontent.com/a=w226-h226-p-l90-rj")
        );
    }

    #[test]
    fn artistas_encontrados_al_buscar() {
        let response = json!({ "x": [ { "musicResponsiveListItemRenderer": {
            "navigationEndpoint": { "browseEndpoint": {
                "browseId": "UCradio",
                "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": "MUSIC_PAGE_TYPE_ARTIST" } } } },
            "flexColumns": [
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [ { "text": "Radiohead" } ] } } },
                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [ { "text": "Artista" }, { "text": " • 5,4 M" } ] } } }
            ]
        } } ] });
        let hits = parse_artist_hits(&response);
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].name, "Radiohead");
        assert_eq!(hits[0].subtitle.as_deref(), Some("Artista • 5,4 M"));
    }

    #[test]
    fn continuacion_pertenece_solo_a_la_coleccion() {
        let response = json!({ "contents": [
            { "musicPlaylistShelfRenderer": { "contents": [
                { "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "primera" } } },
                { "continuationItemRenderer": { "continuationEndpoint": { "continuationCommand": { "token": "pagina-2" } } } }
            ] } },
            { "musicShelfRenderer": { "contents": [
                { "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "recomendada" } } }
            ], "continuations": [{ "nextContinuationData": { "continuation": "otra-lista" } }] } }
        ] });
        let shelf = song_shelf(&response).unwrap();
        assert_eq!(shelf_tracks(shelf, Some("Cantante"), None).iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["primera"]);
        assert_eq!(song_continuation(shelf).as_deref(), Some("pagina-2"));
    }

    #[test]
    fn lee_continuaciones_musicales_y_acciones_sin_recortar_ni_reordenar() {
        for key in ["musicShelfContinuation", "musicPlaylistShelfContinuation", "appendContinuationItemsAction"] {
            let rows = json!([
                { "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "segunda" } } },
                { "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "primera" } } },
                { "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "segunda" } } }
            ]);
            let contents_key = if key == "appendContinuationItemsAction" { "continuationItems" } else { "contents" };
            let response = json!({ key: { contents_key: rows, "continuations": [{ "nextContinuationData": { "continuation": "siguiente" } }] } });
            let shelf = song_shelf(&response).unwrap();
            assert_eq!(shelf_tracks(shelf, None, None).iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["segunda", "primera", "segunda"]);
            assert_eq!(song_continuation(shelf).as_deref(), Some("siguiente"));
        }
    }

    #[test]
    fn album_usa_su_estanteria_playlist_y_conserva_pistas_repetidas() {
        let response = json!({ "musicPlaylistShelfRenderer": { "contents": [
            { "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "intro" } } },
            { "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "cancion" } } },
            { "musicResponsiveListItemRenderer": { "playlistItemData": { "videoId": "intro" } } }
        ] } });
        let page = parse_album("MPREb_prueba", &response);
        assert_eq!(page.tracks.iter().map(|t| t.id.as_str()).collect::<Vec<_>>(), vec!["intro", "cancion", "intro"]);
    }

    #[tokio::test]
    #[ignore]
    async fn en_vivo_colecciones_completas() {
        for name in ["Radiohead", "Bad Bunny"] {
            let hit = find_artist_named(name).await.unwrap().unwrap();
            let page = artist(&hit.id).await.unwrap();
            let tracks = artist_songs(&hit.id).await.unwrap();
            assert!(tracks.len() > page.songs.len());
            assert_eq!(tracks.iter().take(page.songs.len()).map(|t| &t.id).collect::<Vec<_>>(), page.songs.iter().map(|t| &t.id).collect::<Vec<_>>());
            assert_eq!(tracks.len(), tracks.iter().map(|t| &t.id).collect::<std::collections::HashSet<_>>().len());
            if name == "Radiohead" { assert!(tracks.len() > 100); }
            println!("COLECCION: {name} · principales {} · lista completa {}", page.songs.len(), tracks.len());
            for card in page.shelves.iter().flat_map(|s| &s.items).filter(|c| c.kind == CardKind::Album).take(2) {
                let album = album(&card.id).await.unwrap();
                assert!(!album.tracks.is_empty());
                println!("DISCO: {} · {} pistas", album.title, album.tracks.len());
                if let Some(id) = &album.playlist_id {
                    let response = call("browse", json!({ "browseId": format!("VL{id}") })).await.unwrap();
                    let expected = complete_songs(&response, None, None).await.unwrap();
                    assert!(!expected.is_empty());
                    // La vista de álbum y su playlist pueden usar IDs regionales
                    // distintos de la misma grabación; las pistas y su orden coinciden.
                    assert_eq!(album.tracks.iter().map(|t| &t.title).collect::<Vec<_>>(), expected.iter().map(|t| &t.title).collect::<Vec<_>>());
                }
            }
        }
    }

    /// Contra YouTube Music de verdad: `cargo test ytmusic -- --ignored --nocapture`.
    #[tokio::test]
    #[ignore]
    async fn en_vivo() {
        let links = track_links(Some("XFkzRNyygfk"), Some("Radiohead"), Some("Radiohead - Creep")).await.unwrap();
        println!("enlaces: {links:?}");
        let artist_id = links.artists[0].id.clone();

        let page = artist(&artist_id).await.unwrap();
        println!(
            "artista: {} · {} canciones · estanterías {:?}",
            page.name,
            page.songs.len(),
            page.shelves.iter().map(|s| format!("{} ({})", s.title, s.items.len())).collect::<Vec<_>>()
        );
        assert!(!page.songs.is_empty());

        let album_card = page.shelves.iter().flat_map(|s| &s.items).find(|c| c.kind == CardKind::Album).unwrap();
        let album = album(&album_card.id).await.unwrap();
        println!("álbum: {} ({:?}, {:?}) · {} pistas · {:?}", album.title, album.kind, album.year, album.tracks.len(), album.playlist_id);
        assert!(!album.tracks.is_empty());

        if let Some(more) = page.shelves.iter().find_map(|s| s.more.as_ref().filter(|m| m.browse_id.starts_with("MPAD"))) {
            let all = self::more(&more.browse_id, more.params.as_deref()).await.unwrap();
            println!("discografía: {} tarjetas", all.len());
        }

        let hit = artist_for_query("radiohead creep").await.unwrap();
        println!("búsqueda: {hit:?}");
        assert!(hit.is_some());

        let lyric = track_links(None, Some("Letras Random"), Some("Radiohead - Creep (Letra)")).await.unwrap();
        println!("por el título: {lyric:?}");

        let songs = search_songs("Las mas bonitas son", 5).await.unwrap();
        for s in &songs {
            println!("canción: {:?} · {:?} · {:?}", s.track.title, s.track.uploader, s.track.duration);
        }
        assert_eq!(songs[0].artists[0].name, "Anuel AA");
    }
}
