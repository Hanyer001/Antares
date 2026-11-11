# Compilación y publicación

Esta guía describe los pasos para generar paquetes cuando se prepare una versión. La ejecución en desarrollo y las pruebas no necesitan generar un instalador.

## Versiones

Mantén la misma versión en `package.json`, `src-tauri/Cargo.toml` y `src-tauri/tauri.conf.json`. Actualiza los archivos de bloqueo correspondientes y añade las novedades a `CHANGELOG.md`.

Conserva el identificador `com.hanyer.antares` para que las instalaciones nuevas encuentren los datos existentes.

## Windows

Prepara primero el entorno descrito en [desarrollo](development.md).

La configuración habilita los artefactos del actualizador, que requieren firma. El script del mantenedor utiliza `../firma-actualizaciones/antares-updater.key` y `../firma-actualizaciones/contrasena.txt`, fuera del repositorio:

```powershell
.\scripts\release-windows.ps1 -Notas "Descripción de los cambios"
```

El script compila Windows x64, verifica la firma con la clave pública de la app y prepara una carpeta nueva en `../publicar/vX.Y.Z/windows-x86_64/`. Incluye instalador, firma, copia con nombre fijo, `latest.json`, notas, `SHA256SUMS` y `revision.json`. Este registro identifica Git, arquitectura y Cargo.lock. La revisión debe estar guardada y el directorio de trabajo limpio antes de preparar la entrega. La firma del actualizador y la firma Authenticode del ejecutable son verificaciones independientes. Este asistente comprueba la primera.

En [antares-actualizaciones](https://github.com/Hanyer001/antares-actualizaciones/releases), crea una release con la etiqueta de la versión y adjunta los dos nombres del instalador y `latest.json` preparados por el script. Marca la publicación estable como la última versión. El código fuente permanece en [Antares](https://github.com/Hanyer001/Antares).

La app consulta el manifiesto configurado en `tauri.conf.json` y verifica la firma antes de instalar. La clave pública está incluida en esa configuración. Consulta la [documentación del actualizador de Tauri](https://v2.tauri.app/plugin/updater/) para el formato y las variables de firma.

### Compilación local sin firma de actualización

Para generar un instalador de pruebas sin las claves del mantenedor:

```powershell
$config = '{"bundle":{"createUpdaterArtifacts":false}}'
cargo tauri build --config $config
```

Ese instalador no sirve como actualización firmada del canal existente. La salida de NSIS queda en `src-tauri/target/release/bundle/nsis/`.

### Verificar un paquete firmado

Usa la ruta absoluta a la carpeta que contiene el instalador y `latest.json`:

```powershell
$env:ANTARES_PUBLICAR = "C:\ruta\publicar\vX.Y.Z"
cargo test --manifest-path src-tauri/Cargo.toml --lib firma_publicada -- --ignored
```

## macOS y manifiesto compartido

El asistente para Apple Silicon recibe las notas y una carpeta nueva de salida.

```sh
sh scripts/release-macos.sh /ruta/notas.md /ruta/publicar/vX.Y.Z/darwin-aarch64
```

Requiere `APPLE_SIGNING_IDENTITY` con una identidad Developer ID Application, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` y la clave del actualizador en `TAURI_SIGNING_PRIVATE_KEY`. La contraseña de esa clave se recibe en `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`. En CI, Tauri recibe el certificado y su contraseña mediante `APPLE_CERTIFICATE` y `APPLE_CERTIFICATE_PASSWORD`. Mantener estas credenciales en el entorno o en secretos de GitHub.

El asistente habilita los paquetes del actualizador para esa compilación, verifica la firma del bundle y exige que Gatekeeper acepte la app antes de preparar `darwin-aarch64`. La compilación local habitual conserva su configuración de pruebas. [Firma de macOS en Tauri](https://v2.tauri.app/distribute/sign/macos/)

El flujo manual `antares-release.yml` ejecuta las pruebas y genera artefactos de revisión para ambos sistemas. Configura los secretos de firma para ejecutarlo. Las dos carpetas deben corresponder al mismo commit, versión, Cargo.lock y notas. Para generar el manifiesto que reúne las entradas verificadas de ambas carpetas, usa una ruta de salida nueva.

```sh
cargo run --locked -p antares-build -- release-merge /ruta/latest.json /ruta/windows-x86_64 /ruta/darwin-aarch64
```

La herramienta vuelve a verificar cada firma y el hash del paquete. Adjunta los paquetes de ambas carpetas y ese `latest.json` a la misma release. Incluir únicamente las arquitecturas con paquete firmado. [Formato del actualizador de Tauri](https://v2.tauri.app/plugin/updater/)

La descarga en la app se puede cancelar y reintentar. Tras verificar el paquete se guarda la posición más reciente y se fuerza la escritura de biblioteca y preferencias antes de instalar. Un fallo de descarga conserva la actualización encontrada para otro intento.

Antes de aprobar una entrega, probar actualización desde la versión instalada con un perfil QA, cancelación, pérdida de conexión y paquete alterado. Las pruebas criptográficas usan un paquete de ejemplo firmado con una clave de prueba. La instalación real y el comportamiento de Gatekeeper y WebView2 requieren los paquetes de distribución y sus equipos correspondientes.

## Android

Publicación Beta con la firma de distribución existente:

```powershell
.\scripts\build-android.ps1 -Beta 1
```

El paquete público es `com.hanyer.antares`; salida `Antares-0.3.3-android-beta.1.apk`. Beta 1 usa `versionCode 300301`; una edición estable de 0.3.3 usaría 300399. Las versiones siguientes aumentan el código. La app de desarrollo puede coexistir y sus datos se trasladan con una copia completa.

Publica la etiqueta `android-v0.3.3-beta.1` como **Pre-release**, con `Antares-Android.apk`, `SHA256SUMS.txt`, notas y `android-latest.json`. Conserva Windows como la última release estable: nunca reemplaces su `latest.json` con un manifiesto Android. El manifiesto Android es preparación para un futuro aviso; actualmente la app no lo consulta.


Con el SDK, NDK y Java configurados:

```powershell
.\scripts\build-android.ps1 -Debug -OptimizedPreview
```

Para una versión firmada, configura `src-tauri/gen/android/keystore.properties` y ejecuta el script sin `-Debug`. La salida queda en `dist-android/Antares-<versión>-android.apk` o `Antares-<versión>-android-preview.apk`. Preview tiene un identificador separado para coexistir con la instalación normal. Los paquetes Android todavía necesitan las [pruebas físicas](android.md) antes de publicarse como estables.

El repositorio no incluye claves ni contraseñas. Conserva la misma clave de firma para actualizar instalaciones existentes.

## Iconos

El original está en `assets/branding/icon.svg`. Para regenerar los tamaños usados por Tauri:

```powershell
cargo tauri icon assets/branding/icon.svg
```

Los iconos que necesita la app están en `src-tauri/icons/` y los recursos del proyecto Android en `src-tauri/gen/android/app/src/main/res/`.
