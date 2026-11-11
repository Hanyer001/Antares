use std::time::Instant;
use std::{env, net::SocketAddr, sync::Arc, time::Duration};

use axum::{
    body::Body,
    extract::{Path, Query, State},
    http::{header, HeaderMap, HeaderValue, Method, StatusCode},
    response::{IntoResponse, Response},
    routing::get,
    Json, Router,
};
use serde::Deserialize;
use tower_http::{cors::CorsLayer, services::ServeDir};

// Mismo motor que usa Antares, sin depender de Tauri ni de un WebView.
#[allow(dead_code)]
#[path = "../../src-tauri/src/cache.rs"]
mod cache;
mod catalog;
mod workspace;
mod source;
#[allow(dead_code)]
#[path = "../../src-tauri/src/store.rs"]
mod store;
#[allow(dead_code)]
#[path = "../../src-tauri/src/users.rs"]
mod users;
#[allow(dead_code)]
#[path = "../../src-tauri/src/settings.rs"]
mod settings;
#[allow(dead_code)]
#[path = "../../src-tauri/src/stats.rs"]
mod stats;
#[allow(dead_code)]
#[path = "../../src-tauri/src/playlists.rs"]
mod playlists;
#[allow(dead_code)]
#[path = "../../src-tauri/src/recommend.rs"]
mod recommend;
#[allow(dead_code)]
#[path = "../../src-tauri/src/related.rs"]
mod related;
#[allow(dead_code)]
#[path = "../../src-tauri/src/home.rs"]
mod home;
#[allow(dead_code)]
#[path = "../../src-tauri/src/importer.rs"]
mod importer;
#[allow(dead_code)]
#[path = "../../src-tauri/src/backup_model.rs"]
mod backup_model;

#[allow(dead_code)]
#[path = "../../src-tauri/src/innertube.rs"]
mod innertube;
#[allow(dead_code)]
#[path = "../../src-tauri/src/lyrics.rs"]
mod lyrics;
use antares_core::track;
#[allow(dead_code)]
#[path = "../../src-tauri/src/ytmusic.rs"]
mod ytmusic;

struct App {
    cache: cache::AppCache,
    client: reqwest::Client,
    lyrics: lyrics::LyricsCache,
    diagnostics: bool,
    workspaces: workspace::Workspaces,
}

type AppState = Arc<App>;
type ApiError = (StatusCode, Json<serde_json::Value>);

fn error(status: StatusCode, message: impl Into<String>) -> ApiError {
    (status, Json(serde_json::json!({ "error": message.into() })))
}

#[derive(Deserialize)]
struct Search {
    q: String,
    limit: Option<usize>,
}

async fn search(Query(params): Query<Search>) -> Result<Json<Vec<track::SearchResult>>, ApiError> {
    let query = params.q.trim();
    if query.is_empty() || query.chars().count() > 160 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Escribe entre 1 y 160 caracteres.",
        ));
    }
    innertube::search_tracks(query, params.limit.unwrap_or(12).clamp(1, 60))
        .await
        .map(Json)
        .map_err(|message| error(StatusCode::BAD_GATEWAY, message))
}

fn allowed_audio(url: &reqwest::Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.path() == "/videoplayback"
        && url
            .host_str()
            .is_some_and(|host| host.ends_with(".googlevideo.com"))
}

async fn resolved_track(app: &App, id: &str) -> Result<track::TrackInfo, ApiError> {
    resolve_audio_track(app, id, false).await
}

fn audio_cache_key(id: &str, saver: bool) -> String {
    format!("{id}:aac:{saver}")
}

async fn resolve_audio_track(
    app: &App,
    id: &str,
    saver: bool,
) -> Result<track::TrackInfo, ApiError> {
    resolve_audio_track_options(app, id, saver, false).await
}

