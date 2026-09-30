//! Estadísticas de escucha y valoraciones en stats.json.
//! El aprendizaje para recomendaciones se guarda por separado en taste.json,
//! para que las sesiones sin aprendizaje cuenten solo en el resumen.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};

use crate::store::{now_secs, read_json, Persister};
use crate::track::SearchResult;

const STATS_FILE: &str = "stats.json";

/// A partir de que parte de la cancion cuenta como escuchada entera. No el 100 %:
/// muchas canciones acaban en silencio o en creditos, y quien pasa a la
/// siguiente en los ultimos segundos si la ha escuchado.
const COMPLETE_RATIO: f64 = 0.8;

/// Por debajo de esto, y a la vez de `SKIP_MAX_SECS`, es un salto: la pusiste y
/// no te convencio.
const SKIP_RATIO: f64 = 0.3;

/// El tope en segundos evita contar como salto dejar a la mitad una sesion de
/// una hora: el 30 % de 60 minutos son 18 minutos escuchados, y eso no es un
/// rechazo.
const SKIP_MAX_SECS: f64 = 45.0;

/// Vida media de las escuchas en las cuentas ponderadas: un salto de hace un
/// mes pesa la mitad que uno de hoy. Los gustos cambian, y el recomendador
/// deberia notarlo.
pub(crate) const HALF_LIFE_SECS: f64 = 30.0 * 24.0 * 3600.0;

/// Tope de pistas recordadas. Con ~300 bytes por pista son 1,5 MB, y de sobra
/// para anos de escucha normal.
const MAX_TRACKS: usize = 5_000;

/// Lo que dijo el usuario de una pista, si dijo algo.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Rating {
    #[default]
    None,
    Like,
    Dislike,
}

/// Como acabo una escucha.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Outcome {
    /// Llegaste al final o casi.
    Complete,
    /// La quitaste enseguida.
    Skip,
    /// Ni una cosa ni otra: cuenta como escucha, pero no dice nada de tu gusto.
    Partial,
}

/// Clasifica una escucha.
///
/// `ended` manda sobre todo: si el `<audio>` llego al final, es completa aunque
/// el recuento de segundos diga otra cosa (por ejemplo, si saltaste hacia
/// delante con las flechas).
///
/// Sin duracion conocida, que pasa en los directos, no hay proporcion que
/// calcular: solo distinguimos el salto rapido del resto.
pub fn classify(listened: f64, duration: Option<f64>, ended: bool) -> Outcome {
    if ended {
        return Outcome::Complete;
    }

    let listened = listened.max(0.0);

    let Some(duration) = duration.filter(|d| d.is_finite() && *d > 0.0) else {
        return if listened < SKIP_MAX_SECS {
            Outcome::Skip
        } else {
            Outcome::Partial
        };
    };

    let ratio = listened / duration;

    if ratio >= COMPLETE_RATIO {
        Outcome::Complete
    } else if ratio < SKIP_RATIO && listened < SKIP_MAX_SECS {
        Outcome::Skip
    } else {
        Outcome::Partial
    }
}

/// Todo lo que sabemos de como escuchas una pista.
#[derive(Clone, Serialize, Deserialize)]
pub struct TrackStats {
    #[serde(flatten)]
    pub track: SearchResult,

    /// Escuchas registradas, de cualquier tipo.
    #[serde(default)]
    pub plays: u32,
    #[serde(default)]
    pub completions: u32,
    #[serde(default)]
    pub skips: u32,
    #[serde(default)]
    pub listened_secs: f64,
    #[serde(default)]
    pub first_played: u64,
    #[serde(default)]
    pub last_played: u64,

    /// Completas y saltos con decaimiento exponencial (ver `HALF_LIFE_SECS`),
    /// validos a fecha de `weighted_at`.
    ///
    /// Guardar el valor ya decaido y la fecha basta para seguir decayendolo
    /// despues, sin tener que conservar cada escucha por separado.
    #[serde(default)]
    pub completions_w: f64,
    #[serde(default)]
    pub skips_w: f64,
    #[serde(default)]
    pub weighted_at: u64,

    #[serde(default)]
    pub rating: Rating,
    /// Cuando se puso la valoracion actual. Ordena la lista "Me gusta".
    #[serde(default)]
    pub rated_at: u64,
}

