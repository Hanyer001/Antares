//! El servidor web usa los proveedores nativos, sin procesos ni plugins Tauri.
pub fn native() -> bool {
    true
}
pub async fn playlist(
    url: String,
    limit: &'static str,
) -> Result<(Option<String>, Vec<crate::track::SearchResult>), String> {
    crate::innertube::list_playlist(&url, limit.parse().unwrap_or(500)).await
}
