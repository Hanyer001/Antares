#!/bin/sh
# Preparar una entrega notarizada. Las credenciales se reciben por entorno.
set -eu
root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
[ "$(uname -s):$(uname -m)" = Darwin:arm64 ] || { echo "Este asistente entrega macOS Apple Silicon." >&2; exit 1; }
: "${APPLE_SIGNING_IDENTITY:?Configura una identidad Developer ID Application}"
case "$APPLE_SIGNING_IDENTITY" in
  "Developer ID Application:"*) ;;
  *) echo "La entrega necesita una identidad Developer ID Application." >&2; exit 1 ;;
esac
: "${TAURI_SIGNING_PRIVATE_KEY:?Configura la clave de actualización}"
: "${APPLE_ID:?Configura la cuenta de notarización}"
: "${APPLE_PASSWORD:?Configura la contraseña de aplicación para notarización}"
: "${APPLE_TEAM_ID:?Configura el equipo de Apple}"
notes=${1:?Indica un archivo Markdown con las notas}
destination=${2:?Indica una carpeta nueva para la entrega}
cargo run --locked -p antares-build -- release-check
cargo tauri build --target aarch64-apple-darwin --bundles app,dmg \
  --config '{"bundle":{"createUpdaterArtifacts":true}}'
bundle=src-tauri/target/aarch64-apple-darwin/release/bundle/macos
codesign --verify --deep --strict "$bundle/Antares.app"
spctl --assess --type execute "$bundle/Antares.app"
cargo run --locked -p antares-build -- release-stage darwin-aarch64 \
  "$bundle/Antares.app.tar.gz" "$destination" "$notes"
