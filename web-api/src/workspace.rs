//! Datos privados por instalación y perfil. El navegador guarda una clave aleatoria
//! de 256 bits; el servidor guarda solamente su hash como identificador de carpeta.
use crate::{
    backup_model::{self, Backup},
    error,
    playlists::{self, PlaylistDetails, Playlists, LIKES_ID},
    recommend::{self, Mode, Params, Rng, SeedMix},
    related::Related,
    settings::Settings,
    stats::{Rating, Stats},
    store::{self, Store},
    track::{SearchResult, TrackInput},
    users::Users,
    ApiError, AppState,
};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
    Json,
};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    path::PathBuf,
    sync::{Arc, Mutex},
};

pub struct Workspaces {
    root: PathBuf,
    accounts: Mutex<HashMap<String, Arc<tokio::sync::Mutex<Account>>>>,
}
struct Account {
    root: PathBuf,
    users: Users,
    profiles: HashMap<String, Workspace>,
    jobs: HashMap<String, Arc<Mutex<ImportJob>>>,
}
struct Workspace {
    dir: PathBuf,
    lists: Playlists,
    stats: Stats,
    history: Store,
    settings: Settings,
    related: Related,
    revision: u64,
    events: Vec<String>,
}
impl Workspaces {
    pub fn new(root: PathBuf) -> Self {
        Self {
            root,
            accounts: Mutex::new(HashMap::new()),
        }
    }
    fn account(&self, token: &str) -> Result<Arc<tokio::sync::Mutex<Account>>, String> {
        if token.len() != 64 || !token.bytes().all(|c| c.is_ascii_hexdigit()) {
            return Err("Falta una clave de instalación válida.".into());
        }
        let key = account_hash(token);
        let mut accounts = self.accounts.lock().map_err(|_| "Acceso ocupado")?;
        if let Some(account) = accounts.get(&key) {
            return Ok(account.clone());
        }
        if accounts.len() >= 256 {
            return Err("Se alcanzó el límite de instalaciones activas.".into());
        }
        let root = self.root.join(&key);
        let users = Users::load(&root);
        let account = Arc::new(tokio::sync::Mutex::new(Account {
            root,
            users,
            profiles: HashMap::new(),
            jobs: HashMap::new(),
        }));
        accounts.insert(key, account.clone());
        Ok(account)
    }
}
fn account_hash(token: &str) -> String {
    format!("{:x}", Sha256::digest(token.as_bytes()))
}

pub async fn verify_account(State(app): State<AppState>, headers: HeaderMap) -> Result<StatusCode, ApiError> {
    let token = headers.get("x-antares-account").and_then(|value| value.to_str().ok()).unwrap_or("");
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit())
        || !app.workspaces.root.join(account_hash(token)).is_dir() {
        return Err(error(StatusCode::UNAUTHORIZED, "La clave no corresponde a una cuenta de este servidor."));
    }
    Ok(StatusCode::NO_CONTENT)
}

fn sync_operation(command: &str, args: &Value) -> Result<Option<String>, String> {
    let Some(id): Option<String> = arg(args, "operationId")? else { return Ok(None); };
    if !matches!(command, "create_playlist" | "add_to_playlist" | "remove_from_playlist" | "set_rating")
        || id.len() != 32 || !id.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Operación de sincronización inválida.".into());
    }
    Ok(Some(id))
}

#[derive(Deserialize, Serialize)]
struct PendingSync {
    id: String,
    command: String,
    args: Value,
}

fn sync_receipt(ws: &Workspace, id: &str) -> PathBuf {
    ws.dir.join("sync-receipts").join(id)
}

fn sync_storage_error(err: std::io::Error) -> String {
    format!("Almacenamiento temporalmente no disponible: {err}")
}

async fn complete_sync(ws: &mut Workspace, pending: &PendingSync) -> Result<Value, String> {
    let marker = ws.dir.join("pending-sync.json");
    let receipt = sync_receipt(ws, &pending.id);
    let output = if let Some(previous) = store::read_json(&receipt) {
        previous
    } else {
        let output = match dispatch(&pending.command, &pending.args, ws).await {
            Ok(output) => output,
            Err(message) => {
                std::fs::remove_file(&marker).map_err(sync_storage_error)?;
                return Err(message);
            }
        };
        ws.revision += 1;
        ws.flush().map_err(|err| format!("Almacenamiento temporalmente no disponible: {err}"))?;
        store::write_json_atomic(&receipt, &output).map_err(sync_storage_error)?;
        output
    };
    std::fs::remove_file(&marker).map_err(sync_storage_error)?;
    Ok(output)
}

