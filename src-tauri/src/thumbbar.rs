// Botones de reproducción en la miniatura de Windows mediante ITaskbarList3.
// TaskbarButtonCreated permite crearlos y reponerlos al reiniciarse el Explorador.
// Los clics llegan como WM_COMMAND/THBN_CLICKED y se envían al frontend.
// El estado COM se mantiene en el hilo de la ventana mediante thread_local.

use std::cell::RefCell;
use std::sync::OnceLock;

use serde::Deserialize;
use tauri::{AppHandle, Emitter};
use windows::core::w;
use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, RECT, WPARAM};
use windows::Win32::Graphics::Gdi::{
    CreateBitmap, CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject,
    DrawTextW, GdiFlush, GetDC, ReleaseDC, SelectObject, SetBkMode, SetTextColor,
    ANTIALIASED_QUALITY, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLIP_DEFAULT_PRECIS,
    DEFAULT_CHARSET, DIB_RGB_COLORS, DT_CENTER, DT_NOPREFIX, DT_SINGLELINE, DT_VCENTER,
    FW_NORMAL, OUT_DEFAULT_PRECIS, TRANSPARENT,
};
use windows::Win32::System::Com::{
    CoCreateInstance, CoInitializeEx, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED,
};
use windows::Win32::UI::HiDpi::{GetDpiForWindow, GetSystemMetricsForDpi};
use windows::Win32::UI::Shell::{
    DefSubclassProc, ITaskbarList3, SetWindowSubclass, TaskbarList, THBF_DISABLED,
    THBF_ENABLED, THBN_CLICKED, THB_FLAGS, THB_ICON, THB_TOOLTIP, THUMBBUTTON,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CreateIconIndirect, RegisterWindowMessageW, HICON, ICONINFO, SM_CXSMICON, WM_COMMAND,
};

/// Lo que enseña la consola, tal como lo manda el frontend.
#[derive(Debug, Clone, Default, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbState {
    pub has_track: bool,
    pub playing: bool,
    pub liked: bool,
    pub can_like: bool,
    pub has_prev: bool,
    pub has_next: bool,
}

/// Los botones, por su id (el que llega en el clic) y la accion que se le
/// manda al frontend.
const ACTIONS: [&str; 4] = ["like", "prev", "toggle", "next"];

/// Glifos de la fuente de iconos de Windows (Segoe MDL2 Assets, en Windows 10
/// y 11): los mismos que usan los controles del sistema.
const GLYPH_HEART: char = '\u{EB51}';
const GLYPH_HEART_FILL: char = '\u{EB52}';
const GLYPH_PREV: char = '\u{E892}';
const GLYPH_PLAY: char = '\u{E768}';
const GLYPH_PAUSE: char = '\u{E769}';
const GLYPH_NEXT: char = '\u{E893}';

/// Id de nuestra subclase de la ventana (cualquiera, unico en la app).
const SUBCLASS_ID: usize = 0x414E_5441; // "ANTA"

/// Para mandar los clics al frontend desde el procedimiento de la ventana.
static APP: OnceLock<AppHandle> = OnceLock::new();

/// El mensaje "TaskbarButtonCreated": su numero lo da Windows al registrarlo.
static BUTTON_CREATED: OnceLock<u32> = OnceLock::new();

struct Icons {
    heart: HICON,
    heart_fill: HICON,
    prev: HICON,
    play: HICON,
    pause: HICON,
    next: HICON,
}

struct Bar {
    hwnd: HWND,
    /// Solo existe una vez que Windows ha creado el boton de la barra.
    list: Option<ITaskbarList3>,
    icons: Option<Icons>,
    state: ThumbState,
}

thread_local! {
    static BAR: RefCell<Option<Bar>> = const { RefCell::new(None) };
}

