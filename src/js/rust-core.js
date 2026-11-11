import init from "../engine/antares_core.js";

// La misma instancia de Wasm sirve al WebView y a la PWA. Node la carga desde
// disco para que las pruebas de la interfaz ejecuten también el motor Rust.
if (typeof process !== "undefined" && process.versions?.node && import.meta.url.startsWith("file:")) {
  const moduleName = "node:fs/promises";
  const { readFile } = await import(moduleName);
  await init({ module_or_path: await readFile(new URL("../engine/antares_core_bg.wasm", import.meta.url)) });
} else {
  const path = typeof __ANTARES_WASM_PATH__ === "string"
    ? __ANTARES_WASM_PATH__ : "./engine/antares_core_bg.wasm";
  await init({ module_or_path: new URL(path, document.baseURI) });
}
export { TrackFilter, PerformanceSamples, preferences_metadata, preferences_schema, preferences_apply, UpNextView, console_play, console_time, console_volume, console_queue, side_player_tab, PlayerView, format_clock, volume_action, HomeSection, home_section_id, move_home_section, mount_navigation, arrange_navigation, mark_navigation, queue_badge, start_section, filter_track_indices, group_list_indices, LibraryView, SettingsView, playlist_count_label, QueueEngine, RecoveryEngine, SearchView, mount_search_controls, matches_search_query, rank_search, clean_session, read_session, store_session } from "../engine/antares_core.js";
