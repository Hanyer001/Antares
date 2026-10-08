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
#   Releases › Draft a new release › etiqueta "vX.Y.Z" › arrastra los TRES
#   archivos de la carpeta › Publish release.

param(
    [string]$Notas = "",
    [switch]$NoAbrir
)

$ErrorActionPreference = "Stop"

$raiz = Split-Path $PSScriptRoot -Parent
$padre = Split-Path $raiz -Parent
$firma = Join-Path $padre "firma-actualizaciones"
$repo = "https://github.com/Hanyer001/antares-actualizaciones"

# --- La versión, igual en los tres sitios -----------------------------------

$version = (Get-Content (Join-Path $raiz "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
$npm = (Get-Content (Join-Path $raiz "package.json") -Raw | ConvertFrom-Json).version
$cargo = (Select-String -Path (Join-Path $raiz "src-tauri\Cargo.toml") -Pattern '^version = "(.+)"' | Select-Object -First 1).Matches[0].Groups[1].Value

if ($version -ne $npm -or $version -ne $cargo) {
    Write-Host "Las versiones no coinciden: tauri.conf.json $version, package.json $npm, Cargo.toml $cargo." -ForegroundColor Red
    Write-Host "Pon el mismo número en los tres y vuelve a intentarlo."
    exit 1
}

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
    npm run tauri build
    if ($LASTEXITCODE -ne 0) { throw "La compilación falló (código $LASTEXITCODE)." }
}
finally {
    Pop-Location
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}

# --- Lo que se sube -------------------------------------------------------------

$nsis = Join-Path $raiz "src-tauri\target\release\bundle\nsis"
$exe = "Antares_${version}_x64-setup.exe"
$sig = Join-Path $nsis "$exe.sig"
if (-not (Test-Path (Join-Path $nsis $exe)) -or -not (Test-Path $sig)) {
    Write-Host "No se generó el instalador firmado ($exe y su .sig)." -ForegroundColor Red
    exit 1
}

$salida = Join-Path $padre "publicar\v$version"
New-Item -ItemType Directory -Force $salida | Out-Null
Copy-Item (Join-Path $nsis $exe) $salida -Force
# El mismo instalador con un nombre que no cambia: la página de descarga
# enlaza a releases/latest/download/Antares-Setup.exe y GitHub entrega el de
# la última versión publicada.
$fijo = "Antares-Setup.exe"
Copy-Item (Join-Path $nsis $exe) (Join-Path $salida $fijo) -Force

$latest = [ordered]@{
    version   = $version
    notes     = $Notas
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = (Get-Content $sig -Raw).Trim()
            url       = "$repo/releases/download/v$version/$exe"
        }
    }
}
$json = $latest | ConvertTo-Json -Depth 5
[IO.File]::WriteAllText((Join-Path $salida "latest.json"), $json, (New-Object Text.UTF8Encoding $false))

Write-Host ""
Write-Host "Listo: Antares $version firmado, en $salida" -ForegroundColor Green
Write-Host ""
Write-Host "Para que les llegue a todos:"
Write-Host "  1. Abre $repo/releases/new"
Write-Host "  2. En 'Choose a tag' escribe: v$version  (y 'Create new tag')"
Write-Host "  3. Título: Antares $version"
Write-Host "  4. Arrastra los TRES archivos de la carpeta: $exe, $fijo y latest.json"
Write-Host "  5. Publish release (con 'Set as the latest release' marcado)"
Write-Host ""
Write-Host "Al abrir Antares, a tus amigos les saldrá el aviso de la versión nueva,"
Write-Host "y el botón de descarga de la página ya da esta versión."
if (-not $NoAbrir) { explorer.exe $salida }
