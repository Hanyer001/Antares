# Ruta de mejoras para macOS y Windows

[[Interfaz de Antares en Rust|Migración de la interfaz]] · [[Antares|Proyecto Antares]]

El primer objetivo es validar en Windows la misma revisión que ya se consolidó como `/Applications/Antares.app` en el Mac. La última instalación local abrió el perfil principal y pasó pruebas de reproducción, búsqueda de posición y minirreproductor. En el repositorio hay un asistente para generar el instalador de Windows x64, pero falta evidencia de una prueba nativa en Windows con esta misma revisión. El proyecto incluye flujos separados para Pages, validación de escritorio y preparación de una entrega firmada.

La primera matriz de escritorio propone macOS en Apple Silicon y Windows x64, porque son las arquitecturas que cubren la instalación del Mac y la guía de distribución actual. Intel y Windows ARM64 pueden incorporarse cuando haya un equipo o entorno adecuado y se defina su alcance de soporte.

## 1. Alta prioridad · Crear una referencia de escritorio y compilar en los dos sistemas

- Registrar una revisión candidata de Git y comprobar que ambas compilaciones salen del mismo código y del mismo `Cargo.lock`. Registrar también la versión de la app, de Rust, de Tauri CLI y de wasm-bindgen.
- Añadir un flujo de escritorio separado del flujo de Pages. Usar ejecutores de macOS y Windows, generar el WebAssembly, ejecutar pruebas de Rust y del cliente, y empaquetar una `.app` y un `Setup.exe` NSIS para revisión. Las credenciales de publicación se reservan para el flujo de entrega.
- Probar la instalación limpia y la actualización sobre una versión anterior usando perfiles de prueba. En Windows, comprobar el arranque como usuario estándar, la disponibilidad de WebView2 y el comportamiento si falta o falla su instalación. En Mac, usar `/Applications/Antares.app` como destino de la entrega y conservar el identificador habitual. Reservar las compilaciones de prueba para una carpeta de artefactos y retirar las anteriores al terminar.
- **Criterio de cierre.** Los dos artefactos corresponden a la misma revisión. Cada uno se instala y abre en su sistema, y una actualización conserva los datos del perfil. Cada prueba se registra como aprobada, fallida o pendiente, con el sistema, la arquitectura y el artefacto exacto.

