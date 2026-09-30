//! Consulta letras en lrclib por título y artista, comparando la duración
//! para elegir la versión. Guarda los resultados, incluidos los vacíos,
//! en memoria durante la sesión.

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use percent_encoding::{utf8_percent_encode, NON_ALPHANUMERIC};
use serde::{Deserialize, Serialize};

const SEARCH_URL: &str = "https://lrclib.net/api/search?q=";

/// lrclib pide identificarse con el nombre de la app.
const USER_AGENT: &str = "Antares/0.1 (reproductor de musica)";

/// Diferencia de duracion aceptable entre el video y la letra, en segundos.
/// Con mas margen empieza a colarse la version en directo o el remix.
const MAX_DURATION_DIFF: f64 = 10.0;

/// Frases que YouTube añade al titulo y que no forman parte de la cancion.
const NOISE: [&str; 14] = [
    "official music video",
    "official video",
    "official audio",
    "official lyric video",
    "video oficial",
    "audio oficial",
    "lyric video",
    "video lyric",
    "video lyrics",
    "visualizer",
    "lyrics",
    "letra",
    "official",
    "oficial",
];

#[derive(Clone, Serialize)]
pub struct LyricLine {
    /// Segundo en que empieza el verso.
    pub time: f64,
    pub text: String,
}

