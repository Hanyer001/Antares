// Punto de entrada de escritorio. Comparte el arranque de lib.rs con Android.

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    antares_lib::run();
}
