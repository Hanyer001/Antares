//! Persistencia de historial y búsquedas, y escritura atómica de JSON.
//! Se guardan identificadores y metadatos; las URLs de audio caducan
//! y se resuelven de nuevo al reproducir.

use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{de::DeserializeOwned, Serialize};

use crate::track::{HistoryEntry, SearchResult};

/// Cuantas pistas recordamos. Con 50 el fichero no pasa de unos pocos KB y sigue
/// cubriendo de sobra "lo que estuve escuchando estos dias".
const MAX_HISTORY: usize = 50;

/// Tope de consultas guardadas. Al pasarlo se vacia entero: son listas pequenas
/// y no merece la pena llevar contabilidad de cual se uso hace mas tiempo.
const MAX_SEARCHES: usize = 200;

const HISTORY_FILE: &str = "history.json";
const SEARCHES_FILE: &str = "searches.json";

pub struct Store {
    history: Mutex<Vec<HistoryEntry>>,
    searches: Mutex<HashMap<String, Vec<SearchResult>>>,
    history_file: Persister,
    searches_file: Persister,
}

impl Store {
    /// Lee los dos ficheros. Cualquier problema —no existen, estan corruptos, el
    /// formato cambio entre versiones— se salda arrancando vacio: perder el
    /// historial es molesto, pero no abrir la app es mucho peor.
    pub fn load(dir: PathBuf) -> Self {
        let history: Vec<HistoryEntry> = read_json(&dir.join(HISTORY_FILE)).unwrap_or_default();
        let mut searches: HashMap<String, Vec<SearchResult>> =
            read_json(&dir.join(SEARCHES_FILE)).unwrap_or_default();

        // Las busquedas guardadas antes de forzar UTF-8 en yt-dlp traen las
        // tildes rotas ("�"). No caducan nunca, asi que sin esto se verian mal
        // para siempre; tiradas, se repiten bien la proxima vez.
        searches.retain(|_, results| !results.iter().any(has_broken_text));

        Self {
            history: Mutex::new(history),
            searches: Mutex::new(searches),
            history_file: Persister::new(dir.join(HISTORY_FILE)),
            searches_file: Persister::new(dir.join(SEARCHES_FILE)),
        }
    }

    #[cfg(any(mobile, test))]
    pub(crate) fn flush_mobile(&self) -> Result<(), String> {
        self.history_file.save_sync(self.history()).map_err(|e| e.to_string())?;
        self.searches_file.save_sync(self.searches.lock().map_err(|_| "busquedas bloqueadas")?.clone()).map_err(|e| e.to_string())
    }
    #[cfg(any(mobile, test))]
    pub(crate) fn reload_mobile(&self, dir: PathBuf) -> Result<(), String> {
        let next = Self::load(dir.clone());
        let mut history = self.history.lock().map_err(|_| "historial bloqueado")?;
        let mut searches = self.searches.lock().map_err(|_| "busquedas bloqueadas")?;
        self.history_file.retarget(dir.join(HISTORY_FILE)); self.searches_file.retarget(dir.join(SEARCHES_FILE));
        *history = next.history(); *searches = next.searches.into_inner().map_err(|_| "busquedas bloqueadas")?;
        Ok(())
    }
    // --- Historial --------------------------------------------------------

    pub fn history(&self) -> Vec<HistoryEntry> {
        self.history.lock().map(|h| h.clone()).unwrap_or_default()
    }

    /// Apunta una reproduccion. Si esa pista ya estaba, la sube arriba en vez de
    /// duplicarla: un historial con la misma cancion cinco veces seguidas no
    /// informa de nada.
    pub fn record(&self, track: SearchResult) {
        let Ok(mut history) = self.history.lock() else {
            return;
        };

        history.retain(|entry| entry.track.id != track.id);
        history.insert(
            0,
            HistoryEntry {
                track,
                played_at: now_secs(),
            },
        );
        history.truncate(MAX_HISTORY);

        // Con el mutex aun tomado: asi el orden de las escrituras es el mismo que
        // el de los cambios (ver `Persister`).
        self.history_file.save(history.clone());
    }

