//! Secciones de Inicio calculadas a partir de las estadísticas de escucha.
//! También devuelve la biblioteca usada por genres.js para detectar géneros.

use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::recommend::{artist_key, quality, song_key, taste};
use crate::stats::{Rating, TrackStats};
use crate::track::SearchResult;

const SHELF_SIZE: usize = 12;
const ARTISTS: usize = 10;
/// Pistas de cada artista: su carátula y las semillas de su radio.
const ARTIST_TRACKS: usize = 3;
const LIBRARY_SIZE: usize = 300;

const HOUR: u64 = 3600;
const DAY: u64 = 24 * HOUR;

/// "Volver a escuchar": lo que te gusta y hace al menos esto que no suena.
const AGAIN_AFTER: u64 = 3 * DAY;
/// Si con eso salen muy pocas, se relaja a esto.
const AGAIN_AFTER_RELAXED: u64 = 12 * HOUR;
const AGAIN_MIN: usize = 4;
/// Gusto minimo (ver `recommend::taste`) para proponer volver a escuchar algo.
const AGAIN_TASTE: f64 = 0.55;

/// "Descubrimientos recientes": lo que sono por primera vez en estos dias y
/// escuchaste entero al menos una vez.
const DISCOVERY_WINDOW: u64 = 14 * DAY;

#[derive(Serialize)]
pub struct LibraryTrack {
    #[serde(flatten)]
    pub track: SearchResult,
    pub listened_secs: f64,
}

#[derive(Serialize)]
pub struct HomeArtist {
    pub name: String,
    pub listened_secs: f64,
    /// Sus pistas mas escuchadas: la primera pone la carátula.
    pub tracks: Vec<SearchResult>,
}

#[derive(Serialize)]
pub struct Home {
    pub again: Vec<SearchResult>,
    pub top: Vec<SearchResult>,
    pub discoveries: Vec<SearchResult>,
    pub artists: Vec<HomeArtist>,
    pub library: Vec<LibraryTrack>,
}

/// Lo escuchado de verdad: sin "No me gusta" y sin recopilatorios de una hora.
fn listened(tracks: &[TrackStats]) -> Vec<&TrackStats> {
    tracks
        .iter()
        .filter(|t| t.plays > 0 && t.rating != Rating::Dislike && quality(&t.track) > 0.0)
        .collect()
}

/// Las primeras `limit`, sin dos versiones de la misma cancion.
fn take_unique<'a>(sorted: impl IntoIterator<Item = &'a TrackStats>, limit: usize) -> Vec<SearchResult> {
    let mut seen = HashSet::new();
    sorted
        .into_iter()
        .filter(|t| seen.insert(song_key(t.track.title.as_deref())))
        .take(limit)
        .map(|t| t.track.clone())
        .collect()
}

fn again(played: &[&TrackStats], now: u64) -> Vec<SearchResult> {
    let pick = |min_age: u64| {
        let mut candidates: Vec<(&TrackStats, f64)> = played
            .iter()
            .filter(|t| now.saturating_sub(t.last_played) >= min_age)
            .filter(|t| t.plays >= 2 || t.rating == Rating::Like)
            .map(|t| (*t, taste(t, now)))
            .filter(|(_, g)| *g >= AGAIN_TASTE)
            .collect();

        // Lo que mas te gusta y mas has escuchado, primero.
        candidates.sort_by(|(a, ga), (b, gb)| {
            let score = |t: &TrackStats, g: f64| g * (1.0 + t.listened_secs / 60.0).ln();
            score(b, *gb).total_cmp(&score(a, *ga))
        });
        take_unique(candidates.into_iter().map(|(t, _)| t), SHELF_SIZE)
    };

    let strict = pick(AGAIN_AFTER);
    if strict.len() >= AGAIN_MIN {
        strict
    } else {
        pick(AGAIN_AFTER_RELAXED)
    }
}

fn top(played: &[&TrackStats]) -> Vec<SearchResult> {
    let mut sorted = played.to_vec();
    sorted.sort_by(|a, b| b.listened_secs.total_cmp(&a.listened_secs));
    take_unique(sorted, SHELF_SIZE)
}

fn discoveries(played: &[&TrackStats], now: u64) -> Vec<SearchResult> {
    let mut recent: Vec<&TrackStats> = played
        .iter()
        .filter(|t| t.completions >= 1 && now.saturating_sub(t.first_played) <= DISCOVERY_WINDOW)
        .copied()
        .collect();
    recent.sort_by_key(|t| std::cmp::Reverse(t.first_played));
    take_unique(recent, SHELF_SIZE)
}

fn artists(played: &[&TrackStats]) -> Vec<HomeArtist> {
    let mut by_artist: HashMap<String, Vec<&TrackStats>> = HashMap::new();
    for t in played {
        let Some(name) = t.track.uploader.as_deref().filter(|n| !n.trim().is_empty()) else {
            continue;
        };
        by_artist.entry(artist_key(Some(name))).or_default().push(t);
    }

    let mut artists: Vec<HomeArtist> = by_artist
        .into_values()
        .map(|mut tracks| {
            tracks.sort_by(|a, b| b.listened_secs.total_cmp(&a.listened_secs));
            HomeArtist {
                // El nombre tal como sale en su pista mas escuchada.
                name: tracks[0].track.uploader.clone().unwrap_or_default(),
                listened_secs: tracks.iter().map(|t| t.listened_secs).sum(),
                tracks: tracks.iter().take(ARTIST_TRACKS).map(|t| t.track.clone()).collect(),
            }
        })
        .collect();

    artists.sort_by(|a, b| b.listened_secs.total_cmp(&a.listened_secs));
    artists.truncate(ARTISTS);
    artists
}