impl Workspace {
    fn load(dir: PathBuf) -> Result<Self, String> {
        apply_restore(&dir)?;
        Ok(Self {
            lists: Playlists::load(dir.clone()),
            stats: Stats::load(dir.clone()),
            history: Store::load(dir.clone()),
            settings: Settings::load(dir.clone()),
            related: Related::load(dir.clone()),
            revision: store::read_json(&dir.join("revision.json")).unwrap_or(0),
            events: store::read_json(&dir.join("events.json")).unwrap_or_default(),
            dir,
        })
    }
    fn flush(&self) -> Result<(), String> {
        self.lists.flush_mobile()?;
        self.stats.flush_mobile()?;
        self.history.flush_mobile()?;
        self.settings.flush_mobile()?;
        store::write_json_atomic(&self.dir.join("events.json"), &self.events)
            .map_err(|e| e.to_string())?;
        store::write_json_atomic(&self.dir.join("revision.json"), &self.revision)
            .map_err(|e| e.to_string())
    }
    fn snapshot(&self, local: Value) -> Result<Backup, String> {
        Backup {
            app: "antares-backup".into(),
            version: 1,
            created_at: store::now_secs(),
            playlists: self.lists.all(),
            stats: self
                .stats
                .snapshot()
                .into_iter()
                .map(|s| (s.track.id.clone(), s))
                .collect(),
            taste: self.stats.signals(),
            history: self.history.history(),
            settings: self.settings.get().unwrap_or(json!({})),
            wallpaper: self.settings.wallpaper(),
            local,
        }
        .validate()
    }
}
fn arg<T: DeserializeOwned>(args: &Value, name: &str) -> Result<T, String> {
    serde_json::from_value(args.get(name).cloned().unwrap_or(Value::Null))
        .map_err(|_| format!("Parámetro inválido: {name}"))
}
fn track(input: TrackInput) -> Result<SearchResult, String> {
    let result = input.into_track()?;
    if result.id.len() != 11
        || !result
            .id
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-'))
        || result.duration.is_some_and(|d| !d.is_finite() || d < 0.0)
    {
        return Err("Canción inválida.".into());
    }
    Ok(result)
}
fn value<T: serde::Serialize>(v: T) -> Result<Value, String> {
    serde_json::to_value(v).map_err(|e| e.to_string())
}
fn reject_system(id: &str) -> Result<(), String> {
    if id == LIKES_ID {
        Err("Esta acción no está disponible en Me gusta.".into())
    } else {
        Ok(())
    }
}
fn read_only(command: &str) -> bool {
    matches!(
        command,
        "get_users"
            | "get_settings"
            | "get_wallpaper"
            | "get_history"
            | "get_rating"
            | "get_playlists"
            | "get_summary"
            | "get_home"
            | "list_backups"
            | "read_backup"
            | "inspect_backup"
            | "restored_workspace"
            | "recommend"
            | "track_links"
    )
}

