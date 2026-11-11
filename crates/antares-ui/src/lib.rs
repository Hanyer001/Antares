//! Interfaz compartida por Tauri y la PWA.
#![cfg(target_arch = "wasm32")]

mod bridge;
mod home_view;
mod library_view;
mod navigation;
mod player_view;
mod settings_view;
mod track_view;
mod upnext_view;
