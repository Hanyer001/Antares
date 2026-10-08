//! Listas guardadas en playlists.json con identificadores y metadatos.
//! Las URLs de audio se resuelven al reproducir.
//! La lista Me gusta se construye desde las valoraciones de stats con LIKES_ID.

use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::store::{now_secs, read_json, Persister};
use crate::track::SearchResult;

const PLAYLISTS_FILE: &str = "playlists.json";

/// Id reservado de la lista "Me gusta".
pub const LIKES_ID: &str = "likes";

/// Cabe de sobra en la cabecera de una ventana de 460 px, y corta los nombres
/// pegados por error de un portapapeles enorme.
const MAX_NAME_CHARS: usize = 80;

#[derive(Clone, Serialize, Deserialize)]
pub struct Playlist {
    pub id: String,
    pub name: String,
    pub tracks: Vec<SearchResult>,
    pub created_at: u64,
    pub updated_at: u64,
    /// Lista del sistema ("Me gusta"): no se renombra, no se borra y no se
    /// reordena. Nunca se guarda a `true` en disco.
    #[serde(default)]
    pub system: bool,
    #[serde(default, flatten)]
    pub details: PlaylistDetails,
}

/// Normaliza el nombre: sin espacios en los extremos ni repetidos, y con tope.
fn clean_name(name: &str) -> Result<String, String> {
    let name = name.split_whitespace().collect::<Vec<_>>().join(" ");

    if name.is_empty() {
        return Err("Ponle un nombre a la lista.".to_string());
    }

    Ok(name.chars().take(MAX_NAME_CHARS).collect())
}

/// Quita repetidos conservando la primera aparicion. Una lista importada de
/// YouTube puede traer el mismo video dos veces, y aqui no tiene sentido.
fn dedupe(tracks: Vec<SearchResult>) -> Vec<SearchResult> {
    let mut seen = std::collections::HashSet::new();
    tracks
        .into_iter()
        .filter(|t| seen.insert(t.id.clone()))
        .collect()
}

pub struct Playlists {
    lists: Mutex<Vec<Playlist>>,
    file: Persister,
    /// Desempata ids creados en el mismo milisegundo.
    counter: AtomicU64,
}

impl Playlists {
    pub fn load(dir: PathBuf) -> Self {
        let lists: Vec<Playlist> = read_json(&dir.join(PLAYLISTS_FILE)).unwrap_or_default();

        Self {
            lists: Mutex::new(lists),
            file: Persister::new(dir.join(PLAYLISTS_FILE)),
            counter: AtomicU64::new(0),
        }
    }

    #[cfg(mobile)]
    pub(crate) fn flush_mobile(&self) -> Result<(), String> {
        self.file.save_sync(self.lists.lock().map_err(|_| "listas bloqueadas")?.clone()).map_err(|e| e.to_string())
    }
    #[cfg(mobile)]
    pub(crate) fn reload_mobile(&self, dir: PathBuf) -> Result<(), String> {
        let mut lists = self.lists.lock().map_err(|_| "listas bloqueadas")?;
        self.file.retarget(dir.join(PLAYLISTS_FILE));
        *lists = Self::load(dir).lists.into_inner().map_err(|_| "listas bloqueadas")?;
        Ok(())
    }
    /// Todas, de la editada mas recientemente a la mas antigua.
    pub fn all(&self) -> Vec<Playlist> {
        let mut lists = self.lists.lock().map(|l| l.clone()).unwrap_or_default();
        lists.sort_by_key(|l| (!l.details.pinned, std::cmp::Reverse(l.updated_at)));
        lists
    }

    pub fn create(&self, name: &str, tracks: Vec<SearchResult>) -> Result<Playlist, String> {
        self.create_with_details(name, tracks, PlaylistDetails::default())
    }

    pub fn create_with_details(&self, name: &str, tracks: Vec<SearchResult>, details: PlaylistDetails) -> Result<Playlist, String> {
        details.validate()?;
        let name = clean_name(name)?;
        let now = now_secs();

        let millis = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis())
            .unwrap_or(0);
        let n = self.counter.fetch_add(1, Ordering::SeqCst);

