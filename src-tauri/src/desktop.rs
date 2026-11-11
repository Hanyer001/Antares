//! Capacidades comprobadas del contenedor de escritorio.
use serde::Serialize;
use tauri::AppHandle;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Capabilities {
    pub tray: bool,
    pub global_shortcuts: bool,
    pub mini: bool,
}

#[tauri::command]
pub fn desktop_capabilities(app: AppHandle) -> Capabilities {
    Capabilities {
        tray: tray_available(&app),
        global_shortcuts: cfg!(desktop) && shortcuts_supported(),
        mini: cfg!(desktop),
    }
}

fn shortcuts_supported() -> bool {
    #[cfg(desktop)]
    {
        crate::global_shortcuts_supported()
    }
    #[cfg(mobile)]
    {
        false
    }
}

fn tray_available(app: &AppHandle) -> bool {
    #[cfg(desktop)]
    {
        app.tray_by_id(crate::TRAY_ID).is_some()
    }
    #[cfg(mobile)]
    {
        let _ = app;
        false
    }
}

/// Un punto de la barra de título debe quedar en un monitor conectado.
/// i64 evita desbordamientos con coordenadas negativas y escalados altos.
#[cfg(desktop)]
pub fn contains_title(area: (i32, i32, u32, u32), position: (i32, i32)) -> bool {
    let (left, top, width, height) = area;
    let x = i64::from(position.0) + 48;
    let y = i64::from(position.1) + 24;
    x >= i64::from(left)
        && x < i64::from(left) + i64::from(width)
        && y >= i64::from(top)
        && y < i64::from(top) + i64::from(height)
}

#[cfg(all(test, desktop))]
mod tests {
    use super::*;
    #[test]
    fn restoring_a_window_distinguishes_connected_and_disconnected_screens() {
        assert!(contains_title((0, 0, 2560, 1440), (100, 100)));
        assert!(contains_title((-1920, 0, 1920, 1080), (-1800, 100)));
        assert!(!contains_title((0, 0, 2560, 1440), (-1800, 100)));
        assert!(!contains_title((0, 0, 2560, 1440), (2700, 100)));
    }
}
