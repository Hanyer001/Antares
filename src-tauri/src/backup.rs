//! Copias versionadas por usuario. Las restauraciones pendientes se aplican
//! al arrancar, antes de cargar los datos en memoria.
use std::{path::{Path, PathBuf}, sync::Mutex};
#[cfg(test)]
use std::collections::HashMap;
use serde::Serialize;
use serde_json::Value;
use tauri::State;
use crate::{commands::UsersState, playlists::Playlists, settings::Settings, stats::Stats, store::{self, Store}};

pub use crate::backup_model::Backup;
use crate::backup_model::parse;
const KEEP: usize = 7;
pub struct Backups { dir: Mutex<PathBuf>, lock: Mutex<()> }
impl Backups {
    pub fn new(dir: PathBuf) -> Self { Self { dir: Mutex::new(dir), lock: Mutex::new(()) } }
    fn dir(&self) -> Result<PathBuf,String> { self.dir.lock().map(|d| d.clone()).map_err(|_| "ruta de copias bloqueada".into()) }
    #[cfg(mobile)]
    pub(crate) fn retarget(&self, dir: PathBuf) -> Result<(),String> {
        let _guard = self.lock.lock().map_err(|_| "copia ocupada")?;
        *self.dir.lock().map_err(|_| "ruta de copias bloqueada")? = dir; Ok(())
    }
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
    if backups.dir()?.join("pending-restore.json").exists() { return Err("Reinicia Antares para terminar la restauración pendiente.".into()); }
    let backup = Backup {
        app: "antares-backup".into(), version: 1, created_at: store::now_secs(),
        playlists: playlists.all(), stats: stats.snapshot().into_iter().map(|s| (s.track.id.clone(), s)).collect(),
        taste: stats.signals(), history: store.history(), settings: settings.get().unwrap_or(serde_json::json!({})),
        wallpaper: settings.wallpaper(), local,
    }.validate()?;
    automatic(&backups.dir()?, &backup)?;
    store::write_json_atomic(&backups.dir()?.join("workspace.json"), &backup.local).map_err(|e| e.to_string())?;
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
    let _guard = backups.lock.lock().map_err(|_| "Copia ocupada".to_string())?;
    stage_restore(&backups.dir()?, &contents, &previous)
}

fn stage_restore(dir: &Path, contents: &str, previous: &str) -> Result<(), String> {
    let next = parse(contents)?;
    let old = parse(previous)?;
    let pending = dir.join("pending-restore.json");
    if pending.exists() {
        return Err("Reinicia Antares para terminar la restauración pendiente.".into());
    }

    #[cfg(desktop)]
    let next = {
        let mut next = next;
        preserve_device_settings(&mut next.settings, &old.settings);
        crate::settings::validate(&next.settings)?;
        next
    };

    save(dir, "before-restore.json", &old)?;
    // Si se interrumpe la aplicación de la copia, el arranque la repite.
    store::write_json_atomic(&pending, &next).map_err(|e| e.to_string())
}

#[cfg(desktop)]
fn preserve_device_settings(imported: &mut Value, current: &Value) {
    let Some(imported) = imported.as_object_mut() else { return };
    for (section, keys) in [
        ("system", ["autostart", "startHidden"]),
        ("shortcuts", ["globalEnabled", "global"]),
    ] {
        let device = current.get(section).and_then(Value::as_object);
        if let Some(portable) = imported.get_mut(section).and_then(Value::as_object_mut) {
            for key in keys {
                portable.remove(key);
            }
        }
        for (key, value) in keys.into_iter().filter_map(|key| Some((key, device?.get(key)?))) {
            let target = imported.entry(section).or_insert_with(|| serde_json::json!({}));
            if !target.is_object() {
                *target = serde_json::json!({});
            }
            target[key] = value.clone();
        }
    }
}