impl TrackStats {
    pub(crate) fn new(track: SearchResult) -> Self {
        Self {
            track,
            plays: 0,
            completions: 0,
            skips: 0,
            listened_secs: 0.0,
            first_played: 0,
            last_played: 0,
            completions_w: 0.0,
            skips_w: 0.0,
            weighted_at: 0,
            rating: Rating::None,
            rated_at: 0,
        }
    }

    /// Lleva las cuentas ponderadas hasta `now`.
    fn decay_to(&mut self, now: u64) {
        let (completions, skips) = self.weights_at(now);

        self.completions_w = completions;
        self.skips_w = skips;
        self.weighted_at = now;
    }

    /// Completas y saltos ponderados tal como valen en `now`, sin tocar nada.
    /// Es lo que lee el recomendador.
    pub fn weights_at(&self, now: u64) -> (f64, f64) {
        let elapsed = now.saturating_sub(self.weighted_at) as f64;
        let factor = 0.5_f64.powf(elapsed / HALF_LIFE_SECS);

        (self.completions_w * factor, self.skips_w * factor)
    }

    fn apply(&mut self, outcome: Outcome, listened: f64, now: u64) {
        self.decay_to(now);

        self.plays += 1;
        self.listened_secs += listened.max(0.0);
        if self.first_played == 0 {
            self.first_played = now;
        }
        self.last_played = now;

        match outcome {
            Outcome::Complete => {
                self.completions += 1;
                self.completions_w += 1.0;
            }
            Outcome::Skip => {
                self.skips += 1;
                self.skips_w += 1.0;
            }
            Outcome::Partial => {}
        }
    }

    /// Se queda con los metadatos mas nuevos que traiga la pista, sin borrar los
    /// que ya teniamos si la nueva viene incompleta.
    fn refresh_metadata(&mut self, fresh: SearchResult) {
        let old = &mut self.track;

        old.title = fresh.title.or(old.title.take());
        old.uploader = fresh.uploader.or(old.uploader.take());
        old.duration = fresh.duration.or(old.duration);
        old.thumbnail = fresh.thumbnail.or(old.thumbnail.take());
    }
}

pub struct Stats {
    tracks: Mutex<HashMap<String, TrackStats>>,
    file: Persister,
    signals: Mutex<HashMap<String, TrackStats>>,
    signals_file: Persister,
}

impl Stats {
    /// Como el resto de ficheros: si no se puede leer, se arranca vacio.
    pub fn load(dir: PathBuf) -> Self {
        let tracks: HashMap<String, TrackStats> = read_json(&dir.join(STATS_FILE)).unwrap_or_default();
        let signals = read_json(&dir.join("taste.json")).unwrap_or_else(|| tracks.clone());
        // Guardar la marca de migración incluso con la biblioteca vacía, para que
        // una primera sesión sin aprendizaje no se incorpore al reiniciar.
        if !dir.join("taste.json").exists() {
            if let Err(e) = crate::store::write_json_atomic(&dir.join("taste.json"), &signals) { eprintln!("No se pudo inicializar el aprendizaje: {e}"); }
        }

        Self {
            tracks: Mutex::new(tracks),
            file: Persister::new(dir.join(STATS_FILE)),
            signals: Mutex::new(signals),
            signals_file: Persister::new(dir.join("taste.json")),
        }
    }

    /// Apunta una escucha y devuelve como se clasifico.
    #[cfg(test)]
    pub fn record_listen(&self, track: SearchResult, listened: f64, ended: bool) -> Outcome {
        self.record_context(track, listened, ended, true)
    }

    pub fn record_context(&self, track: SearchResult, listened: f64, ended: bool, learn: bool) -> Outcome {
        let now = now_secs();
        if learn {
            if let Ok(mut signals) = self.signals.lock() {
                let entry = upsert(&mut signals, track.clone());
                entry.apply(classify(listened, entry.track.duration, ended), listened, now);
                prune(&mut signals);
                self.signals_file.save(signals.clone());
            }
        }

        let Ok(mut tracks) = self.tracks.lock() else {
            return classify(listened, track.duration, ended);
        };

        // Se clasifica DESPUES de fusionar metadatos: si esta vez no llego la
        // duracion, vale la que ya teniamos guardada.
        let entry = upsert(&mut tracks, track);
        let outcome = classify(listened, entry.track.duration, ended);
        entry.apply(outcome, listened, now);

        prune(&mut tracks);
        self.file.save(tracks.clone());

        outcome
    }

