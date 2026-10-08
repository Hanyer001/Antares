//! El recomendador: que suena despues en el aleatorio inteligente, en una radio
//! y cuando se acaba la cola.
//!
//! Funciona en dos pasos.
//!
//! 1. Candidatas. Las CONOCIDAS salen de `stats` (lo que ya escuchaste o
//!    marcaste). Las NUEVAS salen del "Mix" de YouTube de unas cuantas
//!    semillas: canciones que te gustan, o la que pediste como radio.
//!
//! 2. Sorteo. Cada candidata recibe un peso y se elige por ruleta, no por
//!    ranking. Con ranking sonarian siempre las mismas diez favoritas; con
//!    ruleta salen mas a menudo, pero no siempre.
//!
//! Las senales, todas entre 0 y 1:
//!
//!   G  gusto       (completas + 1) / (completas + saltos + 2), con decaimiento
//!                  de 30 dias. 0,5 sin datos; "me gusta" la sube a 0,9.
//!   F  frescura    1 - e^(-horas / 24): recien oida ~0, al dia ~0,63.
//!   A  canal       la misma formula que G, sumando todas las pistas del canal.
//!   R  relacion    1 - prod(1 - G_semilla / (1 + posicion / 5)) sobre los Mix
//!                  en que aparece: mas alta cuanto mas arriba y en mas Mix.
//!   D  diversidad  0 si otra version de esa cancion sono hace poco; 0,2 por
//!                  cada vez que el canal aparece entre los ultimos 3; 1 si no.
//!   Q  calidad     0 para recopilatorios y cortes (> 12 min o < 60 s).
//!
//! Pesos:
//!
//!   conocida:  G^2 * F * D * (1 + R)
//!   nueva:     R * (0,5 + A) * D * Q
//!
//! Antes de cada eleccion se tira una moneda cargada con la "aventura": con esa
//! probabilidad se elige entre las nuevas, y si no entre las conocidas.

use std::collections::{HashMap, HashSet, VecDeque};

use serde::{Deserialize, Serialize};

use crate::stats::{Rating, TrackStats};
use crate::track::SearchResult;

/// "Me gusta" pone el gusto de una pista al menos aqui.
const LIKED_TASTE: f64 = 0.9;

/// Una semilla elegida a mano (una radio, o lo que acabas de buscar y poner)
/// cuenta al menos como esto, aunque nunca la hayas escuchado. Si la elegiste,
/// algo te gusta.
const RADIO_SEED_TASTE: f64 = 0.75;

/// Posiciones del Mix que tarda la relacion en caer a la mitad.
const POSITION_SCALE: f64 = 5.0;

/// Escala de la frescura, en horas.
const FRESHNESS_HOURS: f64 = 24.0;

/// Cuantas canciones recientes bloquean una repeticion (D = 0).
const RECENT_SONGS: usize = 20;

/// Cuantos canales recientes penalizan (D = 0,2).
const RECENT_ARTISTS: usize = 3;
const SAME_ARTIST_PENALTY: f64 = 0.2;

/// Una semilla cuyos Mix el usuario va saltando pesa esto en la sesion.
const AVOIDED_SEED_PENALTY: f64 = 0.3;

const MAX_DURATION_SECS: f64 = 12.0 * 60.0;
const MIN_DURATION_SECS: f64 = 60.0;

/// Palabras que delatan un recopilatorio aunque la duracion no venga.
const COMPILATION_WORDS: [&str; 4] = ["album completo", "álbum completo", "full album", "mix completo"];

/// Palabras de relleno que no distinguen una cancion de otra: "Video Oficial",
/// "Lyrics", "Letra"... Se quitan antes de comparar titulos.
const NOISE_WORDS: [&str; 16] = [
    "official", "oficial", "video", "videoclip", "audio", "lyric", "lyrics", "letra", "visualizer",
    "hd", "4k", "mv", "ft", "feat", "prod", "clip",
];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    /// Aleatorio inteligente: tu biblioteca mas descubrimientos.
    Mix,
    /// Radio desde una cancion: solo lo relacionado con ella.
    Radio,
}

/// Una recomendacion, lista para la cola.
#[derive(Clone, Serialize)]
pub struct Recommendation {
    #[serde(flatten)]
    pub track: SearchResult,
    /// Id de la semilla de cuyo Mix salio, si salio de uno. El frontend lo usa
    /// para notar cuando una semilla no esta funcionando.
    pub seed: Option<String>,
    /// Por que esta aqui, en pocas palabras, para la interfaz.
    pub reason: String,
}

/// Una semilla y su Mix.
pub struct SeedMix {
    pub seed: SearchResult,
    /// Cuanto te gusta la semilla. Escala lo que aporta su Mix.
    pub taste: f64,
    pub related: Vec<SearchResult>,
}

pub struct Params {
    pub mode: Mode,
    pub count: usize,
    /// Probabilidad de elegir una nueva en cada tirada, 0..=1.
    pub adventure: f64,
    /// Ids que no deben salir: la cola actual y lo ya sonado en la sesion.
    pub exclude: HashSet<String>,
    /// Semillas cuyos Mix el usuario ha ido saltando.
    pub avoid_seeds: HashSet<String>,
    pub now: u64,
    pub tuning: Tuning,
}

/// Lo que el usuario ajusta del recomendador (Ajustes › Descubrir), en
/// lenguaje normal. Los valores de serie son los de siempre.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Tuning {
    /// Escala de la frescura: cuanto tarda una cancion en "poder volver".
    pub freshness_hours: f64,
    /// Lo que pesa un canal por cada vez que esta entre los ultimos 3:
    /// 1 = da igual repetir artista, cerca de 0 = casi nunca seguidos.
    pub artist_penalty: f64,
    pub min_duration_secs: f64,
    pub max_duration_secs: f64,
    /// Palabras que, en el titulo, sacan una cancion: "live", "sped up"...
    pub exclude_words: Vec<String>,
    /// Canales que no se recomiendan nunca.
    pub blocked_channels: Vec<String>,
    /// Preferencia suave: reduce su frecuencia sin impedir elegirlo.
    pub less_channels: Vec<String>,
}

