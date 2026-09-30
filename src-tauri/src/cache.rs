//! Caché en memoria de URLs de audio y su caducidad.
//! entries guarda resultados; in_flight coordina la resolución por clave
//! para compartir el trabajo entre prefetch y reproducción.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex as AsyncMutex;

use crate::track::TrackInfo;

/// Margen de seguridad: descartamos la entrada un poco antes de que la URL
/// caduque de verdad, para no entregar un enlace que muera a mitad de cancion.
const EXPIRY_MARGIN_SECS: u64 = 300;

/// Si no logramos leer el `expire=` de la URL, asumimos una vida corta.
const FALLBACK_TTL_SECS: u64 = 1_800;

struct CacheEntry {
    track: TrackInfo,
    /// Timestamp unix en el que la URL firmada deja de ser valida.
    expires_at: u64,
}

/// Caché compartida por Tauri. Los mutex de los mapas no se mantienen durante await.
/// El turno por clave usa un mutex asíncrono porque dura toda la resolución.
#[derive(Default)]
pub struct AppCache {
    entries: Mutex<HashMap<String, CacheEntry>>,
    in_flight: Mutex<HashMap<String, Arc<AsyncMutex<()>>>>,
}

impl AppCache {
    /// Devuelve la pista si su URL sigue siendo utilizable. De paso limpia la
    /// entrada caducada, para que el mapa no crezca indefinidamente.
    ///
    /// Cachear la pista entera y no solo la URL importa: los metadatos vienen de
    /// la misma invocacion de yt-dlp, asi que un acierto de cache devuelve
    /// tambien titulo y caratula sin tocar la red.
    pub fn get(&self, key: &str) -> Option<TrackInfo> {
        let mut entries = self.entries.lock().ok()?;

        if let Some(entry) = entries.get(key) {
            if entry.expires_at.saturating_sub(EXPIRY_MARGIN_SECS) > now_secs() {
                return Some(entry.track.clone());
            }
        }

        entries.remove(key);
        None
    }

    pub fn put(&self, key: &str, track: &TrackInfo) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.insert(
                key.to_string(),
                CacheEntry {
                    expires_at: parse_expiry(&track.url),
                    track: track.clone(),
                },
            );
        }
    }

    pub fn forget(&self, key: &str) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.remove(key);
        }
    }

    /// Olvida todas las URLs: al cambiar la calidad de audio, las guardadas son
    /// de la otra.
    pub fn clear(&self) {
        if let Ok(mut entries) = self.entries.lock() {
            entries.clear();
        }
    }

    /// El turno para resolver esta clave. Todos los que piden la misma clave
    /// reciben el mismo turno: quien lo bloquee primero resuelve, y el resto
    /// espera a que termine y se lleva su resultado de la cache.
    ///
    /// Hay que devolverlo con `finish_turn` al acabar, o la entrada se queda en
    /// el mapa para siempre.
    pub fn turn(&self, key: &str) -> Arc<AsyncMutex<()>> {
        match self.in_flight.lock() {
            Ok(mut map) => map.entry(key.to_string()).or_default().clone(),
            // Mutex envenenado: un turno propio que no comparte nadie. Preferimos
            // duplicar trabajo antes que bloquear al usuario.
            Err(_) => Arc::default(),
        }
    }

    /// Devuelve un turno. Si nadie mas lo tiene ni lo esta esperando, se borra
    /// del mapa; si alguien lo espera, se queda para el.
    ///
    /// La cuenta de referencias se mira con el mapa bloqueado, que es tambien
    /// donde `turn` las crea: asi nadie puede engancharse entre la comprobacion
    /// y el borrado.
    pub fn finish_turn(&self, key: &str, turn: Arc<AsyncMutex<()>>) {
        let Ok(mut map) = self.in_flight.lock() else {
            return;
        };

        let is_ours = map.get(key).is_some_and(|t| Arc::ptr_eq(t, &turn));

        // Dos referencias: la del mapa y la nuestra. Mas que eso es que alguien
        // espera.
        if is_ours && Arc::strong_count(&turn) <= 2 {
            map.remove(key);
        }
    }

    /// Si alguien esta resolviendo esta clave justo ahora.
    pub fn is_in_flight(&self, key: &str) -> bool {
        self.in_flight
            .lock()
            .ok()
            .and_then(|map| map.get(key).map(|turn| turn.try_lock().is_err()))
            .unwrap_or(false)
    }
}

