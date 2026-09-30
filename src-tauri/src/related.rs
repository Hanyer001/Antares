//! Caché de los Mix de YouTube usados como fuente de recomendaciones.
//! Persiste en related.json y tiene una vigencia de una semana.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::store::{now_secs, read_json, Persister};
use crate::track::SearchResult;

const RELATED_FILE: &str = "related.json";

/// Una semana.
const TTL_SECS: u64 = 7 * 24 * 3600;

/// Al pasar de aqui se olvidan los Mix mas antiguos. 300 Mix de 25 pistas son
/// unos 2 MB.
const MAX_SEEDS: usize = 300;

/// Pistas que se piden de cada Mix. Las primeras son las mas relacionadas; mas
/// alla de 25 la relacion ya es floja y la llamada tarda mas.
const MIX_LIMIT: &str = "25";

#[derive(Clone, Serialize, Deserialize)]
struct Entry {
    fetched_at: u64,
    tracks: Vec<SearchResult>,
}

pub struct Related {
    entries: Mutex<HashMap<String, Entry>>,
    file: Persister,
}

/// La URL del Mix de un video: el video mas `list=RD<id>`.
fn mix_url(id: &str) -> String {
    format!("https://www.youtube.com/watch?v={id}&list=RD{id}")
}

impl Related {
    pub fn load(dir: PathBuf) -> Self {
        let entries = read_json(&dir.join(RELATED_FILE)).unwrap_or_default();

        Self {
            entries: Mutex::new(entries),
            file: Persister::new(dir.join(RELATED_FILE)),
        }
    }

    fn get_fresh(&self, id: &str, now: u64) -> Option<Vec<SearchResult>> {
        let entries = self.entries.lock().ok()?;
        let entry = entries.get(id)?;

        (now.saturating_sub(entry.fetched_at) < TTL_SECS).then(|| entry.tracks.clone())
    }

    fn put(&self, id: &str, tracks: Vec<SearchResult>, now: u64) {
        let Ok(mut entries) = self.entries.lock() else {
            return;
        };

        entries.insert(id.to_string(), Entry { fetched_at: now, tracks });

        if entries.len() > MAX_SEEDS {
            let mut by_age: Vec<(u64, String)> =
                entries.iter().map(|(k, e)| (e.fetched_at, k.clone())).collect();
            by_age.sort();

            let excess = entries.len() - MAX_SEEDS;
            for (_, key) in by_age.into_iter().take(excess) {
                entries.remove(&key);
            }
        }

        self.file.save(entries.clone());
    }

    /// El Mix de cada semilla: de la cache si esta al dia, y si no, de YouTube,
    /// todas las que falten a la vez.
    ///
    /// Una semilla que falla (sin red, video borrado) simplemente no aparece en
    /// el resultado: el recomendador sigue con las demas y con la biblioteca.
    pub async fn for_seeds(&self, ids: &[String]) -> HashMap<String, Vec<SearchResult>> {
        let now = now_secs();
        let mut out = HashMap::new();
        let mut tasks = tokio::task::JoinSet::new();

        for id in ids {
            if let Some(tracks) = self.get_fresh(id, now) {
                out.insert(id.clone(), tracks);
                continue;
            }

            let id = id.clone();
            tasks.spawn(async move {
                let result = crate::source::playlist(mix_url(&id), MIX_LIMIT).await;
                (id, result)
            });
        }

        while let Some(joined) = tasks.join_next().await {
            match joined {
                Ok((id, Ok((_, tracks)))) if !tracks.is_empty() => {
                    self.put(&id, tracks.clone(), now);
                    out.insert(id, tracks);
                }
                // Vacio no se guarda: casi siempre es un fallo pasajero, y
                // guardarlo dejaria esa semilla muda una semana entera.
                Ok((id, Ok(_))) => eprintln!("El Mix de {id} vino vacio"),
                Ok((id, Err(e))) => eprintln!("No se pudo leer el Mix de {id}: {e}"),
                Err(e) => eprintln!("Fallo interno al pedir un Mix: {e}"),
            }
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "antares-related-{nombre}-{}-{:?}",
            now_secs(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn pista(id: &str) -> SearchResult {
        SearchResult {
            id: id.to_string(),
            title: None,
            uploader: None,
            duration: None,
            thumbnail: None,
            watch_url: SearchResult::watch_url_for(id),
        }
    }

    #[test]
    fn la_url_del_mix_lleva_el_prefijo_rd() {
        assert_eq!(
            mix_url("abc"),
            "https://www.youtube.com/watch?v=abc&list=RDabc"
        );
    }

    #[test]
    fn un_mix_reciente_se_reutiliza_y_uno_caducado_no() {
        let related = Related::load(temp_dir("ttl"));
        related.put("s", vec![pista("a")], 1_000);

        assert!(related.get_fresh("s", 1_000 + TTL_SECS - 1).is_some());
        assert!(related.get_fresh("s", 1_000 + TTL_SECS).is_none());
    }

    #[test]
    fn al_pasar_el_tope_olvida_los_mas_antiguos() {
        let related = Related::load(temp_dir("tope"));

        for i in 0..(MAX_SEEDS + 2) {
            related.put(&format!("s{i}"), vec![pista("a")], 1_000 + i as u64);
        }

        let now = 1_000 + MAX_SEEDS as u64;
        assert!(related.get_fresh("s0", now).is_none());
        assert!(related.get_fresh("s1", now).is_none());
        assert!(related.get_fresh("s2", now).is_some());
    }
}