    pub fn signals(&self) -> HashMap<String, TrackStats> {
        self.signals.lock().map(|s| s.clone()).unwrap_or_default()
    }

    /// Las escuchas sin aprendizaje cuentan en el resumen y no modifican los gustos habituales.
    pub fn recommendation_snapshot(&self) -> Vec<TrackStats> {
        let mut signals = self.signals();
        for current in self.snapshot() {
            if let Some(s) = signals.get_mut(&current.track.id) { s.rating = current.rating; }
            else if current.rating != Rating::None {
                let mut s = TrackStats::new(current.track.clone()); s.rating = current.rating;
                signals.insert(current.track.id.clone(), s);
            }
        }
        signals.into_values().collect()
    }

    pub fn rating(&self, id: &str) -> Rating {
        self.tracks
            .lock()
            .ok()
            .and_then(|tracks| tracks.get(id).map(|t| t.rating))
            .unwrap_or_default()
    }

    /// Pone una valoracion. Devuelve la que habia antes.
    pub fn set_rating(&self, track: SearchResult, rating: Rating) -> Rating {
        let Ok(mut tracks) = self.tracks.lock() else {
            return Rating::None;
        };

        let entry = upsert(&mut tracks, track);
        let previous = entry.rating;

        if previous != rating {
            entry.rating = rating;
            entry.rated_at = now_secs();
            self.file.save(tracks.clone());
        }

        previous
    }

    /// Quita la valoracion de una pista de la que solo sabemos el id. Es lo que
    /// usa "quitar de Me gusta".
    pub fn clear_ratings(&self, ids: &[String]) -> Result<(), String> {
        let mut tracks = self.tracks.lock().map_err(|_| "Estadísticas ocupadas".to_string())?;
        let mut next = tracks.clone();
        for id in ids { if let Some(track) = next.get_mut(id) { track.rating = Rating::None; track.rated_at = now_secs(); } }
        self.file.save_sync(next.clone()).map_err(|e| e.to_string())?;
        *tracks = next;
        Ok(())
    }

    pub fn clear_rating(&self, id: &str) {
        let Ok(mut tracks) = self.tracks.lock() else {
            return;
        };

        if let Some(entry) = tracks.get_mut(id) {
            if entry.rating != Rating::None {
                entry.rating = Rating::None;
                entry.rated_at = now_secs();
                self.file.save(tracks.clone());
            }
        }
    }

    /// Las pistas con "me gusta", de la ultima marcada a la primera.
    pub fn liked(&self) -> Vec<SearchResult> {
        let Ok(tracks) = self.tracks.lock() else {
            return Vec::new();
        };

        let mut liked: Vec<&TrackStats> = tracks
            .values()
            .filter(|t| t.rating == Rating::Like)
            .collect();

        liked.sort_by_key(|t| std::cmp::Reverse(t.rated_at));
        liked.into_iter().map(|t| t.track.clone()).collect()
    }

    /// Arregla titulos y canales rotos con los de pistas recien leidas de
    /// YouTube.
    ///
    /// Lo guardado antes de forzar UTF-8 en yt-dlp trae "�" donde iban tildes
    /// y eñes, y solo se corregiria al volver a escuchar cada pista. Los Mix que
    /// pide el recomendador traen esas mismas pistas bien escritas: se
    /// aprovechan.
    pub fn repair_text<'a>(&self, fresh: impl IntoIterator<Item = &'a SearchResult>) {
        let Ok(mut tracks) = self.tracks.lock() else {
            return;
        };

        let broken = |text: &Option<String>| text.as_deref().is_some_and(|t| t.contains('\u{FFFD}'));
        let mut changed = false;

        for track in fresh {
            let Some(entry) = tracks.get_mut(&track.id) else {
                continue;
            };

            if broken(&entry.track.title) && track.title.is_some() && !broken(&track.title) {
                entry.track.title = track.title.clone();
                changed = true;
            }
            if broken(&entry.track.uploader) && track.uploader.is_some() && !broken(&track.uploader) {
                entry.track.uploader = track.uploader.clone();
                changed = true;
            }
        }

        if changed {
            self.file.save(tracks.clone());
        }
    }

    /// "Tu resumen": totales, lo mas escuchado y los artistas favoritos.
    pub fn summary(&self) -> Summary {
        let tracks = self.snapshot();
        summarize(&tracks)
    }

    /// Copia de todo lo que sabemos, para el recomendador. Una copia y no una
    /// referencia porque recomendar espera a yt-dlp, y el mutex no puede quedar
    /// tomado durante esa espera.
    pub fn snapshot(&self) -> Vec<TrackStats> {
        self.tracks
            .lock()
            .map(|tracks| tracks.values().cloned().collect())
            .unwrap_or_default()
    }

    #[cfg(test)]
    fn get(&self, id: &str) -> Option<TrackStats> {
        self.tracks.lock().ok()?.get(id).cloned()
    }
}