/// Normaliza la busqueda para que "  Radiohead   Creep " y "radiohead creep"
/// compartan entrada.
///
/// El prefijo separa modo rapido y seguro: si el rapido entrego una URL que el
/// navegador rechazo, no queremos servirla otra vez desde cache cuando el
/// frontend pide explicitamente el modo seguro.
pub fn cache_key(query: &str, safe: bool) -> String {
    let normalized = query
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase();

    let prefix = if safe { "safe|" } else { "fast|" };
    format!("{prefix}{normalized}")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// googlevideo firma cada URL con su propia caducidad. Leerla es mucho mejor
/// que inventarse un TTL fijo: sabemos exactamente cuanto dura el enlace.
///
/// Aparece como query param (`?expire=1712345678`) y en algunas variantes como
/// segmento de ruta (`/expire/1712345678/`).
fn parse_expiry(url: &str) -> u64 {
    let from_query = url
        .split(['?', '&'])
        .find_map(|part| part.strip_prefix("expire="));

    let from_path = url
        .split('/')
        .skip_while(|segment| *segment != "expire")
        .nth(1);

    from_query
        .or(from_path)
        .and_then(|value| value.split('/').next())
        .and_then(|value| value.parse::<u64>().ok())
        .filter(|expiry| *expiry > now_secs())
        .unwrap_or_else(|| now_secs() + FALLBACK_TTL_SECS)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Lejos en el futuro, para que las pruebas no caduquen con el tiempo.
    const FUTURO: u64 = 4_102_444_800; // 2100-01-01

    #[test]
    fn la_clave_normaliza_espacios_y_mayusculas() {
        assert_eq!(
            cache_key("  Radiohead   CREEP ", false),
            cache_key("radiohead creep", false)
        );
    }

    #[test]
    fn los_modos_rapido_y_seguro_no_comparten_clave() {
        assert_ne!(cache_key("creep", false), cache_key("creep", true));
    }

    #[test]
    fn lee_la_caducidad_del_query_param() {
        let url = format!("https://r.googlevideo.com/videoplayback?expire={FUTURO}&ei=x");
        assert_eq!(parse_expiry(&url), FUTURO);
    }

    #[test]
    fn lee_la_caducidad_del_segmento_de_ruta() {
        let url = format!("https://host/expire/{FUTURO}/ei/x/videoplayback");
        assert_eq!(parse_expiry(&url), FUTURO);
    }

    #[test]
    fn sin_caducidad_legible_usa_el_ttl_de_reserva() {
        let expiry = parse_expiry("https://host/videoplayback?ei=x");
        let esperado = now_secs() + FALLBACK_TTL_SECS;
        // Margen de un segundo por si el reloj avanza entre ambas llamadas.
        assert!(expiry.abs_diff(esperado) <= 1);
    }

    #[test]
    fn una_caducidad_ya_pasada_se_trata_como_ilegible() {
        let expiry = parse_expiry("https://host/videoplayback?expire=1000");
        assert!(expiry > now_secs());
    }

    fn pista(expire: u64) -> TrackInfo {
        let mut track =
            TrackInfo::from_url(format!("https://host/videoplayback?expire={expire}"));
        track.title = Some("Weird Fishes".to_string());
        track
    }

    #[test]
    fn guarda_y_devuelve_una_pista_vigente() {
        let cache = AppCache::default();
        cache.put("k", &pista(FUTURO));

        let recuperada = cache.get("k").expect("deberia seguir vigente");
        assert_eq!(recuperada.url, pista(FUTURO).url);
        // Los metadatos tambien sobreviven al viaje por la cache.
        assert_eq!(recuperada.title.as_deref(), Some("Weird Fishes"));
    }

    #[test]
    fn no_devuelve_una_pista_a_punto_de_caducar() {
        let cache = AppCache::default();
        // Dentro del margen de seguridad: aun no ha caducado, pero casi.
        cache.put("k", &pista(now_secs() + 60));

        assert!(cache.get("k").is_none());
    }

    #[test]
    fn forget_borra_la_entrada() {
        let cache = AppCache::default();
        cache.put("k", &pista(FUTURO));

        cache.forget("k");
        assert!(cache.get("k").is_none());
    }

    #[test]
    fn la_misma_clave_comparte_turno() {
        let cache = AppCache::default();

        let a = cache.turn("k");
        let b = cache.turn("k");
        let otra = cache.turn("otra");

        assert!(Arc::ptr_eq(&a, &b), "misma clave, mismo turno");
        assert!(!Arc::ptr_eq(&a, &otra), "claves distintas no se esperan entre si");
    }

    #[test]
    fn una_clave_en_resolucion_se_ve_ocupada() {
        let cache = AppCache::default();
        let turn = cache.turn("k");

        assert!(!cache.is_in_flight("k"), "pedir el turno no es usarlo");

        let guard = turn.try_lock().unwrap();
        assert!(cache.is_in_flight("k"));

        drop(guard);
        cache.finish_turn("k", turn);
        assert!(!cache.is_in_flight("k"));
    }

    #[test]
    fn el_turno_no_se_borra_mientras_alguien_lo_espera() {
        let cache = AppCache::default();

        let primero = cache.turn("k");
        let segundo = cache.turn("k");

        cache.finish_turn("k", primero);
        assert!(
            cache.in_flight.lock().unwrap().contains_key("k"),
            "el segundo sigue esperando: la entrada debe quedarse"
        );

        cache.finish_turn("k", segundo);
        assert!(
            cache.in_flight.lock().unwrap().is_empty(),
            "sin nadie esperando, el mapa queda limpio"
        );
    }

    #[tokio::test]
    async fn el_segundo_espera_al_primero_y_encuentra_la_pista() {
        let cache = Arc::new(AppCache::default());

        let turn = cache.turn("k");
        let guard = turn.clone().lock_owned().await;

        // El segundo pide el mismo turno y se queda esperando.
        let esperando = {
            let cache = cache.clone();
            tokio::spawn(async move {
                let turn = cache.turn("k");
                let resultado = {
                    let _guard = turn.lock().await;
                    cache.get("k")
                };
                cache.finish_turn("k", turn);
                resultado
            })
        };

        // Damos tiempo a que se ponga a esperar; no debe haber terminado.
        tokio::time::sleep(std::time::Duration::from_millis(30)).await;
        assert!(!esperando.is_finished());

        // El primero resuelve, guarda y suelta el turno.
        cache.put("k", &pista(FUTURO));
        drop(guard);
        cache.finish_turn("k", turn);

        let recuperada = esperando.await.unwrap().expect("debe llegarle la pista");
        assert_eq!(recuperada.title.as_deref(), Some("Weird Fishes"));
        assert!(cache.in_flight.lock().unwrap().is_empty());
    }
}