        let playlist = Playlist {
            id: format!("pl-{millis}-{n}"),
            name,
            tracks: dedupe(tracks),
            created_at: now,
            updated_at: now,
            system: false,
            details,
        };

        let mut lists = self.lock()?;
        let mut next = lists.clone(); next.push(playlist.clone());
        self.file.save_sync(next.clone()).map_err(|e| format!("No se pudo guardar la lista: {e}"))?;
        *lists = next;

        Ok(playlist)
    }

    pub fn rename(&self, id: &str, name: &str) -> Result<(), String> {
        let name = clean_name(name)?;
        self.mutate(id, |list| {
            list.name = name;
            Ok(())
        })
    }

    pub fn delete(&self, id: &str) -> Result<(), String> {
        let mut lists = self.lock()?;
        let before = lists.len();

        lists.retain(|l| l.id != id);

        if lists.len() == before {
            return Err(not_found());
        }

        self.file.save(lists.clone());
        Ok(())
    }

    /// Anade al final. Devuelve `false` si ya estaba: una lista no repite
    /// canciones, y el frontend lo dice en vez de fingir que la anadio.
    pub fn add_track(&self, id: &str, track: SearchResult) -> Result<bool, String> {
        self.mutate(id, |list| {
            if list.details.rules.is_some() { return Err("Esta lista se actualiza con sus reglas; edita las reglas para cambiarla.".into()); }
            if list.tracks.iter().any(|t| t.id == track.id) {
                return Ok(false);
            }
            list.tracks.push(track);
            Ok(true)
        })
    }

    pub fn remove_track(&self, id: &str, track_id: &str) -> Result<(), String> {
        self.mutate(id, |list| {
            if list.details.rules.is_some() { return Err("Esta lista se actualiza con sus reglas; edita las reglas para cambiarla.".into()); }
            list.tracks.retain(|t| t.id != track_id);
            Ok(())
        })
    }

    /// Mueve la pista de la posicion `from` a la `to`, desplazando las demas.
    pub fn move_track(&self, id: &str, from: usize, to: usize) -> Result<(), String> {
        self.mutate(id, |list| {
            if list.details.rules.is_some() { return Err("Esta lista se actualiza con sus reglas; edita las reglas para cambiarla.".into()); }
            let len = list.tracks.len();
            if from >= len || to >= len {
                return Err("Esa posición no está en la lista.".to_string());
            }

            let track = list.tracks.remove(from);
            list.tracks.insert(to, track);
            Ok(())
        })
    }

    /// Pone las pistas en el orden de `order` (sus ids).
    ///
    /// Lo que no venga en `order` se queda al final en su orden de antes, y lo
    /// que venga y no este en la lista se ignora: si mientras tanto se anadio o
    /// se quito algo, reordenar no pierde ni inventa canciones.
    pub fn reorder(&self, id: &str, order: &[String]) -> Result<(), String> {
        self.mutate(id, |list| {
            if list.details.rules.is_some() { return Err("Esta lista se actualiza con sus reglas; edita las reglas para cambiarla.".into()); }
            let position: std::collections::HashMap<&str, usize> =
                order.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
            // sort_by_key es estable: las que no estan en `order` conservan su orden.
            list.tracks
                .sort_by_key(|t| position.get(t.id.as_str()).copied().unwrap_or(usize::MAX));
            Ok(())
        })
    }

    pub fn copy_tracks(&self, id: &str, tracks: &[SearchResult]) -> Result<usize, String> {
        let mut current = self.lock()?;
        let mut lists = current.clone();
        let list = lists.iter_mut().find(|l| l.id == id).ok_or_else(not_found)?;
        if list.details.rules.is_some() { return Err("El destino debe ser una lista manual.".into()); }
        let mut added = 0;
        for track in tracks { if !list.tracks.iter().any(|t| t.id == track.id) { list.tracks.push(track.clone()); added += 1; } }
        list.updated_at = now_secs();
        self.file.save_sync(lists.clone()).map_err(|e| e.to_string())?;
        *current = lists;
        Ok(added)
    }

    #[cfg(test)]
    pub fn update_details(&self, id: &str, details: PlaylistDetails) -> Result<(), String> {
        self.update_details_and_name(id, details, None)
    }

    pub fn update_details_and_name(&self, id: &str, details: PlaylistDetails, name: Option<&str>) -> Result<(), String> {
        details.validate()?;
        let name = name.map(clean_name).transpose()?;
        self.mutate(id, |list| { list.details = details; if let Some(name) = name { list.name = name; } Ok(()) })
    }

    /// Both lists change under one lock and are persisted together.
    pub fn bulk(&self, source: &str, target: Option<&str>, ids: &[String], action: &str) -> Result<usize, String> {
        if !["copy", "move", "remove"].contains(&action) { return Err("Acción desconocida.".into()); }
        let mut current = self.lock()?;
        let mut lists = current.clone();
        let from = lists.iter().position(|l| l.id == source).ok_or_else(not_found)?;
        if lists[from].details.rules.is_some() { return Err("Las listas inteligentes se editan mediante reglas.".into()); }
        let selected: std::collections::HashSet<_> = ids.iter().collect();
        let tracks: Vec<_> = lists[from].tracks.iter().filter(|t| selected.contains(&t.id)).cloned().collect();
        if action != "remove" {
            let to = lists.iter().position(|l| Some(l.id.as_str()) == target).ok_or_else(not_found)?;
            if from == to { return Err("Elige otra lista de destino.".into()); }
            if lists[to].details.rules.is_some() { return Err("El destino debe ser una lista manual.".into()); }
            for track in &tracks {
                if !lists[to].tracks.iter().any(|t| t.id == track.id) { lists[to].tracks.push(track.clone()); }
            }
            lists[to].updated_at = now_secs();
        }
        if action != "copy" { lists[from].tracks.retain(|t| !selected.contains(&t.id)); }
        lists[from].updated_at = now_secs();
        self.file.save_sync(lists.clone()).map_err(|e| e.to_string())?;
        *current = lists;
        Ok(tracks.len())
    }

    fn lock(&self) -> Result<std::sync::MutexGuard<'_, Vec<Playlist>>, String> {
        self.lists
            .lock()
            .map_err(|_| "Las listas no están disponibles ahora mismo.".to_string())
    }

    /// Aplica un cambio a una lista, le pone fecha y la guarda.
    ///
    /// Se guarda aunque el cambio no haya tocado nada (anadir una repetida): una
    /// escritura de mas es mas barata que llevar la cuenta de que cambio.
    fn mutate<R>(
        &self,
        id: &str,
        change: impl FnOnce(&mut Playlist) -> Result<R, String>,
    ) -> Result<R, String> {
        let mut current = self.lock()?;
        let mut lists = current.clone();
        let list = lists.iter_mut().find(|l| l.id == id).ok_or_else(not_found)?;
        let result = change(list)?;
        list.updated_at = now_secs();
        self.file.save_sync(lists.clone()).map_err(|e| format!("No se pudo guardar la lista: {e}"))?;
        *current = lists;
        Ok(result)
    }
}

