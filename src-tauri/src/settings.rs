//! Preferencias en settings.json, validadas por el esquema del frontend.
//! Rust lee los ajustes necesarios para el arranque, la ventana y el audio.
//! El fondo se guarda aparte en wallpaper.json para evitar reescribir la imagen
//! en cada cambio de preferencias.

use std::path::PathBuf;
use std::sync::Mutex;

use serde_json::Value;

use crate::store::{read_json, Persister};

const SETTINGS_FILE: &str = "settings.json";
const WALLPAPER_FILE: &str = "wallpaper.json";

/// Tope de las preferencias serializadas. Lo normal son 2-3 KB; mas de esto es
/// un error del frontend o un fichero importado que no es de Antares.
const MAX_SETTINGS_BYTES: usize = 256 * 1024;

/// Tope de la imagen de fondo, como data URL. El frontend la reduce a 1920 px
/// en JPEG, que se queda en unos cientos de KB.
const MAX_WALLPAPER_BYTES: usize = 12 * 1024 * 1024;

/// Zoom permitido de la interfaz.
const MIN_ZOOM: f64 = 0.75;
const MAX_ZOOM: f64 = 1.75;

/// Temas con fondo claro: la barra de titulo de Windows va clara con ellos.
const LIGHT_THEMES: &[&str] = &["light", "paper"];

/// Por encima de esta luminancia un fondo se lee mejor con texto negro que con
/// blanco. Es el mismo umbral que `LIGHT_LUMINANCE` en `themes.js`.
const LIGHT_LUMINANCE: f64 = 0.18;

pub struct Settings {
    /// `None` hasta que el frontend guarde por primera vez: asi sabe que tiene
    /// que traerse las preferencias antiguas de localStorage.
    value: Mutex<Option<Value>>,
    wallpaper: Mutex<Option<String>>,
    file: Persister,
    wallpaper_file: Persister,
}

/// Como debe verse la barra de titulo de Windows.
#[derive(Debug, PartialEq, Eq, Clone, Copy)]
pub enum WindowTone {
    Dark,
    Light,
    /// La del sistema: el tema "Segun Windows".
    System,
}

impl Settings {
    pub fn load(dir: PathBuf) -> Self {
        let value: Option<Value> =
            read_json::<Value>(&dir.join(SETTINGS_FILE)).filter(Value::is_object);
        let wallpaper: Option<String> =
            read_json::<Option<String>>(&dir.join(WALLPAPER_FILE)).flatten().filter(|w| valid_wallpaper(w).is_ok());

        Self {
            value: Mutex::new(value),
            wallpaper: Mutex::new(wallpaper),
            file: Persister::new(dir.join(SETTINGS_FILE)),
            wallpaper_file: Persister::new(dir.join(WALLPAPER_FILE)),
        }
    }

    pub fn get(&self) -> Option<Value> {
        self.value.lock().ok()?.clone()
    }

    pub fn set(&self, value: Value) -> Result<(), String> {
        validate(&value)?;

        let mut current = self.value.lock().map_err(|_| "ajustes bloqueados".to_string())?;
        *current = Some(value.clone());
        self.file.save(value);
        Ok(())
    }

    #[cfg(mobile)]
    pub(crate) fn flush_mobile(&self) -> Result<(), String> {
        if let Some(value) = self.value.lock().map_err(|_| "ajustes bloqueados")?.clone() {
            self.file.save_sync(value).map_err(|e| e.to_string())?;
        }
        self.wallpaper_file.save_sync(self.wallpaper()).map_err(|e| e.to_string())
    }
    #[cfg(mobile)]
    pub(crate) fn reload_mobile(&self, dir: PathBuf) -> Result<(), String> {
        let next = Self::load(dir.clone());
        let mut value = self.value.lock().map_err(|_| "ajustes bloqueados")?;
        let mut wallpaper = self.wallpaper.lock().map_err(|_| "fondo bloqueado")?;
        self.file.retarget(dir.join(SETTINGS_FILE)); self.wallpaper_file.retarget(dir.join(WALLPAPER_FILE));
        *value = next.value.into_inner().map_err(|_| "ajustes bloqueados")?;
        *wallpaper = next.wallpaper.into_inner().map_err(|_| "fondo bloqueado")?;
        Ok(())
    }
    /// Lee algo de los ajustes guardados, o `default` si aun no hay.
    fn read<T>(&self, f: impl FnOnce(&Value) -> T, default: T) -> T {
        self.value
            .lock()
            .ok()
            .and_then(|v| v.as_ref().map(f))
            .unwrap_or(default)
    }

    pub fn close_to_tray(&self) -> bool {
        self.read(close_to_tray, true)
    }

