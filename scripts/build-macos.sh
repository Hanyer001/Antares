#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$root"
case "$(uname -s):$(uname -m)" in
  Darwin:arm64) target=aarch64-apple-darwin ;;
  Darwin:x86_64) target=x86_64-apple-darwin ;;
  *) echo "Ejecuta este asistente desde macOS." >&2; exit 1 ;;
esac

version=2026.10.26
sha=0f922c15ccc0b83eefa1c8bc9104e434318c4bf16e408e1ee93b7745a6efe0aa
# Conserva la firma original del binario universal. Si Tauri lo vuelve a
# firmar como sidecar, PyInstaller no puede cargar su propia biblioteca.
sidecar="$root/src-tauri/binaries/yt-dlp-macos"
valid_sidecar() {
  [ -f "$1" ] && printf '%s  %s\n' "$sha" "$1" | shasum -a 256 -c - >/dev/null
}
if ! valid_sidecar "$sidecar"; then
  mkdir -p "$(dirname -- "$sidecar")"
  staging=$(mktemp "${sidecar}.XXXXXX")
  trap 'rm -f "$staging"' EXIT
  curl --fail --location --silent --show-error --retry 2 \
    "https://github.com/yt-dlp/yt-dlp/releases/download/$version/yt-dlp_macos" -o "$staging"
  valid_sidecar "$staging"
  chmod 755 "$staging"
  mv -f "$staging" "$sidecar"
fi
if [ "${1:-}" = "--prepare" ]; then
  exit 0
fi
if [ ! -x node_modules/.bin/tauri ]; then
  npm ci
fi
npm run tauri -- build --target "$target" "$@"
