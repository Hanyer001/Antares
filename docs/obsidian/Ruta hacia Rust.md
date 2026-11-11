---
tags:
  - antares
  - rust
estado: pasos-2-a-4-y-buscar-en-leptos
---
# Ruta hacia Rust

[[Antares|Volver al proyecto]]

El objetivo es que Rust concentre las reglas del producto y, después, el código de la interfaz mediante WebAssembly. HTML y CSS seguirán describiendo la presentación. Los adaptadores nativos se reducen después de comprobar las funciones de cada plataforma.

## Pasos 2 y 3 implementados

- **Paso 2.** El workspace de Cargo reúne el escritorio Tauri, el complemento de iOS, la API Axum y `antares-core`. Tauri y Axum comparten `TrackInfo` como dependencia y Cargo resuelve las versiones en el archivo de bloqueo de raíz.
- **Paso 3.** Rust concentra la cola normal, pendiente y automática, el avance, retroceso, modo aleatorio, repetición, movimientos, eliminación y deshacer. También lee y prepara las sesiones guardadas. Tauri y la PWA ejecutan este núcleo mediante WebAssembly. La interfaz y los mecanismos de almacenamiento existentes conservan su función.

### Comprobaciones

- Pasaron 247 pruebas de JavaScript usando el núcleo WebAssembly y 413 pruebas de Rust entre el núcleo, Tauri y Axum. Quedaron 21 pruebas de Rust marcadas para ejecución manual.
- En macOS se abrió la compilación de prueba, se cambió de pista desde la cola y con «Siguiente», y se comprobó que al cerrar y reabrir recuperaba la pista, la cola y la repetición. Al reanudar continuó desde la posición guardada.
- La PWA compiló, incluyó el módulo en su caché y la API local sirvió el binario con el tipo `application/wasm`. En el navegador se abrió la cola y se activó la repetición. Queda pendiente probar esta compilación en un iPhone y un Android físicos, y ejecutar la compilación de Docker.
- Los requisitos para generar el módulo están en [la guía de desarrollo](../development.md).

## Pasos 4 y 5

- **Paso 4.** `search_rank.rs` ordena las coincidencias del artista y las separa de las demás versiones. `recovery.rs` decide cuándo esperar la red, reintentar desde la última posición o presentar el error. JavaScript ejecuta los temporizadores y la renovación de la fuente con el motor de audio de cada plataforma.
- **Paso 5, Buscar.** Leptos monta el buscador, los estados vacíos y las filas de resultados. Se reutilizan los estilos, las acciones de cola y los controles de artista y reproducción. La PWA guarda cada binario WebAssembly con el identificador de su versión para que una pestaña antigua pueda cargar el módulo que corresponde a su código.
- **Pruebas.** Pasaron 247 pruebas JavaScript con WebAssembly y 413 pruebas Rust. La pérdida y vuelta de conexión se simuló con el motor real de recuperación. En macOS y en la PWA local, «Talento Yan Block» mostró la grabación y el video oficial antes de las demás versiones. Se comprobó abrir la grabación y encolar el video desde Buscar. En el Mac, la grabación siguió tras saltar a 1:15, llegó al final de sus 2:30 y comenzó automáticamente el video encolado.

En la compilación con catálogo Rust, el Mac comprobó el salto a 1:15 de «Talento». La duración se mantuvo en torno a 2:30 y el video encolado empezó automáticamente. Cuando WebKit devuelve una estimación fuera de rango, el reproductor usa la duración del catálogo.

## Latencia de búsqueda y reproducción

El 9 de noviembre de 2026 se comparó el video oficial de «One More Time» con el diagnóstico de Antares en macOS. La búsqueda pasó de 1060 a 775 ms y el inicio desde el clic pasó de 2264 a 963 ms. Resolver la URL dentro de ese inicio pasó de 1071 a 66 ms. Son mediciones de una ejecución de cada versión.

En la prueba de red con «Talento», «Karma Police» y «One More Time», la resolución directa de escritorio bajó de 1068–2163 ms a 89–370 ms. Las dos búsquedas calientes mejoraron y la primera, «Talento», subió de 945 a 1344 ms en la última corrida. El tiempo de búsqueda depende de cuándo responda cada fuente.

El catálogo solicita respuestas comprimidas y comparte la apertura de sesión entre peticiones simultáneas. En escritorio, Antares intenta primero la URL directa de InnerTube y conserva el extractor Rust completo como respaldo. Las verificaciones de rangos WebM se hacen en paralelo. Mientras llegan los vídeos, se puede preparar el primer candidato de YouTube Music sin alterar el orden final.

## Entregas posteriores

- [[Interfaz de Antares en Rust|Ruta para migrar la interfaz a Rust y evaluar un renderizador propio]].
- Compartir más código Rust entre Tauri y Axum mediante dependencias de Cargo.
- Aplicar la migración de interfaz a Listas, Reciente y Ajustes. El reproductor visual y sus efectos tienen su propia etapa.
- Evaluar por separado la retirada de Node en la compilación, de yt-dlp en el catálogo y del código que aún quede en los adaptadores móviles.

Cada entrega debe anotar qué pasó en Mac, qué se verificó en la PWA y qué sigue pendiente en dispositivos móviles. La referencia y el alcance actual están en [[Antares]].
