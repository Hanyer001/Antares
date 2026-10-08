# Cambios

## 0.3.3 — 2026-10-07

- Importación paginada de playlists públicas de Spotify: ya no se limita a
  las primeras 100 canciones. El resumen distingue canciones del origen,
  coincidencias, duplicados y canciones no encontradas; límite de 500 pistas.
- Reconocimiento de enlaces de Spotify, Deezer, Apple Music y YouTube Music
  desde la búsqueda y el importador, con errores claros para formatos no compatibles.
- Discos completos en su orden original, también desde una pista intermedia;
  Aleatorio permite barajar explícitamente el álbum.
- Tocar una canción, Reproducir o Tus artistas utiliza las cinco principales
  y la continuación habitual, sin desplegar el catálogo completo en pantalla.
- Solo este artista carga el catálogo únicamente en la cola, mantiene la vista
  compacta y evita recomendaciones ajenas. Se recuerda entre sesiones y se
  desactiva al elegir otra colección o canción.
- Código de Android actualizado con recuperación de reproducción, interfaz
  táctil, diseños predefinidos, cola con Deshacer, gestos y control del descubrimiento.
  Android continúa en pruebas; no se ha medido la batería en un teléfono.

## Android Preview 8 (0.3.2-preview.8)

- Cola táctil con arrastre y Deshacer al quitar canciones pendientes, conservando
  la pista activa y los cambios posteriores de la cola.
- Gestos del mini reproductor con umbral y cancelación; botón siguiente visible.
- Inicio: ordenar, fijar y ocultar secciones directamente, usando datos cargados.
- Más como esta, Menos de este artista y Ya la conozco, con Deshacer y revisión
  en Ajustes. Preferencia suave por artista integrada en el recomendador Rust.
- Respuesta táctil opcional, desactivada por defecto y respetando Android.
- 161 pruebas JavaScript y 35 del recomendador Rust; integración de interfaz y
  cuatro tamaños de pantalla. Sin prueba física de batería o vibración.

## Android Preview 7 (0.3.2-preview.7)

- Diseños rápidos Minimal, Medianoche, Menta y Claro, editables y compatibles
  con perfiles; conservan tamaño de lectura, movimiento y ahorro.
- Retiradas las opciones de personalización de carátula en Android. La imagen
  de la canción se mantiene y los perfiles antiguos se adaptan automáticamente.
- Eliminadas la carga y extracción de colores adicionales de portada en Android.
- 152 pruebas JavaScript y validación de estilos, guardado y perfiles. Interfaz
  comprobada en cuatro tamaños, incluido horizontal. Sin prueba física de batería.

## Android Preview 6 (0.3.2-preview.6)

- Sustituido el cliente de audio ANDROID_VR que devolvía HTTP 403 después del
  inicio por VISIONOS, con cabecera de reproducción coincidente.
- Recuperación confirmada por audio real de Media3, cancelable al pausar o
  cambiar de canción. Se limita la duplicación de reintentos de red.
- Validado con 148 pruebas JavaScript y 14 pruebas Android, incluida la lectura
  completa y seek de tres streams reales de YouTube.

## Android Preview 5 (0.3.2-preview.5)

- Corregido el final prematuro de canciones cuando el CDN entrega un bloque
  incompleto sin Content-Range. Se utiliza el tamaño del audio de la URL.
- Recuperación nativa de cortes y timeouts desde el último byte, con reintentos
  limitados y cancelables, también con la interfaz en segundo plano.
- Renovación de URLs rechazadas por HTTP 403/410 por el mismo ID y formato,
  sin repetir ni mezclar bytes de audio.
- Validado con 13 pruebas Android, incluida una conexión HTTP que se corta a
  mitad de la descarga, y 141 pruebas JavaScript.

## Android Preview 4 (0.3.2-preview.4)

- Play y pausa responden inmediatamente durante la carga y se sincronizan con
  Media3 y los controles de la notificación. Se descartan estados atrasados.
- Nuevo diseño móvil: cabecera y perfiles, navegación inferior, tarjetas claras,
  menús desde abajo y reproductor ampliado. Personalización conservada.
- Animación breve del botón de reproducción compatible con ahorro de energía y
  preferencias de movimiento reducido; sin animaciones decorativas continuas.
- Actualización con la misma firma y datos de las Preview anteriores.

## Android Preview 3 (0.3.2-preview.3)

- Corregidos cambios involuntarios de canción por eventos atrasados, órdenes
  pendientes y reintentos de una pista anterior. La selección conserva su ID.
- Los fundidos de Android se gestionan exclusivamente en el servicio nativo.
- Interfaz móvil simplificada: búsqueda dedicada, filas con un menú, portadas
  despejadas, más separación y controles de momento agrupados.
- Actualización compatible con los datos y la firma de las Preview anteriores.

## Android — en desarrollo

- Preview 2: corregido el HTTP 403 de audio con rangos finitos de 1 MiB y lectura continua; pruebas de saltos y reapertura.

- Navegación táctil personalizable con accesos inferiores y menú Más.
- Cola, escuchas, repetición y temporizador en el servicio Media3.
- Ecualizador/nivelador nativos según disponibilidad y fundidos opcionales.
- Ahorro de recursos, precarga opcional, límites de fondos y suspensión de actualizaciones de interfaz al ocultarse.
- Usuarios y restauración de datos sin reinicio del proceso; exportación con el selector de documentos Android.
- Script de compilación reproducible, APK Preview separado y documentación de pruebas pendientes.


## 0.3.2

- Extracción nativa de audio en Windows con rusty_ytdl y corrección de los enlaces que devolvían HTTP 403.
- Corrección de los avisos de compilación del constructor de pruebas y del enlazador de Windows.

## 0.3.0

- Recuperación de reproducción con renovación del enlace, conservación de posición y espera de reconexión.
- Copias completas por usuario, respaldo automático y restauración al reiniciar.
- Búsqueda dentro de listas, selección múltiple y operaciones de copiar, mover y quitar canciones.
- Carpetas, listas fijadas, portadas y descripciones.
- Listas inteligentes con reglas editables.
- Recomendaciones por momento, Más de este estilo y exclusión temporal de canciones.
- Separación entre estadísticas de escucha y aprendizaje de gustos habituales.
- Comprobación e instalación de actualizaciones firmadas de Windows.
