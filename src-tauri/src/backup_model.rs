//! Formato y validación de copias compartidos por Tauri y la API web.
use crate::{
    playlists::Playlist,
    settings,
    stats::TrackStats,
    track::{HistoryEntry, SearchResult},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
const MAX_BYTES: usize = 64 * 1024 * 1024;
#[derive(Clone, Serialize, Deserialize)]
pub struct Backup {
    pub(crate) app: String,
    pub(crate) version: u32,
    pub(crate) created_at: u64,
    pub(crate) playlists: Vec<Playlist>,
    pub(crate) stats: HashMap<String, TrackStats>,
    pub(crate) taste: HashMap<String, TrackStats>,
    pub(crate) history: Vec<HistoryEntry>,
    pub(crate) settings: Value,
    pub(crate) wallpaper: Option<String>,
    pub(crate) local: Value,
}

fn clean_track(track: &mut SearchResult) -> Result<(), String> {
    if track.id.is_empty()
        || track.id.len() > 128
        || !track
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
    {
        return Err("Hay una canción sin identificador válido.".into());
    }
    track.watch_url = SearchResult::watch_url_for(&track.id);
    if track.duration.is_some_and(|n| !n.is_finite() || n < 0.0) {
        return Err("Duración no válida.".into());
    }
    Ok(())
}

impl Backup {
    pub(crate) fn validate(mut self) -> Result<Self, String> {
        if self.app != "antares-backup" || self.version != 1 {
            return Err("Este archivo no es una copia compatible de Antares.".into());
        }
        settings::validate(&self.settings)?;
        if let Some(image) = &self.wallpaper {
            settings::valid_wallpaper(image)?;
        }
        if !self.local.is_object()
            || serde_json::to_vec(&self.local)
                .map_err(|e| e.to_string())?
                .len()
                > 4 * 1024 * 1024
        {
            return Err("La sesión guardada no es válida.".into());
        }
        let mut ids = HashSet::new();
        for list in &mut self.playlists {
            if list.system
                || list.id == "likes"
                || list.id.is_empty()
                || !ids.insert(list.id.clone())
                || list.name.trim().is_empty()
            {
                return Err("La copia contiene listas no válidas o repetidas.".into());
            }
            list.details.validate()?;
            for track in &mut list.tracks {
                clean_track(track)?;
            }
        }
        for map in [&mut self.stats, &mut self.taste] {
            for (id, stat) in map {
                clean_track(&mut stat.track)?;
                if id != &stat.track.id
                    || !stat.listened_secs.is_finite()
                    || stat.listened_secs < 0.0
                    || stat.skips > stat.plays
                    || stat.completions > stat.plays
                {
                    return Err("La copia contiene estadísticas no válidas.".into());
                }
            }
        }
        for entry in &mut self.history {
            clean_track(&mut entry.track)?;
        }
        Ok(self)
    }
}

pub(crate) fn parse(contents: &str) -> Result<Backup, String> {
    if contents.len() > MAX_BYTES {
        return Err("La copia supera el límite de 64 MB.".into());
    }
    serde_json::from_str::<Backup>(contents)
        .map_err(|_| "El archivo está dañado o incompleto.".to_string())?
        .validate()
}