    /// Arregla titulos y canales rotos del historial con los de pistas recien
    /// leidas de YouTube. Es la misma reparacion que `Stats::repair_text`: lo
    /// guardado antes de forzar UTF-8 trae "�" en lugar de tildes y eñes.
    pub fn repair_text<'a>(&self, fresh: impl IntoIterator<Item = &'a SearchResult>) {
        let Ok(mut history) = self.history.lock() else {
            return;
        };

        let by_id: HashMap<&str, &SearchResult> =
            fresh.into_iter().map(|t| (t.id.as_str(), t)).collect();
        let mut changed = false;

        for entry in history.iter_mut() {
            let Some(clean) = by_id.get(entry.track.id.as_str()) else {
                continue;
            };

            if has_broken_text(&entry.track) && !has_broken_text(clean) {
                entry.track.title = clean.title.clone().or(entry.track.title.take());
                entry.track.uploader = clean.uploader.clone().or(entry.track.uploader.take());
                changed = true;
            }
        }

        if changed {
            self.history_file.save(history.clone());
        }
    }

    pub fn clear_history(&self) {
        if let Ok(mut history) = self.history.lock() {
            history.clear();
            self.history_file.save(Vec::<HistoryEntry>::new());
        }
    }

    // --- Busquedas --------------------------------------------------------

    pub fn get_search(&self, key: &str) -> Option<Vec<SearchResult>> {
        self.searches.lock().ok()?.get(key).cloned()
    }

    pub fn put_search(&self, key: &str, results: &[SearchResult]) {
        // Una busqueda sin resultados no se guarda: casi siempre es un fallo
        // pasajero de red, y cachearla condenaria esa consulta a salir vacia
        // para siempre, incluso entre reinicios.
        if results.is_empty() {
            return;
        }

        let Ok(mut searches) = self.searches.lock() else {
            return;
        };

        if searches.len() >= MAX_SEARCHES {
            searches.clear();
        }
        searches.insert(key.to_string(), results.to_vec());

        self.searches_file.save(searches.clone());
    }
}

// ---------------------------------------------------------------------------
// Disco
// ---------------------------------------------------------------------------

/// Serializa las escrituras y descarta las instantáneas anteriores a la última guardada.
/// Llamar a save con el mutex de los datos tomado para conservar su orden.
pub(crate) struct Persister {
    path: Mutex<PathBuf>,
    next: AtomicU64,
    written: Arc<Mutex<u64>>,
}

impl Persister {
    pub(crate) fn new(path: PathBuf) -> Self {
        Self {
            path: Mutex::new(path),
            next: AtomicU64::new(0),
            written: Arc::default(),
        }
    }

    #[cfg(any(mobile, test))]
    pub(crate) fn retarget(&self, path: PathBuf) {
        if let Ok(mut current) = self.path.lock() { *current = path; }
    }
    pub(crate) fn save_sync<T: Serialize>(&self, value: T) -> std::io::Result<()> {
        let seq = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let mut last = self.written.lock().map_err(|_| std::io::Error::other("persistencia bloqueada"))?;
        if seq > *last { write_json_atomic(&self.path.lock().map_err(|_| std::io::Error::other("ruta bloqueada"))?, &value)?; *last = seq; }
        Ok(())
    }

    pub(crate) fn save<T: Serialize + Send + 'static>(&self, value: T) {
        let seq = self.next.fetch_add(1, Ordering::SeqCst) + 1;
        let Ok(path) = self.path.lock() else { return };
        let path = path.clone();
        let written = self.written.clone();

        std::thread::spawn(move || {
            let Ok(mut last) = written.lock() else {
                return;
            };

            // Ya se escribio una instantanea mas nueva que esta.
            if seq <= *last {
                return;
            }

            match write_json_atomic(&path, &value) {
                Ok(()) => *last = seq,
                Err(e) => eprintln!("No se pudo guardar {}: {e}", path.display()),
            }
        });
    }
}

/// Si el titulo o el canal llevan el caracter de reemplazo de UTF-8: la huella
/// de un texto que se leyo con la codificacion equivocada.
fn has_broken_text(track: &SearchResult) -> bool {
    [&track.title, &track.uploader]
        .into_iter()
        .flatten()
        .any(|text| text.contains('\u{FFFD}'))
}

pub(crate) fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

pub(crate) fn read_json<T: DeserializeOwned>(path: &Path) -> Option<T> {
    if let Ok(bytes) = fs::read(path) {
        if let Ok(value) = serde_json::from_slice(&bytes) { return Some(value); }
    }
    let backup = fs::read(path.with_extension("json.bak")).ok()?;
    let value = serde_json::from_slice(&backup).ok()?;
    // Conservar el archivo dañado para diagnóstico antes de recuperar la copia válida.
    if path.exists() { let _ = fs::copy(path, path.with_extension(format!("json.corrupt-{}", now_secs()))); }
    let tmp = path.with_extension("recovery-tmp");
    if fs::write(&tmp, &backup).is_ok() { let _ = fs::rename(&tmp, path); }
    Some(value)
}

