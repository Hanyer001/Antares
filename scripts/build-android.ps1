<#
Compila Rust y Gradle sin necesitar enlaces simbólicos ni Modo de desarrollador.
  .\scripts\build-android.ps1 -Debug
  .\scripts\build-android.ps1             release con la firma existente
Herramientas: JAVA_HOME / ANDROID_HOME / NDK_HOME, -ToolsDirectory, o
android-tools.local.json (solo de esta máquina; nunca se publica).
#>
param([switch]$Debug,[switch]$OptimizedPreview,[ValidateRange(0,98)][int]$Beta=0,[string]$ToolsDirectory,[string]$OutputDirectory,[string[]]$Architectures=@("arm64","arm"))
$ErrorActionPreference="Stop"
if ($Debug -and $Beta) { throw "-Beta usa la compilación pública firmada; no lo combines con -Debug." }
$root=Split-Path $PSScriptRoot -Parent
$tauri=Join-Path $root "src-tauri"
$android=Join-Path $tauri "gen\android"
$localTools=Join-Path $root "android-tools.local.json"
if (-not $ToolsDirectory -and (Test-Path -LiteralPath $localTools)) {
  $ToolsDirectory=(Get-Content -LiteralPath $localTools -Raw | ConvertFrom-Json).toolsDirectory
}
if (-not $ToolsDirectory -and -not $env:JAVA_HOME) { $ToolsDirectory=Join-Path $env:LOCALAPPDATA "AntaresDev" }
if ($ToolsDirectory) {
  $env:JAVA_HOME=Join-Path $ToolsDirectory "jdk"
  $env:ANDROID_HOME=Join-Path $ToolsDirectory "sdk"
}
if (-not $env:ANDROID_HOME) { $env:ANDROID_HOME=$env:ANDROID_SDK_ROOT }
if (-not $env:NDK_HOME -and $env:ANDROID_HOME) {
  $ndks=Join-Path $env:ANDROID_HOME "ndk"
  if (Test-Path -LiteralPath $ndks) { $env:NDK_HOME=(Get-ChildItem -LiteralPath $ndks -Directory | Sort-Object {[version]$_.Name} | Select-Object -Last 1).FullName }
}
if (-not $env:JAVA_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:JAVA_HOME "bin\java.exe"))) { throw "Falta Java 17 o posterior. Configura JAVA_HOME o -ToolsDirectory." }
if (-not $env:ANDROID_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:ANDROID_HOME "platforms\android-36\android.jar"))) { throw "Falta el SDK Android 36. Configura ANDROID_HOME e instala platforms;android-36." }
if (-not $env:NDK_HOME -or -not (Test-Path -LiteralPath (Join-Path $env:NDK_HOME "toolchains\llvm\prebuilt\windows-x86_64\bin\llvm-ar.exe"))) { throw "Falta el NDK de Android." }
$env:PATH="$(Join-Path $env:JAVA_HOME 'bin');$env:PATH"
$mode=if($Debug -and -not $OptimizedPreview){"debug"}else{"release"}
$apkMode=if($Debug){"debug"}else{"release"}
$modeTitle=if($Debug){"Debug"}else{"Release"}
if (-not $Debug -and -not (Test-Path -LiteralPath (Join-Path $android "keystore.properties"))) { throw "Falta la firma existente en keystore.properties. Usa -Debug para probar; no generes otra firma para actualizar la app instalada." }
$supported=@{
  arm64=@{triple="aarch64-linux-android";abi="arm64-v8a";clang="aarch64-linux-android24-clang.cmd";tauri="aarch64"}
  arm=@{triple="armv7-linux-androideabi";abi="armeabi-v7a";clang="armv7a-linux-androideabi24-clang.cmd";tauri="armv7"}
  x86_64=@{triple="x86_64-linux-android";abi="x86_64";clang="x86_64-linux-android24-clang.cmd";tauri="x86_64"}
}
$targets=@($Architectures | ForEach-Object {if(-not $supported.ContainsKey($_)){throw "Arquitectura no admitida: $_"};$supported[$_]})
$llvm=Join-Path $env:NDK_HOME "toolchains\llvm\prebuilt\windows-x86_64\bin"
foreach($target in $targets) {
  $prefix=$target.triple.Replace('-','_')
  [Environment]::SetEnvironmentVariable("CC_$prefix",(Join-Path $llvm $target.clang),"Process")
  [Environment]::SetEnvironmentVariable("AR_$prefix",(Join-Path $llvm "llvm-ar.exe"),"Process")
  [Environment]::SetEnvironmentVariable("CARGO_TARGET_$($prefix.ToUpper())_LINKER",(Join-Path $llvm $target.clang),"Process")
  $env:TAURI_ENV_TARGET_TRIPLE=$target.triple
  $cargoArgs=@("build","--features","tauri/custom-protocol","--manifest-path",(Join-Path $tauri "Cargo.toml"),"--lib","--target",$target.triple)
  if($mode -eq "release"){$cargoArgs+="--release"}
  & cargo @cargoArgs
  if($LASTEXITCODE -ne 0){throw "Falló Rust para $($target.abi)."}
  $cargoTarget=if($env:CARGO_TARGET_DIR){$env:CARGO_TARGET_DIR}else{Join-Path $tauri "target"}
  $so=Join-Path $cargoTarget "$($target.triple)\$mode\libantares_lib.so"
  $jni=Join-Path $android "app\src\main\jniLibs\$($target.abi)"
  New-Item -ItemType Directory -Force $jni | Out-Null
  Copy-Item -LiteralPath $so -Destination (Join-Path $jni "libantares_lib.so") -Force
}
"sdk.dir=$($env:ANDROID_HOME.Replace('\','/'))" | Set-Content -LiteralPath (Join-Path $android "local.properties") -Encoding ascii
$version=(Get-Content (Join-Path $tauri "tauri.conf.json") -Raw | ConvertFrom-Json).version
$gradleArgs=@("assembleUniversal$modeTitle","-PantaresVersion=$version","-PabiList=$(($targets | ForEach-Object {$_.abi}) -join ',')","-ParchList=$($Architectures -join ',')","-PtargetList=$(($targets | ForEach-Object {$_.tauri}) -join ',')","--no-daemon","--max-workers=2","-x","rustBuildUniversal$modeTitle")
if($Beta){$gradleArgs+="-PantaresBeta=$Beta"}
foreach($arch in $Architectures) { $gradleArgs+=@("-x","rustBuild$((Get-Culture).TextInfo.ToTitleCase($arch))$modeTitle") }
# Mantener los artefactos de plugins dentro del proyecto.
$dependencyBuild=Join-Path $android ".gradle\antares-dependencies"
New-Item -ItemType Directory -Force $dependencyBuild | Out-Null
$env:ANTARES_LIBRARY_BUILD=$dependencyBuild
$initScript=Join-Path $android ".gradle\antares-build-paths.gradle"
@'
gradle.beforeProject { project ->
    if (project.projectDir.toString().contains('.cargo') || project.projectDir.toString().contains('registry')) {
        project.layout.buildDirectory.set(new File(System.getenv('ANTARES_LIBRARY_BUILD'), project.name))
    }
}
'@ | Set-Content -LiteralPath $initScript -Encoding ascii
$gradleArgs+=@("--init-script",$initScript)
Push-Location $android
try { & .\gradlew.bat @gradleArgs; if($LASTEXITCODE -ne 0){throw "Falló Gradle."} } finally { Pop-Location }
$apk=Join-Path $android "app\build\outputs\apk\universal\$apkMode\app-universal-$apkMode.apk"
if(-not (Test-Path -LiteralPath $apk)){throw "No se generó el APK esperado."}
if(-not $OutputDirectory){$OutputDirectory=Join-Path $root "dist-android"}
New-Item -ItemType Directory -Force $OutputDirectory | Out-Null
$suffix=if($Debug){"-preview"}elseif($Beta){"-beta.$Beta"}else{""}
$dest=Join-Path $OutputDirectory "Antares-$version-android$suffix.apk"
Copy-Item -LiteralPath $apk -Destination $dest -Force
Write-Host ("APK: {0} ({1:N1} MB)" -f $dest,((Get-Item -LiteralPath $dest).Length/1MB)) -ForegroundColor Green
