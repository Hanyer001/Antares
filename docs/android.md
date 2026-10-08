# Antares para Android — versión de pruebas

La adaptación Android mantiene la biblioteca y la personalización de Antares. Esta edición todavía necesita pruebas en un teléfono real antes de publicarse como estable. No se ha medido su consumo de batería.

## Funciones adaptadas

| Función | Android |
| --- | --- |
| Buscar por texto, URL o ID de YouTube | Backend Rust e InnerTube; no requiere ejecutables externos. |
| Cola, anterior/siguiente, aleatorio y repetición | Cola completa en ExoPlayer, independiente del WebView. |
| Reproducción en segundo plano | Servicio Media3 con sesión multimedia y controles del sistema. Pendiente de comprobar con pantalla apagada en un teléfono. |
| Listas, carpetas, favoritos y reglas inteligentes | Conserva los modelos y datos existentes. El menú ↕ permite ordenar canciones con el dedo. |
| Radios, recomendaciones, momentos y resumen | Conserva el backend; las escuchas se registran desde el servicio nativo. |
| Incógnito | El servicio respeta el ajuste al registrar historial y escuchas. |
| Letras | Vista y seguimiento mientras la interfaz está visible. |
| Temas, colores, fuentes, fondos y perfiles | Conservados; navegación inferior con cuatro accesos y menú Más, según el orden personalizado. |
| Usuarios y copias completas | Cambio de datos sin reiniciar el proceso Android; exportación mediante el selector de documentos del sistema. |
| Ecualizador | Efectos nativos. Diez bandas con DynamicsProcessing cuando está disponible; adaptación a las bandas del ecualizador del dispositivo en el resto. |
| Nivelador | Compresión dinámica disponible cuando Android ofrece DynamicsProcessing. Se deshabilita si no está disponible. |
| Fundido entre canciones | Segundo reproductor solo durante la transición; requiere desactivar Ahorro de recursos. |
| Temporizador | Gestionado por el servicio: por tiempo o al acabar la canción. |

Las funciones propias de ventanas de Windows (bandeja, mini ventana, inicio con Windows y atajos globales) se sustituyen por la navegación táctil y los controles multimedia de Android. Los APK se actualizan mediante paquetes firmados con la misma clave; el actualizador de Windows no instala APK.

## Recursos y batería

En Ajustes → Android, **Ahorro de recursos** está activado inicialmente y la precarga opcional desactivada. El ahorro reduce animaciones y desenfoque y evita el segundo decodificador de los fundidos. Los controles de tiempo y los efectos visuales dejan de actualizarse cuando se oculta la actividad. El temporizador mantiene su reloj en el servicio, sin un intervalo web en segundo plano.

El reproductor mantiene un búfer de 15–30 segundos. Resuelve las fuentes cuando se abren y usa la caché Rust; no extrae anticipadamente toda la cola. Android no incluye rusty_ytdl/Boa ni ejecuta yt-dlp. Las carátulas de fondo se limitan a 1280 píxeles. El ahorro de datos existente sigue siendo un ajuste separado para la calidad del stream.

Estas medidas reducen trabajo innecesario; no equivalen a una medición de batería. La continuidad con Wi-Fi, las restricciones del fabricante, auriculares, interrupciones de audio y efectos deben verificarse en dispositivos reales.

## Compilar desde CMD

Requisitos: Rust con los targets Android, Java 17 o posterior, SDK Android 36 y NDK. El proyecto acepta JAVA_HOME/ANDROID_HOME/NDK_HOME, la opción -ToolsDirectory o android-tools.local.json (archivo local ignorado por Git).

```cmd
cd /d C:\Users\Hanyer\Desktop\Cliente_music\Antares
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\build-android.ps1 -Debug -OptimizedPreview
```

La salida queda en dist-android\Antares-0.3.2-android-preview.apk. El script compila ARM64 y ARM de 32 bits. Para compilar solamente teléfonos ARM64 añade `-Architectures arm64`. La optimización utiliza el perfil release de Rust y la firma de pruebas de Android.

La aplicación de pruebas usa `com.hanyer.antares.preview` y el nombre **Antares Preview**: puede coexistir con Antares normal y tiene sus propios datos. No comparte ni borra la biblioteca de la otra aplicación. Exporta una copia desde la aplicación original e impórtala en Preview si deseas trasladar tus listas.

Para un APK de distribución, conserva el keystore original y configura keystore.properties fuera de Git; ejecuta el script sin -Debug. No cambies la firma de una aplicación ya distribuida. Las claves privadas, contraseñas y la configuración local de herramientas nunca deben subirse.