// ---------------------------------------------------------------------------
// Resumen
// ---------------------------------------------------------------------------

/// Cuantas canciones y artistas enseña el resumen.
const TOP_TRACKS: usize = 10;
const TOP_ARTISTS: usize = 8;

#[derive(Serialize)]
pub struct TopTrack {
    #[serde(flatten)]
    pub track: SearchResult,
    pub plays: u32,
    pub listened_secs: f64,
}

#[derive(Serialize)]
pub struct TopArtist {
    pub name: String,
    pub plays: u32,
    pub listened_secs: f64,
    pub tracks: usize,
}

#[derive(Serialize)]
pub struct Summary {
    pub listened_secs: f64,
    pub plays: u32,
    pub tracks: usize,
    pub completions: u32,
    pub skips: u32,
    pub liked: usize,
    pub top_tracks: Vec<TopTrack>,
    pub top_artists: Vec<TopArtist>,
}

/// El resumen se ordena por tiempo escuchado, no por reproducciones: diez
/// saltos de dos segundos no hacen de una cancion tu favorita.
pub fn summarize(tracks: &[TrackStats]) -> Summary {
    let played: Vec<&TrackStats> = tracks.iter().filter(|t| t.plays > 0).collect();

    let mut top: Vec<&TrackStats> = played.clone();
    top.sort_by(|a, b| {
        b.listened_secs
            .total_cmp(&a.listened_secs)
            .then(b.plays.cmp(&a.plays))
    });

    let top_tracks = top
        .iter()
        .take(TOP_TRACKS)
        .map(|t| TopTrack {
            track: t.track.clone(),
            plays: t.plays,
            listened_secs: t.listened_secs,
        })
        .collect();

    // Los artistas se agrupan por canal normalizado ("Radiohead - Topic" y
    // "RadioheadVEVO" son el mismo), pero se enseñan con el nombre tal cual
    // aparece en su pista mas escuchada.
    let mut artists: HashMap<String, (String, f64, TopArtist)> = HashMap::new();
    for t in &played {
        let Some(name) = t.track.uploader.as_deref().filter(|n| !n.trim().is_empty()) else {
            continue;
        };
        let key = crate::recommend::artist_key(Some(name));

        let entry = artists.entry(key).or_insert_with(|| {
            (
                name.to_string(),
                0.0,
                TopArtist { name: name.to_string(), plays: 0, listened_secs: 0.0, tracks: 0 },
            )
        });

        if t.listened_secs > entry.1 {
            entry.0 = name.to_string();
            entry.1 = t.listened_secs;
        }
        entry.2.plays += t.plays;
        entry.2.listened_secs += t.listened_secs;
        entry.2.tracks += 1;
    }

    let mut top_artists: Vec<TopArtist> = artists
        .into_values()
        .map(|(name, _, mut artist)| {
            artist.name = name;
            artist
        })
        .collect();
    top_artists.sort_by(|a, b| b.listened_secs.total_cmp(&a.listened_secs));
    top_artists.truncate(TOP_ARTISTS);

    Summary {
        listened_secs: played.iter().map(|t| t.listened_secs).sum(),
        plays: played.iter().map(|t| t.plays).sum(),
        tracks: played.len(),
        completions: played.iter().map(|t| t.completions).sum(),
        skips: played.iter().map(|t| t.skips).sum(),
        liked: tracks.iter().filter(|t| t.rating == Rating::Like).count(),
        top_tracks,
        top_artists,
    }
}

