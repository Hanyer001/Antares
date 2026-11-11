//! Resolución de audio de escritorio con el extractor Rust incluido en Antares.

use std::sync::OnceLock;

use rusty_ytdl::{reqwest, RequestOptions, Video, VideoFormat, VideoOptions};

use crate::track::TrackInfo;

/// Solo audio primero; si no existe, permite un stream con audio y video.
fn select_audio(
    formats: &[VideoFormat],
    saver: bool,
    aac_only: bool,
) -> Result<&VideoFormat, String> {
    let playable = |format: &&VideoFormat| {
        format.has_audio
            && (!aac_only
                || (format.mime_type.container == "mp4"
                    && format
                        .mime_type
                        .audio_codec
                        .as_deref()
                        .is_some_and(|codec| codec.starts_with("mp4a"))))
            && (format.url.starts_with("https://") || format.url.starts_with("http://"))
    };
    let audio_only = formats.iter().filter(playable).any(|f| !f.has_video);
    let candidates = || {
        formats
            .iter()
            .filter(playable)
            .filter(|f| !audio_only || !f.has_video)
    };
    // En formatos solo audio el bitrate total mide el stream real; en formatos
    // combinados, audio_bitrate esta expresado en kbps.
    let bitrate = |f: &&VideoFormat| {
        if f.has_video {
            f.audio_bitrate.unwrap_or(0).saturating_mul(1000)
        } else {
            f.bitrate
        }
    };

    if saver {
        if let Some(format) = candidates()
            .filter(|f| bitrate(f) > 0 && bitrate(f) <= 72_000)
            .max_by_key(bitrate)
        {
            return Ok(format);
        }
        return candidates()
            .min_by_key(bitrate)
            .ok_or_else(|| "El video no contiene un stream de audio disponible.".to_string());
    }

    candidates()
        .max_by_key(bitrate)
        .ok_or_else(|| "El video no contiene un stream de audio disponible.".to_string())
}

/// Resuelve el vídeo dentro del proceso y conserva la información del catálogo.
pub async fn resolve(query: &str, saver: bool, aac_only: bool) -> Result<TrackInfo, String> {
    let target = crate::innertube::resolve_video_id(query).await?;
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
    let options = VideoOptions {
        request_options: RequestOptions {
            client: Some(CLIENT.get_or_init(reqwest::Client::new).clone()),
            ..Default::default()
        },
        ..Default::default()
    };
    let video = Video::new_with_options(&target, options)
        .map_err(|e| format!("No se pudo abrir el video con rusty_ytdl: {e}"))?;
    let info = tokio::time::timeout(std::time::Duration::from_secs(30), video.get_info())
        .await
        .map_err(|_| "Se agotó el tiempo al extraer el audio de YouTube.".to_string())?
        .map_err(|e| format!("No se pudo extraer el audio con rusty_ytdl: {e}"))?;
    let url = select_audio(&info.formats, saver, aac_only)?.url.clone();
    let details = info.video_details;

    Ok(TrackInfo {
        url,
        title: field(Some(&details.title)),
        uploader: details
            .author
            .as_ref()
            .and_then(|author| field(Some(&author.name)))
            .or_else(|| field(Some(&details.owner_channel_name))),
        duration: if details.is_live_content {
            None
        } else {
            details.length_seconds.parse().ok()
        },
        thumbnail: details
            .thumbnails
            .iter()
            .max_by_key(|t| (t.width, t.height))
            .and_then(|t| field(Some(&t.url))),
        id: field(Some(&details.video_id)),
    })
}

fn field(raw: Option<&str>) -> Option<String> {
    let value = raw?.trim();

    if value.is_empty() || value == "NA" {
        None
    } else {
        Some(value.to_string())
    }
}