pub fn build(tracks: &[TrackStats], now: u64) -> Home {
    let played = listened(tracks);

    let mut library: Vec<&TrackStats> = played.clone();
    library.sort_by(|a, b| b.listened_secs.total_cmp(&a.listened_secs));

    Home {
        again: again(&played, now),
        top: top(&played),
        discoveries: discoveries(&played, now),
        artists: artists(&played),
        library: library
            .into_iter()
            .take(LIBRARY_SIZE)
            .map(|t| LibraryTrack { track: t.track.clone(), listened_secs: t.listened_secs })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: u64 = 1_800_000_000;

    fn stats(id: &str, title: &str, uploader: &str) -> TrackStats {
        let mut t = TrackStats::new(SearchResult {
            id: id.to_string(),
            title: Some(title.to_string()),
            uploader: Some(uploader.to_string()),
            duration: Some(200.0),
            thumbnail: None,
            watch_url: SearchResult::watch_url_for(id),
        });
        t.plays = 3;
        t.completions = 3;
        t.completions_w = 3.0;
        t.weighted_at = NOW;
        t.listened_secs = 600.0;
        t.first_played = NOW - 30 * DAY;
        t.last_played = NOW - 5 * DAY;
        t
    }

    fn ids(tracks: &[SearchResult]) -> Vec<&str> {
        tracks.iter().map(|t| t.id.as_str()).collect()
    }

    #[test]
    fn volver_a_escuchar_es_lo_que_gusta_y_no_suena_hace_dias() {
        let viejo = stats("viejo", "Vieja", "A");
        let mut reciente = stats("reciente", "Reciente", "B");
        reciente.last_played = NOW - HOUR;
        let mut saltada = stats("saltada", "Saltada", "C");
        saltada.skips_w = 10.0;
        saltada.completions_w = 0.0;
        let mut una = stats("una", "Una vez", "D");
        una.plays = 1;

        let mut relleno: Vec<TrackStats> = (0..4)
            .map(|i| stats(&format!("r{i}"), &format!("Relleno {i}"), "E"))
            .collect();
        relleno.extend([viejo, reciente, saltada, una]);

        let home = build(&relleno, NOW);
        let again = ids(&home.again);
        assert!(again.contains(&"viejo"));
        assert!(!again.contains(&"reciente"), "sonó hace una hora");
        assert!(!again.contains(&"saltada"), "no te gusta");
        assert!(!again.contains(&"una"), "solo una escucha y sin me gusta");
    }

    #[test]
    fn con_pocas_candidatas_volver_a_escuchar_se_relaja() {
        let mut ayer = stats("ayer", "Ayer", "A");
        ayer.last_played = NOW - 20 * HOUR;
        let home = build(&[ayer], NOW);
        assert_eq!(ids(&home.again), ["ayer"]);
    }

    #[test]
    fn fuera_lo_que_no_gusta_y_los_recopilatorios() {
        let mut odiada = stats("odiada", "Odiada", "A");
        odiada.rating = Rating::Dislike;
        let mut larga = stats("larga", "Mix 1 hora", "B");
        larga.track.duration = Some(3600.0);

        let home = build(&[odiada, larga], NOW);
        assert!(home.top.is_empty());
        assert!(home.library.is_empty());
    }

    #[test]
    fn lo_mas_escuchado_sin_versiones_repetidas() {
        let mut a = stats("a", "Yan Block - 444 (Video Oficial)", "Yan Block");
        a.listened_secs = 900.0;
        let mut b = stats("b", "444 - Yan Block [Letra]", "Yan Block");
        b.listened_secs = 800.0;
        let c = stats("c", "Otra", "Otro");

        let home = build(&[c, b, a], NOW);
        assert_eq!(ids(&home.top), ["a", "c"]);
    }

    #[test]
    fn descubrimientos_son_nuevos_y_escuchados_enteros() {
        let mut nueva = stats("nueva", "Nueva", "A");
        nueva.first_played = NOW - 2 * DAY;
        let mut saltada = stats("saltada", "Nueva saltada", "B");
        saltada.first_played = NOW - DAY;
        saltada.completions = 0;
        let vieja = stats("vieja", "Vieja", "C");

        let home = build(&[nueva, saltada, vieja], NOW);
        assert_eq!(ids(&home.discoveries), ["nueva"]);
    }

    #[test]
    fn artistas_agrupados_por_canal() {
        let mut a1 = stats("a1", "Uno", "Radiohead");
        a1.listened_secs = 100.0;
        let mut a2 = stats("a2", "Dos", "Radiohead - Topic");
        a2.listened_secs = 500.0;
        let mut b = stats("b", "Tres", "Nirvana");
        b.listened_secs = 200.0;

        let home = build(&[a1, a2, b], NOW);
        assert_eq!(home.artists.len(), 2);
        // Radiohead suma sus dos canales (600 s) y se llama como su más escuchada.
        assert_eq!(home.artists[0].name, "Radiohead - Topic");
        assert_eq!(ids(&home.artists[0].tracks), ["a2", "a1"]);
        assert_eq!(home.artists[1].name, "Nirvana");
    }
}
