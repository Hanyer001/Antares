//! Proveedores de catálogo y audio de Antares.

use std::sync::atomic::{AtomicBool, Ordering};

use crate::innertube;
use crate::track::{SearchResult, TrackInfo};

pub const PLAYLIST_LIMIT: usize = 500;
static DATA_SAVER: AtomicBool = AtomicBool::new(false);

pub fn set_data_saver(enabled: bool) {
    DATA_SAVER.store(enabled, Ordering::Relaxed);
}

/// El catálogo móvil usa canciones de YouTube Music. En escritorio, la interfaz
/// combina vídeos de YouTube y canciones de YouTube Music antes de ordenar.
pub const fn music_only() -> bool {
    cfg!(mobile)
}

pub async fn resolve(query: &str, safe: bool) -> Result<TrackInfo, String> {
    let saver = DATA_SAVER.load(Ordering::Relaxed);
    // WKWebView puede saltarse la ganancia de Web Audio con WebM/Opus.
    // https://bugs.webkit.org/show_bug.cgi?id=276813
    let aac_only = cfg!(any(target_os = "macos", target_os = "ios"));
    #[cfg(desktop)]
    if !safe {
        let id = innertube::resolve_video_id(query).await?;
        // La respuesta de player normalmente ya trae el audio firmado.
        // El extractor completo queda disponible cuando hace falta descifrar.
        return match innertube::resolve_track_with_format(&id, saver, aac_only).await {
            Ok(track) => Ok(track),
            Err(_) => crate::desktop_audio::resolve(&id, saver, aac_only).await,
        };
    }
    // AAC proporciona un formato alternativo durante la recuperación y es
    // necesario para el reproductor nativo de iOS.
    innertube::resolve_track_with_format(query, saver, safe || aac_only).await
}

pub async fn search(query: &str, limit: usize) -> Result<Vec<SearchResult>, String> {
    if music_only() {
        crate::ytmusic::search_songs(query, limit)
            .await
            .map(|songs| {
                songs
                    .into_iter()
                    .filter(|song| song.track.is_music == Some(true))
                    .map(|song| song.track)
                    .collect()
            })
    } else {
        innertube::search_tracks(query, limit).await
    }
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    #[tokio::test]
    #[ignore = "mide consultas reales a YouTube"]
    async fn latencia_catalogo_y_audio_en_vivo() {
        use std::time::Instant;

        let cdn = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(12))
            .build()
            .unwrap();
        for query in [
            "Talento Yan Block",
            "Radiohead Karma Police",
            "Daft Punk One More Time",
        ] {
            let start = Instant::now();
            let (songs, videos) = tokio::join!(
                async {
                    let result = crate::ytmusic::search_songs(query, 8).await.unwrap();
                    println!("{query}: Music {} ms", start.elapsed().as_millis());
                    result
                },
                async {
                    let result = search(query, 5).await.unwrap();
                    println!("{query}: vídeos {} ms", start.elapsed().as_millis());
                    result
                }
            );
            assert!(!songs.is_empty() && !videos.is_empty());

            for safe in [false, true] {
                let start = Instant::now();
                let track = resolve(&songs[0].track.watch_url, safe).await.unwrap();
                let resolved = start.elapsed();
                let response = cdn
                    .get(&track.url)
                    .header("Range", "bytes=0-1023")
                    .send()
                    .await
                    .unwrap();
                assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
                assert_eq!(response.bytes().await.unwrap().len(), 1024);
                println!(
                    "{query}: recuperación={safe}, URL {} ms, URL + 1 KiB {} ms",
                    resolved.as_millis(),
                    start.elapsed().as_millis()
                );
            }
        }
    }

    #[tokio::test]
    #[ignore = "consulta YouTube y su CDN"]
    async fn audio_de_escritorio_y_recuperacion_aac_en_vivo() {
        let song = crate::ytmusic::search_songs("Talento Yan Block", 8)
            .await
            .unwrap()
            .into_iter()
            .find(|song| {
                song.track.title.as_deref() == Some("Talento")
                    && song.artists.iter().any(|artist| artist.name == "Yan Block")
            })
            .expect("grabación oficial de Talento");

        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(15))
            .build()
            .unwrap();
        for safe in [false, true] {
            let audio = resolve(&song.track.watch_url, safe).await.unwrap();
            assert_eq!(audio.id.as_deref(), Some(song.track.id.as_str()));
            assert!(audio.duration.is_some_and(|d| (148.0..=152.0).contains(&d)));
            let start = 1_200_000;
            let response = client
                .get(&audio.url)
                .header("Range", format!("bytes={start}-{}", start + 1023))
                .send()
                .await
                .unwrap();
            assert_eq!(response.status(), reqwest::StatusCode::PARTIAL_CONTENT);
            assert!(response.headers()["content-range"]
                .to_str()
                .unwrap()
                .starts_with("bytes 1200000-"));
            if safe || cfg!(target_os = "macos") {
                assert!(response.headers()["content-type"]
                    .to_str()
                    .unwrap()
                    .starts_with("audio/mp4"));
            }
            assert_eq!(response.bytes().await.unwrap().len(), 1024);
            println!(
                "Talento: {:?}, rango avanzado disponible, recuperación AAC: {safe}",
                audio.duration
            );
        }
    }
}