async fn resolve_audio_track_options(app: &App, id: &str, saver: bool, fresh: bool) -> Result<track::TrackInfo, ApiError> {
    if id.len() != 11 || innertube::video_id(id).is_none() {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "El identificador de YouTube no es válido.",
        ));
    }

    let key = audio_cache_key(id, saver);
    let turn = app.cache.turn(&key);
    let track = {
        let _guard = turn.lock().await;
        if fresh { if let Some(old) = app.cache.get(&key) { app.cache.forget_url(&key, &old.url); } }
        match app.cache.get(&key) {
            Some(track) => Ok(track),
            None => innertube::resolve_track_with_format(id, saver, true)
                .await
                .inspect(|track| app.cache.put(&key, track)),
        }
    };
    app.cache.finish_turn(&key, turn);

    track.map_err(|message| error(StatusCode::BAD_GATEWAY, message))
}

async fn track_info(
    State(app): State<AppState>,
    Path(id): Path<String>,
    Query(options): Query<AudioOptions>,
) -> Result<Json<track::SearchResult>, ApiError> {
    // La recuperación renueva el enlace de esta pista y calidad; no cambia de vídeo.
    let track = resolve_audio_track_options(&app, &id, options.saver, options.fresh).await?;
    Ok(Json(track::SearchResult {
        watch_url: track::SearchResult::watch_url_for(&id),
        id,
        title: track.title,
        uploader: track.uploader,
        duration: track.duration,
        thumbnail: track.thumbnail,
        is_music: None,
    }))
}

async fn track_lyrics(
    State(app): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Option<lyrics::Lyrics>>, ApiError> {
    let track = resolved_track(&app, &id).await?;
    app.lyrics
        .get(
            &id,
            track.title.as_deref().unwrap_or_default(),
            track.uploader.as_deref(),
            track.duration,
        )
        .await
        .map(Json)
        .map_err(|_| error(StatusCode::BAD_GATEWAY, "No se pudo consultar LRCLIB."))
}

#[derive(Deserialize)]
struct AudioOptions {
    #[serde(default)]
    saver: bool,
    #[serde(default)]
    fresh: bool,
}

async fn prepare_audio(
    State(app): State<AppState>,
    Path(id): Path<String>,
    Query(options): Query<AudioOptions>,
) -> Result<StatusCode, ApiError> {
    resolve_audio_track(&app, &id, options.saver).await?;
    Ok(StatusCode::NO_CONTENT)
}

async fn audio_url(app: &App, id: &str, saver: bool) -> Result<reqwest::Url, ApiError> {
    let track = resolve_audio_track(app, id, saver).await?;
    reqwest::Url::parse(&track.url)
        .ok()
        .filter(allowed_audio)
        .ok_or_else(|| {
            error(
                StatusCode::BAD_GATEWAY,
                "YouTube devolvió un enlace de audio inesperado.",
            )
        })
}

async fn audio(
    State(app): State<AppState>,
    Path(id): Path<String>,
    Query(options): Query<AudioOptions>,
    method: Method,
    headers: HeaderMap,
) -> Result<Response, ApiError> {
    let started = Instant::now();
    let mut url = audio_url(&app, &id, options.saver).await?;
    let resolved = started.elapsed();
    let mut upstream = send_audio(&app, url.clone(), &method, &headers).await?;
    if matches!(upstream.status(), StatusCode::FORBIDDEN | StatusCode::GONE) {
        let key = audio_cache_key(&id, options.saver);
        app.cache.forget_url(&key, url.as_str());
        url = audio_url(&app, &id, options.saver).await?;
        upstream = send_audio(&app, url.clone(), &method, &headers).await?;
        if matches!(upstream.status(), StatusCode::FORBIDDEN | StatusCode::GONE) {
            app.cache.forget_url(&key, url.as_str());
        }
    }
    if app.diagnostics {
        let range = headers
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok());
        eprintln!(
            "audio id={id} {method} rango={range:?} status={} resolución={}ms cabeceras={}ms",
            upstream.status(),
            resolved.as_millis(),
            started.elapsed().as_millis()
        );
    }

    audio_response(upstream, method)
}

async fn send_audio(
    app: &App,
    url: reqwest::Url,
    method: &Method,
    headers: &HeaderMap,
) -> Result<reqwest::Response, ApiError> {
    let mut request = app.client.request(method.clone(), url);
    if let Some(range) = headers.get(header::RANGE) {
        request = request.header(header::RANGE, range);
    }
    request.send().await.map_err(|_| {
        error(
            StatusCode::BAD_GATEWAY,
            "No se pudo contactar al servidor de audio.",
        )
    })
}

