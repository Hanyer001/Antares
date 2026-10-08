use tauri_build::{Attributes, DefaultPermissionRule, InlinedPlugin};

fn main() {
    // El reproductor nativo de Android (PlayerPlugin.kt) es un plugin definido
    // dentro de la app. Tauri solo deja a la interfaz llamar a las órdenes de
    // un plugin que tenga permisos declarados, así que se declaran aquí y
    // capabilities/default.json los concede con "player:default".
    // register_listener / registerListener: los usa addPluginListener para
    // recibir los eventos (prueba el primero y, si falla, el segundo).
    let player = InlinedPlugin::new()
        .commands(&[
            "load",
            "play",
            "pause",
            "seek",
            "setVolume",
            "stop",
            "background",
            "syncQueue",
            "snapshot",
            "setPrivacy",
            "setRepeat",
            "setSleep",
            "setEffects",
            "effectsState",
            "setPlaybackOptions",
            "register_listener",
            "registerListener",
            "remove_listener",
            "removeListener",
        ])
        .default_permission(DefaultPermissionRule::AllowAllCommands);

    let documents = InlinedPlugin::new().commands(&["save"])
        .default_permission(DefaultPermissionRule::AllowAllCommands);
    tauri_build::try_build(Attributes::new().plugin("player", player).plugin("documents", documents))
        .expect("failed to run tauri-build");
}