#[derive(Clone, Serialize)]
pub struct Lyrics {
    /// Versos con tiempo, si la letra es sincronizada.
    pub synced: Vec<LyricLine>,
    /// La letra sin tiempos, para cuando no hay sincronizada.
    pub plain: Option<String>,
    pub instrumental: bool,
    /// Que encontro lrclib, para que se vea si acerto con la cancion.
    pub matched: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Candidate {
    track_name: Option<String>,
    artist_name: Option<String>,
    duration: Option<f64>,
    plain_lyrics: Option<String>,
    synced_lyrics: Option<String>,
    #[serde(default)]
    instrumental: bool,
}

// ---------------------------------------------------------------------------
// Limpieza del titulo
// ---------------------------------------------------------------------------

/// Quita lo que va entre parentesis o corchetes: "(Video Oficial)", "[Letra]".
fn strip_brackets(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut depth = 0usize;

    for c in text.chars() {
        match c {
            '(' | '[' => depth += 1,
            ')' | ']' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }

    out
}

// Las busquedas sin mayusculas usan `to_ascii_lowercase`, que conserva la
// longitud en bytes: los indices que encuentra valen tal cual sobre el texto
// original. `to_lowercase` no lo garantiza (algunas letras cambian de tamaño),
// y las frases que se buscan son todas ASCII.

/// Corta en "ft." / "feat." / "prod.": los invitados no suelen estar en el
/// titulo que lrclib conoce.
fn cut_featuring(text: &str) -> &str {
    let lower = text.to_ascii_lowercase();

    [" ft.", " ft ", " feat.", " feat ", " prod.", " prod "]
        .iter()
        .filter_map(|marker| lower.find(marker))
        .min()
        .map_or(text, |i| &text[..i])
}

/// Quita las frases de relleno, sin importar mayusculas.
fn strip_noise(text: &str) -> String {
    let mut out = text.to_string();

    for phrase in NOISE {
        while let Some(i) = out.to_ascii_lowercase().find(phrase) {
            out.replace_range(i..i + phrase.len(), " ");
        }
    }

    out
}

fn clean_artist(uploader: &str) -> String {
    let lower = uploader.to_lowercase();
    let trimmed = lower.trim_end_matches(" - topic").replace("vevo", "");
    trimmed.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Lo que se le pregunta a lrclib a partir de un titulo de YouTube.
///
/// "Yan Block - 444 (Video Oficial)" → "Yan Block 444". Si el titulo no trae
/// el artista (no hay " - "), se toma del canal: "Fruto" de "Bizarrap" →
/// "bizarrap Fruto".
pub fn search_query(title: &str, uploader: Option<&str>) -> String {
    let base = strip_noise(cut_featuring(&strip_brackets(title)));
    let has_artist = base.contains(" - ");

    let flat: String = base
        .chars()
        .map(|c| if matches!(c, '|' | '·' | '"' | '“' | '”' | '-') { ' ' } else { c })
        .collect();
    let flat = flat.split_whitespace().collect::<Vec<_>>().join(" ");

    match uploader.filter(|_| !has_artist).map(clean_artist) {
        Some(artist) if !artist.is_empty() => format!("{artist} {flat}"),
        _ => flat,
    }
}

// ---------------------------------------------------------------------------
// LRC
// ---------------------------------------------------------------------------

/// `mm:ss.xx` → segundos.
fn parse_timestamp(tag: &str) -> Option<f64> {
    let (min, sec) = tag.split_once(':')?;
    let min: f64 = min.trim().parse().ok()?;
    let sec: f64 = sec.trim().parse().ok()?;
    Some(min * 60.0 + sec)
}

/// Lee un LRC. Una linea puede llevar varias marcas de tiempo (un estribillo
/// que se repite); las etiquetas de metadatos ("[ar:Artista]") se ignoran.
pub fn parse_lrc(text: &str) -> Vec<LyricLine> {
    let mut lines = Vec::new();

    for raw in text.lines() {
        let mut rest = raw.trim();
        let mut times = Vec::new();

        while let Some(inner) = rest.strip_prefix('[') {
            let Some(close) = inner.find(']') else { break };
            if let Some(t) = parse_timestamp(&inner[..close]) {
                times.push(t);
            }
            rest = &inner[close + 1..];
        }

        let text = rest.trim().to_string();
        for time in times {
            lines.push(LyricLine { time, text: text.clone() });
        }
    }

    lines.sort_by(|a, b| a.time.total_cmp(&b.time));
    lines
}

// ---------------------------------------------------------------------------
// Eleccion
// ---------------------------------------------------------------------------

/// La mejor candidata: con letra, de duracion parecida, y sincronizada si hay.
fn pick(candidates: Vec<Candidate>, duration: Option<f64>) -> Option<Candidate> {
    candidates
        .into_iter()
        .filter(|c| c.instrumental || c.synced_lyrics.is_some() || c.plain_lyrics.is_some())
        .filter_map(|c| {
            let diff = match (duration, c.duration) {
                (Some(ours), Some(theirs)) => {
                    let d = (ours - theirs).abs();
                    if d > MAX_DURATION_DIFF {
                        return None;
                    }
                    d
                }
                // Sin una de las dos duraciones no se puede comprobar: vale,
                // pero por detras de las que si encajan.
                _ => MAX_DURATION_DIFF / 2.0,
            };

            let unsynced = if c.synced_lyrics.is_some() { 0.0 } else { 20.0 };
            Some((diff + unsynced, c))
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, c)| c)
}

fn into_lyrics(c: Candidate) -> Lyrics {
    let matched = match (&c.artist_name, &c.track_name) {
        (Some(a), Some(t)) => format!("{a} — {t}"),
        (None, Some(t)) => t.clone(),
        _ => String::new(),
    };

    Lyrics {
        synced: c.synced_lyrics.as_deref().map(parse_lrc).unwrap_or_default(),
        plain: c.plain_lyrics,
        instrumental: c.instrumental,
        matched,
    }
}

// ---------------------------------------------------------------------------
// Red y cache
// ---------------------------------------------------------------------------

fn client() -> &'static reqwest::Client {
    static CLIENT: OnceLock<reqwest::Client> = OnceLock::new();

    CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .user_agent(USER_AGENT)
            .timeout(Duration::from_secs(10))
            .build()
            .unwrap_or_default()
    })
}

#[derive(Default)]
pub struct LyricsCache {
    entries: Mutex<HashMap<String, Option<Lyrics>>>,
}