pub async fn command(
    State(app): State<AppState>,
    Path(command): Path<String>,
    headers: HeaderMap,
    Json(args): Json<Value>,
) -> Result<Json<Value>, ApiError> {
    let token = headers
        .get("x-antares-account")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("");
    let account = app
        .workspaces
        .account(token)
        .map_err(|m| error(StatusCode::UNAUTHORIZED, m))?;
    let mut account = account.lock().await;
    let profile = headers
        .get("x-antares-profile")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("main")
        .to_string();
    if !account.users.users.iter().any(|u| u.id == profile) {
        return Err(error(
            StatusCode::FORBIDDEN,
            "Ese perfil no pertenece a esta instalación.",
        ));
    }
    // La selección pertenece a esta petición: dos pestañas pueden usar perfiles distintos.
    let result: Result<Value, String> = async {
        if command == "register_account" {
            std::fs::create_dir_all(&account.root).map_err(|err| err.to_string())?;
            return Ok(json!({"value":null,"revision":null}));
        }
        if matches!(command.as_str(), "get_users" | "create_user" | "rename_user" | "delete_user" | "switch_user") {
            let mut next = account.users.clone();
            next.current = profile.clone();
            match command.as_str() {
                "create_user" => { next.create(&arg::<String>(&args,"name")?)?; },
                "rename_user" => next.rename(&arg::<String>(&args,"id")?, &arg::<String>(&args,"name")?)?,
                "delete_user" => {
                    let id: String = arg(&args,"id")?; next.remove(&id)?;
                    // Se archiva para permitir recuperación administrativa, sin purgar datos.
                    if let Some(old) = account.profiles.remove(&id) { old.flush()?; }
                    let dir = crate::users::user_dir(&account.root, &id);
                    if dir.exists() {
                        let trash = account.root.join("archived"); std::fs::create_dir_all(&trash).map_err(|e| e.to_string())?;
                        std::fs::rename(&dir, trash.join(format!("{id}-{}",store::now_secs()))).map_err(|e| e.to_string())?;
                    }
                },
                "switch_user" => next.switch(&arg::<String>(&args,"id")?)?, _ => {},
            }
            if command != "get_users" { next.save(&account.root)?; account.users = next.clone(); }
            next.current = if command == "switch_user" { arg(&args,"id")? } else { profile.clone() };
            return value(json!({"value":next,"revision":null}));
        }
        if command == "start_import" {
            let kind: String = arg(&args,"kind")?;
            if !matches!(kind.as_str(), "import_playlist" | "import_text") { return Err("Importador inválido.".into()); }
            account.jobs.retain(|_, job| job.lock().is_ok_and(|j|j.committed.is_none()));
            if account.jobs.len() >= 8 { return Err("Hay demasiadas importaciones pendientes. Cancela alguna antes de iniciar otra.".into()); }
            let id = format!("{:x}",Sha256::digest(format!("{}:{:?}",args,std::time::SystemTime::now()).as_bytes()));
            let job = Arc::new(Mutex::new(ImportJob { profile: profile.clone(), done:0,total:0,result:None,failure:None,committed:None }));
            account.jobs.insert(id.clone(),job.clone());
            let payload = args.clone();
            tokio::spawn(async move {
                let progress = job.clone();
                let report: Arc<dyn Fn(usize,usize)+Send+Sync> = Arc::new(move |done,total| { if let Ok(mut job)=progress.lock(){job.done=done;job.total=total;} });
                let result = resolve_import(&kind,&payload,report).await;
                if let Ok(mut job)=job.lock(){ match result {Ok(result)=>{job.done=result.source_count;job.total=result.source_count;job.result=Some(result);},Err(error)=>job.failure=Some(error)}; }
            });
            return Ok(json!({"value":{"job":id},"revision":null}));
        }
        if command == "import_status" || command == "cancel_import" {
            let id: String=arg(&args,"job")?;
            let job=account.jobs.get(&id).ok_or("No existe esa importación.")?.clone();
            let job=job.lock().map_err(|_|"Importación ocupada")?;
            if job.profile!=profile{return Err("Importación de otro perfil.".into());}
            if command=="cancel_import"{drop(job);account.jobs.remove(&id);return Ok(json!({"value":null,"revision":null}));}
            return Ok(json!({"value":{"done":job.done,"total":job.total,"ready":job.result.is_some(),"error":job.failure,"preview":job.result},"revision":null}));
        }
        let import_job = if command=="commit_import" {
            let id: String=arg(&args,"job")?;
            let job=account.jobs.get(&id).ok_or("La revisión de importación caducó. Vuelve a prepararla.")?.clone();
            {let info=job.lock().map_err(|_|"Importación ocupada")?;
             if info.profile!=profile{return Err("Importación de otro perfil.".into());}
             if let Some(result)=&info.committed{return Ok(json!({"value":result,"revision":null}));}}
            Some(job)
        } else {None};
        if !account.profiles.contains_key(&profile) {
            let dir = crate::users::user_dir(&account.root, &profile);
            account.profiles.insert(profile.clone(), Workspace::load(dir)?);
        }
        let ws = account.profiles.get_mut(&profile).unwrap();
        let marker = ws.dir.join("pending-sync.json");
        if marker.exists() {
            let pending: PendingSync = store::read_json(&marker)
                .ok_or("Almacenamiento temporalmente no disponible: operación pendiente ilegible.")?;
            complete_sync(ws, &pending).await?;
        }
        if let Some(id) = sync_operation(&command, &args)? {
            if let Some(output) = store::read_json::<Value>(&sync_receipt(ws, &id)) {
                return Ok(json!({"value":output,"revision":ws.revision}));
            }
            let pending = PendingSync { id, command, args };
            store::write_json_atomic(&marker, &pending).map_err(sync_storage_error)?;
            let output = complete_sync(ws, &pending).await?;
            return Ok(json!({"value":output,"revision":ws.revision}));
        }
        let event: Option<String> = arg(&args,"eventId")?;
        let listening = matches!(command.as_str(), "record_play" | "record_listen");
        if listening && event.as_ref().is_some_and(|id| ws.events.contains(id)) {
            return Ok(json!({"value":null,"revision":ws.revision}));
        }
        if !read_only(&command) && !listening {
            if let Some(revision) = headers.get("x-antares-revision").and_then(|v| v.to_str().ok()).and_then(|s| s.parse::<u64>().ok()) {
                if revision != ws.revision { return Err("Los datos cambiaron en otra ventana. Vuelve a abrir Antares antes de guardar.".into()); }
            }
        }
        let output = if let Some(job)=&import_job {
            let info=job.lock().map_err(|_|"Importación ocupada")?;
            let prepared=info.result.as_ref().ok_or("La importación aún no termina.")?;
            commit_import(ws,prepared)?
        } else { dispatch(&command, &args, ws).await? };

        if !read_only(&command) {
            if let Some(id) = event.filter(|_| listening) {
                ws.events.push(id);
                if ws.events.len() > 2000 { ws.events.remove(0); }
            }
            ws.revision += 1;
            ws.flush()?;
        }
        if let Some(job)=import_job {job.lock().map_err(|_|"Importación ocupada")?.committed=Some(output.clone());}
        Ok(json!({"value": output, "revision": ws.revision}))
    }.await;
    result.map(Json).map_err(|message| {
        error(
            if message.starts_with("Almacenamiento temporalmente no disponible:") {
                StatusCode::SERVICE_UNAVAILABLE
            } else if message.contains("otra ventana") {
                StatusCode::CONFLICT
            } else {
                StatusCode::BAD_REQUEST
            },
            message,
        )
    })
}

