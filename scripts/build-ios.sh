#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
mode="${1:-simulator}"
case "$mode" in
  simulator) rust_target=aarch64-apple-ios-sim; sdk=iphonesimulator; destination='generic/platform=iOS Simulator' ;;
  device) rust_target=aarch64-apple-ios; sdk=iphoneos; destination='generic/platform=iOS' ;;
  *) echo "Uso: sh scripts/build-ios.sh [simulator|device]"; exit 2 ;;
esac
export IPHONEOS_DEPLOYMENT_TARGET=16.4
export CARGO_TARGET_DIR="$PWD/src-tauri/target"
command -v xcodegen >/dev/null || { echo "Hace falta XcodeGen en PATH."; exit 1; }
cargo run --locked -p antares-build
xcodegen generate --spec src-tauri/gen/apple/project.yml
cargo build --locked --manifest-path src-tauri/Cargo.toml --target "$rust_target" --lib --features tauri/custom-protocol
set -- -project src-tauri/gen/apple/Antares.xcodeproj -scheme Antares_iOS -configuration Debug -sdk "$sdk" -destination "$destination" -derivedDataPath src-tauri/gen/apple/DerivedData
if [ "$mode" = simulator ]; then
  xcodebuild "$@" CODE_SIGNING_ALLOWED=NO ARCHS=arm64 build
else
  : "${APPLE_DEVELOPMENT_TEAM:?Configura el equipo de desarrollo de Apple para firmar}"
  xcodebuild "$@" DEVELOPMENT_TEAM="$APPLE_DEVELOPMENT_TEAM" -allowProvisioningUpdates build
fi
