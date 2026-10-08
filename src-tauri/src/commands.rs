//! Comandos del frontend y resolución de audio con caché y modo seguro.

use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::cache::{cache_key, AppCache};
use crate::importer;
use crate::innertube;
use crate::lyrics::{Lyrics, LyricsCache};
use crate::playlists::{likes_playlist, Playlist, Playlists, LIKES_ID};
use crate::recommend::{self, Mode, Params, Recommendation, Rng, SeedMix};
use crate::related::Related;
use crate::settings::{self, Settings};
use crate::source;
use crate::stats::{Outcome, Rating, Stats, Summary};
use crate::store::Store;
use crate::track::{HistoryEntry, SearchResult, TrackInfo, TrackInput};
use crate::updater;
use crate::users::Users;
use crate::ytdlp;
use crate::ytmusic;

/// Lo que devolvemos al frontend: la pista, mas como se consiguio.
///
/// `cached` y `safe` no son cosmeticos: son como compruebas de un vistazo si la
/// cache y el prefetch estan haciendo su trabajo, y si el cliente rapido sigue
/// sirviendo, sin tener que deducirlo de los milisegundos.
///
/// `#[serde(flatten)]` sube los campos de `TrackInfo` al nivel superior, asi que
/// el frontend recibe `{ url, title, uploader, duration, thumbnail, id, cached,
/// safe }` en plano, sin un objeto anidado de por medio.
#[derive(Serialize)]
pub struct AudioResult {
    #[serde(flatten)]
    track: TrackInfo,
    cached: bool,
    safe: bool,
}

/// Camino comun de resolucion. El bool del retorno indica si vino de cache.
///
/// Si alguien ya esta resolviendo esta misma clave —lo tipico: el prefetch sigue
/// en marcha cuando el usuario pulsa Enter—, esperamos a que termine y nos
/// llevamos su resultado en vez de lanzar un segundo yt-dlp que haria el mismo
/// trabajo desde cero.
pub(crate) async fn resolve(query: &str, cache: &AppCache, safe: bool) -> Result<(TrackInfo, bool), String> {
    let key = cache_key(query, safe);

    if let Some(track) = cache.get(&key) {
        return Ok((track, true));
    }

    let turn = cache.turn(&key);
    let result = {
        let _guard = turn.lock().await;
        resolve_in_turn(query, &key, cache, safe).await
    };
    cache.finish_turn(&key, turn);

    result
}

/// Renovar una URL rechazada por el CDN, también desde el hilo de carga de Android.
pub(crate) async fn resolve_fresh(query: &str, cache: &AppCache, safe: bool) -> Result<(TrackInfo, bool), String> {
    let key = cache_key(query, safe);
    let turn = cache.turn(&key);
    let result = {
        let _guard = turn.lock().await;
        // Una resolución en curso puede haber repuesto la URL antes de obtener el turno.
        cache.forget(&key);
        resolve_in_turn(query, &key, cache, safe).await
    };
    cache.finish_turn(&key, turn);
    result
}

/// La resolucion en si, ya con el turno de la clave en la mano.
///
/// Si el modo rapido falla, reintenta en modo seguro antes de rendirse: el
/// cliente `android` puede dejar de funcionar de un dia para otro y eso no
/// deberia romper la app.
async fn resolve_in_turn(
    query: &str,
    key: &str,
    cache: &AppCache,
    safe: bool,
) -> Result<(TrackInfo, bool), String> {
    // Mientras esperabamos el turno, quien lo tenia pudo dejar la pista lista.
    // Si fallo, no hay nada en cache y lo intentamos nosotros.
    if let Some(track) = cache.get(key) {
        return Ok((track, true));
    }

    let mut result = source::resolve(query, safe).await;

    if result.is_err() && !safe {
        result = source::resolve(query, true).await;
    }

    if let Ok(track) = &result {
        cache.put(key, track);
    }

    result.map(|track| (track, false))
}

/// Resuelve la pista. Si ya estaba en cache, responde en microsegundos sin tocar
/// el disco ni la red, y con los metadatos incluidos.
///
/// `safeMode` lo activa el frontend cuando el elemento `<audio>` rechazo la URL
/// anterior (tipicamente un 403 sobre una URL del cliente android).
#[tauri::command]
pub async fn get_audio_url(
    query: String,
    safe_mode: Option<bool>,
    fresh: Option<bool>,
    cache: State<'_, AppCache>,
) -> Result<AudioResult, String> {
    if query.trim().is_empty() {
        return Err("Escribe el nombre de una canción o pega un enlace.".to_string());
    }

    let safe = safe_mode.unwrap_or(false);

    // Si nos piden modo seguro es porque la URL rapida no sirvio: la tiramos
    // para no volver a entregarla en la siguiente busqueda.
    if safe || fresh.unwrap_or(false) { cache.forget(&cache_key(&query, false)); }
    if fresh.unwrap_or(false) { cache.forget(&cache_key(&query, true)); }

    let (track, cached) = if fresh.unwrap_or(false) {
        resolve_fresh(&query, &cache, safe).await?
    } else { resolve(&query, &cache, safe).await? };

    Ok(AudioResult { track, cached, safe })
}

/// Resolucion especulativa: el frontend la dispara mientras el usuario aun
/// escribe, para que al pulsar Enter la pista ya este en cache.
///
/// No propaga errores: si el termino a medio escribir no da resultados, da igual.
/// Devuelve `true` si de verdad hizo trabajo nuevo.
#[tauri::command]
pub async fn prefetch_audio_url(
    query: String,
    cache: State<'_, AppCache>,
) -> Result<bool, String> {
    let key = cache_key(&query, false);

    if query.trim().is_empty() || cache.get(&key).is_some() {
        return Ok(false);
    }

    // Alguien ya lo esta resolviendo: un prefetch no tiene nada que esperar, el
    // resultado acabara en cache igualmente.
    if cache.is_in_flight(&key) {
        return Ok(false);
    }

    let _ = resolve(&query, &cache, false).await;
    Ok(true)
}