## Verificación pendiente en teléfono

Antes de una publicación estable: reproducción y cambio de canción con pantalla apagada; botones de notificación y auriculares; desconexión y reconexión de red; reabrir la actividad con el servicio reproduciendo; repetición y aleatorio; temporizador y fundidos; disponibilidad de EQ/nivelador; exportar/restaurar y cambiar usuario. Medir CPU, memoria y batería durante una sesión prolongada, comparando los ajustes de ahorro. No se han realizado estas pruebas físicas.

## Preview 2: corrección de reproducción

La versión Android `0.3.2-preview.2` corrige las peticiones de audio que YouTube rechazaba con HTTP 403. La fuente nativa solicita rangos finitos de hasta 1 MiB y continúa con el siguiente bloque dentro del mismo reproductor. Conserva los saltos de posición y la cola. No descarga la canción completa por adelantado.

Se verificaron tres streams reales de YouTube y cuatro pruebas de la fuente de datos Android (continuidad, rango explícito/seek, final de archivo y reapertura). El APK conserva el paquete y la firma de la primera Preview: se instala encima, sin desinstalar ni borrar los datos. La comprobación de reproducción y batería en un teléfono sigue pendiente.


### Preview 3: selección estable e interfaz móvil

La versión `0.3.2-preview.3` (`versionCode 300203`) se instala como actualización
de Antares Preview con la firma existente. No es necesario desinstalar ni borrar datos.

- Una canción elegida se resuelve por su ID de YouTube, incluso si el enlace
  guardado es antiguo. Una respuesta de otro ID se rechaza.
- Los eventos de tiempo, estado y error llevan el ID de la pista; los de una
  selección anterior se descartan. Las órdenes pendientes de carga, play, seek
  y sincronización de cola tampoco pueden reemplazar una selección más reciente.
- Al avanzar desde Media3, los reintentos se vinculan a la pista actual.
  Media3 gestiona los fundidos; la interfaz no inicia un segundo avance.
- Android tiene una búsqueda dedicada, más espacio entre secciones y una acción
  de menú por fila. Las acciones de cola, radio, listas y eliminación siguen
  accesibles. El menú de las tarjetas se muestra junto al título; las portadas
  quedan despejadas. La barra de reproducción vacía se oculta.
- Los temas, fondos, perfiles y orden personalizado de secciones se conservan.
  Las opciones de momento y aprendizaje se agrupan en un apartado desplegable.

Validación: 136 pruebas JavaScript, 4 pruebas del flujo de audio de Media3 y
pruebas de integración de la interfaz con un servicio simulado (selección,
eventos atrasados, fundidos, recuperación y menús). Diseño comprobado en
320×640, 393×852, 412×915 y 852×393. Las carátulas de las capturas son de
demostración. La reproducción y el consumo de batería en un teléfono físico
siguen pendientes de verificación.


### Preview 4: diseño Android y controles de pausa

La versión `0.3.2-preview.4` (`versionCode 300204`) conserva el identificador
`com.hanyer.antares.preview` y la firma de las Preview anteriores. Instala el APK
encima del existente, sin desinstalar, para conservar listas y ajustes.

- Cabecera Antares con acceso a perfiles, búsqueda dedicada, portadas despejadas
  y navegación inferior con indicador de sección. Menús en una hoja inferior.
- Mini reproductor con una acción principal y reproductor completo con controles
  más amplios. Toca el título o la portada para abrirlo y la flecha para cerrarlo.
- Ajustes y tarjetas de temas compactos. Se conservan colores, fondos, tipografía,
  esquinas, densidad, perfiles y orden de navegación.
- Play y pausa reflejan `playWhenReady` de Media3 incluso durante la carga.
  La interfaz responde al toque y la confirmación nativa decide el estado final.
  Las órdenes pendientes reemplazadas y los eventos de estado atrasados se ignoran.
  La notificación y la restauración de la sesión usan el mismo estado.
- Animación del icono de 180 ms y respuesta al toque de 140 ms, también con ahorro
  de energía. El aro gira solo durante la carga, se oculta al pausar y detiene
  su animación cuando la interfaz está en segundo plano. Se respetan las opciones
  «Pocas»/«Ninguna» y la preferencia del sistema de reducir movimiento.

Validación: 141 pruebas JavaScript y 4 pruebas de audio Android, compilación de
Kotlin y APK para ARM64 y ARM de 32 bits. Integración con un servicio simulado:
selección de pista, eventos atrasados, fundidos, recuperación, pausa al cargar y
animación. Diseño revisado en 320×640, 393×852, 412×915 y 852×393; temas claro y
oscuro y opción sin animaciones comprobados. Las carátulas de las capturas son de
demostración. No se hicieron pruebas con un teléfono físico ni mediciones de batería.