impl LyricsCache {
    /// La letra de una pista, o `None` si lrclib no la tiene.
    pub async fn get(
        &self,
        id: &str,
        title: &str,
        uploader: Option<&str>,
        duration: Option<f64>,
    ) -> Result<Option<Lyrics>, String> {
        if let Some(hit) = self.entries.lock().ok().and_then(|e| e.get(id).cloned()) {
            return Ok(hit);
        }

        let query = search_query(title, uploader);
        if query.is_empty() {
            return Ok(None);
        }

        let url = format!("{SEARCH_URL}{}", utf8_percent_encode(&query, NON_ALPHANUMERIC));
        let body = client()
            .get(url)
            .send()
            .await
            .and_then(|r| r.error_for_status())
            .map_err(|e| format!("No se pudo consultar las letras: {e}"))?
            .text()
            .await
            .map_err(|e| format!("No se pudo leer la respuesta de letras: {e}"))?;

        let candidates: Vec<Candidate> =
            serde_json::from_str(&body).map_err(|e| format!("Respuesta de letras ilegible: {e}"))?;

        let lyrics = pick(candidates, duration).map(into_lyrics);

        // Los fallos de red no llegan aqui (salen arriba con `?`): lo que se
        // guarda como "no hay" es un "no hay" de verdad.
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(id.to_string(), lyrics.clone());
        }

        Ok(lyrics)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn limpia_titulos_de_youtube() {
        assert_eq!(search_query("Yan Block - 444 (Video Oficial)", Some("Yan Block")), "Yan Block 444");
        assert_eq!(
            search_query("MILO J - CARENCIAS DE CORDURA ft. Yami Safdie (Video Oficial)", Some("MILO J")),
            "MILO J CARENCIAS DE CORDURA"
        );
        assert_eq!(
            search_query("Radiohead - Creep [Official Music Video]", Some("RadioheadVEVO")),
            "Radiohead Creep"
        );
    }

    #[test]
    fn sin_artista_en_el_titulo_lo_toma_del_canal() {
        assert_eq!(search_query("Fruto", Some("Bizarrap")), "bizarrap Fruto");
        assert_eq!(search_query("La x4", Some("Rari - Topic")), "rari La x4");
    }

    #[test]
    fn las_frases_de_relleno_se_quitan_sin_importar_mayusculas() {
        assert_eq!(search_query("Artista - Tema | OFFICIAL VIDEO", None), "Artista Tema");
        assert_eq!(search_query("Artista - Tema (Letra)", None), "Artista Tema");
    }

    #[test]
    fn los_acentos_no_rompen_la_limpieza() {
        assert_eq!(search_query("Canción - Año Nuevo (Vídeo) ft. Él", None), "Canción Año Nuevo");
    }

    #[test]
    fn lee_un_lrc_con_tiempos_y_metadatos() {
        let lrc = "[ar:Artista]\n[00:12.50] Primer verso\n[01:02.00][02:10.00] Estribillo\n[00:30.00]\n";
        let lines = parse_lrc(lrc);

        let tiempos: Vec<f64> = lines.iter().map(|l| l.time).collect();
        assert_eq!(tiempos, vec![12.5, 30.0, 62.0, 130.0]);
        assert_eq!(lines[0].text, "Primer verso");
        assert_eq!(lines[1].text, "", "los silencios se conservan");
        assert_eq!(lines[3].text, "Estribillo", "un verso con dos tiempos sale dos veces");
    }

    fn candidata(duracion: Option<f64>, sincronizada: bool) -> Candidate {
        Candidate {
            track_name: Some("T".into()),
            artist_name: Some("A".into()),
            duration: duracion,
            plain_lyrics: Some("letra".into()),
            synced_lyrics: sincronizada.then(|| "[00:01.00] hola".into()),
            instrumental: false,
        }
    }

    #[test]
    fn elige_la_de_duracion_parecida_y_sincronizada() {
        let elegida = pick(
            vec![candidata(Some(300.0), true), candidata(Some(181.0), false), candidata(Some(182.0), true)],
            Some(180.0),
        )
        .unwrap();

        assert_eq!(elegida.duration, Some(182.0));
        assert!(elegida.synced_lyrics.is_some());
    }

    #[test]
    fn descarta_las_de_duracion_muy_distinta() {
        // Una version en directo de 6 min para un video de 3: no es esa letra.
        assert!(pick(vec![candidata(Some(360.0), true)], Some(180.0)).is_none());
    }

    #[test]
    fn sin_letra_no_hay_candidata() {
        let vacia = Candidate {
            plain_lyrics: None,
            synced_lyrics: None,
            ..candidata(Some(180.0), false)
        };
        assert!(pick(vec![vacia], Some(180.0)).is_none());
    }
}