/// Cuantos candidatos pedimos. Cinco caben en pantalla sin scroll y siguen
/// costando una sola peticion: subirlo no acelera nada pero llena la lista de
/// ruido, y bajarlo hace probable que el que buscabas no salga.
const SEARCH_LIMIT: usize = 5;
const MAX_SEARCH_LIMIT: usize = 20;

/// Lista los candidatos de una busqueda, sin resolver ninguna URL de audio.
///
/// El frontend la lanza EN PARALELO con `get_audio_url`, no despues: asi el
/// primer resultado empieza a sonar en el mismo tiempo que antes y la lista
/// aparece por su cuenta, en vez de retrasar el sonido hasta que el usuario
/// elija.
///
/// Con un enlace pegado no hay nada que buscar, asi que devuelve lista vacia en
/// vez de inventarse una busqueda con la URL como texto.
///
/// `limit` pide mas candidatos: las estanterias de Inicio por genero quieren
/// una docena, no cinco. Va en la clave de cache para no mezclar listas.
#[tauri::command]
pub async fn search_tracks(
    query: String,
    limit: Option<usize>,
    store: State<'_, Store>,
) -> Result<Vec<SearchResult>, String> {
    let trimmed = query.trim();

    if trimmed.is_empty() || trimmed.starts_with("http") {
        return Ok(Vec::new());
    }

    let limit = limit.unwrap_or(SEARCH_LIMIT).clamp(1, MAX_SEARCH_LIMIT);
    let key = if limit == SEARCH_LIMIT {
        cache_key(trimmed, false)
    } else {
        cache_key(&format!("{trimmed} #{limit}"), false)
    };

    // Acierto en disco: la lista aparece al instante y sin lanzar un proceso,
    // incluso en el primer arranque del dia. Los ids de YouTube no caducan, asi
    // que una lista guardada hace semanas sigue siendo valida.
    if let Some(results) = store.get_search(&key) {
        return Ok(results);
    }

    let results = source::search(trimmed.to_string(), limit).await?;
    store.put_search(&key, &results);

    Ok(results)
}

/// Las ultimas pistas escuchadas, de la mas reciente a la mas antigua.
#[tauri::command]
pub fn get_history(store: State<'_, Store>) -> Vec<HistoryEntry> {
    store.history()
}

/// Apunta una reproduccion.
///
/// Registra la pista cuando empieza el audio. Resolverla o precargarla no cuenta como escucha.
#[tauri::command]
pub fn record_play(
    id: Option<String>,
    title: Option<String>,
    uploader: Option<String>,
    duration: Option<f64>,
    thumbnail: Option<String>,
    store: State<'_, Store>,
) {
    let Some(id) = id.filter(|v| !v.trim().is_empty()) else {
        return;
    };

    store.record(SearchResult {
        watch_url: SearchResult::watch_url_for(&id),
        id,
        title,
        uploader,
        duration,
        thumbnail,
    });
}

#[tauri::command]
pub fn clear_history(store: State<'_, Store>) {
    store.clear_history();
}

// ---------------------------------------------------------------------------
// Escuchas y valoraciones
// ---------------------------------------------------------------------------

/// Apunta como fue una escucha: cuanto sono y si llego al final.
///
/// El frontend la manda al DEJAR de sonar una pista (termina, pasas a otra),
/// no al empezar: hasta entonces no se sabe si fue un salto o una escucha
/// entera. Devuelve la clasificacion, que el frontend solo usa para la consola.
#[tauri::command]
pub fn record_listen(
    track: TrackInput,
    listened: f64,
    ended: bool,
    learn: Option<bool>,
    stats: State<'_, Stats>,
) -> Result<Outcome, String> {
    let track = track.into_track()?;
    Ok(stats.record_context(track, listened, ended, learn.unwrap_or(true)))
}

#[tauri::command]
pub fn get_rating(id: String, stats: State<'_, Stats>) -> Rating {
    stats.rating(&id)
}

#[tauri::command]
pub fn set_rating(track: TrackInput, rating: Rating, stats: State<'_, Stats>) -> Result<(), String> {
    stats.set_rating(track.into_track()?, rating);
    Ok(())
}

// ---------------------------------------------------------------------------
// Listas
// ---------------------------------------------------------------------------

/// "Me gusta" primero, siempre, y despues las del usuario de la editada mas
/// reciente a la mas antigua.
#[tauri::command]
pub fn get_playlists(stats: State<'_, Stats>, playlists: State<'_, Playlists>) -> Vec<Playlist> {
    let mut all = vec![likes_playlist(stats.liked())];
    let library = stats.snapshot();
    all.extend(playlists.all().into_iter().map(|mut list| {
        if let Some(rules) = &list.details.rules { list.tracks = rules.select(&library, crate::store::now_secs()); }
        list
    }));
    all
}

/// Crea una lista, vacia o con pistas (al guardar la cola). Devuelve su id.
#[tauri::command]
pub fn create_playlist(
    name: String,
    tracks: Option<Vec<TrackInput>>,
    playlists: State<'_, Playlists>,
) -> Result<String, String> {
    let tracks = tracks
        .unwrap_or_default()
        .into_iter()
        .filter_map(|t| t.into_track().ok())
        .collect();

    Ok(playlists.create(&name, tracks)?.id)
}