### Preview 5: cortes a mitad de canción

La versión `0.3.2-preview.5` (`versionCode 300205`) actualiza Antares Preview
con el mismo identificador y firma. Instala el APK encima de la Preview anterior,
sin desinstalar, para conservar los datos.

Se reprodujeron dos fallos del lector de audio: una respuesta incompleta sin
`Content-Range` podía terminar una descarga de 3 MB después de apenas 1 MB, y
un timeout de lectura no se recuperaba dentro de la fuente.

- El lector usa el tamaño `clen` de la URL cuando el CDN omite `Content-Range`.
  Un bloque truncado no se considera el final de la canción si faltan bytes.
- Los cortes y timeouts reabren el rango desde el último byte entregado al
  decodificador, conservando el formato y los encabezados. Hay como máximo
  tres recuperaciones por bloque; cancelar la carga cancela los reintentos.
- Los HTTP 403/410 permiten renovar una vez el enlace por el mismo ID de YouTube,
  invalidando la URL en caché bajo el turno de resolución. La renovación se hace
  desde el hilo nativo de carga, también con la interfaz en segundo plano.
- Un cambio de formato o tamaño durante la renovación se rechaza: no se mezclan
  bytes de otro stream. Los errores permanentes siguen usando la recuperación
  de la app. El final real y los seeks siguen respetando sus rangos.
- Se conserva el búfer, la calidad elegida y el ahorro de energía; no se añade
  precarga continua ni se descarga la canción completa por adelantado.

Validación: 13 pruebas Android y 141 pruebas JavaScript. Incluye un servidor HTTP
local que cierra una conexión después de entregar 123 bytes del segundo bloque;
la descarga final se comparó byte por byte con el audio de prueba completo.
También se probaron renovación del mismo ID, rechazo de otro formato, límite de
reintentos, cancelación y final HTTP 416. Compilación para ARM64 y ARM de 32 bits.
No se probó la reproducción en un teléfono físico ni se midió su batería.


### Preview 6: rechazo del stream después del inicio

La versión `0.3.2-preview.6` (`versionCode 300206`) conserva el paquete y la
firma. Instala el APK encima de Preview 5 sin desinstalar para conservar tus datos.

El cliente de extracción ANDROID_VR 1.65.10 entregaba URLs que respondían al
primer bloque, pero devolvían HTTP 403 en rangos posteriores. Se reprodujo con
«Esclava (Remix)». Reducir el bloque a 64 KiB solo retrasó el rechazo. Renovar
con el mismo cliente tampoco corrigió la causa.

- La extracción Android utiliza VISIONOS y el lector nativo usa su User-Agent.
  Conserva URL/ID de entrada, selección de audio, calidad y metadatos de salida.
  No introduce procesos externos ni un motor JavaScript de extracción.
- La interfaz confirma la recuperación cuando Media3 empieza a reproducir
  muestras; aceptar una orden play mientras carga ya no cuenta como éxito.
- La pausa o una nueva selección cancelan la espera del audio anterior.
- El watchdog Android deja margen a los reintentos nativos. Media3 no multiplica
  de nuevo los intentos del lector: las reconexiones siguen siendo limitadas.
- Después de diez segundos de avance del audio se permite recuperar un corte
  independiente. Errores seguidos sin ese avance siguen terminando en el aviso.
- No cambia el diseño, el búfer de 15–30 segundos ni el ahorro de recursos.

Validación: 148 pruebas JavaScript y 14 pruebas Android sin fallos ni omisiones.
La prueba de integración usa DefaultHttpDataSource y ChunkedAudioDataSource
contra tres streams reales: Esclava (Remix), Creep y Never Gonna Give You Up.
Compara tamaño y checksum de todos los bytes con una lectura independiente;
también reabre después de 3 MiB y llega al final. No se ha comprobado el
decodificador, la pantalla apagada ni la batería en un teléfono físico.


### Preview 7: diseños rápidos y personalización más sencilla

La versión `0.3.2-preview.7` (`versionCode 300207`) conserva el paquete y la
firma. Instala el APK encima de tu Antares Preview sin desinstalar para
conservar canciones, listas y ajustes.