/// Engancha la ventana. Antes de enseñarla: si no, el aviso de que su boton
/// ya esta en la barra podria llegar sin nadie escuchando.
pub fn install(app: &AppHandle, window: &tauri::WebviewWindow) {
    let Ok(hwnd) = window.hwnd() else {
        return;
    };
    let _ = APP.set(app.clone());
    BUTTON_CREATED.get_or_init(|| unsafe { RegisterWindowMessageW(w!("TaskbarButtonCreated")) });

    BAR.with(|bar| {
        *bar.borrow_mut() = Some(Bar {
            hwnd,
            list: None,
            icons: None,
            state: ThumbState::default(),
        });
    });

    unsafe {
        let _ = SetWindowSubclass(hwnd, Some(subclass_proc), SUBCLASS_ID, 0);
    }
}

/// El frontend cambio algo de la consola: se repinta lo que haga falta.
pub fn update(app: &AppHandle, state: ThumbState) {
    let _ = app.run_on_main_thread(move || {
        BAR.with(|bar| {
            if let Some(bar) = bar.borrow_mut().as_mut() {
                if bar.state == state {
                    return;
                }
                bar.state = state;
                if let Some(list) = &bar.list {
                    let buttons = buttons(bar);
                    unsafe {
                        let _ = list.ThumbBarUpdateButtons(bar.hwnd, &buttons);
                    }
                }
            }
        });
    });
}