impl Default for Tuning {
    fn default() -> Self {
        Self {
            freshness_hours: FRESHNESS_HOURS,
            artist_penalty: SAME_ARTIST_PENALTY,
            min_duration_secs: MIN_DURATION_SECS,
            max_duration_secs: MAX_DURATION_SECS,
            exclude_words: Vec::new(),
            blocked_channels: Vec::new(),
            less_channels: Vec::new(),
        }
    }
}

impl Tuning {
    /// Con los valores dentro de sus limites: el frontend ya los acota, pero
    /// un NaN o un minimo mayor que el maximo no pueden romper el sorteo.
    pub fn sanitized(mut self) -> Self {
        let d = Self::default();
        let fix = |v: f64, lo: f64, hi: f64, def: f64| if v.is_finite() { v.clamp(lo, hi) } else { def };

        self.freshness_hours = fix(self.freshness_hours, 1.0, 24.0 * 30.0, d.freshness_hours);
        self.artist_penalty = fix(self.artist_penalty, 0.0, 1.0, d.artist_penalty);
        self.min_duration_secs = fix(self.min_duration_secs, 0.0, 600.0, d.min_duration_secs);
        self.max_duration_secs = fix(self.max_duration_secs, 120.0, 3.0 * 3600.0, d.max_duration_secs);
        if self.min_duration_secs >= self.max_duration_secs {
            self.min_duration_secs = d.min_duration_secs.min(self.max_duration_secs / 2.0);
        }

        let clean = |list: Vec<String>, key: fn(&str) -> String| -> Vec<String> {
            let mut out: Vec<String> = list.iter().map(|w| key(w)).filter(|w| !w.is_empty()).collect();
            out.sort();
            out.dedup();
            out.truncate(200);
            out
        };
        self.exclude_words = clean(self.exclude_words, |w| w.trim().to_lowercase());
        self.blocked_channels = clean(self.blocked_channels, |c| artist_key(Some(c)));
        self.less_channels = clean(self.less_channels, |c| artist_key(Some(c.trim())));
        self
    }

    /// Si la pista puede salir: dentro de la duracion elegida, sin recopilatorios,
    /// sin palabras excluidas y de un canal no bloqueado.
    pub fn preference_weight(&self, artist: &str) -> f64 {
        if self.less_channels.iter().any(|channel| channel == artist) { 0.25 } else { 1.0 }
    }

    pub fn allows(&self, track: &SearchResult) -> bool {
        if crate::source::native() && !is_music(track) { return false; }
        if let Some(d) = track.duration {
            if d < self.min_duration_secs || d > self.max_duration_secs {
                return false;
            }
        }

        let title = track.title.as_deref().unwrap_or("").to_lowercase();
        if COMPILATION_WORDS.iter().any(|w| title.contains(w)) {
            return false;
        }
        if self.exclude_words.iter().any(|w| contains_word(&title, w)) {
            return false;
        }

        let channel = artist_key(track.uploader.as_deref());
        !self.blocked_channels.contains(&channel)
    }

    fn freshness(&self, last_played: u64, now: u64) -> f64 {
        freshness_over(last_played, now, self.freshness_hours)
    }
}

/// Si `word` aparece en `text` como palabra(s) entera(s): "live" saca
/// "(Live at Wembley)" pero no "Delivery".
fn contains_word(text: &str, word: &str) -> bool {
    let is_edge = |c: Option<char>| c.is_none_or(|c| !c.is_alphanumeric());

    text.match_indices(word).any(|(i, _)| {
        is_edge(text[..i].chars().next_back()) && is_edge(text[i + word.len()..].chars().next())
    })
}

// ---------------------------------------------------------------------------
// Aleatoriedad
// ---------------------------------------------------------------------------

/// xorshift64*: sobra para barajar canciones y evita una dependencia. Las
/// pruebas le dan una semilla fija para que el sorteo sea reproducible.
pub struct Rng(u64);

impl Rng {
    pub fn seeded(seed: u64) -> Self {
        // Cero es un punto fijo de xorshift: nunca saldria de ahi.
        Self(seed.max(1))
    }

    pub fn from_time() -> Self {
        let nanos = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos() as u64)
            .unwrap_or(0x9E37_79B9_7F4A_7C15);
        Self::seeded(nanos ^ 0x9E37_79B9_7F4A_7C15)
    }

    /// Uniforme en [0, 1).
    pub fn next_f64(&mut self) -> f64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        let x = self.0.wrapping_mul(0x2545_F491_4F6C_DD1D);
        (x >> 11) as f64 / (1u64 << 53) as f64
    }
}

/// Indice elegido por ruleta, o `None` si todos los pesos son cero.
fn roulette(weights: &[f64], rng: &mut Rng) -> Option<usize> {
    let total: f64 = weights.iter().sum();
    if total <= 0.0 {
        return None;
    }

    let mut target = rng.next_f64() * total;
    for (i, w) in weights.iter().enumerate() {
        if *w <= 0.0 {
            continue;
        }
        if target < *w {
            return Some(i);
        }
        target -= w;
    }

    // Redondeo: la ultima con peso.
    weights.iter().rposition(|w| *w > 0.0)
}

// ---------------------------------------------------------------------------
// Senales
// ---------------------------------------------------------------------------

/// Gusto por una pista: suavizado de Laplace sobre completas y saltos.
pub fn taste(stats: &TrackStats, now: u64) -> f64 {
    let (completions, skips) = stats.weights_at(now);
    let g = (completions + 1.0) / (completions + skips + 2.0);

    if stats.rating == Rating::Like {
        g.max(LIKED_TASTE)
    } else {
        g
    }
}

/// Cuanto hace que no suena, de 0 (ahora mismo) a 1 (hace dias o nunca).
pub fn freshness(last_played: u64, now: u64) -> f64 {
    freshness_over(last_played, now, FRESHNESS_HOURS)
}

/// La frescura con otra escala (ver `Tuning::freshness_hours`).
fn freshness_over(last_played: u64, now: u64, scale_hours: f64) -> f64 {
    if last_played == 0 {
        return 1.0;
    }

    let hours = now.saturating_sub(last_played) as f64 / 3600.0;
    1.0 - (-hours / scale_hours).exp()
}