async fn dispatch(command: &str, a: &Value, ws: &mut Workspace) -> Result<Value, String> {
    match command {
        "track_links" => {
            let id: Option<String> = arg(a, "videoId")?;
            let uploader: Option<String> = arg(a, "uploader")?;
            let title: Option<String> = arg(a, "title")?;
            value(
                crate::ytmusic::track_links(id.as_deref(), uploader.as_deref(), title.as_deref())
                    .await?,
            )
        }
        "get_settings" => value(ws.settings.get()),
        "save_settings" => {
            ws.settings.set(arg(a, "value")?)?;
            Ok(Value::Null)
        }
        "get_wallpaper" => value(ws.settings.wallpaper()),
        "set_wallpaper" => {
            ws.settings.set_wallpaper(arg(a, "image")?)?;
            Ok(Value::Null)
        }
        "get_history" => value(ws.history.history()),
        "clear_history" => {
            ws.history.clear_history();
            Ok(Value::Null)
        }
        "record_play" => {
            ws.history.record(track(
                serde_json::from_value(a.clone()).map_err(|_| "Canción inválida")?,
            )?);
            Ok(Value::Null)
        }
        "record_listen" => value(ws.stats.record_context(
            track(arg(a, "track")?)?,
            arg(a, "listened")?,
            arg(a, "ended")?,
            arg::<Option<bool>>(a, "learn")?.unwrap_or(true),
        )),
        "get_rating" => value(ws.stats.rating(&arg::<String>(a, "id")?)),
        "set_rating" => {
            ws.stats
                .set_rating(track(arg(a, "track")?)?, arg(a, "rating")?);
            Ok(Value::Null)
        }
        "get_summary" => value(ws.stats.summary()),
        "get_home" => value(crate::home::build(
            &ws.stats.recommendation_snapshot(),
            store::now_secs(),
        )),
        "get_playlists" => {
            let mut all = vec![playlists::likes_playlist(ws.stats.liked())];
            let library = ws.stats.snapshot();
            all.extend(ws.lists.all().into_iter().map(|mut list| {
                if let Some(rules) = &list.details.rules {
                    list.tracks = rules.select(&library, store::now_secs());
                }
                list
            }));
            value(all)
        }
        "create_playlist" | "create_smart_playlist" => {
            let inputs: Option<Vec<TrackInput>> = arg(a, "tracks")?;
            let tracks = inputs
                .unwrap_or_default()
                .into_iter()
                .map(track)
                .collect::<Result<Vec<_>, _>>()?;
            let details: PlaylistDetails = if command == "create_smart_playlist" {
                arg(a, "details")?
            } else {
                PlaylistDetails::default()
            };
            if command == "create_smart_playlist" && details.rules.is_none() {
                return Err("Elige las reglas de la lista.".into());
            }
            let name: String = arg(a, "name")?;
            let list = if let Some(operation) = sync_operation(command, a)? {
                ws.lists.create_for_sync(format!("sync-{operation}"), &name, tracks)?
            } else {
                ws.lists.create_with_details(&name, tracks, details)?
            };
            value(list.id)
        }
        "rename_playlist" => {
            let id: String = arg(a, "id")?;
            reject_system(&id)?;
            ws.lists.rename(&id, &arg::<String>(a, "name")?)?;
            Ok(Value::Null)
        }
        "delete_playlist" => {
            let id: String = arg(a, "id")?;
            reject_system(&id)?;
            ws.lists.delete(&id)?;
            Ok(Value::Null)
        }
        "update_playlist_details" => {
            let id: String = arg(a, "id")?;
            reject_system(&id)?;
            ws.lists.update_details_and_name(
                &id,
                arg(a, "details")?,
                arg::<Option<String>>(a, "name")?.as_deref(),
            )?;
            Ok(Value::Null)
        }
        "add_to_playlist" => {
            let id: String = arg(a, "id")?;
            let t = track(arg(a, "track")?)?;
            value(if id == LIKES_ID {
                ws.stats.set_rating(t, Rating::Like) != Rating::Like
            } else {
                ws.lists.add_track(&id, t)?
            })
        }
        "remove_from_playlist" => {
            let id: String = arg(a, "id")?;
            let tid: String = arg(a, "trackId")?;
            if id == LIKES_ID {
                ws.stats.clear_rating(&tid);
            } else {
                ws.lists.remove_track(&id, &tid)?;
            }
            Ok(Value::Null)
        }
        "move_in_playlist" => {
            let id: String = arg(a, "id")?;
            reject_system(&id)?;
            ws.lists.move_track(&id, arg(a, "from")?, arg(a, "to")?)?;
            Ok(Value::Null)
        }
        "reorder_playlist" => {
            let id: String = arg(a, "id")?;
            reject_system(&id)?;
            ws.lists.reorder(&id, &arg::<Vec<String>>(a, "order")?)?;
            Ok(Value::Null)
        }
        "bulk_playlist" => {
            let source: String = arg(a, "source")?;
            let target: Option<String> = arg(a, "target")?;
            let ids: Vec<String> = arg(a, "ids")?;
            let action: String = arg(a, "action")?;
            if ids.len() > 50000 {
                return Err("Demasiadas canciones seleccionadas.".into());
            }
            let smart = ws
                .lists
                .all()
                .into_iter()
                .find(|l| l.id == source)
                .and_then(|l| l.details.rules);
            if source == LIKES_ID || smart.is_some() {
                let library = if source == LIKES_ID {
                    ws.stats.liked()
                } else {
                    smart
                        .unwrap()
                        .select(&ws.stats.snapshot(), store::now_secs())
                };
                let selected: HashSet<_> = ids.iter().collect();
                let tracks: Vec<_> = library
                    .into_iter()
                    .filter(|t| selected.contains(&t.id))
                    .collect();
                match action.as_str() {
                    "copy" => value(
                        ws.lists
                            .copy_tracks(target.as_deref().ok_or("Elige un destino")?, &tracks)?,
                    ),
                    "remove" if source == LIKES_ID => {
                        ws.stats.clear_ratings(&ids)?;
                        value(tracks.len())
                    }
                    _ => Err("Esta acción no está disponible para esta lista.".into()),
                }
            } else {
                value(ws.lists.bulk(&source, target.as_deref(), &ids, &action)?)
            }
        }
        "recommend" => recommendations(a, ws).await,

        "create_backup" => {
            let b = ws.snapshot(arg(a, "local")?)?;
            let dir = ws.dir.join("backups");
            store::write_json_atomic(&dir.join(format!("auto-{}.json", b.created_at / 86400)), &b)
                .map_err(|e| e.to_string())?;
            let mut paths: Vec<_> = std::fs::read_dir(&dir)
                .map_err(|e| e.to_string())?
                .filter_map(Result::ok)
                .map(|e| e.path())
                .filter(|p| {
                    p.file_name()
                        .is_some_and(|n| n.to_string_lossy().starts_with("auto-"))
                        && p.extension().is_some_and(|e| e == "json")
                })
                .collect();
            paths.sort();
            let excess = paths.len().saturating_sub(7);
            for p in paths.into_iter().take(excess) {
                std::fs::remove_file(p).map_err(|e| e.to_string())?;
            }
            value(b)
        }
        "inspect_backup" => {
            let b = backup_model::parse(&arg::<String>(a, "contents")?)?;
            Ok(
                json!({"lists":b.playlists.len(),"liked":b.stats.values().filter(|s|s.rating==Rating::Like).count(),"tracks":b.stats.len(),"created_at":b.created_at}),
            )
        }
        "restore_backup" => {
            let next = backup_model::parse(&arg::<String>(a, "contents")?)?;
            // El respaldo se obtiene del estado del servidor; no se confía en el enviado por el cliente.
            let previous: Option<String> = arg(a, "previous")?;
            let local = match previous {
                Some(contents) => backup_model::parse(&contents)?.local,
                None => json!({}),
            };
            let old = ws.snapshot(local)?;
            store::write_json_atomic(&ws.dir.join("backups/before-restore.json"), &old)
                .map_err(|e| e.to_string())?;
            store::write_json_atomic(&ws.dir.join("pending-restore.json"), &next)
                .map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "restart_after_restore" => {
            ws.flush()?;
            let revision = ws.revision;
            *ws = Workspace::load(ws.dir.clone())?;
            ws.revision = revision;
            Ok(Value::Null)
        }
        "restored_workspace" => {
            Ok(store::read_json(&ws.dir.join("restored-workspace.json")).unwrap_or(Value::Null))
        }
        "acknowledge_restored_workspace" => {
            let p = ws.dir.join("restored-workspace.json");
            if p.exists() {
                std::fs::remove_file(p).map_err(|e| e.to_string())?;
            }
            Ok(Value::Null)
        }
        "list_backups" => {
            let mut found = Vec::new();
            if let Ok(entries) = std::fs::read_dir(ws.dir.join("backups")) {
                for entry in entries.filter_map(Result::ok) {
                    let path = entry.path();
                    if path.extension().is_none_or(|e| e != "json") {
                        continue;
                    }
                    if let Ok(text) = std::fs::read_to_string(&path) {
                        if let Ok(b) = backup_model::parse(&text) {
                            found.push(json!({"name":entry.file_name().to_string_lossy(),"created_at":b.created_at}));
                        }
                    }
                }
            }
            found.sort_by_key(|b| std::cmp::Reverse(b["created_at"].as_u64().unwrap_or(0)));
            value(found)
        }
        "read_backup" => {
            let name: String = arg(a, "name")?;
            if !name.ends_with(".json")
                || !(name.starts_with("auto-") || name == "before-restore.json")
                || !name
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.'))
            {
                return Err("Nombre de copia inválido.".into());
            }
            value(
                std::fs::read_to_string(ws.dir.join("backups").join(name))
                    .map_err(|e| e.to_string())?,
            )
        }
        _ => Err(format!("Operación web desconocida: {command}")),
    }
}

fn apply_restore(dir: &PathBuf) -> Result<(), String> {
    let path = dir.join("pending-restore.json");
    if !path.exists() {
        return Ok(());
    }
    let b = backup_model::parse(&std::fs::read_to_string(&path).map_err(|e| e.to_string())?)?;
    for (name, v) in [
        ("playlists.json", value(b.playlists)?),
        ("stats.json", value(b.stats)?),
        ("taste.json", value(b.taste)?),
        ("history.json", value(b.history)?),
        ("settings.json", b.settings),
        ("wallpaper.json", value(b.wallpaper)?),
        ("restored-workspace.json", b.local),
    ] {
        store::write_json_atomic(&dir.join(name), &v).map_err(|e| e.to_string())?;
    }
    std::fs::remove_file(path).map_err(|e| e.to_string())
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RecommendRequest {
    mode: Mode,
    #[serde(default)]
    seeds: Vec<TrackInput>,
    count: usize,
    adventure: f64,
    #[serde(default)]
    exclude: Vec<String>,
    #[serde(default)]
    avoid_seeds: Vec<String>,
    #[serde(default)]
    tuning: recommend::Tuning,
}
async fn recommendations(a: &Value, ws: &Workspace) -> Result<Value, String> {
    let r: RecommendRequest = arg(a, "request")?;
    let now = store::now_secs();
    let library = ws.stats.recommendation_snapshot();
    let mut rng = Rng::from_time();
    let forced: Vec<_> = r
        .seeds
        .into_iter()
        .take(3)
        .map(track)
        .collect::<Result<_, _>>()?;
    if r.mode == Mode::Radio && forced.is_empty() {
        return Err("Una radio necesita una canción de la que partir.".into());
    }
    let avoid: HashSet<_> = r.avoid_seeds.into_iter().collect();
    let extra = if r.mode == Mode::Radio {
        0
    } else {
        3usize.saturating_sub(forced.len())
    };
    let seeds = recommend::choose_seeds(&library, &forced, extra, &avoid, now, &mut rng);
    if seeds.is_empty() {
        return Err("Escucha canciones o empieza una radio para descubrir música.".into());
    }
    let mut lists = ws
        .related
        .for_seeds(&seeds.iter().map(|s| s.id.clone()).collect::<Vec<_>>())
        .await;
    ws.stats.repair_text(lists.values().flatten());
    ws.history.repair_text(lists.values().flatten());
    let library = ws.stats.recommendation_snapshot();
    let mixes: Vec<_> = seeds
        .into_iter()
        .map(|seed| SeedMix {
            taste: recommend::seed_taste(
                &library,
                &seed,
                forced.iter().any(|f| f.id == seed.id),
                now,
            ),
            related: lists.remove(&seed.id).unwrap_or_default(),
            seed,
        })
        .collect();
    let p = Params {
        mode: r.mode,
        count: r.count.clamp(1, 50),
        adventure: r.adventure,
        exclude: r.exclude.into_iter().collect(),
        avoid_seeds: avoid,
        now,
        tuning: r.tuning.sanitized(),
    };
    value(recommend::recommend(&library, &mixes, &p, &mut rng))
}
async fn resolve_import(
    command: &str,
    a: &Value,
    progress: Arc<dyn Fn(usize, usize) + Send + Sync>,
) -> Result<PreparedImport, String> {
    let (name, found, source_count, missing) = if command == "import_text" {
        let text: String = arg(a, "text")?;
        if text.len() > 2 * 1024 * 1024 {
            return Err("El texto supera 2 MB.".into());
        }
        let wanted = crate::importer::parse_text(&text);
        let total = wanted.len();
        if total == 0 || total > 5000 {
            return Err("Importa entre 1 y 5000 canciones por vez.".into());
        }
        let found =
            crate::importer::find_all(wanted, move |done, total| progress(done, total)).await;
        (
            arg::<Option<String>>(a, "name")?.unwrap_or("Lista importada".into()),
            found.tracks,
            total,
            found
                .missing
                .iter()
                .map(crate::importer::Wanted::label)
                .collect::<Vec<_>>(),
        )
    } else {
        let url: String = arg(a, "url")?;
        if crate::importer::service_of(&url).is_some() {
            let (name, wanted) = crate::importer::read_link(&url).await?;
            let total = wanted.len();
            if total > 5000 {
                return Err("Importa como máximo 5000 canciones por vez.".into());
            }
            let found =
                crate::importer::find_all(wanted, move |done, total| progress(done, total)).await;
            (
                name,
                found.tracks,
                total,
                found
                    .missing
                    .iter()
                    .map(crate::importer::Wanted::label)
                    .collect::<Vec<_>>(),
            )
        } else {
            let parsed = reqwest::Url::parse(&url).map_err(|_| "Enlace inválido")?;
            if !matches!(
                parsed.host_str(),
                Some(
                    "youtube.com"
                        | "www.youtube.com"
                        | "music.youtube.com"
                        | "m.youtube.com"
                        | "youtu.be"
                )
            ) {
                return Err("Servicio de importación no compatible.".into());
            }
            let (name, tracks) = crate::innertube::list_playlist(&url, 5000).await?;
            let total = tracks.len();
            (
                name.unwrap_or("Lista importada".into()),
                tracks,
                total,
                Vec::new(),
            )
        }
    };
    if found.is_empty() {
        return Err("No encontré canciones para importar.".into());
    }
    let count = found.len();
    let duplicates = source_count.saturating_sub(count + missing.len());
    Ok(PreparedImport {
        name,
        tracks: found,
        count,
        source_count,
        duplicates,
        missing,
    })
}

#[derive(Clone, Serialize)]
struct PreparedImport {
    name: String,
    #[serde(skip)]
    tracks: Vec<SearchResult>,
    count: usize,
    source_count: usize,
    duplicates: usize,
    missing: Vec<String>,
}
struct ImportJob {
    profile: String,
    done: usize,
    total: usize,
    result: Option<PreparedImport>,
    failure: Option<String>,
    committed: Option<Value>,
}
fn commit_import(ws: &Workspace, prepared: &PreparedImport) -> Result<Value, String> {
    let existing = ws.lists.all().into_iter().find(|l| {
        l.name == prepared.name
            && l.tracks
                .iter()
                .map(|t| &t.id)
                .eq(prepared.tracks.iter().map(|t| &t.id))
    });
    let list = match existing {
        Some(list) => list,
        None => ws.lists.create(&prepared.name, prepared.tracks.clone())?,
    };
    Ok(
        json!({"id":list.id,"name":list.name,"count":prepared.count,"source_count":prepared.source_count,"duplicates":prepared.duplicates,"missing":prepared.missing}),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "antares-web-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ))
    }
    fn app(root: PathBuf) -> AppState {
        Arc::new(crate::App {
            cache: Default::default(),
            client: reqwest::Client::new(),
            lyrics: Default::default(),
            diagnostics: false,
            workspaces: Workspaces::new(root),
        })
    }
    fn song() -> Value {
        json!({"id":"abcdefghijk","title":"Prueba","uploader":"Artista","duration":100,"thumbnail":null})
    }
    async fn call(
        app: &AppState,
        who: &str,
        profile: &str,
        name: &str,
        args: Value,
        revision: Option<u64>,
    ) -> Result<Value, ApiError> {
        let mut headers = HeaderMap::new();
        headers.insert("x-antares-account", who.parse().unwrap());
        headers.insert("x-antares-profile", profile.parse().unwrap());
        if let Some(revision) = revision {
            headers.insert("x-antares-revision", revision.to_string().parse().unwrap());
        }
        command(State(app.clone()), Path(name.into()), headers, Json(args))
            .await
            .map(|j| j.0)
    }
    #[tokio::test]
    async fn account_key_recovers_library_and_sync_replay_does_not_duplicate() {
        let dir = root();
        let server = app(dir.clone());
        let owner = "4".repeat(64);
        let mut headers = HeaderMap::new();
        headers.insert("x-antares-account", owner.parse().unwrap());
        assert_eq!(verify_account(State(server.clone()), headers.clone()).await.unwrap_err().0, StatusCode::UNAUTHORIZED);
        call(&server, &owner, "main", "register_account", json!({}), None).await.unwrap();
        assert_eq!(verify_account(State(server.clone()), headers.clone()).await.unwrap(), StatusCode::NO_CONTENT);

        let operation = "d".repeat(32);
        let payload = json!({"name":"En los dos teléfonos", "operationId":operation, "tracks":[song()]});
        let first = call(&server, &owner, "main", "create_playlist", payload.clone(), Some(0)).await.unwrap();
        call(&server, &owner, "main", "set_rating", json!({
            "track":song(), "rating":"like", "operationId":"e".repeat(32)
        }), Some(0)).await.unwrap();
        drop(server);
        let server = app(dir);
        let replay = call(&server, &owner, "main", "create_playlist", payload, Some(0)).await.unwrap();
        assert_eq!(first["value"], replay["value"]);

        let restored = call(&server, &owner, "main", "get_playlists", json!({}), None).await.unwrap();
        let lists = restored["value"].as_array().unwrap();
        assert_eq!(lists.len(), 2);
        assert_eq!(lists[0]["tracks"][0]["id"], song()["id"]);
        assert_eq!(lists[1]["id"], first["value"]);
        let stranger = call(&server, &"5".repeat(64), "main", "get_playlists", json!({}), None).await.unwrap();
        assert_eq!(stranger["value"].as_array().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn an_interrupted_sync_is_completed_before_new_changes() {
        let dir = root();
        let owner = "6".repeat(64);
        let workspace = dir.join(account_hash(&owner));
        let id = "f".repeat(32);
        let args = json!({"name":"Reanudada","operationId":id,"tracks":[song()]});
        let mut ws = Workspace::load(workspace.clone()).unwrap();
        let expected = dispatch("create_playlist", &args, &mut ws).await.unwrap();
        store::write_json_atomic(&workspace.join("pending-sync.json"), &PendingSync {
            id: id.clone(), command: "create_playlist".into(), args: args.clone()
        }).unwrap();
        drop(ws);
        let server = app(dir);
        let lists = call(&server, &owner, "main", "get_playlists", json!({}), None).await.unwrap();
        assert_eq!(lists["value"].as_array().unwrap().len(), 2);
        assert!(!workspace.join("pending-sync.json").exists());
        assert_eq!(call(&server, &owner, "main", "create_playlist", args, None).await.unwrap()["value"], expected);
    }

    #[tokio::test]
    async fn rejects_missing_or_malformed_installation_keys() {
        let a = app(root());
        for token in ["", "../private", "short"] {
            let err = call(&a, token, "main", "get_playlists", json!({}), None)
                .await
                .unwrap_err();
            assert_eq!(err.0, StatusCode::UNAUTHORIZED);
        }
    }
    #[tokio::test]
    async fn installations_and_profiles_have_separate_libraries() {
        let a = app(root());
        let one = "a".repeat(64);
        let two = "b".repeat(64);
        call(
            &a,
            &one,
            "main",
            "create_playlist",
            json!({"name":"Privada","tracks":[song()]}),
            None,
        )
        .await
        .unwrap();
        assert_eq!(
            call(&a, &two, "main", "get_playlists", json!({}), None)
                .await
                .unwrap()["value"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        let users = call(
            &a,
            &one,
            "main",
            "create_user",
            json!({"name":"Trabajo"}),
            None,
        )
        .await
        .unwrap();
        let profile = users["value"]["users"][1]["id"].as_str().unwrap();
        assert_eq!(
            call(&a, &one, profile, "get_playlists", json!({}), None)
                .await
                .unwrap()["value"]
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            call(&a, &two, profile, "get_playlists", json!({}), None)
                .await
                .unwrap_err()
                .0,
            StatusCode::FORBIDDEN
        );
    }
    #[tokio::test]
    async fn rejects_stale_writes_instead_of_overwriting_another_window() {
        let a = app(root());
        let token = "a".repeat(64);
        call(
            &a,
            &token,
            "main",
            "create_playlist",
            json!({"name":"Primera"}),
            Some(0),
        )
        .await
        .unwrap();
        let err = call(
            &a,
            &token,
            "main",
            "create_playlist",
            json!({"name":"Atrasada"}),
            Some(0),
        )
        .await
        .unwrap_err();
        assert_eq!(err.0, StatusCode::CONFLICT);
        assert_eq!(
            call(&a, &token, "main", "get_playlists", json!({}), None)
                .await
                .unwrap()["value"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
    }
    #[tokio::test]
    async fn committed_lists_ratings_and_events_survive_server_restart() {
        let dir = root();
        let a = app(dir.clone());
        let token = "c".repeat(64);
        call(
            &a,
            &token,
            "main",
            "create_playlist",
            json!({"name":"Persistente","tracks":[song()]}),
            None,
        )
        .await
        .unwrap();
        call(
            &a,
            &token,
            "main",
            "set_rating",
            json!({"track":song(),"rating":"like"}),
            None,
        )
        .await
        .unwrap();
        let event = json!({"track":song(),"listened":95,"ended":true,"eventId":"listen-1"});
        call(&a, &token, "main", "record_listen", event.clone(), None)
            .await
            .unwrap();
        drop(a);
        let a = app(dir);
        call(&a, &token, "main", "record_listen", event, None)
            .await
            .unwrap();
        let summary = call(&a, &token, "main", "get_summary", json!({}), None)
            .await
            .unwrap();
        assert_eq!(summary["value"]["plays"], 1);
        assert_eq!(summary["value"]["liked"], 1);
        let lists = call(&a, &token, "main", "get_playlists", json!({}), None)
            .await
            .unwrap();
        assert_eq!(lists["value"].as_array().unwrap().len(), 2);
        assert_eq!(lists["value"][1]["tracks"][0]["id"], "abcdefghijk");
    }
    #[tokio::test]
    async fn invalid_backup_does_not_change_library_and_valid_backup_restores_it() {
        let mut ws = Workspace::load(root()).unwrap();
        dispatch(
            "create_playlist",
            &json!({"name":"Original","tracks":[song()]}),
            &mut ws,
        )
        .await
        .unwrap();
        let backup = dispatch("create_backup", &json!({"local":{"session":null}}), &mut ws)
            .await
            .unwrap();
        let mut bad = backup.clone();
        bad["version"] = json!(999);
        assert!(dispatch(
            "restore_backup",
            &json!({"contents":bad.to_string()}),
            &mut ws
        )
        .await
        .is_err());
        assert_eq!(ws.lists.all().len(), 1);
        dispatch(
            "delete_playlist",
            &json!({"id":ws.lists.all()[0].id}),
            &mut ws,
        )
        .await
        .unwrap();
        dispatch(
            "restore_backup",
            &json!({"contents":backup.to_string()}),
            &mut ws,
        )
        .await
        .unwrap();
        dispatch("restart_after_restore", &json!({}), &mut ws)
            .await
            .unwrap();
        assert_eq!(ws.lists.all()[0].name, "Original");
        assert!(ws.dir.join("backups/before-restore.json").exists());
    }
    #[tokio::test]
    async fn list_editing_preserves_order_and_smart_lists_follow_ratings() {
        let mut ws = Workspace::load(root()).unwrap();
        let id = dispatch(
            "create_playlist",
            &json!({"name":"Orden","tracks":[song(),{"id":"lmnopqrstuv","title":"Otra"}]}),
            &mut ws,
        )
        .await
        .unwrap();
        dispatch(
            "move_in_playlist",
            &json!({"id":id,"from":0,"to":1}),
            &mut ws,
        )
        .await
        .unwrap();
        assert_eq!(ws.lists.all()[0].tracks[0].id, "lmnopqrstuv");
        dispatch(
            "set_rating",
            &json!({"track":song(),"rating":"like"}),
            &mut ws,
        )
        .await
        .unwrap();
        let all = dispatch("get_playlists", &json!({}), &mut ws)
            .await
            .unwrap();
        assert_eq!(all[0]["tracks"][0]["id"], "abcdefghijk");
        assert!(dispatch(
            "read_backup",
            &json!({"name":"../../settings.json"}),
            &mut ws
        )
        .await
        .is_err());
    }
    #[tokio::test]
    async fn import_preview_does_not_write_and_repeated_commit_does_not_duplicate() {
        let ws = Workspace::load(root()).unwrap();
        let prepared = PreparedImport {
            name: "Revisada".into(),
            tracks: vec![track(serde_json::from_value(song()).unwrap()).unwrap()],
            count: 1,
            source_count: 3,
            duplicates: 1,
            missing: vec!["Sin coincidencia".into()],
        };
        let preview = serde_json::to_value(&prepared).unwrap();
        assert_eq!(preview["missing"][0], "Sin coincidencia");
        assert!(preview.get("tracks").is_none());
        assert!(ws.lists.all().is_empty());
        let first = commit_import(&ws, &prepared).unwrap();
        let second = commit_import(&ws, &prepared).unwrap();
        assert_eq!(first["id"], second["id"]);
        assert_eq!(ws.lists.all().len(), 1);
    }
    #[tokio::test]
    async fn import_job_cannot_be_read_or_committed_from_another_profile() {
        let a = app(root());
        let token = "e".repeat(64);
        let users = call(
            &a,
            &token,
            "main",
            "create_user",
            json!({"name":"Otro"}),
            None,
        )
        .await
        .unwrap();
        let profile = users["value"]["users"][1]["id"].as_str().unwrap();
        let account = a.workspaces.account(&token).unwrap();
        account.lock().await.jobs.insert(
            "job".into(),
            Arc::new(Mutex::new(ImportJob {
                profile: "main".into(),
                done: 0,
                total: 0,
                result: None,
                failure: None,
                committed: None,
            })),
        );
        assert!(call(
            &a,
            &token,
            profile,
            "import_status",
            json!({"job":"job"}),
            None
        )
        .await
        .is_err());
        assert!(call(
            &a,
            &token,
            profile,
            "commit_import",
            json!({"job":"job"}),
            None
        )
        .await
        .is_err());
    }
}