unsafe extern "system" fn subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _id: usize,
    _data: usize,
) -> LRESULT {
    if Some(&msg) == BUTTON_CREATED.get() {
        add_buttons();
    } else if msg == WM_COMMAND && (wparam.0 >> 16) as u32 & 0xFFFF == THBN_CLICKED {
        let id = wparam.0 & 0xFFFF;
        if let (Some(app), Some(action)) = (APP.get(), ACTIONS.get(id)) {
            let _ = app.emit("thumbbar", *action);
        }
        return LRESULT(0);
    }
    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// El boton de la ventana ya esta en la barra (o el Explorador se reinicio):
/// una lista de tareas nueva y los cuatro botones.
fn add_buttons() {
    BAR.with(|bar| {
        let mut bar = bar.borrow_mut();
        let Some(bar) = bar.as_mut() else {
            return;
        };

        let list: ITaskbarList3 = unsafe {
            // En el hilo de la ventana COM ya esta iniciado (lo hace WebView2);
            // si no, esto lo inicia. Lo que devuelva da igual.
            let _ = CoInitializeEx(None, COINIT_APARTMENTTHREADED);
            match CoCreateInstance(&TaskbarList, None, CLSCTX_INPROC_SERVER) {
                Ok(list) => list,
                Err(e) => {
                    eprintln!("Sin botones en la barra de tareas: {e}");
                    return;
                }
            }
        };
        if unsafe { list.HrInit() }.is_err() {
            return;
        }

        if bar.icons.is_none() {
            bar.icons = make_icons(bar.hwnd);
        }
        let buttons = buttons(bar);
        match unsafe { list.ThumbBarAddButtons(bar.hwnd, &buttons) } {
            Ok(()) => {
                println!("Botones de la miniatura listos");
                bar.list = Some(list);
            }
            Err(e) => eprintln!("No se pudieron añadir los botones de la miniatura: {e}"),
        }
    });
}

/// Los cuatro botones segun el estado de ahora.
fn buttons(bar: &Bar) -> [THUMBBUTTON; 4] {
    let s = &bar.state;
    let icon = |pick: fn(&Icons) -> HICON| bar.icons.as_ref().map(pick).unwrap_or_default();

    let like_tip = if s.liked { "Quitar de Me gusta" } else { "Me gusta" };
    let play_tip = if s.playing { "Pausar" } else { "Reproducir" };

    [
        button(
            0,
            icon(if s.liked { |i| i.heart_fill } else { |i| i.heart }),
            like_tip,
            s.can_like,
        ),
        button(1, icon(|i| i.prev), "Anterior", s.has_prev),
        button(
            2,
            icon(if s.playing { |i| i.pause } else { |i| i.play }),
            play_tip,
            s.has_track,
        ),
        button(3, icon(|i| i.next), "Siguiente", s.has_next),
    ]
}

fn button(id: u32, icon: HICON, tip: &str, enabled: bool) -> THUMBBUTTON {
    let mut sz_tip = [0u16; 260];
    for (slot, unit) in sz_tip.iter_mut().zip(tip.encode_utf16().take(259)) {
        *slot = unit;
    }
    THUMBBUTTON {
        dwMask: THB_ICON | THB_TOOLTIP | THB_FLAGS,
        iId: id,
        iBitmap: 0,
        hIcon: icon,
        szTip: sz_tip,
        dwFlags: if enabled { THBF_ENABLED } else { THBF_DISABLED },
    }
}

/// Los iconos, al tamaño de icono pequeño del monitor de la ventana (16 px al
/// 100 %, 24 al 150 %...). Si la fuente no estuviera, los botones salen sin
/// dibujo pero con su texto al pasar el raton.
fn make_icons(hwnd: HWND) -> Option<Icons> {
    let size = unsafe {
        let dpi = GetDpiForWindow(hwnd);
        let size = GetSystemMetricsForDpi(SM_CXSMICON, if dpi == 0 { 96 } else { dpi });
        if size > 0 { size } else { 16 }
    };
    Some(Icons {
        heart: glyph_icon(GLYPH_HEART, size)?,
        heart_fill: glyph_icon(GLYPH_HEART_FILL, size)?,
        prev: glyph_icon(GLYPH_PREV, size)?,
        play: glyph_icon(GLYPH_PLAY, size)?,
        pause: glyph_icon(GLYPH_PAUSE, size)?,
        next: glyph_icon(GLYPH_NEXT, size)?,
    })
}

/// Un glifo blanco sobre transparente, como icono de `size` x `size`.
fn glyph_icon(glyph: char, size: i32) -> Option<HICON> {
    let pixels = glyph_pixels(glyph, size)?;
    unsafe {
        let info = dib_info(size);
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let color = CreateDIBSection(None, &info, DIB_RGB_COLORS, &mut bits, None, 0).ok()?;
        std::ptr::copy_nonoverlapping(pixels.as_ptr(), bits as *mut u32, pixels.len());

        // La mascara no cuenta con un color de 32 bits con opacidad, pero
        // `CreateIconIndirect` la exige.
        let mask = CreateBitmap(size, size, 1, 1, None);
        let icon = CreateIconIndirect(&ICONINFO {
            fIcon: true.into(),
            xHotspot: 0,
            yHotspot: 0,
            hbmMask: mask,
            hbmColor: color,
        });

        let _ = DeleteObject(mask.into());
        let _ = DeleteObject(color.into());
        icon.ok()
    }
}

/// Un mapa de bits de 32 bits, de arriba abajo.
fn dib_info(size: i32) -> BITMAPINFO {
    BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: size,
            biHeight: -size,
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    }
}