/// Las listas del sistema tienen sus propias reglas: "Me gusta" se construye
/// desde las valoraciones, asi que no tiene nombre que cambiar ni orden propio.
fn reject_system(id: &str, action: &str) -> Result<(), String> {
    if id == LIKES_ID {
        Err(format!("La lista Me gusta no se puede {action}."))
    } else {
        Ok(())
    }
}

#[tauri::command]
pub fn rename_playlist(id: String, name: String, playlists: State<'_, Playlists>) -> Result<(), String> {
    reject_system(&id, "renombrar")?;
    playlists.rename(&id, &name)
}

#[tauri::command]
pub fn delete_playlist(id: String, playlists: State<'_, Playlists>) -> Result<(), String> {
    reject_system(&id, "borrar")?;
    playlists.delete(&id)
}

/// Anade una pista. Devuelve `false` si ya estaba.
///
/// Anadir a "Me gusta" es lo mismo que marcar el corazon.
#[tauri::command]
pub fn add_to_playlist(
    id: String,
    track: TrackInput,
    stats: State<'_, Stats>,
    playlists: State<'_, Playlists>,
) -> Result<bool, String> {
    let track = track.into_track()?;

    if id == LIKES_ID {
        return Ok(stats.set_rating(track, Rating::Like) != Rating::Like);
    }

    playlists.add_track(&id, track)
}

/// Quitar de "Me gusta" es lo mismo que desmarcar el corazon.
#[tauri::command]
pub fn remove_from_playlist(
    id: String,
    track_id: String,
    stats: State<'_, Stats>,
    playlists: State<'_, Playlists>,
) -> Result<(), String> {
    if id == LIKES_ID {
        stats.clear_rating(&track_id);
        return Ok(());
    }

    playlists.remove_track(&id, &track_id)
}

#[tauri::command]
pub fn move_in_playlist(
    id: String,
    from: usize,
    to: usize,
    playlists: State<'_, Playlists>,
) -> Result<(), String> {
    reject_system(&id, "reordenar")?;
    playlists.move_track(&id, from, to)
}

/// Pone la lista en el orden de `order` (sus ids). Es lo que hace "Ordenar
/// por…", y también deshacerlo.
#[tauri::command]
pub fn reorder_playlist(id: String, order: Vec<String>, playlists: State<'_, Playlists>) -> Result<(), String> {
    reject_system(&id, "reordenar")?;
    playlists.reorder(&id, &order)
}

/// Una lista importada: la que se creó y lo que no se pudo encontrar.
#[derive(Serialize)]
pub struct Imported {
    id: String,
    name: String,
    count: usize,
    source_count: usize,
    duplicates: usize,
    /// "Artista - Canción" de las que no aparecieron en YouTube Music.
    missing: Vec<String>,
}

/// Importa una lista por su enlace: de YouTube o YouTube Music tal cual, y de
/// Spotify, Deezer o Apple Music buscando cada canción (ver `importer`).
#[tauri::command]
pub async fn import_playlist(
    url: String,
    app: tauri::AppHandle,
    playlists: State<'_, Playlists>,
) -> Result<Imported, String> {
    let url = url.trim().to_string();

    if importer::service_of(&url).is_some() {
        let (name, wanted) = importer::read_link(&url).await?;
        return import_found(name, wanted, &app, &playlists).await;
    }

    if !url.starts_with("http") || !url.contains("list=") {
        return Err(
            "Pega el enlace de una lista de YouTube, YouTube Music, Spotify, Deezer o Apple Music.".to_string(),
        );
    }

    let (title, tracks) = source::playlist(url, ytdlp::PLAYLIST_LIMIT).await?;

    if tracks.is_empty() {
        return Err("No encontré canciones en esa lista. ¿Es privada?".to_string());
    }

    let name = title.unwrap_or_else(|| "Lista importada".to_string());
    let list = playlists.create(&name, tracks)?;
    Ok(Imported { count: list.tracks.len(), source_count: list.tracks.len(), duplicates: 0,
        id: list.id, name: list.name, missing: Vec::new() })
}

/// Importa canciones pegadas ("Artista - Canción", una por línea) o un CSV
/// exportado de cualquier app.
#[tauri::command]
pub async fn import_text(
    name: Option<String>,
    text: String,
    app: tauri::AppHandle,
    playlists: State<'_, Playlists>,
) -> Result<Imported, String> {
    let wanted = importer::parse_text(&text);
    if wanted.is_empty() {
        return Err("No encontré canciones. Escribe una por línea: «Artista - Canción».".to_string());
    }
    let name = name
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Lista importada".to_string());
    import_found(name, wanted, &app, &playlists).await
}

/// Busca en YouTube Music lo que viene de otra app y crea la lista. Mientras,
/// avisa al frontend de por dónde va ("import-progress").
async fn import_found(
    name: String,
    wanted: Vec<importer::Wanted>,
    app: &tauri::AppHandle,
    playlists: &Playlists,
) -> Result<Imported, String> {
    use tauri::Emitter;

    let source_count = wanted.len();
    let handle = app.clone();
    let found = importer::find_all(wanted, move |done, total| {
        let _ = handle.emit("import-progress", serde_json::json!({ "done": done, "total": total }));
    })
    .await;

    if found.tracks.is_empty() {
        return Err("No encontré ninguna de esas canciones en YouTube Music.".to_string());
    }

    let duplicates = source_count.saturating_sub(found.tracks.len() + found.missing.len());
    let list = playlists.create(&name, found.tracks)?;
    Ok(Imported {
        count: list.tracks.len(),
        source_count,
        duplicates,
        id: list.id,
        name: list.name,
        missing: found.missing.iter().map(importer::Wanted::label).collect(),
    })
}

