# Arquitectura

Antares combina componentes Leptos compilados a WebAssembly, HTML/CSS y adaptadores JavaScript con un backend Rust mediante Tauri 2. El frontend envía comandos a Rust; Rust resuelve contenido, persiste datos e integra la aplicación con el sistema.

## Interfaz

`src/main.js` inicializa los módulos y coordina reproducción, navegación, cola y biblioteca. `src/js/dom.js` agrupa referencias compartidas al HTML.

| Área | Módulos principales de `src/js/` |
| --- | --- |
| Audio y recuperación | `player.js`, `native-deck.js`, `recovery.js`, `sound.js` |
| Cola y sesión | `queue.js`, `listening.js`, `session.js`, `session-model.js` |
| Biblioteca | `library.js`, `lists.js`, `library-tools.js`, `library-model.js`, `listsort.js` |
| Búsqueda y descubrimiento | `search.js`, `searchrank.js`, `discovery.js`, `moments.js`, `home.js`, `artist.js` |
| Apariencia y ajustes | `prefs.js`, `prefs-schema.js`, `themes.js`, `appearance.js`, `layout.js`, `settings.js` |
| Vistas y controles | `results.js`, `playerbar.js`, `miniplayer.js`, `lyrics.js`, `dialog.js`, `menu.js` |
| Datos y actualizaciones | `backups.js`, `user.js`, `appupdate.js` |

`crates/antares-core/` reúne cola, recuperación, sesión, orden de búsqueda, preferencias y resúmenes de tiempos. `crates/antares-ui/` aporta componentes Leptos y puentes Wasm. `crates/antares-build/` genera el motor y verifica las entregas. Las pruebas del cliente ejecutan ese Wasm con Node sin abrir Tauri. Las vistas delegan las acciones en callbacks y los módulos de acceso a datos centralizan las llamadas al backend.

## Backend

| Módulo de `src-tauri/src/` | Responsabilidad |
| --- | --- |
| `lib.rs` / `main.rs` | Arranque, registro de comandos y estado compartido. |
| `commands.rs` | Operaciones expuestas al frontend. |
| `source.rs` | Selección del proveedor de audio. |
| `desktop_audio.rs` / `innertube.rs` | Resolución de audio y consultas a YouTube. |
| `ytmusic.rs` | Artistas, álbumes y listas de YouTube Music. |
| `cache.rs` / `related.rs` | Cachés de audio resuelto y canciones relacionadas. |
| `store.rs` | Historial, búsquedas y escritura atómica de archivos JSON. |
| `playlists.rs` / `stats.rs` | Biblioteca, reglas, escuchas y valoraciones. |
| `recommend.rs` / `home.rs` | Recomendaciones y secciones de Inicio. |
| `settings.rs` / `users.rs` / `backup.rs` | Preferencias, separación por usuario y restauraciones. |
| `importer.rs` / `lyrics.rs` | Importación de listas y letras. |
| `audio_proxy.rs` | Audio con cabeceras CORS para Web Audio. |
| `app_update.rs` | Actualización firmada de Antares. |

## Reproducción

1. El frontend selecciona una consulta o un identificador de vídeo.
2. Rust consulta la caché y resuelve una URL de audio si hace falta. Las solicitudes simultáneas del mismo contenido comparten el turno de resolución.
3. En Windows, el audio pasa por el proxy `stream://` para Web Audio. En macOS, WKWebView utiliza AAC y el puente HTTP local. En Android lo reproduce el servicio nativo.
4. En escritorio, la siguiente canción se precarga para reducir la espera. En Android, la precarga web es opcional y está desactivada por defecto; Media3 administra el búfer de su cola nativa.
5. Ante un fallo, la recuperación renueva la URL e intenta continuar desde la posición guardada. Los reintentos están limitados y se cancelan al pausar o elegir otra canción.

El catálogo usa InnerTube y YouTube Music en Rust. En escritorio, `desktop_audio.rs` integra la copia local de `rusty_ytdl` y el modo de recuperación prueba audio AAC de InnerTube. En Android e iOS, InnerTube resuelve la fuente y el adaptador nativo se encarga de reproducirla.

Las URLs directas son temporales. Historial y listas guardan identificadores y metadatos para volver a resolverlas cuando se necesitan.

## Recomendaciones

El recomendador combina canciones conocidas con candidatos de los Mix de YouTube. La selección pondera escuchas completas, saltos, valoraciones, tiempo desde la última escucha, relación con las semillas y diversidad de artistas.

El control de aventura ajusta la proporción de canciones nuevas. Las radios se basan en sus semillas; la mezcla puede usar toda la biblioteca. Los momentos permiten separar elecciones de la sesión y desactivar el aprendizaje de los gustos habituales. `stats.json` y `taste.json` mantienen separados el resumen y las señales de aprendizaje.

## Apariencia

`antares-core/src/preferences*.rs` define el esquema, tipos, límites, valores predeterminados y migraciones. `prefs-schema.js` adapta las llamadas a ese núcleo Wasm. `themes.js` calcula variables CSS y atributos; `appearance.js` los aplica. Una copia del aspecto en localStorage permite a `boot-theme.js` mostrar el tema antes de cargar las preferencias de Rust.

## Android

`NativeDeck` adapta las propiedades y eventos del reproductor nativo a la interfaz que espera `player.js`. `PlaybackService.kt` mantiene el audio en segundo plano y ofrece controles en la notificación y la pantalla de bloqueo.


La cola completa se sincroniza por IDs y metadatos. Media3 abre `antares://video/<id>` mediante ResolvingDataSource y un puente JNI (`android_playback.rs`), que reutiliza la resolución y caché Rust. El servicio registra historial y escuchas, respeta el incógnito y mantiene el temporizador sin necesitar un WebView activo.

`NativeEffects` utiliza los efectos de la sesión de audio del sistema. `NativeCrossfade` crea un segundo decodificador únicamente para las transiciones habilitadas. `DocumentsPlugin` exporta mediante el selector de archivos de Android. El cambio de usuario y la restauración conservan las instancias de estado gestionadas por Tauri y recargan su contenido, rutas y cachés.

La política de navegación y cola está en `mobile-policy.js`; `mobile.js` aplica los accesos inferiores y el ahorro de recursos. La [guía Android](android.md) recoge las verificaciones físicas pendientes.

`ChunkedAudioDataSource` entrega una fuente continua a Media3 a partir de peticiones HTTP con rango finito, preservando la posición y los límites de DataSpec. Esto evita los HTTP 403 que devuelve YouTube ante peticiones completas o rangos abiertos.
