//! Tipos de pistas y resultados compartidos por los proveedores de audio,
//! la caché, la persistencia y los comandos del frontend.

use serde::{Deserialize, Serialize};

/// Una pista resuelta: la URL de audio mas lo que yt-dlp sabe de ella.
///
/// Todos los metadatos son opcionales a proposito. Un directo no tiene duracion,
/// algunos videos no traen miniatura, y nada de eso deberia impedir reproducir.
#[derive(Clone, Serialize)]
pub struct TrackInfo {
    /// URL directa del audio. Caduca en horas: es la unica parte perecedera.
    pub url: String,
    pub title: Option<String>,
    pub uploader: Option<String>,
    /// Duracion en segundos.
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    /// Identificador estable usado para guardar la pista y volver a resolver su audio.
    pub id: Option<String>,
}

// Este constructor se usa en las pruebas de la cache.
#[cfg(test)]
impl TrackInfo {
    /// Para cuando solo tenemos la URL y ningun metadato.
    pub fn from_url(url: String) -> Self {
        Self {
            url,
            title: None,
            uploader: None,
            duration: None,
            thumbnail: None,
            id: None,
        }
    }
}

/// Una pista ya escuchada.
///
/// Reutiliza `SearchResult` con `#[serde(flatten)]`, asi que en JSON sale plana
/// y el frontend puede pintar una fila del historial con exactamente el mismo
/// codigo que una de busqueda.
#[derive(Clone, Serialize, Deserialize)]
pub struct HistoryEntry {
    #[serde(flatten)]
    pub track: SearchResult,
    /// Timestamp unix de la ultima vez que sono.
    pub played_at: u64,
}

/// Un candidato de la lista de busqueda.
///
/// No lleva URL de audio a proposito: sale de una busqueda "plana", donde yt-dlp
/// lista los resultados sin entrar en cada video. Esa es justo la razon de que
/// pedir cinco cueste casi lo mismo que pedir uno. La URL se resuelve despues,
/// solo para el que el usuario elija.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub title: Option<String>,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
    /// URL de YouTube lista para pasarsela a `get_audio_url`.
    pub watch_url: String,
}

impl SearchResult {
    /// La URL de reproduccion no se guarda en disco por separado: se deriva del
    /// id, que es el unico dato de YouTube que no caduca nunca.
    pub fn watch_url_for(id: &str) -> String {
        format!("https://www.youtube.com/watch?v={id}")
    }
}

/// Una pista tal como la manda el frontend a los comandos de biblioteca.
///
/// Es un `SearchResult` sin `watch_url`, porque esa se deriva del id. Serde
/// ignora los campos que sobren, asi que el frontend puede mandar directamente
/// una fila de cualquier lista (que trae `watch_url` y hasta `played_at`).
#[derive(Deserialize)]
pub struct TrackInput {
    pub id: String,
    pub title: Option<String>,
    pub uploader: Option<String>,
    pub duration: Option<f64>,
    pub thumbnail: Option<String>,
}

impl TrackInput {
    /// Sin id no hay pista: es lo unico con lo que podriamos volver a
    /// reproducirla.
    pub fn into_track(self) -> Result<SearchResult, String> {
        let id = self.id.trim().to_string();

        if id.is_empty() {
            return Err("La pista no tiene id.".to_string());
        }

        Ok(SearchResult {
            watch_url: SearchResult::watch_url_for(&id),
            id,
            title: self.title,
            uploader: self.uploader,
            duration: self.duration,
            thumbnail: self.thumbnail,
        })
    }
}