En **Más → Ajustes y personalización → Apariencia → Diseños rápidos** hay
cuatro estilos: Minimal, Medianoche, Menta y Claro. Cada uno aplica tema,
acento, tipografía, esquinas y densidad. Puedes retocarlo y guardarlo como
perfil. Se mantienen el tamaño de lectura, las preferencias de movimiento,
los ajustes de audio y el ahorro de energía.

La imagen de la canción se conserva. Android elimina únicamente sus opciones
de personalización: tema y acento derivados de la carátula, tinte, fondo con
carátula y selector de su tamaño. Los ajustes y perfiles antiguos se adaptan
a un tema con acento fijo y fondo liso cuando corresponde. Se conservan las
imágenes de fondo elegidas por el usuario y las demás opciones de apariencia.

Las tarjetas de estilos no descargan imágenes ni tienen animaciones continuas.
Android deja de cargar la miniatura adicional y analizar sus píxeles para
extraer colores. No se ha medido el ahorro de batería en un dispositivo.

Validación: 152 pruebas JavaScript, integración de guardado y perfiles con
backend simulado, y revisión de la interfaz en 320×640, 393×852, 412×915 y
852×393, sin desbordamiento horizontal ni textos de tarjetas recortados.
El lector nativo de audio conserva la corrección de Preview 6 y sus pruebas;
esta entrega no vuelve a probar reproducción ni batería en un teléfono.


### Preview 8: interacciones para Android

La versión `0.3.2-preview.8` (`versionCode 300208`) conserva paquete y firma.
Instala el APK encima de tu Preview actual, sin desinstalar, para conservar datos.

1. **Cola:** arrastra el asa de una canción pendiente para ordenar. Toca el asa
   para subir, bajar o mover a los extremos. La canción actual permanece fija.
   Quitar una canción desde su menú muestra **Deshacer**. La restauración añade
   solamente esa entrada: conserva nuevas canciones y el avance de reproducción.
   Al reordenar, lo pendiente se considera elegido manualmente, para mantener
   ese orden cuando se renuevan las recomendaciones. No se vuelve a extraer
   el audio actual; el servicio recibe el orden definitivo cuando sueltas.
2. **Mini reproductor:** desliza a la izquierda para avanzar y a la derecha
   para la acción anterior. Los movimientos cortos o predominantemente
   verticales no cambian de canción. Los botones de reproducción y siguiente
   siguen disponibles; el reproductor ampliado conserva todos sus controles.
3. **Inicio:** pulsa **Organizar Inicio**. Arrastra el asa de una sección o
   tócala para fijar arriba, subir, bajar u ocultar. Las fijadas permanecen
   delante; se ordena dentro del grupo fijado o del grupo normal. Ocultar tiene
   Deshacer. Pulsa **Listo** para salir. Reutiliza las secciones ya cargadas.
4. **Descubrimiento:** en **Más opciones** están **Más como esta**, **Menos de
   este artista** y **Ya la conozco**, con confirmación y Deshacer. Menos reduce
   el peso del artista al 25 % del que tenía; no lo bloquea. Ya la conozco evita
   presentar ese video como descubrimiento en Inicio, Descubrir y futuras
   solicitudes; no borra la canción ni impide buscarla o reproducirla a mano.
   Puedes revisar estas señales en Ajustes → Recomendaciones. El bloqueo
   completo de un canal sigue disponible como acción independiente.
5. **Respuesta táctil:** se activa en **Ajustes → Android y batería**. Está
   apagada por defecto. Se solicita una respuesta breve tras guardar un favorito
   o confirmar un cambio de orden, respetando la configuración de Android.

Los gestos se cancelan al perder el puntero o salir de la pantalla. El
desplazamiento automático de listas trabaja solo mientras se arrastra junto
a un borde y se detiene al soltar. No se añaden visualizadores, sondeos ni
animaciones decorativas continuas. La respuesta táctil utiliza
[la API oficial de Android](https://developer.android.com/develop/ui/views/haptics/haptic-feedback)
sin pedir permiso VIBRATE ni ignorar las preferencias del sistema.

Validación: 161 pruebas JavaScript y 35 del recomendador Rust. Incluye una
prueba de frecuencia que demuestra reducción sin bloqueo del artista. La
integración de interfaz usa un servicio simulado y verifica arrastre,
cancelación, ausencia de nueva extracción durante el gesto, deshacer, gestos,
organización de Inicio, feedback y activación opcional de respuesta táctil.
Se comprobó también el arrastre mediante entrada real del navegador y cuatro
tamaños de interfaz (320×640, 393×852, 412×915 y 852×393).
No se hicieron pruebas en un teléfono, de vibración física ni de batería.
El lector de audio mantiene las correcciones anteriores.
