# Desarrollo

## Herramientas

La app nativa se compila con Cargo. En Windows instala el toolchain MSVC de Rust, Microsoft C++ Build Tools con **Desarrollo para el escritorio con C++** y WebView2. Consulta los [prerrequisitos de Tauri](https://v2.tauri.app/start/prerequisites/) para cada sistema.

Desde la raíz del repositorio:

```sh
rustup target add wasm32-unknown-unknown
cargo install tauri-cli --version 2.11.4 --locked
cargo install wasm-bindgen-cli --version 0.2.130 --locked
cargo tauri dev
```

`cargo run --locked -p antares-build` genera el núcleo WebAssembly en `src/engine/`. Tauri, la PWA y las pruebas lo generan antes de usarlo. Si invocas `cargo check` o `cargo test` para Tauri directamente desde una copia nueva, genera el núcleo primero.

Node.js 22+ y `npm ci` se usan para las pruebas JavaScript y el empaquetado de la PWA. La interfaz nativa se sirve desde `src/` y llama a Rust mediante `window.__TAURI__`.

| Comando desde la raíz | Función |
| --- | --- |
| `cargo tauri dev` | Abre Tauri en desarrollo. |
| `cargo tauri build` | Compila y empaqueta la app nativa. |
| `npm test` | Ejecuta las pruebas de JavaScript con WebAssembly. |
| `npm run web:build` | Empaqueta la PWA. |
| `cargo test --locked -p antares --lib` | Prueba el backend nativo. |
| `cargo test --locked -p antares-web-api` | Prueba la API web. |

## Pruebas

Los archivos de `tests/` cubren cola, preferencias, filtros, búsqueda, reconocimiento de canciones, recuperación y modelos de biblioteca. Las pruebas Rust se encuentran junto al módulo que verifican.

Algunas pruebas consultan servicios externos y se excluyen de la ejecución habitual. Para ejecutarlas de forma explícita:

```powershell
cargo test --manifest-path src-tauri/Cargo.toml --lib importer -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib innertube -- --ignored --nocapture
cargo test --manifest-path src-tauri/Cargo.toml --lib ytmusic -- --ignored --nocapture
```

La prueba de firma de actualizaciones necesita un paquete ya publicado; está documentada en [publicación](releases.md).

## Android

El proyecto nativo está en `src-tauri/gen/android/`. El audio usa ExoPlayer mediante `PlaybackService.kt` y `PlayerPlugin.kt`.

El script `scripts/build-android.ps1` espera esta instalación local:

```text
%LOCALAPPDATA%/AntaresDev/
├── jdk/                   # Java 17 o posterior
└── sdk/                   # SDK de Android
    └── ndk/               # NDK instalado
```

También necesita los targets Rust `aarch64-linux-android` y `armv7-linux-androideabi`. Para una versión firmada requiere `src-tauri/gen/android/keystore.properties` y la clave a la que apunta. Esos archivos no forman parte del repositorio.

El script compila Rust para ambas arquitecturas y copia las bibliotecas al proyecto Android antes de ejecutar Gradle. Evita depender de la creación de enlaces simbólicos en Windows. Los comandos que generan APK se encuentran en [publicación](releases.md). El SDK usado es Android 36 y el mínimo de la app es Android 7 (API 24). Para el APK de pruebas optimizado y las diferencias entre plataformas, consulta [Android](android.md).

## Diagnóstico de catálogo y audio

Las siguientes pruebas consultan YouTube y su CDN. Ejecuta las de red en serie para facilitar el diagnóstico.

```sh
cargo test --locked -p antares-web-api innertube::tests -- --ignored --nocapture --test-threads=1
cargo test --locked -p antares --lib audio_de_escritorio_y_recuperacion_aac_en_vivo -- --ignored --nocapture
```

## Organización y nombres

- `src/js/`: módulos de interfaz y modelos JavaScript.
- `src-tauri/src/`: servicios, persistencia y comandos Rust.
- `scripts/`: herramientas PowerShell; calculan las rutas desde la raíz del proyecto.
- `docs/`: guías Markdown; el README presenta el proyecto y enlaza las guías.
- `assets/branding/`: originales gráficos que no necesita cargar la interfaz.
- `tests/`: archivos `*.test.mjs` con nombres según la función que prueban.

Los archivos JavaScript nuevos usan nombres en minúsculas con guiones; los módulos Rust siguen `snake_case`. Los módulos existentes conservan sus nombres para mantener los imports y referencias.
