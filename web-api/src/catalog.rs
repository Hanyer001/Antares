use axum::{
    extract::{Path, Query},
    http::StatusCode,
    routing::get,
    Json, Router,
};
use serde::{Deserialize, Serialize};

use crate::{error, innertube, track::SearchResult, ytmusic, ApiError, AppState, Search};

pub(super) fn routes() -> Router<AppState> {
    Router::new()
        .route("/v1/songs", get(songs))
        .route("/v1/artist", get(artist_for_query))
        .route("/v1/artists/{id}", get(artist))
        .route("/v1/artists/{id}/songs", get(artist_songs))
        .route("/v1/albums/{id}", get(album))
        .route("/v1/collections/{id}", get(collection))
        .route("/v1/mixes/{id}", get(mix))
        .route("/v1/shelves/{id}", get(shelf))
}

#[derive(Deserialize)]
struct ShelfOptions {
    params: Option<String>,
}

async fn shelf(
    Path(id): Path<String>,
    Query(options): Query<ShelfOptions>,
) -> Result<Json<Vec<ytmusic::Card>>, ApiError> {
    valid_id(&id)?;
    if options.params.as_ref().is_some_and(|value| value.len() > 2048) {
        return Err(error(StatusCode::BAD_REQUEST, "Parámetros de estantería inválidos."));
    }
    ytmusic::more(&id, options.params.as_deref()).await.map(Json).map_err(provider_error)
}

fn valid_id(id: &str) -> Result<(), ApiError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
    {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Identificador de colección inválido.",
        ));
    }
    Ok(())
}

fn checked_query(query: &str) -> Result<&str, ApiError> {
    let text = query.trim();
    if text.is_empty() || text.chars().count() > 160 {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Escribe entre 1 y 160 caracteres.",
        ));
    }
    Ok(text)
}

fn provider_error(message: String) -> ApiError {
    error(StatusCode::BAD_GATEWAY, message)
}

async fn songs(Query(query): Query<Search>) -> Result<Json<Vec<ytmusic::SongHit>>, ApiError> {
    ytmusic::search_songs(checked_query(&query.q)?, query.limit.unwrap_or(12).clamp(1, 60))
        .await
        .map(Json)
        .map_err(provider_error)
}

async fn artist_for_query(
    Query(query): Query<Search>,
) -> Result<Json<Option<ytmusic::ArtistHit>>, ApiError> {
    ytmusic::artist_for_query(checked_query(&query.q)?)
        .await
        .map(Json)
        .map_err(provider_error)
}

async fn artist(Path(id): Path<String>) -> Result<Json<ytmusic::ArtistPage>, ApiError> {
    valid_id(&id)?;
    ytmusic::artist(&id).await.map(Json).map_err(provider_error)
}

async fn artist_songs(Path(id): Path<String>) -> Result<Json<Vec<SearchResult>>, ApiError> {
    valid_id(&id)?;
    ytmusic::artist_songs(&id)
        .await
        .map(Json)
        .map_err(provider_error)
}

async fn album(Path(id): Path<String>) -> Result<Json<ytmusic::AlbumPage>, ApiError> {
    valid_id(&id)?;
    ytmusic::album(&id).await.map(Json).map_err(provider_error)
}

#[derive(Serialize)]
struct Collection {
    title: Option<String>,
    tracks: Vec<SearchResult>,
}

async fn collection(Path(id): Path<String>) -> Result<Json<Collection>, ApiError> {
    valid_id(&id)?;
    let url = format!("https://www.youtube.com/playlist?list={id}");
    let (title, tracks) = innertube::list_playlist(&url, 500)
        .await
        .map_err(provider_error)?;
    Ok(Json(Collection { title, tracks }))
}

async fn mix(Path(id): Path<String>) -> Result<Json<Vec<SearchResult>>, ApiError> {
    if id.len() != 11 || innertube::video_id(&id).is_none() {
        return Err(error(
            StatusCode::BAD_REQUEST,
            "Identificador de canción inválido.",
        ));
    }
    ytmusic::music_mix(&id, 25)
        .await
        .map(Json)
        .map_err(provider_error)
}