// ---------------------------------------------------------------------------
// Artistas y álbumes (YouTube Music)
// ---------------------------------------------------------------------------

/// Canciones que se piden de una lista de YouTube para verla sin importarla
/// (las más escuchadas de un artista, una lista de su página).
const LIST_VIEW_LIMIT: usize = 200;

/// Los artistas y el álbum de una canción, para ir a ellos.
#[tauri::command]
pub async fn track_links(
    video_id: Option<String>,
    uploader: Option<String>,
    title: Option<String>,
) -> Result<ytmusic::TrackLinks, String> {
    ytmusic::track_links(video_id.as_deref(), uploader.as_deref(), title.as_deref()).await
}

#[tauri::command]
pub async fn artist_page(id: String) -> Result<ytmusic::ArtistPage, String> {
    ytmusic::artist(&id).await
}

#[tauri::command]
pub async fn artist_songs(id: String) -> Result<Vec<SearchResult>, String> {
    ytmusic::artist_songs(&id).await
}

#[tauri::command]
pub async fn album_page(id: String) -> Result<ytmusic::AlbumPage, String> {
    ytmusic::album(&id).await
}

/// El resto de una estantería de la página de un artista ("Ver todo").
#[tauri::command]
pub async fn shelf_more(browse_id: String, params: Option<String>) -> Result<Vec<ytmusic::Card>, String> {
    ytmusic::more(&browse_id, params.as_deref()).await
}

/// Canciones oficiales de YouTube Music para lo buscado, con sus artistas: la
/// búsqueda las usa para poner primero las del artista. Fallar aquí no es un
/// error para el usuario: la búsqueda normal sigue sirviendo.
#[tauri::command]
pub async fn search_songs(query: String) -> Vec<ytmusic::SongHit> {
    ytmusic::search_songs(&query, 8).await.unwrap_or_default()
}

/// El artista que se está buscando, si la búsqueda empieza por su nombre.
/// Fallar aquí no es un error para el usuario: solo no sale la tarjeta.
#[tauri::command]
pub async fn artist_for_query(query: String) -> Option<ytmusic::ArtistHit> {
    ytmusic::artist_for_query(&query).await.ok().flatten()
}

#[derive(Serialize)]
pub struct YoutubeList {
    title: Option<String>,
    tracks: Vec<SearchResult>,
}

/// Las canciones de una lista de YouTube, sin crear una lista propia.
#[tauri::command]
pub async fn youtube_list(id: String) -> Result<YoutubeList, String> {
    let url = format!("https://www.youtube.com/playlist?list={}", id.trim());
    let (title, tracks) = innertube::list_playlist(&url, LIST_VIEW_LIMIT).await?;
    Ok(YoutubeList { title, tracks })
}

// ---------------------------------------------------------------------------
// Recomendaciones
// ---------------------------------------------------------------------------

/// Cuantas semillas usa el aleatorio inteligente. Tres Mix de 25 son ~70
/// candidatas nuevas, de sobra para variar, y se piden en paralelo.
const MIX_SEEDS: usize = 3;

/// Tope de recomendaciones por llamada: la cola infinita pide pocas cada vez,
/// y una radio o una mezcla no necesitan mas para empezar.
const MAX_RECOMMENDATIONS: usize = 50;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecommendRequest {
    mode: Mode,
    /// Las semillas forzadas: la cancion de la radio, o lo ultimo que el usuario
    /// busco y puso. Mas recientes primero; se usan como mucho `MIX_SEEDS`.
    #[serde(default)]
    seeds: Vec<TrackInput>,
    count: usize,
    /// Probabilidad de elegir algo nuevo en cada tirada, 0..=1.
    adventure: f64,
    /// Lo que no debe salir: la cola y lo ya sonado en la sesion.
    #[serde(default)]
    exclude: Vec<String>,
    /// Semillas cuyos Mix el usuario ha ido saltando en esta sesion.
    #[serde(default)]
    avoid_seeds: Vec<String>,
    /// Los ajustes del recomendador (Ajustes › Descubrir).
    #[serde(default)]
    tuning: recommend::Tuning,
}

