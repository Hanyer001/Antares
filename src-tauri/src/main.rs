// Punto de entrada de escritorio. Comparte el arranque de lib.rs con Android.

// MSVC imprime "Creando biblioteca" como progreso; Rust lo presenta como warning.
// Suprimimos esa categoria en MSVC. Los errores del enlazador siguen fallando.
#![cfg_attr(all(windows, target_env = "msvc"), allow(linker_messages))]

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    antares_lib::run();
}