    pub fn zoom(&self) -> f64 {
        self.read(zoom, 1.0)
    }

    pub fn window_tone(&self) -> WindowTone {
        self.read(window_tone, WindowTone::Dark)
    }

    /// Audio en calidad de ahorro de datos.
    pub fn data_saver(&self) -> bool {
        self.read(|v| v.pointer("/playback/quality").and_then(Value::as_str) == Some("saver"), false)
    }

    /// Abrir Antares al iniciar Windows.
    pub fn autostart(&self) -> bool {
        self.read(|v| flag(v, "/system/autostart", false), false)
    }

    /// Al abrirse con Windows, quedarse en la bandeja sin enseñar la ventana.
    pub fn start_hidden(&self) -> bool {
        self.read(|v| flag(v, "/system/startHidden", false), false)
    }

    // --- Imagen de fondo ----------------------------------------------------

    pub fn wallpaper(&self) -> Option<String> {
        self.wallpaper.lock().ok()?.clone()
    }

    /// Guarda la imagen de fondo, o la borra con `None`.
    pub fn set_wallpaper(&self, image: Option<String>) -> Result<(), String> {
        if let Some(image) = &image {
            valid_wallpaper(image)?;
        }

        let mut current = self
            .wallpaper
            .lock()
            .map_err(|_| "ajustes bloqueados".to_string())?;
        *current = image.clone();
        // `null` en disco: al leerlo, `read_json::<String>` falla y queda en None.
        self.wallpaper_file.save(image);
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Lectura de los pocos campos que Rust necesita
// ---------------------------------------------------------------------------

pub(crate) fn validate(value: &Value) -> Result<(), String> {
    if !value.is_object() {
        return Err("Los ajustes no tienen el formato esperado.".to_string());
    }

    let size = serde_json::to_vec(value).map(|b| b.len()).unwrap_or(usize::MAX);
    if size > MAX_SETTINGS_BYTES {
        return Err("Los ajustes son demasiado grandes.".to_string());
    }

    Ok(())
}

pub(crate) fn valid_wallpaper(image: &str) -> Result<(), String> {
    if !image.starts_with("data:image/") {
        return Err("La imagen de fondo no es una imagen.".to_string());
    }
    if image.len() > MAX_WALLPAPER_BYTES {
        return Err("La imagen de fondo es demasiado grande.".to_string());
    }
    Ok(())
}

fn flag(value: &Value, pointer: &str, default: bool) -> bool {
    value.pointer(pointer).and_then(Value::as_bool).unwrap_or(default)
}

fn close_to_tray(value: &Value) -> bool {
    flag(value, "/system/closeToTray", true)
}

fn zoom(value: &Value) -> f64 {
    value
        .pointer("/appearance/scale")
        .and_then(Value::as_f64)
        .filter(|z| z.is_finite())
        .map(|z| z.clamp(MIN_ZOOM, MAX_ZOOM))
        .unwrap_or(1.0)
}

fn window_tone(value: &Value) -> WindowTone {
    let theme = value
        .pointer("/appearance/theme")
        .and_then(Value::as_str)
        .unwrap_or("dark");

    match theme {
        "system" => WindowTone::System,
        t if LIGHT_THEMES.contains(&t) => WindowTone::Light,
        "custom" => {
            let bg = value
                .pointer("/appearance/custom/bg")
                .and_then(Value::as_str)
                .and_then(parse_hex);
            match bg {
                Some(rgb) if luminance(rgb) > LIGHT_LUMINANCE => WindowTone::Light,
                _ => WindowTone::Dark,
            }
        }
        _ => WindowTone::Dark,
    }
}

/// `#rrggbb` → (r, g, b).
fn parse_hex(hex: &str) -> Option<(u8, u8, u8)> {
    let hex = hex.strip_prefix('#')?;
    if hex.len() != 6 || !hex.is_ascii() {
        return None;
    }
    let channel = |i: usize| u8::from_str_radix(&hex[i..i + 2], 16).ok();
    Some((channel(0)?, channel(2)?, channel(4)?))
}

/// Luminancia relativa (0 negro, 1 blanco), la misma que usa `themes.js`.
fn luminance((r, g, b): (u8, u8, u8)) -> f64 {
    let lin = |c: u8| {
        let c = f64::from(c) / 255.0;
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
}

/// Un nombre de fichero seguro para exportar: solo letras, cifras, `-`, `_` y
/// `.`, y siempre `.json`. Nada de rutas: el fichero va a Descargas y punto.
pub fn export_name(name: &str) -> String {
    let stem: String = name
        .trim_end_matches(".json")
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
        .take(80)
        .collect();
    let stem = stem.trim_matches('.');

    if stem.is_empty() {
        "antares.json".to_string()
    } else {
        format!("{stem}.json")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn temp_dir(nombre: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "antares-settings-{nombre}-{}",
            crate::store::now_secs()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        dir
    }

    #[test]
    fn sin_fichero_no_hay_ajustes_y_valen_los_de_por_defecto() {
        let settings = Settings::load(temp_dir("vacio"));
        assert!(settings.get().is_none());
        assert!(settings.close_to_tray());
        assert_eq!(settings.zoom(), 1.0);
        assert_eq!(settings.window_tone(), WindowTone::Dark);
    }

    #[test]
    fn lee_los_campos_que_necesita_rust() {
        let settings = Settings::load(temp_dir("campos"));
        settings
            .set(json!({
                "system": { "closeToTray": false },
                "appearance": { "scale": 1.25, "theme": "light" }
            }))
            .unwrap();

        assert!(!settings.close_to_tray());
        assert_eq!(settings.zoom(), 1.25);
        assert_eq!(settings.window_tone(), WindowTone::Light);
        assert!(!settings.data_saver());
        assert!(!settings.autostart());

        settings
            .set(json!({
                "playback": { "quality": "saver" },
                "system": { "autostart": true, "startHidden": true }
            }))
            .unwrap();
        assert!(settings.data_saver());
        assert!(settings.autostart());
        assert!(settings.start_hidden());
    }

    #[test]
    fn el_zoom_se_acota() {
        assert_eq!(zoom(&json!({ "appearance": { "scale": 9 } })), MAX_ZOOM);
        assert_eq!(zoom(&json!({ "appearance": { "scale": 0.1 } })), MIN_ZOOM);
        assert_eq!(zoom(&json!({ "appearance": { "scale": "grande" } })), 1.0);
    }

    #[test]
    fn el_tono_de_la_ventana_sigue_al_tema() {
        let tone = |theme: Value| window_tone(&json!({ "appearance": theme }));

        assert_eq!(tone(json!({ "theme": "paper" })), WindowTone::Light);
        assert_eq!(tone(json!({ "theme": "oled" })), WindowTone::Dark);
        assert_eq!(tone(json!({ "theme": "system" })), WindowTone::System);
        assert_eq!(
            tone(json!({ "theme": "custom", "custom": { "bg": "#f0f0f0" } })),
            WindowTone::Light
        );
        assert_eq!(
            tone(json!({ "theme": "custom", "custom": { "bg": "#101010" } })),
            WindowTone::Dark
        );
        assert_eq!(
            tone(json!({ "theme": "custom", "custom": { "bg": "rojo" } })),
            WindowTone::Dark
        );
    }

    #[test]
    fn rechaza_lo_que_no_es_un_objeto_o_es_enorme() {
        let settings = Settings::load(temp_dir("rechazo"));
        assert!(settings.set(json!([1, 2, 3])).is_err());
        assert!(settings.set(json!("hola")).is_err());

        let enorme = "x".repeat(MAX_SETTINGS_BYTES + 1);
        assert!(settings.set(json!({ "a": enorme })).is_err());
        assert!(settings.get().is_none());
    }

    #[test]
    fn la_imagen_de_fondo_tiene_que_ser_una_imagen() {
        let settings = Settings::load(temp_dir("fondo"));
        assert!(settings.set_wallpaper(Some("https://ejemplo.com/a.jpg".into())).is_err());
        assert!(settings.set_wallpaper(Some("data:text/html,hola".into())).is_err());

        settings
            .set_wallpaper(Some("data:image/jpeg;base64,AAAA".into()))
            .unwrap();
        assert_eq!(settings.wallpaper().as_deref(), Some("data:image/jpeg;base64,AAAA"));

        settings.set_wallpaper(None).unwrap();
        assert!(settings.wallpaper().is_none());
    }

    #[test]
    fn se_guardan_en_disco() {
        let dir = temp_dir("disco");
        let settings = Settings::load(dir.clone());
        settings.set(json!({ "system": { "closeToTray": false } })).unwrap();

        // El Persister escribe en segundo plano.
        for _ in 0..50 {
            if dir.join(SETTINGS_FILE).exists() {
                break;
            }
            std::thread::sleep(std::time::Duration::from_millis(20));
        }

        let again = Settings::load(dir);
        assert!(!again.close_to_tray());
    }

    #[test]
    fn nombres_de_exportacion_seguros() {
        assert_eq!(export_name("antares-tema.json"), "antares-tema.json");
        assert_eq!(export_name("..\\..\\Windows\\win.ini"), "Windowswin.ini.json");
        assert_eq!(export_name("../"), "antares.json");
        assert_eq!(export_name("mi tema"), "mitema.json");
    }
}
