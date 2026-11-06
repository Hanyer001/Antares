use tauri::{plugin::{Builder, TauriPlugin}, Runtime};

tauri::ios_plugin_binding!(init_plugin_antares_ios);

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("antares-ios")
        .setup(|_, api| {
            api.register_ios_plugin(init_plugin_antares_ios)?;
            Ok(())
        })
        .build()
}