fn not_found() -> String {
    "Esa lista ya no existe.".to_string()
}

/// "Me gusta" presentada como una lista mas.
pub fn likes_playlist(tracks: Vec<SearchResult>) -> Playlist {
    Playlist {
        id: LIKES_ID.to_string(),
        name: "Me gusta".to_string(),
        tracks,
        created_at: 0,
        updated_at: 0,
        system: true,
        details: PlaylistDetails::default(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "antares-pl-{nombre}-{}-{:?}",
            now_secs(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn pista(id: &str) -> SearchResult {
        SearchResult {
            id: id.to_string(),
            title: Some(id.to_uppercase()),
            uploader: None,
            duration: None,
            thumbnail: None,
            watch_url: SearchResult::watch_url_for(id),
        }
    }

    fn ids(list: &Playlist) -> Vec<&str> {
        list.tracks.iter().map(|t| t.id.as_str()).collect()
    }

    fn buscar(pl: &Playlists, id: &str) -> Playlist {
        pl.all().into_iter().find(|l| l.id == id).unwrap()
    }

    #[test]
    fn crea_una_lista_con_nombre_limpio() {
        let pl = Playlists::load(temp_dir("crear"));

        let lista = pl.create("   Para   correr  ", vec![pista("a")]).unwrap();

        assert_eq!(lista.name, "Para correr");
        assert_eq!(ids(&lista), vec!["a"]);
        assert!(!lista.system);
    }

    #[test]
    fn un_nombre_vacio_se_rechaza() {
        let pl = Playlists::load(temp_dir("vacio"));

        assert!(pl.create("   ", Vec::new()).is_err());
        assert!(pl.all().is_empty());
    }

    #[test]
    fn un_nombre_enorme_se_recorta() {
        let pl = Playlists::load(temp_dir("largo"));
        let lista = pl.create(&"ñ".repeat(500), Vec::new()).unwrap();

        // Por caracteres, no por bytes: la ñ ocupa dos.
        assert_eq!(lista.name.chars().count(), MAX_NAME_CHARS);
    }

    #[test]
    fn dos_listas_creadas_seguidas_no_comparten_id() {
        let pl = Playlists::load(temp_dir("ids"));

        let a = pl.create("A", Vec::new()).unwrap();
        let b = pl.create("B", Vec::new()).unwrap();

        assert_ne!(a.id, b.id);
    }

    #[test]
    fn al_crear_quita_repetidos() {
        let pl = Playlists::load(temp_dir("dedupe"));
        let lista = pl
            .create("L", vec![pista("a"), pista("b"), pista("a")])
            .unwrap();

        assert_eq!(ids(&lista), vec!["a", "b"]);
    }

    #[test]
    fn anadir_no_repite_canciones() {
        let pl = Playlists::load(temp_dir("anadir"));
        let id = pl.create("L", Vec::new()).unwrap().id;

        assert!(pl.add_track(&id, pista("a")).unwrap());
        assert!(!pl.add_track(&id, pista("a")).unwrap(), "la segunda vez no");

        assert_eq!(ids(&buscar(&pl, &id)), vec!["a"]);
    }

    #[test]
    fn quitar_y_mover_pistas() {
        let pl = Playlists::load(temp_dir("mover"));
        let id = pl
            .create("L", vec![pista("a"), pista("b"), pista("c"), pista("d")])
            .unwrap()
            .id;

        pl.move_track(&id, 0, 2).unwrap();
        assert_eq!(ids(&buscar(&pl, &id)), vec!["b", "c", "a", "d"]);

        pl.move_track(&id, 3, 0).unwrap();
        assert_eq!(ids(&buscar(&pl, &id)), vec!["d", "b", "c", "a"]);

        pl.remove_track(&id, "c").unwrap();
        assert_eq!(ids(&buscar(&pl, &id)), vec!["d", "b", "a"]);
    }

    #[test]
    fn mover_fuera_de_rango_es_un_error_y_no_toca_nada() {
        let pl = Playlists::load(temp_dir("rango"));
        let id = pl.create("L", vec![pista("a"), pista("b")]).unwrap().id;

        assert!(pl.move_track(&id, 0, 5).is_err());
        assert_eq!(ids(&buscar(&pl, &id)), vec!["a", "b"]);
    }

    #[test]
    fn reordenar_por_ids() {
        let pl = Playlists::load(temp_dir("reordenar"));
        let id = pl
            .create("L", vec![pista("a"), pista("b"), pista("c"), pista("d")])
            .unwrap()
            .id;

        let orden = |ids: &[&str]| ids.iter().map(|s| s.to_string()).collect::<Vec<_>>();

        pl.reorder(&id, &orden(&["d", "b", "a", "c"])).unwrap();
        assert_eq!(ids(&buscar(&pl, &id)), vec!["d", "b", "a", "c"]);

        // "c" no viene (se añadió después de ordenar) y "z" ya no está.
        pl.reorder(&id, &orden(&["a", "z", "b", "d"])).unwrap();
        assert_eq!(ids(&buscar(&pl, &id)), vec!["a", "b", "d", "c"]);
    }

    #[test]
    fn renombrar_y_borrar() {
        let pl = Playlists::load(temp_dir("renombrar"));
        let id = pl.create("Vieja", Vec::new()).unwrap().id;

        pl.rename(&id, "Nueva").unwrap();
        assert_eq!(buscar(&pl, &id).name, "Nueva");

        pl.delete(&id).unwrap();
        assert!(pl.all().is_empty());
        assert!(pl.delete(&id).is_err(), "borrar dos veces avisa");
    }

    #[test]
    fn la_editada_mas_recientemente_va_primero() {
        let pl = Playlists::load(temp_dir("orden"));
        let a = pl.create("A", Vec::new()).unwrap().id;
        let b = pl.create("B", Vec::new()).unwrap().id;

        {
            let mut lists = pl.lists.lock().unwrap();
            lists.iter_mut().find(|l| l.id == a).unwrap().updated_at = 500;
            lists.iter_mut().find(|l| l.id == b).unwrap().updated_at = 100;
        }

        let orden: Vec<String> = pl.all().into_iter().map(|l| l.id).collect();
        assert_eq!(orden, vec![a, b]);
    }

    #[test]
    fn las_listas_sobreviven_al_reinicio() {
        let dir = temp_dir("persistencia");
        let id = {
            let pl = Playlists::load(dir.clone());
            let id = pl.create("Guardada", vec![pista("a")]).unwrap().id;
            pl.add_track(&id, pista("b")).unwrap();
            id
        };

        for _ in 0..200 {
            let releida = Playlists::load(dir.clone());
            if let Some(lista) = releida.all().into_iter().find(|l| l.id == id) {
                if lista.tracks.len() == 2 {
                    assert_eq!(lista.name, "Guardada");
                    return;
                }
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        panic!("la lista no se releyo del disco");
    }
}

#[derive(Clone, Default, Serialize, Deserialize)]
pub struct PlaylistDetails {
    #[serde(default)] pub pinned: bool,
    #[serde(default)] pub folder: String,
    #[serde(default)] pub description: String,
    #[serde(default)] pub cover: Option<String>,
    #[serde(default)] pub rules: Option<SmartRules>,
}

impl PlaylistDetails {
    pub fn validate(&self) -> Result<(), String> {
        if self.folder.chars().count() > 80 || self.description.chars().count() > 1000 { return Err("Carpeta o descripción demasiado larga.".into()); }
        if let Some(cover) = &self.cover {
            if cover.len() > 2 * 1024 * 1024 || !["data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,"].iter().any(|p| cover.starts_with(p)) {
                return Err("La portada debe ser una imagen JPEG, PNG o WebP de menos de 2 MB.".into());
            }
        }
        if let Some(rules) = &self.rules { rules.validate()?; }
        Ok(())
    }
}

#[derive(Clone, Serialize, Deserialize)]
pub struct SmartRules {
    pub liked_only: bool,
    pub not_played_days: u32,
    pub discovered_days: u32,
    pub min_plays: u32,
    pub max_skip_percent: u32,
    pub artist: String,
    pub limit: usize,
}
impl SmartRules {
    pub fn validate(&self) -> Result<(), String> {
        if self.not_played_days > 3650 || self.discovered_days > 3650 || self.min_plays > 10000 || self.max_skip_percent > 100 || self.artist.len() > 200 || !(1..=2000).contains(&self.limit) {
            return Err("Las reglas de la lista están fuera de rango.".into());
        }
        Ok(())
    }
    pub fn select(&self, library: &[crate::stats::TrackStats], now: u64) -> Vec<SearchResult> {
        use crate::stats::Rating;
        let artist = self.artist.trim().to_lowercase();
        let mut tracks: Vec<_> = library.iter().filter(|s| {
            s.rating != Rating::Dislike
            && (!self.liked_only || s.rating == Rating::Like)
            && (self.not_played_days == 0 || now.saturating_sub(s.last_played) >= u64::from(self.not_played_days) * 86400)
            && (self.discovered_days == 0 || (s.first_played > 0 && now.saturating_sub(s.first_played) <= u64::from(self.discovered_days) * 86400))
            && s.plays >= self.min_plays
            && (self.max_skip_percent == 100 || (s.plays > 0 && f64::from(s.skips) * 100.0 / f64::from(s.plays) <= f64::from(self.max_skip_percent)))
            && (artist.is_empty() || s.track.uploader.as_deref().unwrap_or("").to_lowercase().contains(&artist))
        }).collect();
        if self.not_played_days > 0 { tracks.sort_by_key(|s| (s.last_played, s.track.id.clone())); }
        else { tracks.sort_by_key(|s| (std::cmp::Reverse(s.first_played), s.track.id.clone())); }
        tracks.into_iter().take(self.limit).map(|s| s.track.clone()).collect()
    }
}

#[cfg(test)]
mod feature_tests {
    use super::*;
    use crate::stats::{TrackStats, Rating};
    fn track(id: &str) -> SearchResult { SearchResult { id:id.into(), title:Some(id.into()), uploader:Some("Artista".into()), duration:Some(100.0), thumbnail:None, watch_url:SearchResult::watch_url_for(id) } }
    fn lists() -> Playlists { Playlists::load(std::env::temp_dir().join(format!("antares-library-{}-{:?}",std::process::id(),std::thread::current().id()))) }
    fn rules() -> SmartRules { SmartRules { liked_only:true, not_played_days:30, discovered_days:0,min_plays:0,max_skip_percent:100,artist:String::new(),limit:100 } }
    #[test] fn smart_rules_refresh_after_a_listen_or_rating() {
        let now=100*86400; let mut a=TrackStats::new(track("a"));a.rating=Rating::Like;a.last_played=now-31*86400;
        assert_eq!(rules().select(&[a.clone()],now).len(),1);
        a.last_played=now;assert!(rules().select(&[a.clone()],now).is_empty());
        a.last_played=1;a.rating=Rating::Dislike;assert!(rules().select(&[a],now).is_empty());
    }
    #[test] fn reliable_rule_requires_real_plays_and_combines_artist_filter() {
        let mut rule=rules();rule.liked_only=false;rule.not_played_days=0;rule.min_plays=3;rule.max_skip_percent=10;rule.artist="artista".into();
        let mut a=TrackStats::new(track("a"));a.plays=10;a.skips=1;
        assert_eq!(rule.select(&[a.clone()],100).len(),1);a.skips=2;assert!(rule.select(&[a],100).is_empty());
    }
    #[test] fn bulk_move_deduplicates_destination_and_keeps_unselected_tracks() {
        let p=lists();let a=p.create("A",vec![track("a"),track("b"),track("c")]).unwrap();let b=p.create("B",vec![track("b")]).unwrap();
        assert_eq!(p.bulk(&a.id,Some(&b.id),&["a".into(),"b".into()],"move").unwrap(),2);
        let all=p.all();assert_eq!(all.iter().find(|l|l.id==a.id).unwrap().tracks[0].id,"c");assert_eq!(all.iter().find(|l|l.id==b.id).unwrap().tracks.len(),2);
    }
    #[test] fn invalid_bulk_destination_leaves_source_untouched() {
        let p=lists();let a=p.create("A",vec![track("a")]).unwrap();assert!(p.bulk(&a.id,Some("missing"),&["a".into()],"move").is_err());
        assert_eq!(p.all().iter().find(|l|l.id==a.id).unwrap().tracks.len(),1);
    }
    #[test] fn smart_lists_reject_manual_edits() {
        let p=lists();let a=p.create("Smart",vec![]).unwrap();p.update_details(&a.id,PlaylistDetails{rules:Some(rules()),..Default::default()}).unwrap();
        assert!(p.add_track(&a.id,track("a")).is_err());assert!(p.reorder(&a.id,&[]).is_err());
    }
}
