# Compilación y publicación

Esta guía describe los pasos para generar paquetes cuando se prepare una versión. La ejecución en desarrollo y las pruebas no necesitan generar un instalador.

## Versiones

Mantén la misma versión en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`. Actualiza los archivos de bloqueo correspondientes y añade las novedades a `CHANGELOG.md`.

Conserva el identificador `com.hanyer.antares` para que las instalaciones nuevas encuentren los datos existentes.

## Windows

Prepara primero el entorno descrito en [desarrollo](development.md), incluido el ejecutable auxiliar de yt-dlp.

La configuración habilita los artefactos del actualizador, que requieren firma. El script del mantenedor utiliza `../firma-actualizaciones/antares-updater.key` y `../firma-actualizaciones/contrasena.txt`, fuera del repositorio:

```powershell
.\scripts\release-windows.ps1 -Notas "Descripción de los cambios"
```

El script compila y firma el instalador. Deja `Antares_<versión>_x64-setup.exe`, una copia idéntica llamada `Antares-Setup.exe` y `latest.json` listos para publicar en `../publicar/vX.Y.Z/`, pero no los sube a GitHub. La página descarga la copia con nombre fijo. Las claves privadas y sus contraseñas no deben añadirse al control de versiones.

En [antares-actualizaciones](https://github.com/Hanyer001/antares-actualizaciones/releases), crea una release con la etiqueta de la versión y adjunta los dos nombres del instalador y `latest.json` preparados por el script. Marca la publicación estable como la última versión. El código fuente permanece en [Antares](https://github.com/Hanyer001/Antares).

La app consulta el manifiesto configurado en `tauri.conf.json` y verifica la firma antes de instalar. La clave pública está incluida en esa configuración. Consulta la [documentación del actualizador de Tauri](https://v2.tauri.app/plugin/updater/) para el formato y las variables de firma.

### Compilación local sin firma de actualización

Para generar un instalador de pruebas sin las claves del mantenedor:

```powershell
$config = '{"bundle":{"createUpdaterArtifacts":false}}'
npm run tauri -- build --config $config
```

Ese instalador no sirve como actualización firmada del canal existente. La salida de NSIS queda en `src-tauri/target/release/bundle/nsis/`.

### Verificar un paquete firmado

Usa la ruta absoluta a la carpeta que contiene el instalador y `latest.json`:

```powershell
$env:ANTARES_PUBLICAR = "C:\ruta\publicar\vX.Y.Z"
cargo test --manifest-path src-tauri/Cargo.toml --lib firma_publicada -- --ignored
```

## Android

Con el SDK, NDK y Java configurados:

```powershell
.\scripts\build-android.ps1 -Debug
```

Para una versión firmada, configura `src-tauri/gen/android/keystore.properties` y ejecuta el script sin `-Debug`. La salida queda junto a la carpeta del proyecto como `Antares-<versión>.apk` o `Antares-<versión>-debug.apk`.

El repositorio no incluye claves ni contraseñas. Conserva la misma clave de firma para actualizar instalaciones existentes.

## Iconos

El original está en `assets/branding/icon.svg`. Para regenerar los tamaños usados por Tauri:

```powershell
npx tauri icon assets/branding/icon.svg
```

Los iconos que necesita la app están en `src-tauri/icons/` y los recursos del proyecto Android en `src-tauri/gen/android/app/src/main/res/`.