[Instalador de Windows en Tauri](https://v2.tauri.app/distribute/windows-installer/) · [Distribución de WebView2](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)

## 2. Alta prioridad · Verificar el audio de extremo a extremo

- Preparar dos grupos de pruebas. Un servidor de audio de prueba permite reproducir pistas conocidas y simular rangos HTTP, un corte y una fuente caducada. Un grupo pequeño de canciones reales cubre catálogo, resolución y CDN.
- Cubrir reproducción, pausa y reanudación, salto al principio y al 90 %, final natural, siguiente pista, repetir una y repetir cola, cambio manual rápido y recuperación después de desconectar y reconectar la red. Mantener abierta una sesión durante al menos 30 minutos e incluir suspensión y reanudación del equipo.
- Probar volumen al 80 %, 20 %, 0 % y de vuelta al 80 %. Medir señal de salida cuando el entorno lo permita y confirmar con altavoces o audífonos. Probar también normalización, ecualizador, fundido y un cambio de dispositivo de audio. La prueba de volumen debe observar la señal o la escucha, además del estado que muestra el deslizador.
- Mantener visibles las diferencias del transporte. El backend fuerza AAC en macOS y usa HTTP local para WebKit. Windows usa la ruta de audio de escritorio y puede recibir Opus o AAC. Probar los formatos que ofrece cada sistema y comprobar el paso a la fuente de recuperación. Revisar primero `source.rs`, `audio_http.rs`, `audio_proxy.rs`, `player.js` y `sound.js`.
- **Criterio de cierre.** El audio llega al final, la cola avanza una sola vez, el volumen cero silencia y la recuperación conserva la posición. Si la recuperación agota sus intentos, la app muestra una acción clara para reintentar.

## 3. Alta prioridad · Proteger biblioteca, perfiles y sesión

- Crear una biblioteca de prueba con dos perfiles, favoritos, listas, historial, una cola activa, ajustes personalizados y nombres con tildes y emoji. Probar actualización y cierre forzado durante escrituras controladas. Confirmar que el formato que usa `store.rs` deja una copia legible y que la app informa de una recuperación cuando corresponda.
- Exportar con la función de copias existente y probar Mac → Windows y Windows → Mac. Comparar número de listas y pistas, orden de cola, posición, favoritos y ajustes portables. Separar los ajustes ligados al equipo, como combinaciones globales, inicio automático y posición de ventana.
- Probar restauración con archivo correcto, truncado e incompatible, y verificar que cambiar de perfil mientras se carga una pista respeta el aislamiento. Trabajar sobre datos de prueba antes de actualizar el perfil real.
- **Criterio de cierre.** Una actualización o restauración válida conserva los datos esperados. Un archivo inválido deja intacto el perfil activo. Cambiar de perfil conserva las bibliotecas separadas.

## 4. Prioridad media · Igualar la experiencia de escritorio

| Área | macOS | Windows |
| --- | --- | --- |
| Controles del sistema | Menú Reproducción, Dock, barra de menús, teclas multimedia y Centro de Control donde estén disponibles. | Barra de tareas, miniatura, bandeja, teclas multimedia y controles multimedia del sistema donde estén disponibles. |
| Ventanas | Cerrar ventana y volver a abrir, Comando+Q, minirreproductor, pantalla externa y Retina. | Cerrar ventana y volver a abrir, Alt+F4, minirreproductor, dos monitores con distinto DPI y escalado al 125 % y 150 %. |
| Teclado y accesibilidad | VoiceOver, foco visible, navegación por teclado y atajos con Comando y Opción. | Narrador, foco visible, navegación por teclado y atajos con Control y Alt. |
| Inicio de sesión | Abrir con LaunchAgent desde la ubicación definitiva. | Abrir con el mecanismo de inicio automático de la instalación por usuario. |

- Distinguir controles existentes de integraciones que aún necesitan confirmación o implementación. Si alguna acción no está disponible, ajustar su presentación según las capacidades del sistema.
- **Criterio de cierre.** Los controles compartidos tienen el mismo resultado en los dos sistemas. Cada integración nativa conserva el estado de reproducción y el foco al abrir, minimizar o volver a mostrar la ventana.

## 5. Prioridad media · Medir rendimiento y corregir el cuello de botella real

- Ampliar el diagnóstico local existente con el sistema, el tipo de WebView, la revisión y tiempos separados de búsqueda, resolución de fuente, primer byte de audio y comienzo de reproducción. Excluir consultas, URLs firmadas y datos de biblioteca de los informes.
- Hacer al menos 20 repeticiones por escenario y equipo. Separar caché fría y caliente. Comparar mediana y percentil 95 del arranque y de clic a primer audio. Medir CPU y memoria en reposo, en reproducción y al recorrer una biblioteca de 1.000 canciones, con el mismo corpus y equipo antes y después.
- Revisar primero el mayor tramo del tiempo total. Limitar el renderizado de filas visibles si las listas grandes son el cuello de botella. Si domina la red, ajustar cancelación, caché o precarga con datos de reintentos y consumo.
- **Criterio de cierre.** Cada cambio trae una comparación reproducible. Una regresión repetible superior al 10 % en p95 exige investigar antes de aprobar el cambio. El umbral es provisional hasta medir la variación de los dos equipos.

## 6. Prioridad media · Preparar una entrega con actualización comprobada

- Hacer que el flujo de entrega compruebe la coherencia entre versión de Cargo, Tauri, paquete e instalador. Generar notas, sumas SHA-256 y un registro por arquitectura desde la misma revisión.
- En Windows, verificar por separado la firma de actualización que ya prepara el asistente y la firma de código del instalador si se habilita para distribuirlo. En Mac, mantener el paquete local para pruebas y preparar la firma Developer ID y la notarización para distribución externa. Añadir la entrada de macOS al manifiesto cuando exista un artefacto de actualización firmado para esa arquitectura.
- Probar actualización desde la última versión instalada hacia una candidata, cancelación o error de red y rechazo de un paquete manipulado. Conservar una copia de recuperación y verificar qué formatos de datos admite la versión previa.
- **Criterio de cierre.** Se puede instalar y actualizar en ambos sistemas sin perder el perfil. La app anuncia la actualización solo cuando el manifiesto tiene un paquete compatible con el equipo.

[Firma y notarización de macOS](https://v2.tauri.app/distribute/sign/macos/) · [Actualizador de Tauri](https://v2.tauri.app/plugin/updater/)

## 7. Después de la primera entrega · Completar la migración a Rust por funciones

- Priorizar el esquema y las migraciones de preferencias, las reglas de listas y las decisiones de recuperación que aún vivan en el cliente. Mantener en el núcleo compartido las reglas que se puedan probar sin navegador. Usar Leptos para migrar los componentes que aún se construyen en JavaScript.
- Separar las llamadas de Web Audio, ventana, atajos y menús del estado que las gobierna. Mantener los adaptadores existentes mientras cada cambio obtiene evidencia en WKWebView y WebView2. Medir el tamaño de WebAssembly, el arranque y la memoria por módulo migrado.
- **Criterio de cierre.** Cada migración sustituye una pieza concreta y pasa las pruebas de sus dos plataformas. El avance se registra por funciones migradas y por efecto medido en el producto.

## Orden de trabajo

La primera entrega combina la compilación en ambos sistemas con el recorrido básico de audio. La segunda cubre recuperación de datos e integración de escritorio. La tercera prepara rendimiento y distribución con las mediciones anteriores como referencia. La migración adicional a Rust se divide en cambios pequeños que pueden entrar entre esas entregas cuando simplifiquen una función concreta.

## Registro de validación de los puntos 1–3 · 10 de noviembre de 2026

Candidato local `71d15e864c7a6b2b603bb7391eac2c32194f7c06`, Antares 0.3.3. Cargo.lock SHA-256 `b8e1ae56b82a847fb9146e984cfd00e32a2e822ddcc401275d0d83973eeff0de`. Rust 1.99.1, Tauri CLI 2.11.4, wasm-bindgen 0.2.130 y Node 24.22.2.

| Prueba | Estado y evidencia |
| --- | --- |
| Compilar, abrir limpio y sustituir el paquete en macOS 27.2 Apple Silicon | **Aprobado con perfil QA.** La compilación anterior abrió vacía. El candidato 0.3.3 conservó la lista, la cola y la posición al sustituir la compilación anterior del mismo número de versión. La app de QA usó el identificador `com.hanyer.antares.desktopqa`. |
| Compilar y empaquetar en Windows x64 | **Pendiente de ejecución.** El flujo `antares-desktop.yml` define los dos empaquetados y registra la revisión, herramientas y sumas de verificación. Falta ejecutar el flujo en GitHub y comprobar instalación limpia y actualización como usuario estándar en Windows, incluyendo WebView2 instalado y ausente o con instalación fallida. |
| Audio automatizado | **Aprobado en el Mac.** 198 pruebas de Rust, 246 del cliente y una prueba adicional con el CDN real. El servidor local cubre rangos posteriores a 1 MiB, fuente caducada y transferencia truncada. El cliente cubre recuperación desde la última posición y espera sin gastar reintentos cuando la red cae. |
| Audio en la app de macOS | **Aprobado en el recorrido probado.** Pausa y reanudación, más de un minuto de reproducción, salto al inicio y al 90 %, final con avance a la siguiente pista, repetición de una pista y vuelta de la última a la primera en modo cola. También se probaron cambios rápidos. El deslizador mostró 80 %, 15 %, 0 % y 85 %. |
| Audio en hardware | **Pendiente.** Medición o escucha del nivel de salida, normalización, ecualizador, fundido, cambio de salida, sesión continua de 30 minutos y suspensión. Pendientes también corte real de red y decodificación/reproducción en WebView2, incluyendo Opus y AAC. |
| Copia y perfiles en macOS | **Aprobado.** El segundo perfil abrió vacío. Se exportó y restauró una copia con una lista con tildes y emoji, un favorito, dos entradas del historial y una cola activa. Tras reiniciar reapareció la biblioteca y la sesión. El respaldo previo quedó en el perfil de destino. |
| Archivos inválidos e interrupción de escritura | **Aprobado en pruebas de Rust.** Una copia truncada o incompatible no modifica el perfil ni reemplaza el respaldo anterior. Un fallo inducido en la escritura deja la marca de restauración para reintentar. Se conservan el inicio automático, el arranque oculto y los atajos globales del destino. |
| Portabilidad entre sistemas | **Pendiente en equipo Windows.** Usar los instaladores de la misma revisión y perfiles de prueba. Importar la copia desde Mac, cotejar lista, historial, favoritos, orden y posición, exportarla desde Windows y volver a importarla en el Mac. Comprobar también el cambio de usuario con una pista todavía cargando. |

Los ZIP y registros de macOS están en la carpeta local de auditoría de Antares. Se conservó el paquete QA comprimido y se retiró la copia ejecutable de la carpeta de pruebas al terminar.

## Implementación y comprobaciones de los puntos 4–7 · 10 de noviembre de 2026

### 4. Integración de escritorio

La app informa de las capacidades de bandeja, atajos globales y minirreproductor desde Rust. Los ajustes se deshabilitan cuando su integración no está disponible. Si falla la creación de la bandeja durante un arranque oculto, Antares muestra la ventana. Reabrir el paquete en macOS vuelve a enfocar la ventana, incluso si estaba minimizada.

La salida del modo mini comprueba si el monitor de la posición anterior sigue conectado. Si esa posición quedó fuera de los monitores disponibles, centra la ventana. Conserva el estado de restauración hasta completar la operación. Los atajos respetan composición de texto y campos editables. Mantener una tecla pulsada repite volumen y búsqueda de posición, mientras que reproducir/pausar actúa una vez por pulsación.

Antes de salir, reiniciar o instalar una actualización se fuerza la escritura de los datos pendientes. La función de persistencia se comparte con móvil y web. Sus pruebas de API se ejecutaron después de ajustar los nombres de sus llamadas.

En el paquete QA de macOS se comprobaron reproducción, pausa desde el menú Reproducción, entrada y salida del mini, ocultar con Comando+W, reabrir con la canción avanzando y salir con Comando+Q. El perfil recuperó la sesión después de sustituir el paquete. Siguen pendientes las pruebas físicas de VoiceOver, teclas multimedia, Centro de Control, inicio tras iniciar sesión y monitores externos. En Windows faltan ejecución nativa, Narrador, bandeja y miniatura, escalado al 125 % y 150 % y varios monitores.

### 5. Diagnóstico y rendimiento

El informe local incluye sistema, arquitectura, tipo de WebView, revisión base y marca de cambios locales. Rust mantiene hasta 100 muestras por medida y calcula mediana y p95. Los nombres admitidos son fijos. El informe excluye consulta, título, biblioteca y URL firmada. Desactivar el diagnóstico borra las muestras.

El proxy de escritorio mide desde la petición al CDN hasta el primer fragmento recibido. Su tabla se llama `proxyMilliseconds` y cuenta peticiones de rango inicial, que pueden ser varias para una sola canción. La interfaz registra búsqueda, resolución, comienzo de reproducción y final del dibujo de filas por lotes. El arranque nativo de QA se mide desde Rust hasta que termina la inicialización de `main.js`.

| Medida en macOS Apple Silicon | Muestras | Mediana | p95 |
| --- | --- | --- | --- |
| Arranque de proceso QA | 20 | 567,39 ms | 824,60 ms |
| Búsqueda de catálogo por red | 20 | 400,11 ms | 479,47 ms |
| Resolución con caché de aplicación vacía | 20 | 59,05 ms | 86,50 ms |
| Resolución con caché de aplicación llena | 20 | 0,014 ms | 0,037 ms |
| Primer fragmento del CDN en el ensayo de backend | 20 | 9,59 ms | 11,14 ms |
| Dibujo completo de una lista de 1.000 pistas en la app | 20 | 499 ms | 530 ms |
| Filtrado repetido de 1.000 pistas antes, motor Wasm en Node | 20 × 20 operaciones | 0,834 ms | 0,958 ms |
| Filtrado repetido de 1.000 pistas después, motor Wasm en Node | 20 × 20 operaciones | 0,093 ms | 0,119 ms |

El índice Rust conserva el texto normalizado de una colección y detecta cambios de orden o metadatos comparando la entrada. Las búsquedas posteriores reutilizan ese índice. El ensayo de filtrado excluye serialización del adaptador, dibujo de filas y red. La primera llamada de ese ensayo dio 10,08 ms con el índice y 2,78 ms en la referencia. Es una muestra por versión y requiere una comparación de arranque frío más amplia. El Wasm del ensayo pasó de 3.321.125 a 3.326.466 bytes.

Los arranques reutilizan las cachés del sistema operativo. La caché fría del ensayo de red corresponde a la aplicación y conserva conexiones reutilizables. En el recorrido manual de una canción se observaron 688 ms de búsqueda, 19 ms de resolución y 404 ms de comienzo de audio. Esa observación individual queda fuera de las series de 20 muestras.

La API de renderizado conserva el dibujo por lotes de todas las filas. Una biblioteca de 1.000 pistas todavía tarda alrededor de medio segundo en completar el dibujo. Quedan pendientes la comparación del renderizado contra una referencia previa, mediciones de CPU y memoria de la app y sus procesos WebView en reposo y reproducción, 20 muestras de clic a sonido en el WebView y todas las series equivalentes en Windows. El informe del ensayo Wasm contiene CPU y memoria del proceso Node que lo ejecutó.

Los registros locales están en `proyectos/Antares-auditoria-mac/Puntos-4-7.noindex/`. Las mediciones se reproducen con estas herramientas.

```sh
cargo run --locked -p antares-build -- benchmark-startup /ruta/QA.noindex/Antares.app/Contents/MacOS/Antares /ruta/startup.json
ANTARES_BENCHMARK_OUTPUT=/ruta/red.json cargo test --locked -p antares --lib desktop_latency_twenty_samples -- --ignored --nocapture
node scripts/benchmark-core.mjs /ruta/filtro.json /ruta/glue-anterior.js /ruta/motor-anterior.wasm
```

La herramienta de arranque termina cada proceso QA al recibir la medida. Usar un paquete con identificador de prueba en una carpeta `.noindex`.

### 6. Preparación de entrega y actualización

`antares-build release-check` comprueba versiones de Tauri, Cargo, npm y sus bloqueos. `release-stage` comprueba nombre del paquete, firma del actualizador, revisión guardada y directorio limpio. Prepara manifiesto, notas, SHA-256 y registro de la arquitectura en una carpeta nueva. `release-merge` vuelve a verificar firmas y hashes y une únicamente paquetes de la misma revisión, versión, Cargo.lock y notas.

Se añadió el flujo manual `antares-release.yml` y el asistente `release-macos.sh`. El asistente de Windows utiliza la comprobación Rust. La entrega de Mac requiere Developer ID, notarización y firma del actualizador. Los detalles de entorno y comandos están en `docs/releases.md`.

La app separa descarga verificada e instalación. Permite cancelar la descarga y conserva la actualización encontrada si la red falla. Después de descargar se guarda la sesión más reciente y se fuerza la persistencia. Rust impide ejecutar dos operaciones de actualización simultáneas. Una cancelación finalizada deja libre el siguiente intento.

Se aprobaron pruebas con paquetes de ejemplo firmados, rechazo de contenido alterado, preparación y unión de dos plataformas, rechazo de versiones distintas y control de concurrencia y cancelación. Los paquetes de ejemplo usan una clave pública de pruebas. La clave privada de esa prueba se retiró después de generar las muestras.

La entrega firmada con las credenciales de distribución, la firma de código de Windows y una actualización instalada de extremo a extremo siguen pendientes. El flujo está preparado en el código local y debe ejecutarse en GitHub para obtener paquetes de ambos sistemas. La compilación QA del Mac usa firma ad hoc.

### 7. Migración a Rust por funciones

El esquema completo de preferencias, valores predeterminados, límites, validación y migraciones vive en `antares-core/src/preferences*.rs`. El puente Wasm los utiliza desde `prefs-schema.js`. Se conservan lectura de localStorage, rutas y eventos en el adaptador. Las preferencias antiguas de volumen, modos y ecualizador siguen pasando por las mismas pruebas.

El filtrado repetido de pistas utiliza un índice Rust. La cola y las decisiones de recuperación ya utilizaban el núcleo Rust y siguen usando sus adaptadores para Web Audio, temporizadores y controles nativos. La interfaz Leptos existente permanece integrada con esas funciones.

La migración continúa por módulos. Todavía quedan componentes y adaptadores JavaScript. Falta medir el efecto de cada módulo en memoria y arranque frío, y validar los cambios en WebView2.

### Validación disponible

Pasaron 249 pruebas del cliente, las suites Rust de escritorio, núcleo y herramientas de entrega, y 189 pruebas de API. El núcleo y las herramientas también pasaron `cargo check` para `x86_64-pc-windows-msvc` desde el Mac. Esa comprobación cruzada cubre esos paquetes Rust. La app completa y su instalador necesitan compilación y ejecución en Windows.

Las comprobaciones locales utilizaron perfiles QA y el paquete `Antares Escritorio QA`. La versión de la app sigue siendo 0.3.3. Los informes distinguen la revisión base `b9734743dec67d8eb80e5f3fc31fbeb1717a841f` de los cambios locales mediante `modified: true`.
