// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "tauri-plugin-antares-ios",
    platforms: [.iOS(.v16)],
    products: [.library(name: "tauri-plugin-antares-ios", type: .static, targets: ["AntaresPlayer"])],
    dependencies: [.package(name: "Tauri", path: "../.tauri/tauri-api")],
    targets: [.target(name: "AntaresPlayer", dependencies: ["Tauri"], path: "Sources")]
)
