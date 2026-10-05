//! Copias versionadas por usuario. Las restauraciones pendientes se aplican
//! al arrancar, antes de cargar los datos en memoria.
use std::{collections::{HashMap, HashSet}, path::{Path, PathBuf}, sync::Mutex};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::State;
use crate::{commands::UsersState, playlists::{Playlist, Playlists}, settings::{self, Settings}, stats::{Stats, TrackStats}, store::{self, Store}, track::{HistoryEntry, SearchResult}};

const MAX_BYTES: usize = 64 * 1024 * 1024;
const KEEP: usize = 7;
#[derive(Clone, Serialize, Deserialize)]
pub struct Backup {
    app: String,
    version: u32,
    created_at: u64,
    playlists: Vec<Playlist>,
    stats: HashMap<String, TrackStats>,
    taste: HashMap<String, TrackStats>,
    history: Vec<HistoryEntry>,
    settings: Value,
    wallpaper: Option<String>,
    local: Value,
}

pub struct Backups { dir: PathBuf, lock: Mutex<()> }
impl Backups { pub fn new(dir: PathBuf) -> Self { Self { dir, lock: Mutex::new(()) } } }

fn clean_track(track: &mut SearchResult) -> Result<(), String> {
    if track.id.is_empty() || track.id.len() > 128 || !track.id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-') {
        return Err("Hay una canción sin identificador válido.".into());
    }
    track.watch_url = SearchResult::watch_url_for(&track.id);
    if track.duration.is_some_and(|n| !n.is_finite() || n < 0.0) { return Err("Duración no válida.".into()); }
    Ok(())
}

impl Backup {
    fn validate(mut self) -> Result<Self, String> {
        if self.app != "antares-backup" || self.version != 1 { return Err("Este archivo no es una copia compatible de Antares.".into()); }
        settings::validate(&self.settings)?;
        if let Some(image) = &self.wallpaper { settings::valid_wallpaper(image)?; }
        if !self.local.is_object() || serde_json::to_vec(&self.local).map_err(|e| e.to_string())?.len() > 4 * 1024 * 1024 {
            return Err("La sesión guardada no es válida.".into());
        }
        let mut ids = HashSet::new();
        for list in &mut self.playlists {
            if list.system || list.id == "likes" || list.id.is_empty() || !ids.insert(list.id.clone()) || list.name.trim().is_empty() {
                return Err("La copia contiene listas no válidas o repetidas.".into());
            }
            list.details.validate()?;
            for track in &mut list.tracks { clean_track(track)?; }
        }
        for map in [&mut self.stats, &mut self.taste] {
            for (id, stat) in map {
                clean_track(&mut stat.track)?;
                if id != &stat.track.id || !stat.listened_secs.is_finite() || stat.listened_secs < 0.0 || stat.skips > stat.plays || stat.completions > stat.plays {
                    return Err("La copia contiene estadísticas no válidas.".into());
                }
            }
        }
        for entry in &mut self.history { clean_track(&mut entry.track)?; }
        Ok(self)
    }
}

fn parse(contents: &str) -> Result<Backup, String> {
    if contents.len() > MAX_BYTES { return Err("La copia supera el límite de 64 MB.".into()); }
    serde_json::from_str::<Backup>(contents).map_err(|_| "El archivo está dañado o incompleto.".to_string())?.validate()
}

fn save(dir: &Path, name: &str, backup: &Backup) -> Result<(), String> {
    store::write_json_atomic(&dir.join("backups").join(name), backup).map_err(|e| format!("No se pudo guardar la copia: {e}"))
}

