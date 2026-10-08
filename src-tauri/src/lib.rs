// Arranque de Tauri en escritorio y Android.
// Registra comandos, carga el estado y configura la bandeja y el protocolo de audio.

// En movil sobra lo de escritorio (modo mini, bandeja, yt-dlp...): compila
// pero no se usa, y sin esto cada pieza daria un aviso.
// MSVC imprime "Creando biblioteca" como progreso; Rust lo presenta como warning.
// Suprimimos esa categoria en MSVC. Los errores del enlazador siguen fallando.
#![cfg_attr(all(windows, target_env = "msvc"), allow(linker_messages))]

#![cfg_attr(mobile, allow(dead_code, unused_imports))]

#[cfg(target_os = "android")]
mod android_playback;
mod app_update;
mod audio_proxy;
mod backup;
mod cache;
mod commands;
mod home;
mod importer;
mod innertube;
mod lyrics;
mod playlists;
mod recommend;
mod related;
mod settings;
mod source;
mod stats;
mod store;
#[cfg(windows)]
mod thumbbar;
mod track;
mod updater;
mod users;
mod ytdlp;
mod ytmusic;

use std::time::Duration;

use cache::AppCache;
use lyrics::LyricsCache;
use playlists::Playlists;
use related::Related;
use settings::Settings;
#[cfg(desktop)]
use settings::WindowTone;
use stats::Stats;
use store::Store;
use tauri::{AppHandle, Manager};
#[cfg(desktop)]
use tauri::{Emitter, WindowEvent};
use users::Users;

/// Id del icono de la bandeja, para encontrarlo al cambiar su texto.
pub const TRAY_ID: &str = "antares";

/// Cuantas favoritas se precalientan al arrancar, y cuando. La espera deja
/// pasar primero el arranque de la ventana y la comprobacion de yt-dlp.
const WARM_SEEDS: usize = 6;
const WARM_DELAY: Duration = Duration::from_secs(4);

// ---------------------------------------------------------------------------
// Solo escritorio: bandeja, atajos globales y ventana
// ---------------------------------------------------------------------------

/// Si "Salir" no recibe respuesta del frontend en este tiempo, se cierra igual.
#[cfg(desktop)]
const QUIT_GRACE: Duration = Duration::from_secs(2);

/// El argumento con el que Windows abre Antares al iniciar sesion (lo registra
/// el plugin de autostart). Con el ajuste "abrir en la bandeja", la ventana no
/// se enseña.
#[cfg(desktop)]
const AUTOSTART_ARG: &str = "--minimized";

/// Un atajo global pulsado: "show" lo resuelve Rust (enseñar la ventana), el
/// resto va al frontend, que es quien sabe que suena.
#[cfg(desktop)]
fn on_global_shortcut(
    app: &AppHandle,
    shortcut: &tauri_plugin_global_shortcut::Shortcut,
    event: tauri_plugin_global_shortcut::ShortcutEvent,
) {
    if event.state != tauri_plugin_global_shortcut::ShortcutState::Pressed {
        return;
    }
    let Some(action) = app.state::<commands::GlobalKeys>().action(shortcut.id()) else {
        return;
    };

    if action == "show" {
        show_window(app);
    } else {
        let _ = app.emit("shortcut", action);
    }
}

/// Saca la ventana de donde este: escondida en la bandeja o minimizada.
#[cfg(desktop)]
fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// La barra de titulo de Windows, clara u oscura segun el tema de la app.
#[cfg(desktop)]
pub fn apply_window_tone(window: &tauri::WebviewWindow, tone: WindowTone) {
    let theme = match tone {
        WindowTone::Dark => Some(tauri::Theme::Dark),
        WindowTone::Light => Some(tauri::Theme::Light),
        WindowTone::System => None,
    };
    let _ = window.set_theme(theme);
}