fn audio_response(upstream: reqwest::Response, method: Method) -> Result<Response, ApiError> {
    if !(upstream.status().is_success() || upstream.status() == StatusCode::RANGE_NOT_SATISFIABLE) {
        return Err(error(
            StatusCode::BAD_GATEWAY,
            "El servidor rechazó el audio. Intenta reproducir de nuevo.",
        ));
    }

    let mut response = Response::builder()
        .status(upstream.status())
        .header(header::CACHE_CONTROL, "private, no-store");
    for key in [
        header::ACCEPT_RANGES,
        header::CONTENT_RANGE,
        header::CONTENT_LENGTH,
        header::CONTENT_TYPE,
    ] {
        if let Some(value) = upstream.headers().get(&key) {
            response = response.header(key, value);
        }
    }
    let body = if method == Method::HEAD {
        Body::empty()
    } else {
        Body::from_stream(upstream.bytes_stream())
    };
    Ok(response
        .body(body)
        .unwrap_or_else(|_| StatusCode::BAD_GATEWAY.into_response()))
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let address: SocketAddr = env::var("ANTARES_WEB_BIND")
        .unwrap_or_else(|_| env::var("PORT").map(|port| format!("0.0.0.0:{port}")).unwrap_or_else(|_| "127.0.0.1:4173".into()))
        .parse()?;
    let client = reqwest::Client::builder()
        .user_agent(innertube::AUDIO_USER_AGENT)
        .connect_timeout(Duration::from_secs(10))
        .read_timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() < 5 && allowed_audio(attempt.url()) {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()?;
    let mut api = Router::new()
        .merge(catalog::routes())
        .route("/account/verify", axum::routing::post(workspace::verify_account))
        .route("/command/{command}", axum::routing::post(workspace::command))
        .layer(axum::extract::DefaultBodyLimit::max(70 * 1024 * 1024))
        .route(
            "/health",
            get(|| async {
                Json(serde_json::json!({"service": "antares-web-api", "ready": true, "demo": env::var("ANTARES_WEB_DEMO").is_ok_and(|value| value == "true")}))
            }),
        )
        .route("/search", get(search))
        .route("/track/{id}", get(track_info))
        .route("/lyrics/{id}", get(track_lyrics))
        .route("/audio/{id}", get(audio))
        .route("/audio/{id}/prepare", get(prepare_audio))
        .with_state(Arc::new(App {
            workspaces: workspace::Workspaces::new(env::var_os("ANTARES_WEB_DATA").map(std::path::PathBuf::from).unwrap_or_else(|| std::path::PathBuf::from(".antares-web-data"))),
            cache: cache::AppCache::default(),
            client,
            lyrics: lyrics::LyricsCache::default(),
            diagnostics: env::var_os("ANTARES_WEB_DIAGNOSTICS").is_some(),
        }));

    if let Some(origin) = env::var("ANTARES_WEB_ORIGIN").ok().filter(|value| !value.trim().is_empty()) {
        api = api.layer(
            CorsLayer::new()
                .allow_origin(origin.parse::<HeaderValue>()?)
                .allow_methods([Method::GET, Method::HEAD, Method::POST])
                .allow_headers([header::RANGE, header::CONTENT_TYPE, axum::http::HeaderName::from_static("x-antares-account"), axum::http::HeaderName::from_static("x-antares-profile"), axum::http::HeaderName::from_static("x-antares-revision")]),
        );
    }

    let dist = env::var_os("ANTARES_WEB_DIST").map(std::path::PathBuf::from)
        .unwrap_or_else(|| concat!(env!("CARGO_MANIFEST_DIR"), "/../dist/web").into());
    let router = Router::new()
        .nest("/api", api)
        .fallback_service(ServeDir::new(dist));
    let listener = tokio::net::TcpListener::bind(address).await?;
    println!("Antares web en http://{}", listener.local_addr()?);
    axum::serve(listener, router).await?;
    Ok(())
}