/// Recomienda canciones. Ver `recommend.rs` para la formula.
///
/// - `mix`: aleatorio inteligente. Las semillas forzadas y, hasta completar
///   tres, otras de tu biblioteca; candidatas de toda la biblioteca y de sus
///   Mix.
/// - `radio`: solo lo relacionado con las semillas forzadas (al menos una): la
///   radio de una cancion, o la cola a partir de lo que elegiste.
#[tauri::command]
pub async fn recommend(
    request: RecommendRequest,
    stats: State<'_, Stats>,
    store: State<'_, Store>,
    related: State<'_, Related>,
) -> Result<Vec<Recommendation>, String> {
    let now = crate::store::now_secs();
    let library = stats.recommendation_snapshot();
    let mut rng = Rng::from_time();

    let mut forced: Vec<SearchResult> = request
        .seeds
        .into_iter()
        .filter_map(|t| t.into_track().ok())
        .collect();

    // Como mucho `MIX_SEEDS` semillas en los dos modos. Una radio de varias es
    // lo que usa la cola: lo relacionado con lo ultimo que elegiste.
    forced.truncate(MIX_SEEDS);

    if request.mode == Mode::Radio && forced.is_empty() {
        return Err("Una radio necesita una canción de la que partir.".to_string());
    }

    let avoid: HashSet<String> = request.avoid_seeds.into_iter().collect();
    let extra = match request.mode {
        Mode::Radio => 0,
        Mode::Mix => MIX_SEEDS.saturating_sub(forced.len()),
    };

    let seeds = recommend::choose_seeds(&library, &forced, extra, &avoid, now, &mut rng);

    if seeds.is_empty() {
        return Err(
            "Todavía no hay de dónde recomendar: escucha algunas canciones o empieza una radio desde una."
                .to_string(),
        );
    }

    let ids: Vec<String> = seeds.iter().map(|s| s.id.clone()).collect();
    let mut lists = related.for_seeds(&ids).await;

    // Los Mix traen los titulos bien escritos: arreglan los que se guardaron
    // rotos, y la biblioteca se vuelve a leer ya arreglada.
    stats.repair_text(lists.values().flatten());
    store.repair_text(lists.values().flatten());
    let library = stats.recommendation_snapshot();

    let mixes: Vec<SeedMix> = seeds
        .into_iter()
        .map(|mut seed| {
            // La semilla aparece en su propio Mix: su titulo de ahi es el fresco,
            // y es el que se lee en "Porque escuchas «...»".
            if let Some(fresh) = lists.get(&seed.id).and_then(|l| l.iter().find(|t| t.id == seed.id)) {
                if fresh.title.is_some() {
                    seed.title = fresh.title.clone();
                }
            }

            let is_forced = forced.iter().any(|f| f.id == seed.id);
            SeedMix {
                taste: recommend::seed_taste(&library, &seed, is_forced, now),
                related: lists.remove(&seed.id).unwrap_or_default(),
                seed,
            }
        })
        .collect();

    let params = Params {
        mode: request.mode,
        count: request.count.clamp(1, MAX_RECOMMENDATIONS),
        adventure: request.adventure,
        exclude: request.exclude.into_iter().collect(),
        avoid_seeds: avoid,
        now,
        tuning: request.tuning.sanitized(),
    };

    let picks = recommend::recommend(&library, &mixes, &params, &mut rng);

    if picks.is_empty() {
        return Err("No encontré nada que recomendar ahora mismo. ¿Hay conexión?".to_string());
    }

    Ok(picks)
}

// ---------------------------------------------------------------------------
// Letras y resumen
// ---------------------------------------------------------------------------

/// La letra de una pista, de lrclib. `None` si no la tienen.
#[tauri::command]
pub async fn get_lyrics(
    id: String,
    title: String,
    uploader: Option<String>,
    duration: Option<f64>,
    cache: State<'_, LyricsCache>,
) -> Result<Option<Lyrics>, String> {
    cache.get(&id, &title, uploader.as_deref(), duration).await
}

#[tauri::command]
pub fn get_summary(stats: State<'_, Stats>) -> Summary {
    stats.summary()
}

// ---------------------------------------------------------------------------
// Ventana y bandeja
// ---------------------------------------------------------------------------

/// Lo que dice el icono de la bandeja al pasar el raton: lo que suena.
#[tauri::command]
pub fn set_tray_tooltip(text: String, app: tauri::AppHandle) {
    #[cfg(desktop)]
    if let Some(tray) = app.tray_by_id(crate::TRAY_ID) {
        let _ = tray.set_tooltip(Some(text));
    }
    #[cfg(mobile)]
    let _ = (text, app);
}

/// La miniatura de la barra de tareas: el titulo de la ventana (lo que sale
/// encima de la miniatura y en Alt+Tab) y sus botones (ver `thumbbar`).
#[tauri::command]
pub fn set_thumbbar(title: String, state: ThumbStateArg, app: tauri::AppHandle) {
    #[cfg(desktop)]
    {
        use tauri::Manager;
        if let Some(window) = app.get_webview_window("main") {
            let _ = window.set_title(&title);
        }
    }
    #[cfg(windows)]
    crate::thumbbar::update(&app, state);
    #[cfg(not(windows))]
    let _ = (title, state, app);
}

#[cfg(windows)]
pub type ThumbStateArg = crate::thumbbar::ThumbState;
/// Fuera de Windows no hay miniatura: se acepta lo que llegue y se ignora.
#[cfg(not(windows))]
pub type ThumbStateArg = serde_json::Value;