/// Quita el icono de la bandeja YA, antes de cerrar o reiniciar la app.
///
/// Si el proceso termina sin quitarlo (un reinicio, el instalador de una
/// actualizacion, salir), Windows deja un icono "fantasma" en la bandeja hasta
/// que se pasa el raton por encima: con unos cuantos, parecia que habia varios
/// Antares abiertos. `set_visible(false)` lo borra al momento (espera a que lo
/// haga el hilo principal).
pub fn remove_tray(app: &AppHandle) {
    #[cfg(desktop)]
    if let Some(tray) = app.remove_tray_by_id(TRAY_ID) {
        let _ = tray.set_visible(false);
    }
    #[cfg(mobile)]
    let _ = app;
}

/// Reiniciar sin dejar el icono viejo en la bandeja (ver `remove_tray`).
pub fn restart_clean(app: &AppHandle) -> ! {
    remove_tray(app);
    app.restart()
}

/// El icono de la bandeja: controles basicos, y la ventana a un clic.
///
/// Las acciones de reproduccion no se hacen aqui: se avisan al frontend con el
/// evento "tray", porque quien sabe que suena y que va despues es la cola.
#[cfg(desktop)]
fn build_tray(app: &tauri::App) -> tauri::Result<()> {
    use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};

    let toggle = MenuItem::with_id(app, "toggle", "Reproducir / pausar", true, None::<&str>)?;
    let next = MenuItem::with_id(app, "next", "Siguiente", true, None::<&str>)?;
    let prev = MenuItem::with_id(app, "prev", "Anterior", true, None::<&str>)?;
    let show = MenuItem::with_id(app, "show", "Mostrar Antares", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Salir", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let separator2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(
        app,
        &[&toggle, &next, &prev, &separator, &show, &separator2, &quit],
    )?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .tooltip("Antares")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => show_window(app),
            "quit" => {
                // El frontend guarda la escucha en curso y la cola, y llama a
                // `quit_app`. Si no contesta (ventana colgada), se sale igual.
                let _ = app.emit("tray", "quit");
                let handle = app.clone();
                std::thread::spawn(move || {
                    std::thread::sleep(QUIT_GRACE);
                    remove_tray(&handle);
                    handle.exit(0);
                });
            }
            action => {
                let _ = app.emit("tray", action);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }

    builder.build(app)?;
    Ok(())
}

/// Lo que en escritorio se hace al arrancar y en movil no existe: la ventana
/// (zoom, barra de titulo, arrancar oculta), yt-dlp y su actualizador, y la
/// bandeja.
#[cfg(desktop)]
fn setup_desktop(app: &tauri::App, base: std::path::PathBuf, settings: &Settings) {
    if let Some(window) = app.get_webview_window("main") {
        if settings.zoom() != 1.0 {
            let _ = window.set_zoom(settings.zoom());
        }
        apply_window_tone(&window, settings.window_tone());

        // Antes de enseñarla: los botones se añaden cuando Windows avisa de que
        // su boton ya esta en la barra, y ese aviso llega al enseñarla.
        #[cfg(windows)]
        thumbbar::install(app.handle(), &window);

        // La ventana nace oculta (tauri.conf.json) para poder decidir aqui:
        // abierta por Windows al iniciar sesion y con "abrir en la bandeja",
        // se queda escondida; si no, se enseña ya.
        let by_windows = std::env::args().any(|arg| arg == AUTOSTART_ARG);
        if !(by_windows && settings.start_hidden()) {
            let _ = window.show();
        }
    }

    // Antes que nada: sin esto, `find_ytdlp` no sabria donde buscar la copia
    // que mantiene el actualizador.
    ytdlp::set_data_dir(base.clone());

    // Paga el arranque de PyInstaller mientras el usuario aun no ha escrito
    // nada, para que no lo pague la primera busqueda.
    if !source::native() {
        ytdlp::warm_up();
    }

    // Sin bandeja la app sigue funcionando: solo se pierde el icono.
    if let Err(e) = build_tray(app) {
        eprintln!("No se pudo crear el icono de la bandeja: {e}");
    }

    // Comprobacion de version en segundo plano. Nunca bloquea el arranque ni
    // interrumpe nada: si no hay red, se queda como estaba.
    let handle = app.handle().clone();
    std::thread::spawn(move || match updater::check(&base, false) {
        Ok(updater::Outcome::Updated(version)) => {
            println!("yt-dlp actualizado a {version}");
            let _ = handle.emit("ytdlp-updated", version);
        }
        Ok(updater::Outcome::UpToDate) => {}
        Err(e) => eprintln!("No se pudo comprobar la version de yt-dlp: {e}"),
    });
}