/// La entrada de esa pista, creandola si no existia y refrescando sus
/// metadatos si ya estaba.
fn upsert(tracks: &mut HashMap<String, TrackStats>, track: SearchResult) -> &mut TrackStats {
    let id = track.id.clone();

    match tracks.entry(id) {
        std::collections::hash_map::Entry::Occupied(slot) => {
            let entry = slot.into_mut();
            entry.refresh_metadata(track);
            entry
        }
        std::collections::hash_map::Entry::Vacant(slot) => slot.insert(TrackStats::new(track)),
    }
}

/// Al pasar del tope se olvidan las pistas que hace mas tiempo que no suenan.
/// Las valoradas no se tocan nunca: son lo que el usuario nos dijo a proposito.
fn prune(tracks: &mut HashMap<String, TrackStats>) {
    if tracks.len() <= MAX_TRACKS {
        return;
    }

    let mut forgettable: Vec<(u64, String)> = tracks
        .values()
        .filter(|t| t.rating == Rating::None)
        .map(|t| (t.last_played, t.track.id.clone()))
        .collect();

    forgettable.sort();

    let excess = tracks.len() - MAX_TRACKS;
    for (_, id) in forgettable.into_iter().take(excess) {
        tracks.remove(&id);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "antares-stats-{nombre}-{}-{:?}",
            now_secs(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    fn pista(id: &str, duracion: Option<f64>) -> SearchResult {
        SearchResult {
            id: id.to_string(),
            title: Some(format!("Titulo {id}")),
            uploader: Some("Canal".to_string()),
            duration: duracion,
            thumbnail: None,
            watch_url: SearchResult::watch_url_for(id),
        }
    }

    // --- Clasificacion -----------------------------------------------------

    #[test]
    fn llegar_al_final_es_completa_aunque_se_saltara_tiempo() {
        assert_eq!(classify(20.0, Some(200.0), true), Outcome::Complete);
    }

    #[test]
    fn el_ochenta_por_ciento_ya_cuenta_como_completa() {
        assert_eq!(classify(160.0, Some(200.0), false), Outcome::Complete);
        assert_eq!(classify(159.0, Some(200.0), false), Outcome::Partial);
    }

    #[test]
    fn quitarla_enseguida_es_un_salto() {
        assert_eq!(classify(10.0, Some(200.0), false), Outcome::Skip);
        assert_eq!(classify(0.0, Some(200.0), false), Outcome::Skip);
    }

    #[test]
    fn media_cancion_no_es_ni_salto_ni_completa() {
        assert_eq!(classify(100.0, Some(200.0), false), Outcome::Partial);
    }

    #[test]
    fn en_una_sesion_larga_el_tope_de_segundos_evita_el_falso_salto() {
        // 10 minutos de una sesion de una hora: menos del 30 %, pero no es un
        // rechazo.
        assert_eq!(classify(600.0, Some(3600.0), false), Outcome::Partial);
    }

    #[test]
    fn sin_duracion_solo_distingue_el_salto_rapido() {
        assert_eq!(classify(10.0, None, false), Outcome::Skip);
        assert_eq!(classify(300.0, None, false), Outcome::Partial);
        assert_eq!(classify(10.0, Some(0.0), false), Outcome::Skip);
    }

    // --- Cuentas -----------------------------------------------------------

    #[test]
    fn registra_escuchas_saltos_y_completas() {
        let stats = Stats::load(temp_dir("cuentas"));

        stats.record_listen(pista("a", Some(200.0)), 200.0, true);
        stats.record_listen(pista("a", Some(200.0)), 5.0, false);
        stats.record_listen(pista("a", Some(200.0)), 100.0, false);

        let a = stats.get("a").unwrap();
        assert_eq!(a.plays, 3);
        assert_eq!(a.completions, 1);
        assert_eq!(a.skips, 1);
        assert_eq!(a.listened_secs, 305.0);
        assert!((a.completions_w - 1.0).abs() < 1e-6);
        assert!((a.skips_w - 1.0).abs() < 1e-6);
    }

    #[test]
    fn las_cuentas_ponderadas_pierden_la_mitad_en_una_vida_media() {
        let mut entry = TrackStats::new(pista("a", Some(200.0)));
        entry.apply(Outcome::Complete, 200.0, 1_000);

        entry.decay_to(1_000 + HALF_LIFE_SECS as u64);

        assert!((entry.completions_w - 0.5).abs() < 1e-6);
        // Las cuentas brutas no decaen: son historia, no preferencia.
        assert_eq!(entry.completions, 1);
    }

    #[test]
    fn usa_la_duracion_guardada_si_la_nueva_no_viene() {
        let stats = Stats::load(temp_dir("duracion"));

        stats.record_listen(pista("a", Some(200.0)), 200.0, true);
        // Segunda escucha sin duracion: 170 s de 200 ya es completa.
        let outcome = stats.record_listen(pista("a", None), 170.0, false);

        assert_eq!(outcome, Outcome::Complete);
    }

    #[test]
    fn los_metadatos_nuevos_no_borran_los_viejos() {
        let stats = Stats::load(temp_dir("metadatos"));

        stats.record_listen(pista("a", Some(200.0)), 10.0, false);

        let mut incompleta = pista("a", None);
        incompleta.title = None;
        stats.record_listen(incompleta, 10.0, false);

        let a = stats.get("a").unwrap();
        assert_eq!(a.track.title.as_deref(), Some("Titulo a"));
        assert_eq!(a.track.duration, Some(200.0));
    }

    // --- Valoraciones ------------------------------------------------------

    #[test]
    fn me_gusta_se_guarda_y_se_quita() {
        let stats = Stats::load(temp_dir("rating"));

        assert_eq!(stats.rating("a"), Rating::None);

        stats.set_rating(pista("a", None), Rating::Like);
        assert_eq!(stats.rating("a"), Rating::Like);

        stats.clear_rating("a");
        assert_eq!(stats.rating("a"), Rating::None);
    }

    #[test]
    fn se_puede_valorar_una_pista_nunca_escuchada() {
        // Desde el menu de una fila de resultados, sin haberla puesto.
        let stats = Stats::load(temp_dir("sin-escuchar"));

        stats.set_rating(pista("nueva", None), Rating::Like);

        let entry = stats.get("nueva").unwrap();
        assert_eq!(entry.plays, 0);
        assert_eq!(entry.rating, Rating::Like);
    }

    #[test]
    fn la_lista_me_gusta_va_de_la_ultima_a_la_primera() {
        let stats = Stats::load(temp_dir("liked"));

        stats.set_rating(pista("a", None), Rating::Like);
        stats.set_rating(pista("b", None), Rating::Like);
        stats.set_rating(pista("c", None), Rating::Dislike);

        // Forzamos fechas distintas: dentro del mismo segundo empatarian.
        {
            let mut tracks = stats.tracks.lock().unwrap();
            tracks.get_mut("a").unwrap().rated_at = 100;
            tracks.get_mut("b").unwrap().rated_at = 200;
        }

        let ids: Vec<String> = stats.liked().into_iter().map(|t| t.id).collect();
        assert_eq!(ids, vec!["b", "a"]);
    }

    #[test]
    fn repara_los_titulos_rotos_y_respeta_los_sanos() {
        let stats = Stats::load(temp_dir("reparar"));

        let mut rota = pista("rota", None);
        rota.title = Some("Yo s\u{FFFD}".to_string());
        stats.record_listen(rota, 10.0, false);
        stats.record_listen(pista("sana", None), 10.0, false);

        let mut fresca_rota = pista("rota", None);
        fresca_rota.title = Some("Yo sé".to_string());
        let mut fresca_sana = pista("sana", None);
        fresca_sana.title = Some("Otro titulo".to_string());

        stats.repair_text([&fresca_rota, &fresca_sana]);

        assert_eq!(stats.get("rota").unwrap().track.title.as_deref(), Some("Yo sé"));
        assert_eq!(
            stats.get("sana").unwrap().track.title.as_deref(),
            Some("Titulo sana"),
            "un titulo sano no se toca"
        );
    }

    // --- Resumen ----------------------------------------------------------

    fn escuchada(id: &str, canal: &str, plays: u32, segundos: f64) -> TrackStats {
        let mut t = TrackStats::new(pista(id, Some(200.0)));
        t.track.uploader = Some(canal.to_string());
        t.plays = plays;
        t.listened_secs = segundos;
        t
    }

    #[test]
    fn el_resumen_ordena_por_tiempo_y_no_por_reproducciones() {
        let tracks = vec![
            escuchada("saltada", "A", 10, 20.0),
            escuchada("favorita", "B", 3, 600.0),
            escuchada("nunca", "C", 0, 0.0),
        ];

        let s = summarize(&tracks);

        assert_eq!(s.top_tracks[0].track.id, "favorita");
        assert_eq!(s.tracks, 2, "lo nunca escuchado no cuenta");
        assert_eq!(s.plays, 13);
        assert_eq!(s.listened_secs, 620.0);
    }

    #[test]
    fn el_resumen_junta_los_canales_de_un_mismo_artista() {
        let tracks = vec![
            escuchada("a", "Radiohead - Topic", 1, 100.0),
            escuchada("b", "RadioheadVEVO", 2, 300.0),
            escuchada("c", "Otro", 1, 50.0),
        ];

        let s = summarize(&tracks);

        assert_eq!(s.top_artists.len(), 2);
        assert_eq!(s.top_artists[0].name, "RadioheadVEVO", "con el nombre de su pista mas escuchada");
        assert_eq!(s.top_artists[0].tracks, 2);
        assert_eq!(s.top_artists[0].listened_secs, 400.0);
    }

    // --- Tope y disco ------------------------------------------------------

    #[test]
    fn al_pasar_el_tope_olvida_lo_mas_antiguo_pero_no_lo_valorado() {
        let mut tracks = HashMap::new();

        for i in 0..(MAX_TRACKS + 3) {
            let mut entry = TrackStats::new(pista(&format!("t{i}"), None));
            entry.last_played = i as u64 + 10;
            tracks.insert(entry.track.id.clone(), entry);
        }

        // La mas antigua de todas, pero con "me gusta": no se toca.
        tracks.get_mut("t0").unwrap().rating = Rating::Like;

        prune(&mut tracks);

        assert_eq!(tracks.len(), MAX_TRACKS);
        assert!(tracks.contains_key("t0"), "lo valorado se queda");
        assert!(!tracks.contains_key("t1"), "lo mas antiguo se va");
        assert!(tracks.contains_key(&format!("t{}", MAX_TRACKS + 2)));
    }

    #[test]
    fn las_estadisticas_sobreviven_al_reinicio() {
        let dir = temp_dir("persistencia");

        {
            let stats = Stats::load(dir.clone());
            stats.record_listen(pista("a", Some(200.0)), 200.0, true);
            stats.set_rating(pista("a", Some(200.0)), Rating::Like);
        }

        let path = dir.join(STATS_FILE);
        for _ in 0..200 {
            let releido = Stats::load(dir.clone());
            if releido.rating("a") == Rating::Like {
                assert_eq!(releido.get("a").unwrap().completions, 1);
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(10));
        }

        panic!("no se releyo {}", path.display());
    }
}

#[cfg(test)]
mod learning_tests {
    use super::*;
    #[test] fn an_empty_taste_library_survives_restart_after_temporary_listening() {
        let dir=std::env::temp_dir().join(format!("antares-first-temporary-{}-{:?}",std::process::id(),std::thread::current().id()));
        let stats=Stats::load(dir.clone());
        let track=SearchResult {id:"party".into(),title:None,uploader:None,duration:Some(100.0),thumbnail:None,watch_url:SearchResult::watch_url_for("party")};
        stats.record_context(track,100.0,true,false);
        stats.file.save_sync(stats.snapshot().into_iter().map(|s|(s.track.id.clone(),s)).collect::<HashMap<_,_>>()).unwrap();
        let reloaded=Stats::load(dir);
        assert_eq!(reloaded.snapshot().len(),1);assert!(reloaded.recommendation_snapshot().is_empty());
    }
    #[test] fn temporary_listens_count_without_training_taste() {
        let dir=std::env::temp_dir().join(format!("antares-temporary-{}-{:?}",std::process::id(),std::thread::current().id()));
        let stats=Stats::load(dir);
        let track=SearchResult {id:"temporary".into(),title:Some("Fiesta".into()),uploader:None,duration:Some(100.0),thumbnail:None,watch_url:SearchResult::watch_url_for("temporary")};
        stats.record_context(track.clone(),100.0,true,false);
        assert_eq!(stats.snapshot()[0].plays,1);assert!(stats.recommendation_snapshot().is_empty());
        stats.record_context(track.clone(),100.0,true,true);
        assert_eq!(stats.snapshot()[0].plays,2);assert_eq!(stats.recommendation_snapshot()[0].plays,1);
        stats.set_rating(track,Rating::Like);assert_eq!(stats.recommendation_snapshot()[0].rating,Rating::Like);
    }
}