/// Cierra la app de verdad. Lo llama el frontend cuando ya ha guardado lo que
/// sonaba (la escucha en curso, la cola), al elegir "Salir" en la bandeja.
#[tauri::command]
pub fn quit_app(app: tauri::AppHandle) {
    crate::remove_tray(&app);
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

/// Las preferencias guardadas, o `None` si aun no se guardo nunca (el frontend
/// se trae entonces las antiguas de localStorage).
#[tauri::command]
pub fn get_settings(settings: State<'_, Settings>) -> Option<serde_json::Value> {
    settings.get()
}

/// Guarda las preferencias y aplica lo que es de la ventana: zoom y barra de
/// titulo. Solo si cambiaron: reaplicar el zoom en cada guardado haria
/// parpadear la ventana cada vez que se mueve el volumen.
#[tauri::command]
pub fn save_settings(
    value: serde_json::Value,
    settings: State<'_, Settings>,
    cache: State<'_, AppCache>,
    window: tauri::WebviewWindow,
) -> Result<(), String> {
    let (zoom, tone) = (settings.zoom(), settings.window_tone());
    let (saver, autostart) = (settings.data_saver(), settings.autostart());
    settings.set(value)?;

    if settings.data_saver() != saver {
        ytdlp::set_data_saver(settings.data_saver());
        // Las URLs guardadas son de la otra calidad.
        cache.clear();
    }

    // Zoom, barra de titulo y arranque con Windows: cosas de escritorio.
    #[cfg(desktop)]
    {
        if settings.zoom() != zoom {
            let _ = window.set_zoom(settings.zoom());
        }
        if settings.window_tone() != tone {
            crate::apply_window_tone(&window, settings.window_tone());
        }
        if settings.autostart() != autostart {
            use tauri::Manager;
            apply_autostart(window.app_handle(), settings.autostart());
        }
    }
    #[cfg(mobile)]
    let _ = (window, zoom, tone, autostart);
    Ok(())
}

#[tauri::command]
pub fn get_wallpaper(settings: State<'_, Settings>) -> Option<String> {
    settings.wallpaper()
}

#[tauri::command]
pub fn set_wallpaper(image: Option<String>, settings: State<'_, Settings>) -> Result<(), String> {
    settings.set_wallpaper(image)
}

// ---------------------------------------------------------------------------
// Inicio
// ---------------------------------------------------------------------------

/// Las estanterias de Inicio que salen de tus estadisticas (ver `home`).
#[tauri::command]
pub fn get_home(stats: State<'_, Stats>) -> crate::home::Home {
    crate::home::build(&stats.recommendation_snapshot(), crate::store::now_secs())
}

// ---------------------------------------------------------------------------
// Usuarios
// ---------------------------------------------------------------------------

/// Quienes usan la app en este PC (ver `users`).
pub struct UsersState {
    base: std::path::PathBuf,
    users: std::sync::Mutex<Users>,
}

impl UsersState {
    pub fn data_dir(&self) -> Result<std::path::PathBuf, String> {
        self.users.lock().map(|u| u.data_dir(&self.base)).map_err(|_| "usuarios bloqueados".into())
    }
    pub fn new(base: std::path::PathBuf, users: Users) -> Self {
        Self { base, users: std::sync::Mutex::new(users) }
    }

    /// Aplica un cambio y lo guarda; si no se pudo guardar, no cambia nada.
    fn change(&self, f: impl FnOnce(&mut Users) -> Result<(), String>) -> Result<Users, String> {
        let mut users = self.users.lock().map_err(|_| "usuarios bloqueados".to_string())?;
        let mut next = users.clone();
        f(&mut next)?;
        next.save(&self.base)?;
        *users = next;
        Ok(users.clone())
    }
}

#[tauri::command]
pub fn get_users(state: State<'_, UsersState>) -> Result<Users, String> {
    state
        .users
        .lock()
        .map(|u| u.clone())
        .map_err(|_| "usuarios bloqueados".to_string())
}

#[tauri::command]
pub fn create_user(name: String, state: State<'_, UsersState>) -> Result<Users, String> {
    state.change(|users| users.create(&name).map(|_| ()))
}

#[tauri::command]
pub fn rename_user(id: String, name: String, state: State<'_, UsersState>) -> Result<Users, String> {
    state.change(|users| users.rename(&id, &name))
}

/// Borra un usuario y todos sus datos. No tiene deshacer: el frontend
/// pregunta antes.
#[tauri::command]
pub fn delete_user(id: String, state: State<'_, UsersState>) -> Result<Users, String> {
    let users = state.change(|users| users.remove(&id))?;
    crate::users::delete_data(&state.base, &id)?;
    Ok(users)
}

/// Cambia de usuario y reinicia la app, que arranca con los datos del nuevo.
/// El frontend guarda antes lo que tenga pendiente (la sesion, los ajustes).
#[tauri::command]
pub fn switch_user(id: String, state: State<'_, UsersState>, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(mobile)]
    flush_mobile_data(&app)?;
    state.change(|users| users.switch(&id))?;
    #[cfg(desktop)]
    crate::restart_clean(&app);
    #[cfg(mobile)]
    reload_mobile_data(&app)
}

/// Cambios de usuario/restauración recargan el estado, sin intentar arrancar
/// un ejecutable de escritorio en Android. El frontend se recarga después.
#[cfg(mobile)]
pub(crate) fn flush_mobile_data(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    app.state::<Store>().flush_mobile()?; app.state::<Stats>().flush_mobile()?;
    app.state::<Playlists>().flush_mobile()?; app.state::<Settings>().flush_mobile()
}

#[cfg(mobile)]
pub(crate) fn reload_mobile_data(app: &tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    let dir = app.state::<UsersState>().data_dir()?;
    crate::backup::apply_pending(&dir)?;
    app.state::<Store>().reload_mobile(dir.clone())?;
    app.state::<Stats>().reload_mobile(dir.clone())?;
    app.state::<Playlists>().reload_mobile(dir.clone())?;
    app.state::<crate::backup::Backups>().retarget(dir.clone())?;
    app.state::<Settings>().reload_mobile(dir)?;
    ytdlp::set_data_saver(app.state::<Settings>().data_saver());
    app.state::<AppCache>().clear();
    Ok(())
}

// ---------------------------------------------------------------------------
// Modo mini
// ---------------------------------------------------------------------------

/// Tamaño de la ventana en modo mini si el frontend no dice otro, en pixeles
/// logicos al 100 %. El de verdad depende del estilo (Ajustes › Reproductor).
const MINI_SIZE: (f64, f64) = (340.0, 340.0);
/// Lo mas pequeña que se deja: por debajo, los controles no caben.
const MINI_MIN: (f64, f64) = (240.0, 72.0);
/// El minimo de la ventana normal (el de tauri.conf.json).
const NORMAL_MIN: (f64, f64) = (980.0, 620.0);

/// Como estaba la ventana antes del modo mini, para devolverla igual.
#[allow(dead_code)] // en movil no hay ventana que restaurar
struct Restore {
    size: tauri::PhysicalSize<u32>,
    position: tauri::PhysicalPosition<i32>,
    maximized: bool,
}

#[derive(Default)]
pub struct MiniState(std::sync::Mutex<Option<Restore>>);

/// Entra o sale del modo mini: una ventana pequeña con lo que suena y los
/// controles, encima de las demas si `on_top`. Sin la barra de titulo de
/// Windows, como el mini reproductor de Apple Music: se arrastra desde
/// cualquier sitio y trae sus propios botones de volver y cerrar.
#[cfg(mobile)]
#[tauri::command]
pub fn set_mini_mode(enabled: bool, on_top: bool, width: Option<f64>, height: Option<f64>) -> Result<(), String> {
    let _ = (enabled, on_top, width, height);
    Err("El modo mini es de la versión de escritorio.".to_string())
}

#[cfg(desktop)]
#[tauri::command]
pub fn set_mini_mode(
    enabled: bool,
    on_top: bool,
    width: Option<f64>,
    height: Option<f64>,
    window: tauri::WebviewWindow,
    mini: State<'_, MiniState>,
    settings: State<'_, Settings>,
) -> Result<(), String> {
    use tauri::LogicalSize;

    let err = |e: tauri::Error| e.to_string();
    let mut saved = mini.0.lock().map_err(|_| "estado bloqueado".to_string())?;
    // El contenido crece con el zoom de la interfaz: la ventana tambien.
    let zoom = settings.zoom();

    if enabled {
        if saved.is_none() {
            *saved = Some(Restore {
                size: window.inner_size().map_err(err)?,
                position: window.outer_position().map_err(err)?,
                maximized: window.is_maximized().map_err(err)?,
            });
        }

        let size = (
            width.unwrap_or(MINI_SIZE.0).clamp(MINI_MIN.0, 900.0),
            height.unwrap_or(MINI_SIZE.1).clamp(MINI_MIN.1, 900.0),
        );
        window.unmaximize().map_err(err)?;
        window.set_decorations(false).map_err(err)?;
        window
            .set_min_size(Some(LogicalSize::new(MINI_MIN.0 * zoom, MINI_MIN.1 * zoom)))
            .map_err(err)?;
        window
            .set_size(LogicalSize::new(size.0 * zoom, size.1 * zoom))
            .map_err(err)?;
        window.set_always_on_top(on_top).map_err(err)?;
        return Ok(());
    }

    window.set_always_on_top(false).map_err(err)?;
    window.set_decorations(true).map_err(err)?;
    window
        .set_min_size(Some(LogicalSize::new(NORMAL_MIN.0, NORMAL_MIN.1)))
        .map_err(err)?;

    match saved.take() {
        Some(restore) if restore.maximized => window.maximize().map_err(err)?,
        Some(restore) => {
            window.set_size(restore.size).map_err(err)?;
            window.set_position(restore.position).map_err(err)?;
        }
        None => window.maximize().map_err(err)?,
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Atajos globales
// ---------------------------------------------------------------------------

/// Que accion lanza cada atajo global registrado, por id del atajo.
#[derive(Default)]
pub struct GlobalKeys(std::sync::Mutex<HashMap<u32, String>>);

impl GlobalKeys {
    pub fn action(&self, id: u32) -> Option<String> {
        self.0.lock().ok()?.get(&id).cloned()
    }
}

/// Registra los atajos globales (`accion → "Ctrl+Alt+Space"`), quitando los
/// anteriores. Sin nada, los quita todos.
///
/// Devuelve las acciones cuyo atajo no se pudo registrar: mal escrito o ya lo
/// usa otro programa.
#[cfg(mobile)]
#[tauri::command]
pub fn set_global_shortcuts(bindings: HashMap<String, String>) -> Vec<String> {
    // En el movil no hay teclado global: nada que registrar, nada que falle.
    let _ = bindings;
    Vec::new()
}

#[cfg(desktop)]
#[tauri::command]
pub fn set_global_shortcuts(
    bindings: HashMap<String, String>,
    app: tauri::AppHandle,
    keys: State<'_, GlobalKeys>,
) -> Vec<String> {
    use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

    let shortcuts = app.global_shortcut();
    let _ = shortcuts.unregister_all();

    let Ok(mut map) = keys.0.lock() else {
        return bindings.into_keys().collect();
    };
    map.clear();

    let mut failed = Vec::new();
    for (action, accelerator) in bindings {
        if accelerator.trim().is_empty() {
            continue;
        }

        let registered = accelerator
            .parse::<Shortcut>()
            .ok()
            .filter(|shortcut| shortcuts.register(*shortcut).is_ok());

        match registered {
            Some(shortcut) => {
                map.insert(shortcut.id(), action);
            }
            None => failed.push(action),
        }
    }

    failed.sort();
    failed
}

// ---------------------------------------------------------------------------
// Avisos y arranque con Windows
// ---------------------------------------------------------------------------

/// El aviso de Windows de "ahora suena". El frontend decide cuando: solo con
/// la ventana en segundo plano, que con ella delante sobra.
#[tauri::command]
pub fn notify_track(title: String, body: String, app: tauri::AppHandle) {
    use tauri_plugin_notification::NotificationExt;

    let _ = app.notification().builder().title(title).body(body).show();
}

/// Si Antares esta de verdad en el arranque de Windows (el usuario pudo
/// quitarlo desde el Administrador de tareas).
#[tauri::command]
pub fn get_autostart(app: tauri::AppHandle) -> bool {
    #[cfg(desktop)]
    {
        use tauri_plugin_autostart::ManagerExt;
        app.autolaunch().is_enabled().unwrap_or(false)
    }
    #[cfg(mobile)]
    {
        let _ = app;
        false
    }
}

/// Deja el arranque con Windows como diga el ajuste.
#[cfg(desktop)]
pub fn apply_autostart(app: &tauri::AppHandle, enabled: bool) {
    use tauri_plugin_autostart::ManagerExt;

    let launcher = app.autolaunch();
    let result = if enabled { launcher.enable() } else { launcher.disable() };
    if let Err(e) = result {
        eprintln!("No se pudo cambiar el arranque con Windows: {e}");
    }
}

/// Deja un fichero en Descargas y lo enseña en el Explorador: exportar un tema
/// o una copia de los ajustes. Si ya hay uno con ese nombre, no lo pisa.
///
/// Devuelve la ruta donde quedo.
#[cfg(mobile)]
#[tauri::command]
pub fn export_file(name: String, contents: String) -> Result<String, String> {
    let _ = (name, contents);
    Err("Exportar a un archivo es de la versión de escritorio.".to_string())
}

#[cfg(desktop)]
#[tauri::command]
pub fn export_file(name: String, contents: String, app: tauri::AppHandle) -> Result<String, String> {
    use tauri::Manager;

    let dir = app
        .path()
        .download_dir()
        .or_else(|_| app.path().document_dir())
        .map_err(|e| format!("No encuentro la carpeta de Descargas: {e}"))?;

    let name = settings::export_name(&name);
    let stem = name.trim_end_matches(".json");
    let mut path = dir.join(&name);
    let mut n = 2;
    while path.exists() {
        path = dir.join(format!("{stem} ({n}).json"));
        n += 1;
    }

    std::fs::write(&path, contents).map_err(|e| format!("No se pudo guardar: {e}"))?;
    let _ = tauri_plugin_opener::reveal_item_in_dir(&path);

    Ok(path.display().to_string())
}

// ---------------------------------------------------------------------------
// yt-dlp
// ---------------------------------------------------------------------------

/// Fuerza una comprobacion de version de yt-dlp, saltandose el limite diario.
///
/// Existe para el dia en que YouTube rompa algo y no quieras esperar a mañana:
/// el arranque ya comprueba solo una vez cada 24 h.
///
/// Devuelve la version nueva si la instalo, o `None` si ya estaba al dia.
#[tauri::command]
pub async fn update_ytdlp(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri::Manager;

    if source::native() {
        return Ok(None);
    }

    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("no hay directorio de datos: {e}"))?;

    // La comprobacion hace red y disco: fuera del runtime asincrono.
    tokio::task::spawn_blocking(move || match updater::check(&dir, true) {
        Ok(updater::Outcome::Updated(version)) => Ok(Some(version)),
        Ok(updater::Outcome::UpToDate) => Ok(None),
        Err(e) => Err(e),
    })
    .await
    .map_err(|e| format!("fallo interno: {e}"))?
}

/// Version de yt-dlp que se esta usando ahora mismo.
///
/// Preguntarselo al binario cuesta ~1 s (arranca PyInstaller), asi que el
/// frontend solo lo pide al abrir los ajustes y se lo queda.
#[tauri::command]
pub async fn ytdlp_version() -> Option<String> {
    // Con el cliente propio (Android) no hay yt-dlp que preguntar.
    if source::native() {
        return None;
    }
    tokio::task::spawn_blocking(ytdlp::installed_version)
        .await
        .ok()
        .flatten()
}

/// En que sistema corre la app ("windows", "android"...): la interfaz esconde
/// lo que en movil no existe (bandeja, atajos, modo mini).
#[tauri::command]
pub fn get_platform() -> &'static str {
    std::env::consts::OS
}

#[tauri::command]
pub fn update_playlist_details(id: String, details: crate::playlists::PlaylistDetails, name: Option<String>, playlists: State<'_, Playlists>) -> Result<(), String> {
    reject_system(&id, "editar")?;
    playlists.update_details_and_name(&id, details, name.as_deref())
}
#[tauri::command]
pub fn create_smart_playlist(name: String, details: crate::playlists::PlaylistDetails, playlists: State<'_, Playlists>) -> Result<String, String> {
    details.validate()?;
    if details.rules.is_none() { return Err("Elige las reglas de la lista.".into()); }
    Ok(playlists.create_with_details(&name, Vec::new(), details)?.id)
}
#[tauri::command]
pub fn bulk_playlist(source: String, target: Option<String>, ids: Vec<String>, action: String, playlists: State<'_, Playlists>, stats: State<'_, Stats>) -> Result<usize, String> {
    if ids.len() > 50000 { return Err("Demasiadas canciones seleccionadas.".into()); }
    if source == LIKES_ID {
        let selected: HashSet<_> = ids.iter().collect();
        let tracks: Vec<_> = stats.liked().into_iter().filter(|t| selected.contains(&t.id)).collect();
        return match action.as_str() {
            "copy" => playlists.copy_tracks(target.as_deref().ok_or("Elige un destino")?, &tracks),
            "remove" => { stats.clear_ratings(&ids)?; Ok(tracks.len()) },
            _ => Err("Esta acción no está disponible para Me gusta.".into()),
        };
    }
    if let Some(list) = playlists.all().into_iter().find(|l| l.id == source) {
        if let Some(rules) = list.details.rules {
            if action != "copy" { return Err("Edita las reglas para cambiar esta lista.".into()); }
            let selected: HashSet<_> = ids.iter().collect();
            let tracks: Vec<_> = rules.select(&stats.snapshot(), crate::store::now_secs()).into_iter().filter(|t| selected.contains(&t.id)).collect();
            return playlists.copy_tracks(target.as_deref().ok_or("Elige un destino")?, &tracks);
        }
    }
    playlists.bulk(&source, target.as_deref(), &ids, &action)
}