/// Cuanto aporta aparecer en la posicion `pos` del Mix de una semilla.
fn contribution(seed_taste: f64, pos: usize) -> f64 {
    seed_taste / (1.0 + pos as f64 / POSITION_SCALE)
}

/// 0 para lo que no es una cancion: recopilatorios de una hora, cortes.
pub fn is_music(track: &SearchResult) -> bool {
    if let Some(value) = track.is_music { return value; }
    let channel = track.uploader.as_deref().unwrap_or("").to_lowercase();
    channel.ends_with(" - topic") || channel.ends_with("vevo")
}

pub fn quality(track: &SearchResult) -> f64 {
    if let Some(d) = track.duration {
        if !(MIN_DURATION_SECS..=MAX_DURATION_SECS).contains(&d) {
            return 0.0;
        }
    }

    let title = track.title.as_deref().unwrap_or("").to_lowercase();
    if COMPILATION_WORDS.iter().any(|w| title.contains(w)) {
        return 0.0;
    }

    1.0
}

/// El canal normalizado: sin " - Topic", "VEVO" ni "Official", que YouTube
/// pega a los canales de un mismo artista.
pub fn artist_key(uploader: Option<&str>) -> String {
    let lower = uploader.unwrap_or("").to_lowercase();
    let trimmed = lower
        .trim_end_matches(" - topic")
        .replace("vevo", "")
        .replace("official", "")
        .replace("oficial", "");

    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// La "huella" de una cancion, igual para sus distintas versiones subidas.
///
/// "Yan Block - 444 (Video Oficial)" y "444 - Yan Block [Letra]" son la misma
/// cancion, y sonarlas seguidas delata el aleatorio. Se quita lo que va entre
/// parentesis o corchetes, las palabras de relleno, y se ordenan las palabras
/// que quedan, para que el orden artista/titulo no importe.
pub fn song_key(title: Option<&str>) -> String {
    let Some(title) = title else {
        return String::new();
    };

    let mut clean = String::with_capacity(title.len());
    let mut depth = 0usize;

    for c in title.to_lowercase().chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => clean.push(if c.is_alphanumeric() { c } else { ' ' }),
            _ => {}
        }
    }

    let mut words: Vec<&str> = clean
        .split_whitespace()
        .filter(|w| !NOISE_WORDS.contains(w))
        .collect();

    words.sort_unstable();
    words.dedup();
    words.join(" ")
}

/// Gusto agregado por canal.
struct ArtistTaste(HashMap<String, (f64, f64)>);

impl ArtistTaste {
    fn from_library(library: &[TrackStats], now: u64) -> Self {
        let mut map: HashMap<String, (f64, f64)> = HashMap::new();

        for stats in library {
            let key = artist_key(stats.track.uploader.as_deref());
            if key.is_empty() {
                continue;
            }

            let (c, s) = stats.weights_at(now);
            // Un "me gusta" cuenta como un par de escuchas completas del canal.
            let bonus = if stats.rating == Rating::Like { 2.0 } else { 0.0 };

            let entry = map.entry(key).or_default();
            entry.0 += c + bonus;
            entry.1 += s;
        }

        Self(map)
    }

    fn affinity(&self, key: &str) -> f64 {
        let (c, s) = self.0.get(key).copied().unwrap_or((0.0, 0.0));
        (c + 1.0) / (c + s + 2.0)
    }
}

/// Lo que acaba de sonar, para la diversidad. Se va actualizando con cada
/// eleccion: la segunda recomendacion ya tiene en cuenta la primera.
struct Recent {
    /// Huella de cancion → id de la pista que la hizo sonar.
    songs: HashMap<String, String>,
    artists: VecDeque<String>,
    /// Lo que pesa cada repeticion de canal (ver `Tuning::artist_penalty`).
    penalty: f64,
}

impl Recent {
    fn from_library(library: &[TrackStats], penalty: f64) -> Self {
        let mut played: Vec<&TrackStats> = library.iter().filter(|t| t.last_played > 0).collect();
        played.sort_by_key(|t| std::cmp::Reverse(t.last_played));

        let songs = played
            .iter()
            .take(RECENT_SONGS)
            .map(|t| (song_key(t.track.title.as_deref()), t.track.id.clone()))
            .filter(|(k, _)| !k.is_empty())
            .collect();

        let artists = played
            .iter()
            .take(RECENT_ARTISTS)
            .map(|t| artist_key(t.track.uploader.as_deref()))
            .collect();

        Self { songs, artists, penalty }
    }

    /// La huella bloquea OTRAS versiones de una cancion reciente, no la pista
    /// misma: que una conocida haya sonado hace poco ya lo castiga la frescura,
    /// y bloquearla aqui dejaria sin conocidas a cualquier biblioteca de menos
    /// de `RECENT_SONGS` canciones.
    fn diversity(&self, candidate: &Candidate) -> f64 {
        let other_version = self
            .songs
            .get(&candidate.song)
            .is_some_and(|id| *id != candidate.track.id);

        if !candidate.song.is_empty() && other_version {
            return 0.0;
        }
        if candidate.artist.is_empty() {
            return 1.0;
        }

        // Acumulativa: una vez entre las ultimas 3 pesa 0,2; dos veces, 0,04.
        // El Mix de una cancion suele estar lleno de su propio artista, y con
        // un 0,2 fijo seguiria ganando tres veces seguidas.
        let repeats = self.artists.iter().filter(|a| **a == candidate.artist).count();
        self.penalty.powi(repeats as i32)
    }

    fn push(&mut self, candidate: &Candidate) {
        if !candidate.song.is_empty() {
            self.songs.insert(candidate.song.clone(), candidate.track.id.clone());
        }

        self.artists.push_front(candidate.artist.clone());
        self.artists.truncate(RECENT_ARTISTS);
    }
}

// ---------------------------------------------------------------------------
// Semillas
// ---------------------------------------------------------------------------

/// Lo que cuenta como "conocida": sonada alguna vez o marcada con me gusta, y
/// nunca con no me gusta.
fn is_known(stats: &TrackStats) -> bool {
    stats.rating != Rating::Dislike && (stats.plays > 0 || stats.rating == Rating::Like)
}

