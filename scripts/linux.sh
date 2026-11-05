#!/usr/bin/env bash
# Herramientas y compilaciones de Linux en el HDD, separadas de Windows.
set -euo pipefail
PROJECT_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
DISK_ROOT="$(cd -- "$PROJECT_ROOT/../../.." && pwd -P)"
export ANTARES_LINUX_ROOT="${ANTARES_LINUX_ROOT:-$DISK_ROOT/Linux}"
TOOLS="$ANTARES_LINUX_ROOT/Herramientas"
export CARGO_HOME="$TOOLS/cargo"
export RUSTUP_HOME="$TOOLS/rustup"
export CARGO_TARGET_DIR="$ANTARES_LINUX_ROOT/Compilaciones/Antares"
export npm_config_cache="$ANTARES_LINUX_ROOT/Cache/npm"
export XDG_CACHE_HOME="$ANTARES_LINUX_ROOT/Cache"
export XDG_DATA_HOME="$ANTARES_LINUX_ROOT/Datos"
export TMPDIR="$ANTARES_LINUX_ROOT/Temporales"
export CARGO_BUILD_JOBS="${CARGO_BUILD_JOBS:-4}"
export CARGO_PROFILE_DEV_DEBUG=0
export CARGO_PROFILE_TEST_DEBUG=0
export CARGO_INCREMENTAL=0
export PATH="$TOOLS/node/bin:$CARGO_HOME/bin:$PATH"
CLI="$TOOLS/antares-cli/node_modules/@tauri-apps/cli/tauri.js"
fail() { printf '%s\n' "$*" >&2; exit 1; }
download() { curl --fail --location --retry 3 --connect-timeout 20 --proto '=https' --tlsv1.2 "$1" -o "$2"; }
prepare_dirs() { mkdir -p "$TOOLS" "$CARGO_HOME" "$RUSTUP_HOME" "$CARGO_TARGET_DIR" "$npm_config_cache" "$XDG_DATA_HOME" "$TMPDIR"; }
require_tools() {
  [[ -x "$TOOLS/node/bin/node" && -x "$CARGO_HOME/bin/cargo" && -f "$CLI" ]] || fail "Primero ejecuta: bash scripts/linux.sh preparar"
}
configure_webview() {
  # En GNOME/Wayland, no heredar X11 de la app que abre la terminal.
  # Wayland directo permite DMABUF/GPU; la sincronización explícita de NVIDIA
  # necesita este ajuste en WebKitGTK. Solo afecta a Antares, no al sistema.
  if [[ -d /sys/module/nvidia && ( -n "${WAYLAND_DISPLAY:-}" || "${XDG_SESSION_TYPE:-}" == wayland ) ]]; then
    export GDK_BACKEND="${ANTARES_GDK_BACKEND:-wayland}"
    export __NV_DISABLE_EXPLICIT_SYNC="${__NV_DISABLE_EXPLICIT_SYNC:-1}"
    export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-0}"
    # WebKit 2.54: en este equipo TextureMapper mejoró algo el scroll.
    # Conserva la GPU y permite volver a Skia mediante una anulación explícita.
    export WEBKIT_USE_SKIA_FOR_COMPOSITION="${WEBKIT_USE_SKIA_FOR_COMPOSITION:-0}"
  fi
}
system_check() {
  local missing=0
  for tool in cc c++ make pkg-config curl tar xz git; do
    command -v "$tool" >/dev/null || { printf 'Falta: %s\n' "$tool"; missing=1; }
  done
  for library in webkit2gtk-4.1 gtk+-3.0 openssl librsvg-2.0 appindicator3-0.1; do
    if ! pkg-config --exists "$library"; then
      printf 'Falta biblioteca de desarrollo: %s\n' "$library"; missing=1
    fi
  done
  (( missing == 0 )) || fail "Consulta docs/LINUX.md para instalar los paquetes de Fedora."
}
prepare() {
  [[ "$(uname -s)" == Linux && "$(uname -m)" == x86_64 ]] || fail "Este asistente prepara Fedora Linux x86_64."
  (( EUID != 0 )) || fail "Ejecuta este script con tu usuario, sin sudo."
  system_check
  prepare_dirs
  if [[ ! -x "$TOOLS/node/bin/node" ]]; then
    local sums="$TMPDIR/node-SHASUMS256.txt" archive staging
    download https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt "$sums"
    archive="$(awk '$2 ~ /^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$/ { print $2; exit }' "$sums")"
    [[ "$archive" =~ ^node-v24\.[0-9]+\.[0-9]+-linux-x64\.tar\.xz$ ]] || fail "No se pudo identificar Node 24 oficial."
    download "https://nodejs.org/dist/latest-v24.x/$archive" "$TMPDIR/$archive"
    (cd "$TMPDIR" && awk -v name="$archive" '$2 == name' "$sums" | sha256sum --check -)
    staging="$(mktemp -d "$TOOLS/node-preparacion.XXXXXX")"
    tar -xJf "$TMPDIR/$archive" -C "$staging" --strip-components=1
    [[ ! -e "$TOOLS/node" ]] || fail "Ya existe $TOOLS/node; revisa la instalación incompleta antes de continuar."
    mv -- "$staging" "$TOOLS/node"
    rm -- "$TMPDIR/$archive"
  fi
  if [[ ! -x "$CARGO_HOME/bin/rustup" ]]; then
    download https://sh.rustup.rs "$TMPDIR/rustup-init.sh"
    sh "$TMPDIR/rustup-init.sh" -y --profile minimal --default-toolchain stable --no-modify-path
  fi
  if ! rustc --version >/dev/null 2>&1; then
    rustup toolchain install stable --profile minimal
    rustup default stable
  fi
  rustup component add rustfmt clippy
  local cli_version
  cli_version="$(node -p 'JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8")).packages["node_modules/@tauri-apps/cli"].version' "$PROJECT_ROOT/package-lock.json")"
  if [[ ! -f "$CLI" ]] || [[ "$(node -p 'require(process.argv[1]).version' "$TOOLS/antares-cli/node_modules/@tauri-apps/cli/package.json")" != "$cli_version" ]]; then
    npm install --prefix "$TOOLS/antares-cli" --no-audit --no-fund --package-lock=false "@tauri-apps/cli@$cli_version"
  fi
  local sidecar="$PROJECT_ROOT/src-tauri/binaries/yt-dlp-x86_64-unknown-linux-gnu"
  if [[ ! -f "$sidecar" ]]; then
    local staged="$sidecar.part" checksums="$TMPDIR/ytdlp-SHA2-256SUMS" expected actual tag
    mkdir -p "$PROJECT_ROOT/src-tauri/binaries"
    tag="$(curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest | node -e 'let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>process.stdout.write(JSON.parse(s).tag_name))')"
    [[ "$tag" =~ ^[0-9]{4}\.[0-9]{2}\.[0-9]{2}([.][0-9]+)?$ ]] || fail "Etiqueta de yt-dlp inesperada."
    download "https://github.com/yt-dlp/yt-dlp/releases/download/$tag/SHA2-256SUMS" "$checksums"
    expected="$(awk '$2 == "yt-dlp_linux" || $2 == "*yt-dlp_linux" {print $1; exit}' "$checksums")"
    [[ "$expected" =~ ^[a-fA-F0-9]{64}$ ]] || fail "Falta el checksum de yt-dlp_linux."
    download "https://github.com/yt-dlp/yt-dlp/releases/download/$tag/yt-dlp_linux" "$staged"
    actual="$(sha256sum "$staged")"; actual="${actual%% *}"
    [[ "$actual" == "$expected" ]] || fail "Checksum incorrecto de yt-dlp. No se instala."
    chmod u+x "$staged"
    "$staged" --version
    mv -- "$staged" "$sidecar"
  fi
  node --version
  npm --version
  rustc --version
  cargo --version
  printf '\nHerramientas listas en: %s\nSiguiente paso: bash scripts/linux.sh comprobar\n' "$ANTARES_LINUX_ROOT"
}
cd "$PROJECT_ROOT"
case "${1:-ayuda}" in
  preparar) prepare ;;
  diagnostico)
    system_check
    printf 'Proyecto: %s\nHerramientas y datos: %s\nCompilaciones: %s\n' "$PROJECT_ROOT" "$ANTARES_LINUX_ROOT" "$CARGO_TARGET_DIR"
    command -v node cargo || true
    df -h "$PROJECT_ROOT" /
    ;;
  comprobar)
    prepare_dirs; require_tools; system_check
    cargo check --locked --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tee "$CARGO_TARGET_DIR/check.log"
    ;;
  pruebas)
    prepare_dirs; require_tools
    node --test tests/*.test.mjs
    cargo test --locked --manifest-path src-tauri/Cargo.toml --lib 2>&1 | tee "$CARGO_TARGET_DIR/test.log"
    ;;
  abrir)
    prepare_dirs; require_tools; system_check
    configure_webview
    exec node "$CLI" dev -- --locked
    ;;
  ejecutar)
    prepare_dirs
    configure_webview
    [[ -x "$CARGO_TARGET_DIR/release/Antares" ]] || fail "Primero ejecuta: bash scripts/linux.sh compilar"
    exec "$CARGO_TARGET_DIR/release/Antares"
    ;;
  compilar)
    prepare_dirs; require_tools; system_check
    exec node "$CLI" build --no-bundle -- --locked
    ;;
  *) printf 'Uso: bash scripts/linux.sh {preparar|diagnostico|comprobar|pruebas|abrir|compilar|ejecutar}\n' ;;
esac