/// Escribe a un temporal y luego renombra.
///
/// Sin esto, un corte de luz o un cierre forzado a mitad de escritura dejaria un
/// JSON truncado, y el usuario perderia el historial entero la proxima vez que
/// abriera la app. El renombrado es atomico: o esta el fichero viejo, o el nuevo
/// completo, nunca uno a medias.
pub(crate) fn write_json_atomic<T: Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }

    let tmp = path.with_extension("tmp");
    let bytes = serde_json::to_vec_pretty(value)
        .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;

    // Conservar la copia válida; no sustituirla por un archivo dañado.
    if let Ok(previous) = fs::read(path) {
        if serde_json::from_slice::<serde_json::Value>(&previous).is_ok() {
            let backup_tmp = path.with_extension("backup-tmp");
            fs::write(&backup_tmp, previous)?;
            fs::rename(backup_tmp, path.with_extension("json.bak"))?;
        }
    }
    use std::io::Write;
    let mut file = fs::File::create(&tmp)?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);
    fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("antares-test-{nombre}-{}", now_secs()));
        let _ = fs::remove_dir_all(&dir);
        dir
    }

    fn candidato(id: &str, titulo: &str) -> SearchResult {
        SearchResult { is_music: None,
            id: id.to_string(),
            title: Some(titulo.to_string()),
            uploader: None,
            duration: None,
            thumbnail: None,
            watch_url: SearchResult::watch_url_for(id),
        }
    }

    /// Espera a que el hilo de escritura deje el fichero en su sitio.
    fn esperar_fichero(path: &Path) -> bool {
        for _ in 0..100 {
            if path.is_file() {
                return true;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        false
    }

    #[test]
    fn cambiar_usuario_aisla_historial_busquedas_y_escrituras() {
        let base = std::env::temp_dir().join(format!("antares-users-{}-{:?}", std::process::id(), std::thread::current().id()));
        let a = base.join("a"); let b = base.join("b");
        let live = Store::load(a.clone());
        live.record(candidato("old", "Usuario A"));
        live.put_search("only-a", &[candidato("old", "Usuario A")]);
        live.flush_mobile().unwrap();
        let other = Store::load(b.clone());
        other.record(candidato("new", "Usuario B"));
        other.put_search("only-b", &[candidato("new", "Usuario B")]);
        other.flush_mobile().unwrap();

        live.reload_mobile(b.clone()).unwrap();
        assert_eq!(live.history()[0].track.id, "new");
        assert!(live.get_search("only-a").is_none());
        assert!(live.get_search("only-b").is_some());
        live.record(candidato("next", "Otra de B"));
        live.flush_mobile().unwrap();
        assert_eq!(Store::load(a.clone()).history()[0].track.id, "old");
        assert_eq!(Store::load(b).history().len(), 2);

        live.reload_mobile(a).unwrap();
        assert_eq!(live.history().len(), 1);
        assert_eq!(live.history()[0].track.id, "old");
        assert!(live.get_search("only-b").is_none());
    }

    #[test]
    fn un_directorio_vacio_arranca_sin_datos() {
        let store = Store::load(temp_dir("vacio"));

        assert!(store.history().is_empty());
        assert!(store.get_search("lo que sea").is_none());
    }

    #[test]
    fn un_json_corrupto_no_impide_arrancar() {
        let dir = temp_dir("corrupto");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join(HISTORY_FILE), b"{ esto no es json").unwrap();

        // Lo importante es que no entre en panico y siga usable.
        let store = Store::load(dir);
        assert!(store.history().is_empty());
    }

    #[test]
    fn el_historial_pone_lo_ultimo_primero() {
        let store = Store::load(temp_dir("orden"));

        store.record(candidato("a", "Primera"));
        store.record(candidato("b", "Segunda"));

        let history = store.history();
        assert_eq!(history.len(), 2);
        assert_eq!(history[0].track.id, "b");
        assert_eq!(history[1].track.id, "a");
    }

    #[test]
    fn repetir_una_pista_la_sube_en_vez_de_duplicarla() {
        let store = Store::load(temp_dir("dedupe"));

        store.record(candidato("a", "A"));
        store.record(candidato("b", "B"));
        store.record(candidato("a", "A"));

        let history = store.history();
        assert_eq!(history.len(), 2, "no debe duplicarse");
        assert_eq!(history[0].track.id, "a", "la repetida sube arriba");
    }

    #[test]
    fn el_historial_no_pasa_del_tope() {
        let store = Store::load(temp_dir("tope"));

        for i in 0..(MAX_HISTORY + 20) {
            store.record(candidato(&format!("id{i}"), "T"));
        }

        let history = store.history();
        assert_eq!(history.len(), MAX_HISTORY);
        // La mas reciente sigue arriba y las mas viejas se cayeron.
        assert_eq!(history[0].track.id, format!("id{}", MAX_HISTORY + 19));
    }

    #[test]
    fn lo_guardado_se_relee_en_el_siguiente_arranque() {
        let dir = temp_dir("persistencia");

        {
            let store = Store::load(dir.clone());
            store.record(candidato("abc", "Weird Fishes"));
            store.put_search("creep", &[candidato("xyz", "Creep")]);
            assert!(esperar_fichero(&dir.join(HISTORY_FILE)));
            assert!(esperar_fichero(&dir.join(SEARCHES_FILE)));
        }

        // Segunda "sesion": mismo directorio, Store nuevo.
        let store = Store::load(dir);

        assert_eq!(store.history()[0].track.id, "abc");
        assert_eq!(store.history()[0].track.title.as_deref(), Some("Weird Fishes"));
        assert_eq!(store.get_search("creep").unwrap()[0].id, "xyz");
    }

    #[test]
    fn al_arrancar_tira_las_busquedas_con_tildes_rotas() {
        let dir = temp_dir("tildes");
        fs::create_dir_all(&dir).unwrap();

        let mut rota = candidato("a", "Yo s\u{FFFD}");
        rota.uploader = Some("Canal".to_string());

        let mut guardadas = HashMap::new();
        guardadas.insert("rota".to_string(), vec![rota]);
        guardadas.insert("sana".to_string(), vec![candidato("b", "Yo sé")]);
        write_json_atomic(&dir.join(SEARCHES_FILE), &guardadas).unwrap();

        let store = Store::load(dir);

        assert!(store.get_search("rota").is_none());
        assert_eq!(store.get_search("sana").unwrap()[0].title.as_deref(), Some("Yo sé"));
    }

    #[test]
    fn repara_el_historial_con_titulos_frescos() {
        let store = Store::load(temp_dir("reparar-historial"));
        store.record(candidato("a", "Yo s\u{FFFD}"));
        store.record(candidato("b", "Sana"));

        store.repair_text([&candidato("a", "Yo sé"), &candidato("b", "Otro")]);

        let history = store.history();
        let titulo = |id: &str| {
            history.iter().find(|e| e.track.id == id).unwrap().track.title.clone().unwrap()
        };
        assert_eq!(titulo("a"), "Yo sé");
        assert_eq!(titulo("b"), "Sana", "lo sano no se toca");
    }

    #[test]
    fn una_busqueda_vacia_no_se_guarda() {
        let store = Store::load(temp_dir("busqueda-vacia"));
        store.put_search("nada", &[]);

        assert!(store.get_search("nada").is_none());
    }

    #[test]
    fn clear_history_deja_el_historial_vacio_en_disco() {
        let dir = temp_dir("limpiar");
        let store = Store::load(dir.clone());

        store.record(candidato("a", "A"));
        assert!(esperar_fichero(&dir.join(HISTORY_FILE)));

        store.clear_history();
        assert!(store.history().is_empty());

        // Y tambien tras releer: no se quedo solo en memoria.
        std::thread::sleep(std::time::Duration::from_millis(120));
        assert!(Store::load(dir).history().is_empty());
    }

    #[test]
    fn con_escrituras_seguidas_gana_la_ultima() {
        let dir = temp_dir("orden-escrituras");
        let path = dir.join("valor.json");
        let persister = Persister::new(path.clone());

        for i in 0..50u32 {
            persister.save(i);
        }

        for _ in 0..200 {
            if read_json::<u32>(&path) == Some(49) {
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        panic!("el fichero deberia acabar con la ultima instantanea (49)");
    }

    #[test]
    fn la_escritura_no_deja_temporales_sueltos() {
        let dir = temp_dir("atomica");
        let store = Store::load(dir.clone());

        store.record(candidato("a", "A"));
        assert!(esperar_fichero(&dir.join(HISTORY_FILE)));
        std::thread::sleep(std::time::Duration::from_millis(60));

        assert!(!dir.join("history.tmp").exists(), "el temporal debe renombrarse");
    }
}

#[cfg(test)]
mod recovery_tests {
    use super::*;
    #[test] fn corrupt_json_recovers_last_good_backup() {
        let dir=std::env::temp_dir().join(format!("antares-recover-{}-{:?}",std::process::id(),std::thread::current().id()));let path=dir.join("lists.json");
        write_json_atomic(&path,&vec!["first"]).unwrap();write_json_atomic(&path,&vec!["second"]).unwrap();
        fs::write(&path,b"{ broken").unwrap();assert_eq!(read_json::<Vec<String>>(&path).unwrap(),vec!["first"]);
        assert!(serde_json::from_slice::<Vec<String>>(&fs::read(&path).unwrap()).is_ok());
    }
    #[test] fn a_synchronous_snapshot_cannot_be_overwritten_by_an_old_save() {
        let dir=std::env::temp_dir().join(format!("antares-sync-{}-{:?}",std::process::id(),std::thread::current().id()));let path=dir.join("state.json");let p=Persister::new(path.clone());
        for i in 0..20 {p.save(i);}p.save_sync(999).unwrap();std::thread::sleep(std::time::Duration::from_millis(60));assert_eq!(read_json::<u32>(&path),Some(999));
    }
}
