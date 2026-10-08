//! Selecciona yt-dlp en escritorio o InnerTube en Android.
//! ANTARES_SOURCE=innertube permite probar el cliente nativo en escritorio.

use std::sync::OnceLock;

use crate::innertube;
use crate::track::{SearchResult, TrackInfo};
use crate::ytdlp;

/// Si se usa el cliente propio en vez de yt-dlp.
pub fn native() -> bool {
    static NATIVE: OnceLock<bool> = OnceLock::new();
    *NATIVE.get_or_init(|| {
        cfg!(mobile) || std::env::var("ANTARES_SOURCE").is_ok_and(|v| v.eq_ignore_ascii_case("innertube"))
    })
}

/// La URL de audio y los metadatos. `safe` es el reintento de yt-dlp con su
/// cliente conservador; el cliente propio simplemente lo vuelve a intentar.
pub async fn resolve(query: &str, safe: bool) -> Result<TrackInfo, String> {
    if native() {
        innertube::resolve_track(query, ytdlp::data_saver()).await
    } else {
        ytdlp::resolve_track(ytdlp::build_target(query), safe).await
    }
}

pub async fn search(query: String, limit: usize) -> Result<Vec<SearchResult>, String> {
    if native() {
        crate::ytmusic::search_songs(&query, limit).await.map(|songs| songs.into_iter().filter(|s| s.track.is_music == Some(true)).map(|s| s.track).collect())
    } else {
        ytdlp::search_tracks(query, limit).await
    }
}

/// Una lista o un Mix de YouTube: su titulo y sus canciones.
pub async fn playlist(url: String, limit: &'static str) -> Result<(Option<String>, Vec<SearchResult>), String> {
    if native() {
        innertube::list_playlist(&url, limit.parse().unwrap_or(500)).await
    } else {
        ytdlp::list_playlist(url, limit).await
    }
}
