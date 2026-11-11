# Prepara una versión nueva de Antares para que les llegue a todos sola.
#
#   powershell -ExecutionPolicy Bypass -File .\scripts\release-windows.ps1 -Notas "Qué trae de nuevo"
#
# Antes: sube el número de versión en package.json, src-tauri/Cargo.toml y
# src-tauri/tauri.conf.json (los tres igual, y mayor que el anterior).
#
# Hace esto:
#   1. Compila el instalador y lo FIRMA con la clave privada de
#      ..\firma-actualizaciones (sin esa firma, la app de tus amigos rechaza
#      la actualización).
#   2. Deja en ..\publicar\vX.Y.Z el instalador, una copia suya con nombre fijo
#      (Antares-Setup.exe, la que descarga la página) y el latest.json que la
#      app lee para saber que hay una versión nueva.
#
# Después, a mano, en https://github.com/Hanyer001/antares-actualizaciones:
#   Revisa la carpeta de entrega y sigue docs/releases.md.

param(
    [string]$Notas = "",
    [switch]$NoAbrir
)

$ErrorActionPreference = "Stop"

$raiz = Split-Path $PSScriptRoot -Parent
$padre = Split-Path $raiz -Parent
$firma = Join-Path $padre "firma-actualizaciones"
$repo = "https://github.com/Hanyer001/antares-actualizaciones"

Push-Location $raiz
try {
    cargo run --locked -p antares-build -- release-check
    if ($LASTEXITCODE -ne 0) { throw "Las versiones de la entrega no coinciden." }
}
finally { Pop-Location }
$version = (Get-Content (Join-Path $raiz "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version

# --- La firma -----------------------------------------------------------------

$clave = Join-Path $firma "antares-updater.key"
$contrasena = Join-Path $firma "contrasena.txt"
if (-not (Test-Path $clave) -or -not (Test-Path $contrasena)) {
    Write-Host "No encuentro la clave de firma en $firma." -ForegroundColor Red
    Write-Host "Sin ella no se puede publicar: las apps ya instaladas solo aceptan versiones firmadas con esa clave."
    exit 1
}

if (-not $Notas) {
    $Notas = Read-Host "Qué trae de nuevo esta versión (una línea; Enter para dejarlo vacío)"
}

Write-Host "Compilando Antares $version (tarda unos minutos)..." -ForegroundColor Cyan

# La clave va por variables de entorno solo para esta compilación: no se
# escribe en ningún archivo del proyecto ni se muestra.
$env:TAURI_SIGNING_PRIVATE_KEY = (Get-Content $clave -Raw).Trim()
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = (Get-Content $contrasena -Raw).Trim()
try {
    Push-Location $raiz
    cargo tauri build --target x86_64-pc-windows-msvc
    if ($LASTEXITCODE -ne 0) { throw "La compilación falló (código $LASTEXITCODE)." }
}
finally {
    Pop-Location
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

$nsis = Join-Path $raiz "src-tauri\target\x86_64-pc-windows-msvc\release\bundle\nsis"
$exe = Join-Path $nsis "Antares_${version}_x64-setup.exe"
$salida = Join-Path $padre "publicar\v$version\windows-x86_64"
$notasTemporal = [IO.Path]::GetTempFileName()
try {
    [IO.File]::WriteAllText($notasTemporal, $Notas, (New-Object Text.UTF8Encoding $false))
    Push-Location $raiz
    try {
        cargo run --locked -p antares-build -- release-stage windows-x86_64 $exe $salida $notasTemporal
        if ($LASTEXITCODE -ne 0) { throw "No se pudo verificar y preparar la entrega." }
    }
    finally { Pop-Location }
}
finally { Remove-Item $notasTemporal -ErrorAction SilentlyContinue }
Copy-Item (Join-Path $salida "Antares_${version}_x64-setup.exe") (Join-Path $salida "Antares-Setup.exe")
Write-Host "Entrega verificada en $salida. Revisa latest.json, revision.json y SHA256SUMS antes de publicarla."
if (-not $NoAbrir) { explorer.exe $salida }