// ---------------------------------------------------------------------------
// Comun
// ---------------------------------------------------------------------------

/// Deja en cache los Mix de tus favoritas, para que la primera mezcla o la
/// primera recomendacion de la cola salgan al instante.
fn warm_related(handle: AppHandle) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(WARM_DELAY).await;

        let seeds = {
            let stats = handle.state::<Stats>();
            recommend::warm_seeds(&stats.recommendation_snapshot(), WARM_SEEDS, store::now_secs())
        };

        if seeds.is_empty() {
            return;
        }

        let related = handle.state::<Related>();
        let ready = related.for_seeds(&seeds).await;
        println!("Mix precalentados: {} de {}", ready.len(), seeds.len());
    });
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();

    // Un solo Antares a la vez: abrirlo otra vez (el acceso directo, el menu
    // Inicio) con uno ya abierto, aunque este escondido en la bandeja, enseña
    // ese en vez de arrancar otro con su propio icono. Tiene que ser el primer
    // plugin. Solo en el instalado: en desarrollo se quiere poder abrir la
    // version de prueba con la instalada abierta.
    #[cfg(all(desktop, not(debug_assertions)))]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        show_window(app);
    }));

    #[cfg(desktop)]
    let builder = builder
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(on_global_shortcut)
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec![AUTOSTART_ARG]),
        ))
        // Versiones nuevas de la app, firmadas: ver `app_update`.
        .plugin(tauri_plugin_updater::Builder::new().build())
        // Cerrar la ventana la esconde en la bandeja si asi esta configurado:
        // la musica sigue, y se vuelve con un clic en el icono.
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let to_tray = window
                    .try_state::<Settings>()
                    .is_none_or(|settings| settings.close_to_tray());
                if to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        });

    // En Android el audio lo reproduce el sistema (un servicio con su
    // notificacion), no la pagina: ver `mobile::player`.
    #[cfg(mobile)]
    let builder = builder.plugin(mobile::player()).plugin(mobile::documents());

    builder
        .plugin(tauri_plugin_notification::init())
        .manage(AppCache::default())
        .manage(LyricsCache::default())
        .manage(commands::MiniState::default())
        .manage(commands::GlobalKeys::default())
        .manage(app_update::Pending::default())
        // El audio pasa por aqui para poder procesarlo: ver `audio_proxy`.
        .register_asynchronous_uri_scheme_protocol("stream", |_ctx, request, responder| {
            tauri::async_runtime::spawn(async move {
                responder.respond(audio_proxy::handle(request).await);
            });
        })
        .setup(|app| {
            // El directorio de datos del usuario (%APPDATA%\\com.hanyer.antares
            // en Windows, el privado de la app en Android). Si el sistema no lo
            // diera, caemos al directorio actual antes que dejar la app sin
            // historial.
            let base = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));

            // Lo de cada persona sale de su carpeta (ver `users`); lo que no es
            // de nadie (la cache de los Mix, yt-dlp) se queda en la raiz.
            let users = Users::load(&base);
            let dir = users.data_dir(&base);
            app.manage(commands::UsersState::new(base.clone(), users));

            backup::apply_pending(&dir).map_err(std::io::Error::other)?;
            app.manage(backup::Backups::new(dir.clone()));
            app.manage(Store::load(dir.clone()));
            app.manage(Stats::load(dir.clone()));
            app.manage(Playlists::load(dir.clone()));
            app.manage(Related::load(base.clone()));

            let settings = Settings::load(dir);
            ytdlp::set_data_saver(settings.data_saver());

            #[cfg(desktop)]
            setup_desktop(app, base, &settings);
            #[cfg(mobile)]
            let _ = base;

            app.manage(settings);
            #[cfg(desktop)]
            warm_related(app.handle().clone());
            #[cfg(target_os = "android")]
            android_playback::init(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            backup::create_backup,
            backup::inspect_backup,
            backup::restore_backup,
            backup::list_backups,
            backup::read_backup,
            backup::restored_workspace,
            backup::acknowledge_restored_workspace,
            backup::restart_after_restore,
            commands::update_playlist_details,
            commands::create_smart_playlist,
            commands::bulk_playlist,
            commands::get_audio_url,
            commands::prefetch_audio_url,
            commands::search_tracks,
            commands::get_history,
            commands::record_play,
            commands::clear_history,
            commands::record_listen,
            commands::get_rating,
            commands::set_rating,
            commands::get_playlists,
            commands::create_playlist,
            commands::rename_playlist,
            commands::delete_playlist,
            commands::add_to_playlist,
            commands::remove_from_playlist,
            commands::move_in_playlist,
            commands::import_playlist,
            commands::import_text,
            commands::reorder_playlist,
            commands::track_links,
            commands::artist_page,
            commands::artist_songs,
            commands::album_page,
            commands::shelf_more,
            commands::artist_for_query,
            commands::search_songs,
            commands::youtube_list,
            commands::recommend,
            commands::get_lyrics,
            commands::get_summary,
            commands::get_settings,
            commands::save_settings,
            commands::get_wallpaper,
            commands::set_wallpaper,
            commands::export_file,
            commands::get_home,
            commands::get_platform,
            commands::set_mini_mode,
            commands::set_global_shortcuts,
            commands::notify_track,
            commands::get_autostart,
            commands::get_users,
            commands::create_user,
            commands::rename_user,
            commands::delete_user,
            commands::switch_user,
            commands::set_tray_tooltip,
            commands::set_thumbbar,
            commands::quit_app,
            commands::update_ytdlp,
            commands::ytdlp_version,
            app_update::app_version,
            app_update::check_app_update,
            app_update::install_app_update
        ])
        .build(tauri::generate_context!())
        .expect("Error al ejecutar Tauri")
        .run(|app, event| {
            // Por si se sale por un camino que no paso por `remove_tray`.
            if let tauri::RunEvent::Exit = event {
                remove_tray(app);
            }
        });
}

/// Lo propio de Android.
#[cfg(mobile)]
mod mobile {
    use tauri::plugin::{Builder, TauriPlugin};
    use tauri::Runtime;

    /// El reproductor nativo (PlayerPlugin.kt): ExoPlayer dentro de un
    /// servicio en primer plano, con la notificacion multimedia, los botones
    /// de los auriculares y la pantalla de bloqueo. El frontend lo maneja con
    /// `plugin:player|...` (ver native-deck.js).
    pub fn documents<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("documents").setup(|_app, api| {
            #[cfg(target_os = "android")]
            api.register_android_plugin("com.hanyer.antares", "DocumentsPlugin")?;
            #[cfg(not(target_os = "android"))]
            let _ = api;
            Ok(())
        }).build()
    }
    pub fn player<R: Runtime>() -> TauriPlugin<R> {
        Builder::new("player")
            .setup(|_app, api| {
                #[cfg(target_os = "android")]
                api.register_android_plugin("com.hanyer.antares", "PlayerPlugin")?;
                #[cfg(not(target_os = "android"))]
                let _ = api;
                Ok(())
            })
            .build()
    }
}