/// Elige las semillas: las forzadas (la de la radio, o lo que el usuario acaba
/// de buscar y poner) y hasta `extra` mas de tu biblioteca, sorteadas por gusto.
///
/// El gusto va al cuadrado para que las semillas sean de verdad favoritas, y se
/// modula con la frescura para que no sean siempre las mismas tres.
pub fn choose_seeds(
    library: &[TrackStats],
    forced: &[SearchResult],
    extra: usize,
    avoid: &HashSet<String>,
    now: u64,
    rng: &mut Rng,
) -> Vec<SearchResult> {
    let mut seeds: Vec<SearchResult> = Vec::with_capacity(forced.len() + extra);
    for seed in forced {
        if !seeds.iter().any(|s| s.id == seed.id) {
            seeds.push(seed.clone());
        }
    }

    let mut pool: Vec<&TrackStats> = library
        .iter()
        .filter(|t| is_known(t) && !avoid.contains(&t.track.id))
        .filter(|t| !seeds.iter().any(|s| s.id == t.track.id))
        .collect();

    for _ in 0..extra {
        let weights: Vec<f64> = pool
            .iter()
            .map(|t| taste(t, now).powi(2) * (0.5 + 0.5 * freshness(t.last_played, now)))
            .collect();

        let Some(i) = roulette(&weights, rng) else {
            break;
        };

        seeds.push(pool.swap_remove(i).track.clone());
    }

    seeds
}

/// Las semillas que mas probablemente saldran en una mezcla: tus favoritas, de
/// mas a menos. Son las que se precalientan al arrancar, para que el primer
/// "Nueva mezcla" no espere a YouTube.
pub fn warm_seeds(library: &[TrackStats], count: usize, now: u64) -> Vec<String> {
    let mut known: Vec<&TrackStats> = library.iter().filter(|t| is_known(t)).collect();
    known.sort_by(|a, b| taste(b, now).total_cmp(&taste(a, now)));

    known.into_iter().take(count).map(|t| t.track.id.clone()).collect()
}

/// El gusto con el que entra una semilla.
pub fn seed_taste(library: &[TrackStats], seed: &SearchResult, forced: bool, now: u64) -> f64 {
    let known = library.iter().find(|t| t.track.id == seed.id).map(|t| taste(t, now));

    match (known, forced) {
        (Some(g), true) => g.max(RADIO_SEED_TASTE),
        (Some(g), false) => g,
        (None, _) => RADIO_SEED_TASTE,
    }
}

// ---------------------------------------------------------------------------
// Sorteo
// ---------------------------------------------------------------------------

struct Candidate {
    track: SearchResult,
    /// Peso sin la diversidad, que cambia con cada eleccion.
    base: f64,
    song: String,
    artist: String,
    seed: Option<String>,
    reason: String,
}

impl Candidate {
    fn new(track: SearchResult, base: f64, seed: Option<String>, reason: String) -> Self {
        Self {
            song: song_key(track.title.as_deref()),
            artist: artist_key(track.uploader.as_deref()),
            track,
            base,
            seed,
            reason,
        }
    }
}

/// De que Mix viene una candidata y cuanto la respalda.
struct Relation {
    track: SearchResult,
    /// Producto de (1 - aportacion): R = 1 - esto.
    not_r: f64,
    best: f64,
    seed_id: String,
    seed_title: String,
}

impl Relation {
    fn r(&self) -> f64 {
        1.0 - self.not_r
    }
}

fn relations(mixes: &[SeedMix], avoid: &HashSet<String>) -> HashMap<String, Relation> {
    let mut out: HashMap<String, Relation> = HashMap::new();

    for mix in mixes {
        let penalty = if avoid.contains(&mix.seed.id) { AVOIDED_SEED_PENALTY } else { 1.0 };
        let seed_title = mix.seed.title.clone().unwrap_or_else(|| "otra canción".to_string());

        // El propio Mix trae la semilla primera: no se recomienda a si misma.
        let related = mix.related.iter().filter(|t| t.id != mix.seed.id);

        for (pos, track) in related.enumerate() {
            let c = (contribution(mix.taste, pos) * penalty).clamp(0.0, 1.0);

            let entry = out.entry(track.id.clone()).or_insert_with(|| Relation {
                track: track.clone(),
                not_r: 1.0,
                best: 0.0,
                seed_id: mix.seed.id.clone(),
                seed_title: seed_title.clone(),
            });

            entry.not_r *= 1.0 - c;
            if c > entry.best {
                entry.best = c;
                entry.seed_id = mix.seed.id.clone();
                entry.seed_title = seed_title.clone();
            }
        }
    }

    out
}

/// Construye las dos bolsas de candidatas: conocidas y nuevas.
fn candidates(
    library: &[TrackStats],
    mixes: &[SeedMix],
    params: &Params,
) -> (Vec<Candidate>, Vec<Candidate>) {
    let now = params.now;
    let by_id: HashMap<&str, &TrackStats> =
        library.iter().map(|t| (t.track.id.as_str(), t)).collect();
    let artists = ArtistTaste::from_library(library, now);
    let related = relations(mixes, &params.avoid_seeds);

    let tuning = &params.tuning;
    let usable = |track: &SearchResult| !params.exclude.contains(&track.id) && tuning.allows(track);
    let related_reason = |rel: &Relation| format!("Porque escuchas «{}»", rel.seed_title);

    let mut known = Vec::new();
    let mut fresh = Vec::new();

    // Conocidas. En modo mezcla, toda la biblioteca; en radio, solo las que
    // estan en el Mix de la semilla.
    for stats in library.iter().filter(|t| is_known(t) && usable(&t.track)) {
        let rel = related.get(&stats.track.id);
        let r = rel.map_or(0.0, Relation::r);

        if params.mode == Mode::Radio && rel.is_none() {
            continue;
        }

        let g = taste(stats, now);
        let f = tuning.freshness(stats.last_played, now);

        let base = match params.mode {
            Mode::Mix => g.powi(2) * f * (1.0 + r),
            Mode::Radio => r * (0.5 + g) * f,
        };

        let reason = match (stats.rating, rel) {
            (Rating::Like, _) => "Te gusta".to_string(),
            (_, Some(rel)) => related_reason(rel),
            _ => "De tu biblioteca".to_string(),
        };

        known.push(Candidate::new(
            stats.track.clone(),
            base,
            rel.map(|rel| rel.seed_id.clone()),
            reason,
        ));
    }

    // Nuevas: lo que traen los Mix y no conoces. Lo que marcaste con "no me
    // gusta" no vuelve por aqui tampoco.
    for (id, rel) in &related {
        let in_library = by_id.get(id.as_str());
        if in_library.is_some_and(|t| is_known(t) || t.rating == Rating::Dislike) || !usable(&rel.track) {
            continue;
        }

        // La calidad (duracion, recopilatorios) ya la filtro `usable`.
        let a = artists.affinity(&artist_key(rel.track.uploader.as_deref()));
        let base = rel.r() * (0.5 + a);

        fresh.push(Candidate::new(
            rel.track.clone(),
            base,
            Some(rel.seed_id.clone()),
            related_reason(rel),
        ));
    }

    // Orden estable: el HashMap no lo tiene, y sin esto el mismo `Rng` daria
    // resultados distintos en cada ejecucion de las pruebas.
    known.sort_by(|a, b| a.track.id.cmp(&b.track.id));
    fresh.sort_by(|a, b| a.track.id.cmp(&b.track.id));

    (known, fresh)
}

