<p align="center"><img src="assets/branding/icon.svg" alt="Antares icon" width="96" /></p>
<h1 align="center">Antares</h1>
<p align="center">A personal music player built with Rust, Tauri and Leptos.</p>
<p align="center"><strong>English</strong> · <a href="README.es.md">Español</a></p>
<p align="center">
  <a href="https://github.com/Hanyer001/antares-actualizaciones/releases/latest">Windows downloads</a> ·
  <a href="https://github.com/Hanyer001/antares-actualizaciones/releases/tag/android-v0.3.3-beta.1">Android beta</a> ·
  <a href="https://hanyer001.github.io/Pagina-Antares/">Product website</a>
</p>

Antares searches YouTube and YouTube Music, plays audio, organizes playlists and recommends music from listening history. It includes synchronized lyrics, configurable sound effects, themes, profiles and per-user backups.

The source version is **0.3.3**. Published downloads are **Windows 0.3.3** and **Android 0.3.3 Beta 1**. Recent Rust and macOS work is available in this source tree and becomes a downloadable update when a new signed package is published.

## Current development

- **Rust search and extraction.** InnerTube and YouTube Music queries run in Rust. Desktop audio resolution uses InnerTube first and the patched `rusty_ytdl` extractor when needed. Search, imports and audio resolution run without yt-dlp or an external Python runtime.
- **Shared Rust core.** Queue, playback recovery, session handling, search ranking, preference validation and migrations live in `antares-core`. Browser tests exercise the generated WebAssembly.
- **Rust interface components.** Leptos renders navigation, search results, library views, settings groups and player components. JavaScript adapters still connect browser audio, storage, events and native controls.
- **macOS Apple Silicon.** Local QA covers playback, volume controls, seeking, queue transitions, the native playback menu, the mini player, hiding and reopening, and backup restoration. Distribution signing and native Windows validation of this revision are still pending.
- **Data protection and diagnostics.** Atomic writes, recovery copies, isolated users and portable backups preserve device-specific startup and shortcut settings. Optional local diagnostics record bounded timing samples, median and p95.
- **Desktop delivery tools.** Separate workflows validate macOS/Windows candidates and prepare signed delivery artifacts. Rust checks versions, package signatures, hashes and matching revisions before generating update manifests.

The [macOS and Windows progress record](docs/obsidian/Ruta%20de%20mejoras%20para%20macOS%20y%20Windows.md) describes measured scenarios and outstanding checks. Recorded measurements belong to their stated machine and test scope.

## Platform status

| Platform | Availability | Playback and integration |
| --- | --- | --- |
| Windows x64 | Published stable 0.3.3. Current source has additional changes awaiting native validation. | Rust resolution, WebView2/Web Audio, tray, mini player, taskbar thumbnail and global shortcuts. |
| Android ARM 32/64 | Published 0.3.3 Beta 1, Android 7.0+. | Rust resolution, Kotlin Media3/ExoPlayer service, background playback and lock-screen controls. |
| macOS Apple Silicon | Build from source and local QA packages. | Rust resolution with AAC, a local HTTP bridge for WKWebView, playback menu, menu-bar controls and mini player. |
| Web / iPhone | Experimental PWA and iOS source adaptation. | Shared Wasm interface, browser or native playback according to the build. The PWA needs a separately hosted Rust API. |
| Linux / Fedora | Experimental source adaptation. | Rust backend and local HTTP audio bridge for WebKitGTK. |

Search and playback require internet access. Availability depends on the queried services. GitHub Pages hosts the static interface. The Rust API and persistent libraries need their own server. Account authentication remains on the [separate accounts branch](https://github.com/Hanyer001/Antares/tree/feat/cuentas-web).

## Features

- Song and link search, albums in order, artist pages, queue, shuffle, repeat and session resume.
- Playlists, folders, covers, descriptions, bulk actions and listening-based smart lists.
- Recommendations, radios, discovery controls, listening statistics and incognito mode.
- Synchronized lyrics, equalizer, loudness control and transitions according to platform capabilities.
- Themes, fonts, layout controls, settings profiles and per-user export/restore.
- Imports from supported public music services, text and CSV.

See [features and usage](docs/features.md) for supported formats and platform differences.

## Build and test

Install Rust, Node.js 24 and the native prerequisites for your system. Windows requires MSVC C++ Build Tools and WebView2. macOS requires Xcode command-line tools and its accepted license.

```sh
git clone https://github.com/Hanyer001/Antares.git
cd Antares
rustup target add wasm32-unknown-unknown
cargo install tauri-cli --version 2.11.4 --locked
cargo install wasm-bindgen-cli --version 0.2.130 --locked
npm ci
cargo tauri dev
```

Tauri builds the Wasm engine before starting. Generate the engine before running desktop Rust tests in a fresh checkout.

```sh
npm test
cargo test --locked -p antares -p antares-core --lib
cargo test --locked -p antares-build
cargo test --locked -p antares-web-api
cargo run --locked -p antares-build -- release-check
```

Network, live-service and signed-delivery tests run separately. Native Windows, macOS distribution signing and physical device checks are tracked independently from automated tests.

## Repository map

```text
Cargo.toml / Cargo.lock   Shared Rust workspace and dependency lock
crates/antares-core/      Queue, recovery, session, search, preferences and timing summaries
crates/antares-ui/        Leptos components and Wasm/browser bridges
crates/antares-build/     Wasm generation, release verification and startup measurements
src/                     HTML/CSS, browser adapters and generated engine assets
src-tauri/src/           Native Rust services, persistence and Tauri commands
src-tauri/gen/android/   Android project and Kotlin playback service
src-tauri/ios-player/    iOS playback plugin
src-tauri/vendor/        Patched Rust YouTube extractor
web/                     PWA bootstrap, manifest and service worker
web-api/                 Rust API and server-side library storage
deploy/                  Hosting configuration
tests/                   Client tests, including the real Wasm core
docs/obsidian/           Architecture notes, migration routes and validation records
.github/workflows/       Pages, desktop validation and signed-delivery preparation
```

`src/engine/` is generated and excluded from Git. Build scripts generate it from the Rust workspace.

## Project repositories

| Repository | Responsibility |
| --- | --- |
| [Antares](https://github.com/Hanyer001/Antares) | Application source and documentation. |
| [Pagina-Antares](https://github.com/Hanyer001/Pagina-Antares) | Product website published with GitHub Pages. |
| [antares-actualizaciones](https://github.com/Hanyer001/antares-actualizaciones) | Published installers and signed update manifests. |

A source change and a published installer have separate delivery steps. Follow the [release guide](docs/releases.md) to prepare and verify packages.

## Documentation and feedback

Detailed guides are currently in Spanish.

[Development](docs/development.md) · [Architecture](docs/architecture.md) · [Data and backups](docs/data.md) · [macOS](docs/MACOS.md) · [Android](docs/android.md) · [Web and iOS](docs/WEB.md) · [Fedora](docs/LINUX.md) · [Releases](docs/releases.md) · [Changelog](CHANGELOG.md)

Report reproducible problems in [Issues](https://github.com/Hanyer001/Antares/issues), including the version, operating system and expected behavior.

Built with Rust, Tauri 2, Leptos, HTML/CSS and JavaScript adapters. Playback integrations include InnerTube, `rusty_ytdl`, Media3/ExoPlayer and the iOS player plugin. Lyrics use LRCLIB. Font credits are preserved in [src/fonts/LEEME.txt](src/fonts/LEEME.txt).
