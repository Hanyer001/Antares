[English](README.md) · **Español**

<p align="center">
  <img src="assets/branding/icon.svg" alt="Antares" width="96" />
</p>

<h1 align="center">Antares</h1>

<p align="center">Tu música, tus listas y nuevas canciones por descubrir.</p>
<p align="center"><strong>Rust · Tauri 2 · Leptos · Windows · Android · macOS en desarrollo</strong></p>

Antares es un reproductor de música que permite buscar canciones en YouTube, organizar una biblioteca personal y descubrir música a partir de tus escuchas. Combina una interfaz personalizable con listas inteligentes, letras sincronizadas y controles de reproducción integrados en el sistema.

La versión del código es **0.3.3**. Las descargas publicadas corresponden a Windows **0.3.3** y Android **0.3.3 Beta 1**. Los avances recientes de Rust y macOS están en este árbol de fuentes y se distribuyen cuando se publica un nuevo paquete firmado en [antares-actualizaciones](https://github.com/Hanyer001/antares-actualizaciones/releases).

## Novedades de 0.3.3

- Listas de Spotify con más de 100 canciones, paginación y resumen de coincidencias.
- Álbumes completos en orden y enlaces de listas de otros servicios reconocidos desde la búsqueda.
- Cinco principales al reproducir un artista, con continuación habitual y una vista compacta.
- Botón **Solo este artista** para escuchar su catálogo desde la cola, sin recomendaciones ajenas.
- Código Android con recuperación de cortes, diseños predefinidos, gestos, Deshacer en la cola y control del descubrimiento. Continúa como versión de pruebas.

La copia de `rusty_ytdl` y su parche de cliente YouTube se documentan en [ANTARES_PATCH.md](src-tauri/vendor/rusty_ytdl/ANTARES_PATCH.md). No cambia la arquitectura de reproducción de Tauri ni el proxy de audio.

[Descargar Antares 0.3.3 para Windows](https://github.com/Hanyer001/antares-actualizaciones/releases/download/v0.3.3/Antares-Setup.exe) · [Página de Antares](https://hanyer001.github.io/Pagina-Antares/)

## Desarrollo actual

- Las búsquedas de YouTube y YouTube Music, las importaciones y la resolución de audio se ejecutan en Rust. InnerTube es la primera ruta de audio y el extractor `rusty_ytdl` queda como respaldo en escritorio. Estas funciones prescinden de yt-dlp y de un intérprete externo de Python.
- `antares-core` comparte cola, recuperación, sesión, orden de búsqueda, esquema de preferencias, validación y migraciones. Sus funciones se compilan a WebAssembly para el cliente.
- Leptos aporta componentes de navegación, búsqueda, biblioteca, ajustes y reproductor. Los adaptadores JavaScript conectan Web Audio, almacenamiento, eventos y controles nativos.
- macOS Apple Silicon tiene compilación y pruebas locales de reproducción, volumen, saltos, cola, menú Reproducción, mini y restauración de copias. La firma de distribución y las pruebas nativas de esta revisión en Windows siguen pendientes.
- El diagnóstico local registra tiempos, mediana y p95 con muestras acotadas. El índice Rust reutiliza el texto normalizado al filtrar una colección.
- Las copias completas conservan los ajustes de inicio y atajos globales del equipo de destino. Antes de salir o instalar se fuerza el guardado de datos pendientes.
- Los flujos de escritorio y entrega comprueban versiones, firmas, sumas SHA-256 y revisión del código. La [ruta de macOS y Windows](docs/obsidian/Ruta%20de%20mejoras%20para%20macOS%20y%20Windows.md) recoge evidencias y comprobaciones pendientes.

## Funciones principales

| | Qué puedes hacer |
| --- | --- |
| **Reproducción** | Buscar por canción o enlace, gestionar la cola, repetir, barajar y retomar la última sesión. |
| **Álbumes y artistas** | Escuchar discos completos en orden, cinco principales con continuación habitual, o elegir Solo este artista. |
| **Biblioteca** | Crear listas, fijarlas, agruparlas en carpetas y añadir portadas y descripciones. Buscar y mover varias canciones a la vez. |
| **Listas inteligentes** | Combinar reglas de favoritos, artista, escuchas, saltos y tiempo sin reproducir. |
| **Descubrimiento** | Crear radios, ajustar la proporción de canciones nuevas y elegir momentos como Trabajo, Fiesta o Relax. |
| **Letras y sonido** | Seguir letras sincronizadas; usar ecualizador, nivelador y fundidos con las capacidades de cada plataforma. |
| **Personalización** | Elegir temas, colores, fuentes, fondos, distribución y atajos. Guardar combinaciones como perfiles. |
| **Datos** | Consultar estadísticas, usar modo incógnito y crear o restaurar copias completas por usuario. |

También permite importar listas públicas de otros servicios y canciones desde texto o CSV. La guía de [funciones](docs/features.md) explica los formatos y las diferencias entre plataformas.

## Plataformas

| Plataforma | Disponibilidad | Reproducción e integración |
| --- | --- | --- |
| Windows x64 | 0.3.3 estable publicada. El código actual añade cambios pendientes de validación nativa. | Rust, WebView2 y Web Audio. Bandeja, mini, miniatura de la barra de tareas y atajos globales. |
| Android ARM 32/64 | 0.3.3 Beta 1 publicada, Android 7.0 o posterior. | Resolución Rust y servicio Kotlin Media3/ExoPlayer. Audio en segundo plano y controles de bloqueo. |
| macOS Apple Silicon | Compilación desde fuentes y paquetes QA locales. | Rust, AAC y puente HTTP para WKWebView. Menú Reproducción, barra de menús y mini. |
| Web / iPhone | PWA y adaptación iOS experimentales. | Interfaz Wasm compartida. La reproducción depende del navegador o reproductor nativo de la compilación. |
| Linux / Fedora | Adaptación experimental desde fuentes. | Rust y puente HTTP de audio para WebKitGTK. |

La [guía Android](docs/android.md), la [guía de macOS](docs/MACOS.md) y la [guía web/iOS](docs/WEB.md) detallan cada recorrido. La PWA necesita una API Rust alojada en un servidor. GitHub Pages sirve su interfaz estática. El trabajo de autenticación está en la [rama de cuentas](https://github.com/Hanyer001/Antares/tree/feat/cuentas-web).

La búsqueda y la reproducción requieren conexión. La disponibilidad de canciones y letras depende de los servicios consultados.

## Ejecutar en desarrollo

Instala Rust y Node.js 24. Windows necesita el target MSVC, Microsoft C++ Build Tools y WebView2. macOS necesita las herramientas de Xcode y su licencia aceptada. La [guía de desarrollo](docs/development.md) describe también PWA y Android.

```powershell
git clone https://github.com/Hanyer001/Antares.git
cd Antares
rustup target add wasm32-unknown-unknown
cargo install tauri-cli --version 2.11.4 --locked
cargo install wasm-bindgen-cli --version 0.2.130 --locked
npm ci
cargo tauri dev
```

La interfaz utiliza las API de Tauri: abrir `src/index.html` directamente en el navegador no sustituye el modo de desarrollo.

## Estructura del proyecto

```text
Antares/
├── Cargo.toml / Cargo.lock  Workspace y dependencias Rust compartidas
├── crates/
│   ├── antares-core/        Cola, recuperación, sesión, búsqueda, preferencias y tiempos
│   ├── antares-ui/          Componentes Leptos y puente WebAssembly
│   └── antares-build/       Generación Wasm, verificación de entregas y mediciones
├── src/                    HTML, CSS y adaptadores del navegador
│   └── engine/             Motor Wasm generado, excluido de Git
├── src-tauri/
│   ├── src/                Servicios Rust, persistencia y comandos Tauri
│   ├── gen/android/        Proyecto Android y servicio Kotlin
│   ├── ios-player/         Plugin de reproducción iOS
│   └── vendor/             Extractor Rust con parche de cliente YouTube
├── web/                    Bootstrap, manifiesto y service worker de la PWA
├── web-api/                API Rust y bibliotecas del servidor
├── deploy/                 Configuración de alojamiento
├── scripts/                Compilación, publicación y diagnóstico
├── tests/                  Pruebas del cliente y del motor Wasm real
├── docs/obsidian/           Notas, rutas de migración y registros de validación
└── .github/workflows/      Pages, validación de escritorio y preparación de entrega
```

El código está en [Antares](https://github.com/Hanyer001/Antares), la web de presentación en [Pagina-Antares](https://github.com/Hanyer001/Pagina-Antares) y los instaladores en [antares-actualizaciones](https://github.com/Hanyer001/antares-actualizaciones).

## Generar el instalador de Windows

Con los archivos de firma del canal configurados según la [guía de publicación](docs/releases.md), ejecuta desde la raíz del proyecto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-windows.ps1 -Notas "Listas completas, albumes y modo Solo este artista"
```

El script prepara el instalador, su firma, la copia con nombre fijo, notas, `SHA256SUMS`, `revision.json` y `latest.json` en una carpeta nueva por versión y arquitectura. La herramienta Rust exige una revisión guardada, versiones coherentes y una firma válida. La [guía de publicación](docs/releases.md) incluye el asistente de macOS y la unión de manifiestos de ambos sistemas.

## Comprobaciones

Tras instalar dependencias, ejecuta desde la raíz. `npm test` genera primero el motor Wasm necesario para las pruebas de escritorio.

```powershell
npm test
cargo test --locked -p antares -p antares-core --lib
cargo test --locked -p antares-build
cargo test --locked -p antares-web-api
cargo run --locked -p antares-build -- release-check
```

Las pruebas que necesitan servicios externos o paquetes firmados están marcadas como ignoradas y se ejecutan por separado. Estos comandos no generan instaladores.

## Documentación

- [Funciones y uso](docs/features.md)
- [Entorno de desarrollo y pruebas](docs/development.md)
- [Arquitectura y responsabilidades](docs/architecture.md)
- [Datos locales y copias de seguridad](docs/data.md)
- [Compilación y publicación de versiones](docs/releases.md)
- [Cambios de la versión 0.3.3](CHANGELOG.md)

## Reportar un problema

Abre un [issue](https://github.com/Hanyer001/Antares/issues) indicando la versión, el sistema operativo, los pasos para reproducirlo y qué esperabas que ocurriera. Para problemas de reproducción, incluye el enlace de una canción de ejemplo si es público.

## Tecnologías

[Tauri](https://v2.tauri.app/), [Rust](https://www.rust-lang.org/), HTML, CSS y JavaScript con módulos ES. El catálogo usa InnerTube en Rust y el audio de escritorio usa [rusty_ytdl](https://github.com/Mithronn/rusty_ytdl). Android usa ExoPlayer y [LRCLIB](https://lrclib.net/) proporciona las letras. La fuente Inter se incluye localmente; sus créditos están en [src/fonts/LEEME.txt](src/fonts/LEEME.txt).


### Antares Android 0.3.3 Beta 1

La primera edición pública **0.3.3 Beta 1** incorpora la interfaz móvil compacta, playlists, búsqueda musical, audio nativo y doce tipografías locales. [Descargar para Android](https://github.com/Hanyer001/antares-actualizaciones/releases/download/android-v0.3.3-beta.1/Antares-Android.apk) · [Instalación, migración y validación](docs/android.md). Las actualizaciones públicas conservan el identificador y la firma; el aviso automático en Android aún no está implementado.

