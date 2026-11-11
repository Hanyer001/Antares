use tauri_build::{Attributes, DefaultPermissionRule, InlinedPlugin};

fn main() {
    println!("cargo:rerun-if-env-changed=ANTARES_BUILD_REVISION");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    println!("cargo:rerun-if-changed=../.git/refs");
    let revision = std::env::var("ANTARES_BUILD_REVISION").ok().or_else(|| {
        let output = std::process::Command::new("git").args(["rev-parse", "HEAD"]).output().ok()?;
        output.status.success().then(|| String::from_utf8_lossy(&output.stdout).trim().to_owned())
    }).filter(|s| s.len() == 40 && s.bytes().all(|c| c.is_ascii_hexdigit())).unwrap_or_else(|| "unknown".into());
    println!("cargo:rustc-env=ANTARES_REVISION={revision}");
    let modified = std::process::Command::new("git").args(["status", "--porcelain"]).output()
        .map(|output| !output.status.success() || !output.stdout.is_empty()).unwrap_or(true);
    println!("cargo:rustc-env=ANTARES_MODIFIED={modified}");
    println!("cargo:rustc-env=ANTARES_TARGET={}", std::env::var("TARGET").expect("Cargo target"));
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