fn automatic(dir: &Path, backup: &Backup) -> Result<(), String> {
    let day = backup.created_at / 86400;
    save(dir, &format!("auto-{day}.json"), backup)?;
    let mut files: Vec<_> = std::fs::read_dir(dir.join("backups")).map_err(|e| e.to_string())?
        .filter_map(Result::ok).map(|e| e.path())
        .filter(|p| p.file_name().is_some_and(|n| n.to_string_lossy().starts_with("auto-")) && p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    let excess = files.len().saturating_sub(KEEP);
    for file in files.into_iter().take(excess) {
        let _ = std::fs::remove_file(file.with_extension("json.bak"));
        let _ = std::fs::remove_file(file);
    }
    Ok(())
}

#[tauri::command]
pub fn create_backup(local: Value, backups: State<'_, Backups>, playlists: State<'_, Playlists>, stats: State<'_, Stats>, store: State<'_, Store>, settings: State<'_, Settings>) -> Result<Backup, String> {
    let _guard = backups.lock.lock().map_err(|_| "Copia ocupada".to_string())?;
    if backups.dir.join("pending-restore.json").exists() { return Err("Reinicia Antares para terminar la restauración pendiente.".into()); }
    let backup = Backup {
        app: "antares-backup".into(), version: 1, created_at: store::now_secs(),
        playlists: playlists.all(), stats: stats.snapshot().into_iter().map(|s| (s.track.id.clone(), s)).collect(),
        taste: stats.signals(), history: store.history(), settings: settings.get().unwrap_or(serde_json::json!({})),
        wallpaper: settings.wallpaper(), local,
    }.validate()?;
    automatic(&backups.dir, &backup)?;
    store::write_json_atomic(&backups.dir.join("workspace.json"), &backup.local).map_err(|e| e.to_string())?;
    Ok(backup)
}

#[derive(Serialize)]
pub struct Preview { pub lists: usize, pub liked: usize, pub tracks: usize, pub created_at: u64 }
#[tauri::command]
pub fn inspect_backup(contents: String) -> Result<Preview, String> {
    let b = parse(&contents)?;
    Ok(Preview { lists: b.playlists.len(), liked: b.stats.values().filter(|s| s.rating == crate::stats::Rating::Like).count(), tracks: b.stats.len(), created_at: b.created_at })
}

#[tauri::command]
pub fn restore_backup(contents: String, previous: String, backups: State<'_, Backups>) -> Result<(), String> {
    let next = parse(&contents)?;
    let old = parse(&previous)?;
    let _guard = backups.lock.lock().map_err(|_| "Copia ocupada".to_string())?;
    save(&backups.dir, "before-restore.json", &old)?;
    // La marca se guarda de forma atómica. Si hay un fallo, el arranque repite la restauración completa.
    store::write_json_atomic(&backups.dir.join("pending-restore.json"), &next).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct SavedBackup { pub name: String, pub created_at: u64 }
#[tauri::command]
pub fn list_backups(backups: State<'_, Backups>) -> Vec<SavedBackup> {
    let mut result = Vec::new();
    if let Ok(entries) = std::fs::read_dir(backups.dir.join("backups")) {
        for path in entries.filter_map(Result::ok).map(|e| e.path()) {
            if path.extension().is_none_or(|e| e != "json") { continue; }
            if let Ok(contents) = std::fs::read_to_string(&path) {
                if let Ok(b) = parse(&contents) { result.push(SavedBackup { name: path.file_name().unwrap().to_string_lossy().into(), created_at: b.created_at }); }
            }
        }
    }
    result.sort_by_key(|b| std::cmp::Reverse(b.created_at));
    result
}
#[tauri::command]
pub fn read_backup(name: String, backups: State<'_, Backups>) -> Result<String, String> {
    if !name.ends_with(".json") || !name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.') || !(name.starts_with("auto-") || name == "before-restore.json") {
        return Err("Nombre de copia no válido.".into());
    }
    std::fs::read_to_string(backups.dir.join("backups").join(name)).map_err(|e| e.to_string())
}
#[tauri::command]
pub fn restored_workspace(state: State<'_, UsersState>) -> Result<Value, String> {
    Ok(store::read_json(&state.data_dir()?.join("restored-workspace.json")).unwrap_or(Value::Null))
}
#[tauri::command]
pub fn acknowledge_restored_workspace(state: State<'_, UsersState>) -> Result<(), String> {
    let path = state.data_dir()?.join("restored-workspace.json");
    if path.exists() { std::fs::remove_file(path).map_err(|e| e.to_string())?; }
    Ok(())
}
#[tauri::command]
pub fn restart_after_restore(app: tauri::AppHandle) { crate::restart_clean(&app); }

pub fn apply_pending(dir: &Path) -> Result<(), String> {
    let path = dir.join("pending-restore.json");
    if !path.exists() { return Ok(()); }
    let b = parse(&std::fs::read_to_string(&path).map_err(|e| e.to_string())?)?;
    let files = [
        ("playlists.json", serde_json::to_value(&b.playlists)), ("stats.json", serde_json::to_value(&b.stats)),
        ("taste.json", serde_json::to_value(&b.taste)), ("history.json", serde_json::to_value(&b.history)),
        ("settings.json", Ok(b.settings)), ("wallpaper.json", serde_json::to_value(&b.wallpaper)),
        ("workspace.json", Ok(b.local.clone())), ("restored-workspace.json", Ok(b.local)),
    ];
    for (name, value) in files {
        store::write_json_atomic(&dir.join(name), &value.map_err(|e| e.to_string())?).map_err(|e| format!("No se pudo restaurar {name}: {e}"))?;
    }
    std::fs::remove_file(&path).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn sample() -> Backup { Backup { app:"antares-backup".into(),version:1,created_at:store::now_secs(),playlists:vec![],stats:HashMap::new(),taste:HashMap::new(),history:vec![],settings:serde_json::json!({"version":2}),wallpaper:None,local:serde_json::json!({"session":null,"moments":{}}) } }
    fn dir(name:&str)->PathBuf { std::env::temp_dir().join(format!("antares-backup-{name}-{}-{:?}",std::process::id(),std::thread::current().id())) }
    #[test] fn backup_roundtrip_and_future_versions() { let b=sample();let text=serde_json::to_string(&b).unwrap();assert!(parse(&text).is_ok());let mut b=b;b.version=999;assert!(parse(&serde_json::to_string(&b).unwrap()).is_err());assert!(parse("{}").is_err()); }
    #[test] fn staged_restore_is_replayable_and_clears_commit_marker() {
        let dir=dir("restore");let b=sample();store::write_json_atomic(&dir.join("pending-restore.json"),&b).unwrap();
        store::write_json_atomic(&dir.join("settings.json"),&serde_json::json!({"old":true})).unwrap();
        apply_pending(&dir).unwrap();assert!(!dir.join("pending-restore.json").exists());
        assert_eq!(store::read_json::<Value>(&dir.join("settings.json")).unwrap(),b.settings);
        assert!(dir.join("restored-workspace.json").exists());apply_pending(&dir).unwrap();
    }
    #[test] fn invalid_restore_never_changes_existing_data() {
        let dir=dir("invalid");store::write_json_atomic(&dir.join("settings.json"),&serde_json::json!({"keep":true})).unwrap();
        store::write_json_atomic(&dir.join("pending-restore.json"),&serde_json::json!({"bad":true})).unwrap();
        assert!(apply_pending(&dir).is_err());assert_eq!(store::read_json::<Value>(&dir.join("settings.json")).unwrap(),serde_json::json!({"keep":true}));
    }
    #[test] fn automatic_backups_keep_seven_days() {
        let dir=dir("rotation");let mut b=sample();for day in 20000..20010 {b.created_at=day*86400;automatic(&dir,&b).unwrap();}
        let count=std::fs::read_dir(dir.join("backups")).unwrap().filter_map(Result::ok).filter(|e|e.path().extension().is_some_and(|x|x=="json")).count();assert_eq!(count,7);
    }
}
