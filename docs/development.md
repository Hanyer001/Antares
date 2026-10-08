# Desarrollo

## Windows

Instala Node.js 22 o posterior, npm y Rust con el toolchain MSVC. Tauri requiere Microsoft C++ Build Tools con la carga **Desarrollo para el escritorio con C++** y el runtime WebView2. Consulta los [prerrequisitos oficiales](https://v2.tauri.app/start/prerequisites/) para la instalación.

```powershell
git clone https://github.com/Hanyer001/Antares.git
cd Antares
npm ci
```

Descarga `yt-dlp.exe` de sus [releases oficiales](https://github.com/yt-dlp/yt-dlp/releases/latest), crea `src-tauri/binaries/` y copia el archivo como `yt-dlp-x86_64-pc-windows-msvc.exe`. El sufijo corresponde al target de Rust que Tauri usa para el ejecutable auxiliar. Se conserva para búsquedas y listas. Desde 0.3.2, la extracción de audio en Windows usa `rusty_ytdl`, incluido con su parche de cliente YouTube en `src-tauri/vendor/rusty_ytdl/`.

```powershell
npm run dev
```

El frontend se sirve desde `src/`. No hay un framework ni una compilación separada de JavaScript. Las llamadas a Rust usan `window.__TAURI__`, disponible dentro de la aplicación.

## Comandos habituales

| Comando desde la raíz | Función |
| --- | --- |
| `npm run dev` | Abre Tauri en desarrollo. |
| `npm test` | Ejecuta las pruebas de JavaScript. |
| `npm run check:rust` | Comprueba el backend sin generar un instalador. |
| `npm run test:rust` | Ejecuta las pruebas del backend. |
| `npm run tauri -- --help` | Muestra los comandos de la CLI de Tauri. |

Las dependencias JavaScript y Rust están fijadas mediante `package-lock.json` y `Cargo.lock`. Los comandos de Rust necesitan el ejecutable auxiliar de yt-dlp para la configuración de escritorio.

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

El proyecto nativo está en `src-tauri/gen/android/`. La configuración `tauri.android.conf.json` elimina el ejecutable auxiliar de escritorio. El audio usa ExoPlayer mediante `PlaybackService.kt` y `PlayerPlugin.kt`.

El script `scripts/build-android.ps1` espera esta instalación local:

```text
%LOCALAPPDATA%/AntaresDev/
├── jdk/                   # Java 17 o posterior
└── sdk/                   # SDK de Android
    └── ndk/               # NDK instalado
```

También necesita los targets Rust `aarch64-linux-android` y `armv7-linux-androideabi`. Para una versión firmada requiere `src-tauri/gen/android/keystore.properties` y la clave a la que apunta. Esos archivos no forman parte del repositorio.

El script compila Rust para ambas arquitecturas y copia las bibliotecas al proyecto Android antes de ejecutar Gradle. Evita depender de la creación de enlaces simbólicos en Windows. Los comandos que generan APK se encuentran en [publicación](releases.md). El SDK usado es Android 36 y el mínimo de la app es Android 7 (API 24). Para el APK de pruebas optimizado y las diferencias entre plataformas, consulta [Android](android.md).

## Diagnóstico de audio

El siguiente script compara el extractor externo de yt-dlp como referencia; no mide la extracción nativa que usa Windows desde 0.3.2:

```powershell
.\scripts\benchmark-ytdlp.ps1 "radiohead creep"
```

Para probar InnerTube en escritorio:

```powershell
$env:ANTARES_SOURCE = "innertube"
npm run dev
Remove-Item Env:ANTARES_SOURCE
```

## Organización y nombres

- `src/js/`: módulos de interfaz y modelos JavaScript.
- `src-tauri/src/`: servicios, persistencia y comandos Rust.
- `scripts/`: herramientas PowerShell; calculan las rutas desde la raíz del proyecto.
- `docs/`: guías Markdown; el README presenta el proyecto y enlaza las guías.
- `assets/branding/`: originales gráficos que no necesita cargar la interfaz.
- `tests/`: archivos `*.test.mjs` con nombres según la función que prueban.

Los archivos JavaScript nuevos usan nombres en minúsculas con guiones; los módulos Rust siguen `snake_case`. Los módulos existentes conservan sus nombres para mantener los imports y referencias.