/// Los pixeles (BGRA) del glifo: blanco, con la opacidad del trazo.
///
/// GDI no sabe escribir transparencia: se pinta blanco sobre negro con
/// suavizado y luego el brillo de cada pixel pasa a ser su opacidad.
fn glyph_pixels(glyph: char, size: i32) -> Option<Vec<u32>> {
    unsafe {
        let screen = GetDC(None);
        let dc = CreateCompatibleDC(Some(screen));

        let info = dib_info(size);
        let mut bits: *mut std::ffi::c_void = std::ptr::null_mut();
        let Ok(color) = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0)
        else {
            let _ = DeleteDC(dc);
            ReleaseDC(None, screen);
            return None;
        };
        let old_bitmap = SelectObject(dc, color.into());

        let font = CreateFontW(
            -size,
            0,
            0,
            0,
            FW_NORMAL.0 as i32,
            0,
            0,
            0,
            DEFAULT_CHARSET,
            OUT_DEFAULT_PRECIS,
            CLIP_DEFAULT_PRECIS,
            ANTIALIASED_QUALITY,
            0,
            w!("Segoe MDL2 Assets"),
        );
        let old_font = SelectObject(dc, font.into());
        SetTextColor(dc, COLORREF(0x00FF_FFFF));
        SetBkMode(dc, TRANSPARENT);

        let mut text: Vec<u16> = glyph.to_string().encode_utf16().collect();
        let mut rect = RECT { left: 0, top: 0, right: size, bottom: size };
        DrawTextW(dc, &mut text, &mut rect, DT_CENTER | DT_VCENTER | DT_SINGLELINE | DT_NOPREFIX);
        let _ = GdiFlush();

        // Blanco con la opacidad que dejo el suavizado.
        let drawn = std::slice::from_raw_parts(bits as *const u32, (size * size) as usize);
        let pixels: Vec<u32> = drawn
            .iter()
            .map(|px| {
                let (b, g, r) = (px & 0xFF, (px >> 8) & 0xFF, (px >> 16) & 0xFF);
                (r.max(g).max(b) << 24) | 0x00FF_FFFF
            })
            .collect();

        SelectObject(dc, old_font);
        SelectObject(dc, old_bitmap);
        let _ = DeleteObject(font.into());
        let _ = DeleteObject(color.into());
        let _ = DeleteDC(dc);
        ReleaseDC(None, screen);

        // Sin la fuente, GDI pinta otra cosa o nada: mejor un boton sin
        // dibujo que uno con un cuadrado.
        pixels.iter().any(|px| px >> 24 > 0).then_some(pixels)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Cuanto del cuadrado cubre el glifo (0..1).
    fn coverage(pixels: &[u32]) -> f64 {
        pixels.iter().map(|px| f64::from(px >> 24) / 255.0).sum::<f64>() / pixels.len() as f64
    }

    /// El glifo en texto, para mirarlo con `cargo test -- --nocapture`.
    fn ascii(pixels: &[u32], size: usize) -> String {
        pixels
            .chunks(size)
            .map(|row| {
                row.iter()
                    .map(|px| match px >> 24 {
                        0..=40 => ' ',
                        41..=140 => '+',
                        _ => '#',
                    })
                    .collect::<String>()
            })
            .collect::<Vec<_>>()
            .join("\n")
    }

    #[test]
    fn los_iconos_se_dibujan() {
        let size = 24;
        let glyphs = [
            ("corazon", GLYPH_HEART),
            ("corazon lleno", GLYPH_HEART_FILL),
            ("anterior", GLYPH_PREV),
            ("play", GLYPH_PLAY),
            ("pausa", GLYPH_PAUSE),
            ("siguiente", GLYPH_NEXT),
        ];
        let mut covered = Vec::new();
        for (name, glyph) in glyphs {
            let pixels = glyph_pixels(glyph, size).unwrap_or_else(|| panic!("sin dibujo: {name}"));
            let c = coverage(&pixels);
            println!("{name} ({:.0} %)\n{}\n", c * 100.0, ascii(&pixels, size as usize));
            assert!(c > 0.03 && c < 0.8, "{name}: cubre {c}");
            assert!(glyph_icon(glyph, size).is_some(), "{name}: Windows no creó el icono");
            covered.push(c);
        }
        assert!(covered[1] > covered[0] * 1.3, "el corazón lleno se distingue del vacío");
    }

    #[test]
    fn un_boton_apagado_y_su_texto() {
        let b = button(2, HICON::default(), "Pausar", false);
        assert_eq!(b.dwFlags, THBF_DISABLED);
        assert_eq!(String::from_utf16_lossy(&b.szTip[..6]), "Pausar");
        assert_eq!(b.szTip[6], 0);
    }
}
