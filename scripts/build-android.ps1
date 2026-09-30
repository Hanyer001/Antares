<#
Compila Antares para Android y deja el APK junto a la carpeta del proyecto.

  .\scripts\build-android.ps1            APK de release, firmado (el que se reparte)
  .\scripts\build-android.ps1 -Debug     APK de depuracion (mas grande, para pruebas)

Necesita las herramientas de %LOCALAPPDATA%\AntaresDev (Java 17, SDK y NDK
de Android) y, para el de release, la clave de src-tauri\gen\android\
keystore.properties (ver README).

Por que no basta con `npx tauri android build`: Tauri enlaza la libreria de
Rust en el proyecto de Android con un enlace simbolico, y Windows solo deja
crearlos con el "Modo de desarrollador" activado. Este script compila Rust con
Tauri (ese paso si funciona), copia la libreria a su sitio y lanza Gradle
saltandose su paso de Rust. Con el Modo de desarrollador activado, el comando
de Tauri a secas tambien vale.
#>
param([switch]$Debug)

$ErrorActionPreference = "Stop"

$dev = Join-Path $env:LOCALAPPDATA "AntaresDev"
$env:JAVA_HOME = Join-Path $dev "jdk"
$env:ANDROID_HOME = Join-Path $dev "sdk"
$env:NDK_HOME = (Get-ChildItem (Join-Path $dev "sdk\ndk") -Directory | Sort-Object Name | Select-Object -Last 1).FullName
$env:PATH = "$(Join-Path $dev 'jdk\bin');$env:PATH"

$root = Split-Path $PSScriptRoot -Parent
$tauri = Join-Path $root "src-tauri"
$android = Join-Path $tauri "gen\android"
$mode = if ($Debug) { "debug" } else { "release" }
$modeTitle = (Get-Culture).TextInfo.ToTitleCase($mode)

if (-not $Debug -and -not (Test-Path (Join-Path $android "keystore.properties"))) {
  throw "Falta src-tauri\gen\android\keystore.properties (la clave de firma). Ver README."
}

# Moviles de 64 bits (casi todos) y de 32 bits (los antiguos).
$targets = @(
  @{ tauri = "aarch64"; triple = "aarch64-linux-android"; abi = "arm64-v8a"; arch = "arm64" },
  @{ tauri = "armv7"; triple = "armv7-linux-androideabi"; abi = "armeabi-v7a"; arch = "arm" }
)

foreach ($t in $targets) {
  Write-Host "== Rust para $($t.abi) ($mode)" -ForegroundColor Cyan
  $flags = "--apk --ci --target $($t.tauri)"
  if ($Debug) { $flags += " --debug" }

  # Termina con error al crear el enlace simbolico: se espera. Lo que importa
  # es que cargo haya compilado ("Finished").
  $out = cmd /c "cd /d `"$root`" && npx tauri android build $flags 2>&1"
  if (-not ($out -match "Finished")) {
    $out | Select-Object -Last 40 | Write-Host
    throw "No compilo Rust para $($t.abi)."
  }

  $so = Join-Path $tauri "target\$($t.triple)\$mode\libantares_lib.so"
  $jni = Join-Path $android "app\src\main\jniLibs\$($t.abi)"
  New-Item -ItemType Directory -Force $jni | Out-Null
  Copy-Item $so (Join-Path $jni "libantares_lib.so") -Force
}

Write-Host "== APK (Gradle)" -ForegroundColor Cyan
$skip = @("rustBuildUniversal$modeTitle") + ($targets | ForEach-Object { "rustBuild$((Get-Culture).TextInfo.ToTitleCase($_.arch))$modeTitle" })
$gradleArgs = @(
  "assembleUniversal$modeTitle",
  "-PabiList=$(($targets | ForEach-Object { $_.abi }) -join ',')",
  "-ParchList=$(($targets | ForEach-Object { $_.arch }) -join ',')",
  "-PtargetList=$(($targets | ForEach-Object { $_.tauri }) -join ',')",
  "--no-daemon"
) + ($skip | ForEach-Object { "-x"; $_ })

Push-Location $android
try {
  & .\gradlew.bat @gradleArgs
  if ($LASTEXITCODE -ne 0) { throw "Gradle fallo." }
} finally {
  Pop-Location
}

$apk = Join-Path $android "app\build\outputs\apk\universal\$mode\app-universal-$mode.apk"
$version = (Get-Content (Join-Path $tauri "tauri.conf.json") -Raw | ConvertFrom-Json).version
$suffix = if ($Debug) { "-debug" } else { "" }
$dest = Join-Path (Split-Path $root -Parent) "Antares-$version$suffix.apk"
Copy-Item $apk $dest -Force

Write-Host ("== Listo: {0} ({1:N1} MB)" -f $dest, ((Get-Item $dest).Length / 1MB)) -ForegroundColor Green