/// Elige `count` recomendaciones.
pub fn recommend(
    library: &[TrackStats],
    mixes: &[SeedMix],
    params: &Params,
    rng: &mut Rng,
) -> Vec<Recommendation> {
    let (mut known, mut fresh) = candidates(library, mixes, params);
    let mut recent = Recent::from_library(library, params.tuning.artist_penalty);
    let adventure = params.adventure.clamp(0.0, 1.0);

    let mut picks = Vec::with_capacity(params.count);

    while picks.len() < params.count {
        let wants_new = rng.next_f64() < adventure;

        let weights_of = |pool: &[Candidate], recent: &Recent| -> Vec<f64> {
            pool.iter().map(|c| c.base * recent.diversity(c) * params.tuning.preference_weight(&c.artist)).collect()
        };

        let known_w = weights_of(&known, &recent);
        let fresh_w = weights_of(&fresh, &recent);

        // La bolsa que toco, y si esta vacia, la otra: mejor una conocida que
        // quedarse corto porque la moneda dijo "nueva".
        let (first, second) = if wants_new { (0, 1) } else { (1, 0) };
        let order = [first, second];

        let mut chosen = None;
        for bag in order {
            let weights = if bag == 0 { &fresh_w } else { &known_w };
            if let Some(i) = roulette(weights, rng) {
                chosen = Some((bag, i));
                break;
            }
        }

        let Some((bag, i)) = chosen else {
            break;
        };

        let pool = if bag == 0 { &mut fresh } else { &mut known };
        let candidate = pool.swap_remove(i);
        recent.push(&candidate);

        picks.push(Recommendation {
            track: candidate.track,
            seed: candidate.seed,
            reason: candidate.reason,
        });
    }

    picks
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::HALF_LIFE_SECS;

    const AHORA: u64 = 1_800_000_000;
    const DIA: u64 = 24 * 3600;

    fn pista(id: &str, titulo: &str, canal: &str) -> SearchResult {
        SearchResult { is_music: None,
            id: id.to_string(),
            title: Some(titulo.to_string()),
            uploader: Some(canal.to_string()),
            duration: Some(200.0),
            thumbnail: None,
            watch_url: SearchResult::watch_url_for(id),
        }
    }

    /// Una pista de la biblioteca con `c` completas y `s` saltos, oida hace
    /// `dias` dias.
    fn conocida(id: &str, canal: &str, c: f64, s: f64, dias: u64) -> TrackStats {
        let mut t = TrackStats::new(pista(id, &format!("Cancion {id}"), canal));
        t.plays = (c + s) as u32 + 1;
        t.completions_w = c;
        t.skips_w = s;
        t.weighted_at = AHORA;
        t.last_played = AHORA - dias * DIA;
        t
    }

    fn params(mode: Mode, count: usize, adventure: f64) -> Params {
        Params {
            mode,
            count,
            adventure,
            exclude: HashSet::new(),
            avoid_seeds: HashSet::new(),
            now: AHORA,
            tuning: Tuning::default(),
        }
    }

    #[test]
    fn preferencia_suave_disminuye_seleccion_y_sigue_permitiendo_el_artista() {
        let lib = vec![conocida("a", "Radiohead", 5.0, 0.0, 3), conocida("b", "PSY", 5.0, 0.0, 3)];
        let mut p = params(Mode::Mix, 1, 0.0);
        p.tuning.less_channels = vec!["radiohead".into()];
        let mut rng = Rng::seeded(917);
        let chosen = (0..1000).filter(|_| recommend(&lib, &[], &p, &mut rng)[0].track.id == "a").count();
        assert!(chosen > 100 && chosen < 350, "frecuencia reducida, no bloqueo: {chosen}/1000");
    }

    #[test]
    fn menos_artista_reduce_el_peso_sin_bloquearlo() {
        let tuning = Tuning { less_channels: vec![" Radiohead - Topic ".into()], ..Tuning::default() }.sanitized();
        assert_eq!(tuning.less_channels, vec!["radiohead"]);
        assert_eq!(tuning.preference_weight("radiohead"), 0.25);
        assert_eq!(tuning.preference_weight("psy"), 1.0);
        assert!(tuning.allows(&pista("a", "Creep", "Radiohead - Topic")));
    }

    #[test]
    fn palabras_excluidas_enteras() {
        assert!(contains_word("song (live at wembley)", "live"));
        assert!(!contains_word("delivery", "live"));
        assert!(contains_word("x - sped up version", "sped up"));
        assert!(!contains_word("speed up", "sped up"));
    }

    #[test]
    fn el_ajuste_filtra_palabras_canales_y_duracion() {
        let tuning = Tuning {
            exclude_words: vec![" LIVE ".into()],
            blocked_channels: vec!["Bebefinn - Topic".into()],
            max_duration_secs: 300.0,
            ..Tuning::default()
        }
        .sanitized();

        assert!(tuning.allows(&pista("a", "Canción", "Alguien")));
        assert!(!tuning.allows(&pista("b", "Canción (Live)", "Alguien")));
        assert!(!tuning.allows(&pista("c", "Canción", "Bebefinn")), "mismo canal normalizado");

        let mut larga = pista("d", "Larga", "Alguien");
        larga.duration = Some(400.0);
        assert!(!tuning.allows(&larga));
    }

    #[test]
    fn el_ajuste_se_sanea() {
        let t = Tuning {
            freshness_hours: f64::NAN,
            artist_penalty: 7.0,
            min_duration_secs: 900.0,
            max_duration_secs: 300.0,
            ..Tuning::default()
        }
        .sanitized();

        assert_eq!(t.freshness_hours, FRESHNESS_HOURS);
        assert_eq!(t.artist_penalty, 1.0);
        assert!(t.min_duration_secs < t.max_duration_secs);
    }

    #[test]
    fn canales_bloqueados_no_se_recomiendan() {
        let lib = vec![conocida("a", "Semilla", 5.0, 0.0, 3)];
        let relacionadas = vec![pista("b", "Buena", "Otro"), pista("c", "Mala", "Bloqueado")];
        let mut p = params(Mode::Mix, 10, 1.0);
        p.tuning.blocked_channels = vec!["bloqueado".into()];

        let picks = recommend(&lib, &[mix("a", relacionadas)], &p, &mut Rng::seeded(7));
        assert!(picks.iter().all(|r| r.track.id != "c"));
        assert!(picks.iter().any(|r| r.track.id == "b"));
    }

    #[test]
    fn sin_penalizacion_de_artista_puede_repetir_canal() {
        let lib: Vec<TrackStats> = Vec::new();
        let relacionadas: Vec<SearchResult> =
            (0..6).map(|i| pista(&format!("x{i}"), &format!("Tema {i}"), "Mismo")).collect();

        let mut p = params(Mode::Radio, 4, 1.0);
        p.tuning.artist_penalty = 1.0;
        let picks = recommend(&lib, &[mix("s", relacionadas.clone())], &p, &mut Rng::seeded(3));
        assert_eq!(picks.len(), 4, "con penalizacion 1 no se frena nada");

        p.tuning.artist_penalty = 0.0;
        let picks = recommend(&lib, &[mix("s", relacionadas)], &p, &mut Rng::seeded(3));
        assert_eq!(picks.len(), 1, "con 0, un canal no puede repetir mientras siga entre los ultimos 3");
    }

    fn mix(semilla: &str, relacionadas: Vec<SearchResult>) -> SeedMix {
        SeedMix {
            seed: pista(semilla, "Semilla", "Canal S"),
            taste: 0.9,
            related: relacionadas,
        }
    }

    // --- Senales -----------------------------------------------------------

    #[test]
    fn sin_datos_el_gusto_es_neutro() {
        let t = conocida("a", "C", 0.0, 0.0, 3);
        assert!((taste(&t, AHORA) - 0.5).abs() < 1e-9);
    }

    #[test]
    fn las_completas_suben_el_gusto_y_los_saltos_lo_bajan() {
        assert!(taste(&conocida("a", "C", 5.0, 0.0, 3), AHORA) > 0.8);
        assert!(taste(&conocida("a", "C", 0.0, 5.0, 3), AHORA) < 0.2);
    }

    #[test]
    fn me_gusta_pone_un_suelo_alto_al_gusto() {
        let mut t = conocida("a", "C", 0.0, 3.0, 3);
        t.rating = Rating::Like;
        assert!((taste(&t, AHORA) - LIKED_TASTE).abs() < 1e-9);
    }

    #[test]
    fn los_saltos_viejos_pesan_menos() {
        let mut t = conocida("a", "C", 0.0, 4.0, 3);
        let hoy = taste(&t, AHORA);

        t.weighted_at = AHORA - 3 * HALF_LIFE_SECS as u64;
        assert!(taste(&t, AHORA) > hoy, "tres vidas medias despues, se perdona");
    }

    #[test]
    fn la_frescura_crece_con_el_tiempo() {
        assert!(freshness(AHORA, AHORA) < 0.01);
        assert!((freshness(AHORA - DIA, AHORA) - 0.632).abs() < 0.01);
        assert!(freshness(AHORA - 3 * DIA, AHORA) > 0.94);
        assert_eq!(freshness(0, AHORA), 1.0, "nunca oida: fresca del todo");
    }

    #[test]
    fn la_relacion_cae_con_la_posicion() {
        assert!((contribution(1.0, 0) - 1.0).abs() < 1e-9);
        assert!((contribution(1.0, 5) - 0.5).abs() < 1e-9);
        assert!(contribution(1.0, 20) < contribution(1.0, 4));
    }

    #[test]
    fn aparecer_en_dos_mix_suma_relacion() {
        let comun = pista("x", "Comun", "C");
        let mixes = [
            mix("s1", vec![pista("z", "Z", "C"), pista("y", "Y", "C"), comun.clone()]),
            mix("s2", vec![pista("w", "W", "C"), pista("v", "V", "C"), comun]),
        ];

        let rel = relations(&mixes, &HashSet::new());
        let solo_uno = relations(&mixes[..1], &HashSet::new());

        assert!(rel["x"].r() > solo_uno["x"].r());
        assert!(rel["x"].r() < 1.0);
    }

    #[test]
    fn la_semilla_no_se_recomienda_a_si_misma() {
        let m = mix("s1", vec![pista("s1", "Semilla", "C"), pista("b", "B", "C")]);
        let rel = relations(&[m], &HashSet::new());

        assert!(!rel.contains_key("s1"));
        assert!(rel.contains_key("b"));
    }

    #[test]
    fn los_recopilatorios_y_los_cortes_no_pasan_el_filtro() {
        let mut t = pista("a", "Cancion normal", "C");
        assert_eq!(quality(&t), 1.0);

        t.duration = Some(27.0 * 60.0);
        assert_eq!(quality(&t), 0.0);

        t.duration = Some(30.0);
        assert_eq!(quality(&t), 0.0);

        t.duration = None;
        t.title = Some("111 - Milo J (Álbum Completo)".to_string());
        assert_eq!(quality(&t), 0.0);
    }

    #[test]
    fn la_huella_iguala_versiones_de_la_misma_cancion() {
        let a = song_key(Some("Yan Block - 444 (Video Oficial)"));
        let b = song_key(Some("444 - Yan Block [Letra]"));
        let c = song_key(Some("YAN BLOCK · 444 | Official Lyric Video"));

        assert_eq!(a, b);
        assert_eq!(a, c);
        assert_ne!(a, song_key(Some("Yan Block - 111 (Video Oficial)")));
    }

    #[test]
    fn el_canal_se_normaliza() {
        assert_eq!(artist_key(Some("Radiohead - Topic")), "radiohead");
        assert_eq!(artist_key(Some("RadioheadVEVO")), "radiohead");
        assert_eq!(artist_key(Some("  Radiohead  ")), "radiohead");
    }

    // --- Semillas ----------------------------------------------------------

    #[test]
    fn la_semilla_forzada_va_primera_y_no_se_repite() {
        let lib = vec![conocida("a", "C", 5.0, 0.0, 3), conocida("b", "C", 5.0, 0.0, 3)];
        let forzada = lib[0].track.clone();

        let seeds = choose_seeds(&lib, std::slice::from_ref(&forzada), 5, &HashSet::new(), AHORA, &mut Rng::seeded(1));

        assert_eq!(seeds[0].id, "a");
        assert_eq!(seeds.len(), 2, "solo quedaba b");
        assert_eq!(seeds[1].id, "b");
    }

    #[test]
    fn varias_semillas_forzadas_van_delante_sin_repetirse_y_se_completan() {
        let lib = vec![
            conocida("a", "C", 5.0, 0.0, 3),
            conocida("b", "C", 5.0, 0.0, 3),
            conocida("c", "C", 5.0, 0.0, 3),
        ];
        let buscadas = [pista("x", "X", "C"), lib[0].track.clone(), pista("x", "X", "C")];

        let seeds = choose_seeds(&lib, &buscadas, 1, &HashSet::new(), AHORA, &mut Rng::seeded(4));
        let ids: Vec<&str> = seeds.iter().map(|s| s.id.as_str()).collect();

        assert_eq!(&ids[..2], ["x", "a"], "las buscadas primero, sin repetir");
        assert_eq!(ids.len(), 3, "una mas de la biblioteca");
        assert!(["b", "c"].contains(&ids[2]), "y no repite una forzada");
    }

    #[test]
    fn las_semillas_evitadas_o_con_no_me_gusta_no_se_eligen() {
        let mut odiada = conocida("odiada", "C", 5.0, 0.0, 3);
        odiada.rating = Rating::Dislike;
        let lib = vec![odiada, conocida("evitada", "C", 5.0, 0.0, 3), conocida("ok", "C", 5.0, 0.0, 3)];
        let avoid: HashSet<String> = ["evitada".to_string()].into();

        for seed in 0..50 {
            let seeds = choose_seeds(&lib, &[], 3, &avoid, AHORA, &mut Rng::seeded(seed));
            assert_eq!(seeds.iter().map(|s| s.id.as_str()).collect::<Vec<_>>(), vec!["ok"]);
        }
    }

    #[test]
    fn precalienta_las_favoritas_primero_y_nunca_las_odiadas() {
        let mut odiada = conocida("odiada", "C", 9.0, 0.0, 3);
        odiada.rating = Rating::Dislike;
        let lib = vec![
            conocida("floja", "C", 0.0, 3.0, 3),
            odiada,
            conocida("top", "C", 9.0, 0.0, 3),
            conocida("media", "C", 2.0, 1.0, 3),
        ];

        assert_eq!(warm_seeds(&lib, 2, AHORA), vec!["top", "media"]);
        assert!(!warm_seeds(&lib, 10, AHORA).contains(&"odiada".to_string()));
    }

    #[test]
    fn una_radio_de_algo_nunca_oido_cuenta_como_gustada() {
        let lib = vec![conocida("a", "C", 0.0, 5.0, 3)];

        assert_eq!(seed_taste(&lib, &pista("nueva", "N", "C"), true, AHORA), RADIO_SEED_TASTE);
        assert_eq!(
            seed_taste(&lib, &lib[0].track, true, AHORA),
            RADIO_SEED_TASTE,
            "pedirla como radio le pone suelo"
        );
        assert!(seed_taste(&lib, &lib[0].track, false, AHORA) < 0.2);
    }

    // --- Sorteo ------------------------------------------------------------

    /// Biblioteca con una favorita, una saltada y una con no me gusta, cada una
    /// de un canal distinto para que la diversidad no interfiera.
    fn biblioteca() -> Vec<TrackStats> {
        let mut odiada = conocida("odiada", "Canal 3", 3.0, 0.0, 5);
        odiada.rating = Rating::Dislike;

        vec![
            conocida("favorita", "Canal 1", 8.0, 0.0, 5),
            conocida("saltada", "Canal 2", 0.0, 8.0, 5),
            odiada,
        ]
    }

    #[test]
    fn lo_marcado_con_no_me_gusta_nunca_sale() {
        let lib = biblioteca();
        let m = mix("favorita", vec![pista("odiada", "Cancion odiada", "Canal 3"), pista("n1", "N1", "Canal 9")]);

        for seed in 0..200 {
            let recs = recommend(&lib, std::slice::from_ref(&m), &params(Mode::Mix, 3, 0.5), &mut Rng::seeded(seed));
            assert!(recs.iter().all(|r| r.track.id != "odiada"));
        }
    }

    #[test]
    fn la_favorita_sale_mucho_mas_que_la_saltada() {
        let lib = biblioteca();
        let (mut fav, mut salt) = (0, 0);

        for seed in 0..2000 {
            let recs = recommend(&lib, &[], &params(Mode::Mix, 1, 0.0), &mut Rng::seeded(seed));
            match recs[0].track.id.as_str() {
                "favorita" => fav += 1,
                "saltada" => salt += 1,
                _ => {}
            }
        }

        // G = 0,9 frente a 0,1: al cuadrado, unas 80 veces mas probable.
        assert!(fav > salt * 20, "favorita {fav}, saltada {salt}");
        assert!(salt > 0, "pero la saltada no queda vetada para siempre");
    }

    #[test]
    fn con_aventura_cero_no_sale_nada_nuevo() {
        let lib = biblioteca();
        let m = mix("favorita", vec![pista("n1", "N1", "Canal 8"), pista("n2", "N2", "Canal 9")]);

        for seed in 0..100 {
            let recs = recommend(&lib, std::slice::from_ref(&m), &params(Mode::Mix, 2, 0.0), &mut Rng::seeded(seed));
            assert!(recs.iter().all(|r| r.seed.is_none() || r.track.id == "favorita"));
            assert!(recs.iter().all(|r| !r.track.id.starts_with('n')));
        }
    }

    #[test]
    fn con_aventura_uno_sale_lo_nuevo_mientras_quede() {
        let lib = biblioteca();
        let m = mix("favorita", vec![pista("n1", "N1", "Canal 8"), pista("n2", "N2", "Canal 9")]);

        let recs = recommend(&lib, &[m], &params(Mode::Mix, 3, 1.0), &mut Rng::seeded(7));

        let ids: Vec<&str> = recs.iter().map(|r| r.track.id.as_str()).collect();
        assert!(ids[..2].iter().all(|id| id.starts_with('n')), "{ids:?}");
        assert_eq!(recs.len(), 3, "acabadas las nuevas, sigue con conocidas");
        assert!(recs[0].reason.contains("Semilla"), "la razon nombra la semilla");
    }

    #[test]
    fn nunca_repite_la_misma_cancion_en_otra_version() {
        let lib = vec![conocida("fav", "Canal 1", 8.0, 0.0, 5)];
        let m = mix(
            "fav",
            vec![
                pista("v1", "Yan Block - 444 (Video Oficial)", "Canal 8"),
                pista("v2", "444 - Yan Block [Letra]", "Canal 9"),
            ],
        );

        for seed in 0..100 {
            let recs = recommend(&lib, std::slice::from_ref(&m), &params(Mode::Mix, 3, 1.0), &mut Rng::seeded(seed));
            let versiones = recs.iter().filter(|r| r.track.id.starts_with('v')).count();
            assert_eq!(versiones, 1, "solo una de las dos versiones");
        }
    }

    #[test]
    fn una_biblioteca_pequena_sigue_pudiendo_recomendar_lo_conocido() {
        // Oida ayer y entre las 20 ultimas: la frescura la frena, pero no la veta.
        let lib = vec![conocida("a", "Canal 1", 5.0, 0.0, 1)];

        let recs = recommend(&lib, &[], &params(Mode::Mix, 1, 0.0), &mut Rng::seeded(1));
        assert_eq!(recs[0].track.id, "a");
    }

    #[test]
    fn no_recomienda_otra_version_de_lo_que_acaba_de_sonar() {
        let mut oida = conocida("orig", "Canal 1", 5.0, 0.0, 0);
        oida.track.title = Some("Yan Block - 444 (Video Oficial)".to_string());
        oida.last_played = AHORA - 60;

        let m = mix(
            "orig",
            vec![pista("letra", "444 - Yan Block [Letra]", "Canal 9"), pista("otra", "Otra", "Canal 8")],
        );

        for seed in 0..100 {
            let recs = recommend(
                std::slice::from_ref(&oida),
                std::slice::from_ref(&m),
                &params(Mode::Mix, 3, 1.0),
                &mut Rng::seeded(seed),
            );
            assert!(recs.iter().all(|r| r.track.id != "letra"));
        }
    }

    #[test]
    fn un_mix_lleno_del_mismo_artista_no_lo_pone_tres_veces_seguidas() {
        // Seis del mismo canal y dos de otros, todas igual de relacionadas:
        // lo tipico del Mix de una cancion.
        let mut relacionadas: Vec<SearchResult> =
            (0..6).map(|i| pista(&format!("m{i}"), &format!("Tema {i}"), "MILO J")).collect();
        relacionadas.push(pista("b1", "Otro", "Bizarrap"));
        relacionadas.push(pista("n1", "Otro mas", "Nicki Nicole"));
        let m = mix("semilla", relacionadas);

        let mut tres_seguidas = 0;
        for seed in 0..300 {
            let recs = recommend(&[], std::slice::from_ref(&m), &params(Mode::Radio, 3, 1.0), &mut Rng::seeded(seed));
            if recs.iter().all(|r| r.track.id.starts_with('m')) {
                tres_seguidas += 1;
            }
        }

        // Sin la penalizacion acumulativa pasaba en torno a la mitad de las veces.
        assert!(tres_seguidas < 45, "tres seguidas en {tres_seguidas}/300");
    }

    #[test]
    fn lo_excluido_no_sale() {
        let lib = biblioteca();
        let mut p = params(Mode::Mix, 5, 0.0);
        p.exclude.insert("favorita".to_string());

        let recs = recommend(&lib, &[], &p, &mut Rng::seeded(3));
        assert!(recs.iter().all(|r| r.track.id != "favorita"));
    }

    #[test]
    fn en_radio_solo_sale_lo_relacionado() {
        let lib = biblioteca();
        let m = mix("semilla", vec![pista("n1", "N1", "Canal 8"), pista("n2", "N2", "Canal 9")]);

        let recs = recommend(&lib, &[m], &params(Mode::Radio, 10, 0.3), &mut Rng::seeded(5));
        let ids: HashSet<&str> = recs.iter().map(|r| r.track.id.as_str()).collect();

        assert_eq!(ids, HashSet::from(["n1", "n2"]), "la favorita no esta en el Mix");
    }

    #[test]
    fn sin_candidatas_devuelve_menos_en_vez_de_colgarse() {
        let recs = recommend(&[], &[], &params(Mode::Mix, 10, 0.5), &mut Rng::seeded(1));
        assert!(recs.is_empty());
    }

    #[test]
    fn la_ruleta_respeta_los_pesos() {
        let mut rng = Rng::seeded(42);
        let mut cuenta = [0; 3];

        for _ in 0..10_000 {
            cuenta[roulette(&[1.0, 0.0, 3.0], &mut rng).unwrap()] += 1;
        }

        assert_eq!(cuenta[1], 0, "peso cero nunca sale");
        let ratio = cuenta[2] as f64 / cuenta[0] as f64;
        assert!((ratio - 3.0).abs() < 0.3, "ratio {ratio}");
    }
}
