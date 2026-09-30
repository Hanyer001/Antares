# Banco de pruebas de latencia de yt-dlp para Antares.
#
# Uso:   .\scripts\benchmark-ytdlp.ps1
#        .\scripts\benchmark-ytdlp.ps1 "daft punk around the world"
#
# Mide cada variante dos veces y se queda con la mejor, para que la primera
# ejecucion (que calienta la cache de disco) no falsee el resultado.
#
# Como leer la tabla:
#   - La fila 0 es el suelo: arrancar Python sin tocar la red. Ningun flag lo baja.
#   - Resta la fila 0 a las demas: eso es lo unico que los argumentos pueden mejorar.
#   - Una variante marcada FALLA es rapida porque no funciona. Ignorala.

$projectRoot = Split-Path $PSScriptRoot -Parent
$exe = Join-Path $projectRoot "src-tauri\binaries\yt-dlp-x86_64-pc-windows-msvc.exe"
if (-not (Test-Path $exe)) { $exe = Join-Path $projectRoot "src-tauri\yt-dlp.exe" }
if (-not (Test-Path $exe)) {
    Write-Host "No encuentro yt-dlp. Revisa src-tauri\binaries\." -ForegroundColor Red
    exit 1
}

$query  = if ($args.Count -gt 0) { $args -join " " } else { "radiohead creep" }
$target = "ytsearch1:$query"

# Los mismos argumentos que usa Antares hoy, sin el --extractor-args.
$common = @(
    "--ignore-config", "--no-warnings", "--quiet", "--no-playlist",
    "-4", "--socket-timeout", "8",
    "-f", "bestaudio[ext=m4a]/bestaudio/best", "-g"
)

$variants = [ordered]@{
    "0. suelo (arranque Python)"    = @("--version")
    "1. sin flags (referencia)"     = @("-g", "-f", "bestaudio", $target)
    "2. Antares actual"             = $common + @("--extractor-args", "youtube:skip=hls,dash", $target)
    "3. + player_client=tv"         = $common + @("--extractor-args", "youtube:skip=hls,dash;player_client=tv", $target)
    "4. + player_client=mweb"       = $common + @("--extractor-args", "youtube:skip=hls,dash;player_client=mweb", $target)
    "5. + player_client=web_safari" = $common + @("--extractor-args", "youtube:skip=hls,dash;player_client=web_safari", $target)
    "6. + player_client=android"    = $common + @("--extractor-args", "youtube:skip=hls,dash;player_client=android", $target)
    "7. + player_skip=webpage"      = $common + @("--extractor-args", "youtube:skip=hls,dash;player_skip=webpage,configs", $target)
}

Write-Host ""
Write-Host "Binario  : $exe"
Write-Host "Busqueda : $query"
Write-Host ""
Write-Host ("{0,-30} {1,10}  {2}" -f "VARIANTE", "MEJOR", "ESTADO")
Write-Host ("-" * 56)

foreach ($name in $variants.Keys) {
    $argumentos = $variants[$name]
    $mejor = [double]::MaxValue
    $ok = $false

    foreach ($intento in 1..2) {
        $reloj = [System.Diagnostics.Stopwatch]::StartNew()
        $salida = & $exe @argumentos 2>$null
        $reloj.Stop()

        if ($LASTEXITCODE -eq 0 -and $salida) { $ok = $true }
        $mejor = [Math]::Min($mejor, $reloj.Elapsed.TotalMilliseconds)
    }

    $estado = if ($ok) { "OK" } else { "FALLA" }
    $color  = if ($ok) { "Green" } else { "DarkGray" }
    Write-Host ("{0,-30} {1,7:N0} ms  {2}" -f $name, $mejor, $estado) -ForegroundColor $color
}

Write-Host ""
Write-Host "Si la fila 0 es la mitad o mas del tiempo de la fila 2," -ForegroundColor Yellow
Write-Host "tu cuello de botella es arrancar el proceso, no los flags." -ForegroundColor Yellow
Write-Host ""
