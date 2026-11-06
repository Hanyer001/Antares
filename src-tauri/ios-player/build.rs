fn main() {
    println!("cargo:rerun-if-changed=ios/Sources");
    tauri_plugin::Builder::new(&[]).ios_path("ios").build();
}
