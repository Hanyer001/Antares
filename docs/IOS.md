# Antares en iPhone

La app nativa conserva las vistas de Antares. En iOS, Tauri entrega el audio AAC a un plugin Swift con `AVQueuePlayer`. El sistema reproduce la ventana preparada de la cola, expone los controles de reproducción, pausa, avance y posición, y publica los metadatos en Ahora suena. La sesión `.playback` y el modo de fondo `audio` siguen las [indicaciones de Apple](https://developer.apple.com/documentation/avfoundation/configuring-your-app-for-media-playback).

La interfaz prepara hasta tres pistas siguientes mientras el puente de Tauri está activo. La cola nativa puede avanzar entre esas pistas si el WebView se suspende. La resolución de pistas nuevas y el registro de escuchas pasan por el puente. Una cola larga en segundo plano y la recuperación tras cambiar de red requieren validación física. La biblioteca nativa usa los datos locales de Tauri. La biblioteca web del punto 4 sigue disponible desde Safari.

## Compilar en el Mac

Requisitos: Xcode con el SDK de iOS, XcodeGen en PATH y Rust con los objetivos `aarch64-apple-ios-sim` y `aarch64-apple-ios`. Desde la raíz de Antares:

```sh
rustup target add aarch64-apple-ios-sim aarch64-apple-ios
sh scripts/build-ios.sh simulator
```

El proyecto se genera desde `src-tauri/gen/apple/project.yml`. La app resultante queda en `src-tauri/gen/apple/DerivedData/Build/Products/Debug-iphonesimulator/Antares.app`. En un simulador iniciado, se puede instalar y abrir con `xcrun simctl install booted RUTA_A_ANTARES.APP` y `xcrun simctl launch booted com.hanyer.antares`.

Para un iPhone físico, agrega el equipo de desarrollo de Apple en Xcode, conecta el teléfono, activa el modo de desarrollador si lo solicita y selecciona ese equipo en la configuración de firma. Ejecuta `APPLE_DEVELOPMENT_TEAM=TU_ID sh scripts/build-ios.sh device` y abre el proyecto generado para instalar y depurar en el iPhone. El certificado y el perfil pertenecen al equipo de Apple que firma la app.

## Diagnóstico de reproducción

Abre **Ajustes → Reproducción → Diagnóstico de reproducción**. El informe muestra versión, motor, fase del reproductor, red, visibilidad, posición, duración, búfer, última interrupción observada y tiempos desde que activaste el panel. Puedes copiarlo de forma manual. El panel mantiene las muestras en memoria y las borra al desactivarlo. El informe excluye títulos, claves, credenciales y enlaces de audio.

## Matriz móvil

| Escenario | Qué comprobar |
| --- | --- |
| Arranque y catálogo | Abrir, buscar, reproducir y confirmar que el diagnóstico muestra el motor y registra la resolución. |
| Cola y posición | Agregar pistas, cambiar el orden, buscar cerca del final y confirmar dos avances automáticos. |
| Segundo plano | Ir a Inicio y luego bloquear físicamente el teléfono. Verificar avance y pausa/reproducción desde Ahora suena. |
| Interrupciones | Llamada entrante, cambio de salida Bluetooth y desconexión de auriculares. Una pausa manual debe seguir vigente. |
| Red | Cortar la red y volver, y cambiar entre Wi‑Fi y datos. Verificar la recuperación de la misma pista y el motivo del corte. |
| Persistencia | Cerrar y volver a abrir. Verificar cola y posición. Repetir después de actualizar la PWA. |

Repetir en Safari y la PWA instalada en iPhone, en la app iOS firmada, y en Chrome/PWA y la app Media3 de Android. Las pruebas de bloqueo, Bluetooth y llamadas del simulador tienen un alcance distinto a las del teléfono real.

## Validación del 6 de noviembre de 2026

- La app compiló y arrancó en un iPhone 17e simulado con iOS 27.2. Buscó y reprodujo audio real. Tras reinstalar, recuperó la pista en pausa y reanudó desde la posición guardada.
- Se verificaron dos cambios automáticos con la app en segundo plano: de «Kill Bill» a «Want You» y de «Want You» a «Saturn». Al volver, las siguientes pistas llevaban 42 y 38 segundos respectivamente.
- AVFoundation estimó 5:07 para un AAC de 2:34. La comprobación de duración del catálogo corrigió tanto el contador como la transición de esta pista.
- El simulador permitió abrir el diagnóstico desde Ajustes. Quedan pendientes la firma e instalación en un iPhone real y las pruebas de bloqueo, auriculares, Bluetooth, llamadas y cambio de red en dispositivos físicos. El Mac no tenía una identidad de firma y Xcode no detectó un iPhone conectado durante esta prueba.