#[derive(Serialize)]
pub struct SavedBackup { pub name: String, pub created_at: u64 }
#[tauri::command]
pub fn list_backups(backups: State<'_, Backups>) -> Vec<SavedBackup> {
    let mut result = Vec::new();
    let Ok(dir) = backups.dir() else { return result };
    if let Ok(entries) = std::fs::read_dir(dir.join("backups")) {
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
    std::fs::read_to_string(backups.dir()?.join("backups").join(name)).map_err(|e| e.to_string())
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
pub fn restart_after_restore(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(desktop)]
    return crate::restart_clean(&app);
    #[cfg(mobile)]
    { crate::commands::flush_data(&app)?; crate::commands::reload_mobile_data(&app) }
}

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
    #[test]
    fn invalid_import_keeps_the_profile_and_existing_safety_copy() {
        let dir = dir("invalid-import");
        let b = sample();
        let valid = serde_json::to_string(&b).unwrap();
        let mut incompatible = b.clone();
        incompatible.version = 999;
        save(&dir, "before-restore.json", &b).unwrap();
        let safety = dir.join("backups/before-restore.json");
        let before = std::fs::read(&safety).unwrap();
        store::write_json_atomic(&dir.join("settings.json"), &b.settings).unwrap();

        for contents in [&valid[..valid.len() / 2], &serde_json::to_string(&incompatible).unwrap()] {
            assert!(stage_restore(&dir, contents, &valid).is_err());
            assert!(!dir.join("pending-restore.json").exists());
            assert_eq!(std::fs::read(&safety).unwrap(), before);
            assert_eq!(store::read_json::<Value>(&dir.join("settings.json")).unwrap(), b.settings);
        }
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[cfg(desktop)]
    #[test]
    fn restore_retries_and_keeps_device_settings_and_profiles_separate() {
        use crate::users::{Users, MAIN_ID};
        use serde_json::json;

        let root = dir("portable-restore");
        let mut users = Users::default();
        let other = users.create("Edición 🎵").unwrap();
        users.switch(&other).unwrap();
        users.save(&root).unwrap();
        let destination = Users::load(&root).data_dir(&root);
        let main = crate::users::user_dir(&root, MAIN_ID);
        let main_state = json!({"session":{"position":8.0}});
        store::write_json_atomic(&main.join("workspace.json"), &main_state).unwrap();
        assert_eq!(Users::load(&root).users[1].name, "Edición 🎵");

        let track = json!({"id":"demo2","title":"Canción 🎵","channel":"Artista","watch_url":"","duration":210});
        let mut imported = sample();
        imported.playlists = serde_json::from_value(json!([{
            "id":"mix","name":"Colección 🎵","tracks":[track],"created_at":1,"updated_at":1
        }])).unwrap();
        imported.stats = serde_json::from_value(json!({"demo2":{
            "id":"demo2","title":"Canción 🎵","channel":"Artista","watch_url":"","rating":"like",
            "plays":1,"skips":0,"completions":0,"listened_secs":39.5,"last_played":1
        }})).unwrap();
        imported.local = json!({"session":{"queue":["demo2","demo1"],"time":39.5},"moments":{}});
        imported.settings = json!({
            "version":2,"appearance":{"theme":"light"},
            "system":{"autostart":true,"startHidden":true,"closeToTray":false},
            "shortcuts":{"globalEnabled":true,"global":{"next":"Super+N"},"local":{"next":"N"}}
        });
        let mut old = sample();
        old.settings = json!({
            "version":2,"system":{"autostart":false},
            "shortcuts":{"global":{"next":"Alt+N"}}
        });
        let contents = serde_json::to_string(&imported).unwrap();
        let previous = serde_json::to_string(&old).unwrap();
        stage_restore(&destination, &contents, &previous).unwrap();
        assert!(stage_restore(&destination, &contents, &previous).is_err());

        let blocked = destination.join("workspace.json");
        std::fs::create_dir(&blocked).unwrap();
        assert!(apply_pending(&destination).unwrap_err().contains("workspace.json"));
        assert!(destination.join("pending-restore.json").is_file());
        std::fs::remove_dir(&blocked).unwrap();
        apply_pending(&destination).unwrap();
        assert!(!destination.join("pending-restore.json").exists());

        let settings: Value = store::read_json(&destination.join("settings.json")).unwrap();
        assert_eq!(settings, json!({
            "version":2,"appearance":{"theme":"light"},
            "system":{"autostart":false,"closeToTray":false},
            "shortcuts":{"global":{"next":"Alt+N"},"local":{"next":"N"}}
        }));
        let lists = Playlists::load(destination.clone()).all();
        assert_eq!(lists[0].name, "Colección 🎵");
        assert_eq!(lists[0].tracks[0].id, "demo2");
        let stats = Stats::load(destination.clone()).snapshot();
        assert_eq!(stats[0].rating, crate::stats::Rating::Like);
        assert_eq!(store::read_json::<Value>(&destination.join("restored-workspace.json")).unwrap(), imported.local);
        assert_eq!(store::read_json::<Value>(&main.join("workspace.json")).unwrap(), main_state);
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test] fn automatic_backups_keep_seven_days() {
        let dir=dir("rotation");let mut b=sample();for day in 20000..20010 {b.created_at=day*86400;automatic(&dir,&b).unwrap();}
        let count=std::fs::read_dir(dir.join("backups")).unwrap().filter_map(Result::ok).filter(|e|e.path().extension().is_some_and(|x|x=="json")).count();assert_eq!(count,7);
    }
}
