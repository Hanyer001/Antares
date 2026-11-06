# Paridad de Antares Web — etapa 3

Actualizado el 5 de noviembre de 2026. La web monta `src/index.html`, `src/main.js`, `src/mobile.css`, las fuentes, los temas y los módulos originales. En iPhone y Android se activa el diseño móvil de Android; el audio usa HTMLMediaElement/Web Audio. `src/js/platform.js` selecciona el transporte nativo o web sin inyectar un objeto global Tauri simulado.

## Cobertura de código y prueba física

| Área | Código conectado | Evidencia en Safari del iPhone | Pendiente |
| --- | --- | --- | --- |
| Navegación y diseño Android | Cabecera, navegación inferior, Más, menús, reproductor compacto y completo originales. | Inicio, Buscar, Más, Listas, Ajustes y apertura/cierre del reproductor. Se corrigió la barra de escritorio que tapaba la navegación. | Orientación horizontal, teclado en tamaños distintos y comparación con Android físico. |
| Búsqueda, artistas y álbumes | Adaptador HTTP al catálogo compartido; búsqueda musical móvil, estanterías, listas públicas y enlaces de pistas. | Búsqueda de coincidencias durante la importación de texto. | Repetir las vistas de artista/álbum con la nueva interfaz completa en el teléfono. |
| Biblioteca | Listas, favoritos, valoraciones, carpetas, portadas, detalles, fijar, orden, selección, copiar/mover y listas inteligentes mediante los modelos Rust originales. | Creación de «Prueba iPhone» mediante importación; carga de su canción; favorito confirmado. | Edición masiva y reglas inteligentes en el teléfono. |
| Importación | Proveedores originales de YouTube/YouTube Music, Spotify, Deezer, Apple Music, texto y CSV. Trabajo en segundo plano con progreso, revisión previa, cancelar y guardar. Repetir la misma importación conserva la lista existente si nombre y orden coinciden. | Texto «SZA - Kill Bill»: una coincidencia, revisión y guardado confirmados. | Pruebas de red reales de cada proveedor y CSV desde Archivos. Las pruebas Rust incluyen fixtures de paginación, duplicados y fallos. |
| Reproducción y cola | AAC, recuperación, posición, modos, cola manual, recomendaciones, gestos, temporizador y Media Session. | Kill Bill: contador avanzó de 0:05 a 0:14, duración visible 2:34, pausa y regreso a mini reproductor. | Fin real de pista y transiciones con pantalla bloqueada. No se acredita con esta prueba. |
| Letras | Vista original, sincronización, salto al verso, tamaño, alineación y desfase. | Letras cargadas y verso resaltado mientras sonaba. | Cambiar ajustes y buscar desde un verso en el teléfono. |
| Inicio y Descubrir | Estanterías originales y motor Rust de radios/recomendaciones, aventura y exclusiones. | Inicio y recomendaciones visibles; aparecieron pistas a continuación durante la reproducción. | Validar recomendaciones después de varias escuchas y modos temporales. |
| Historial, resumen y momentos | Modelos originales; eventos de escucha con identificadores, cola de envío local y deduplicación en el servidor. Incógnito conserva la política original del frontend. | Controles visibles. | Recorrer resumen, momentos e incógnito en el teléfono. |
| Apariencia y sonido | Temas, fondos, fuentes, densidad, perfiles, diseños, ecualizador, nivelador, visualizador y fundidos originales con capacidades web. | Ajustes de perfiles/usuarios visibles. | Verificar cada efecto en iPhone y Android; Web Audio puede cambiar el comportamiento en segundo plano. |
| Copias y usuarios | Datos por instalación/perfil, formato compatible compartido con Tauri, validación, respaldo previo y restauración por marca pendiente. | «Guardar copia ahora» actualizó la hora y mostró confirmación. | Exportar/importar desde Archivos y restaurar físicamente. Se probaron por código copia inválida y restauración válida. |
| Sesión | IndexedDB v2 por perfil con respaldo síncrono y migración del prototipo. | La sesión se guardó al pausar. | Reapertura tras cerrar Safari normal; la prueba actual usa navegación privada. |

## Condiciones de la prueba

La revisión final se hizo en Safari del iPhone real mediante Duplicación, con la dirección HTTP local del Mac. No se instaló otro ícono, por indicación del usuario. No se probó en Android físico: solo hay un iPhone disponible. La red local HTTP sirve para revisar la interfaz; la instalación PWA, el service worker y la publicación requieren volver a HTTPS estable.

Los túneles temporales anteriores dejaron de existir tras interrupciones de conexión. No son un alojamiento permanente. El servidor local continúa disponible mientras el Mac permanezca encendido y en la misma red.

## Diferencias de plataforma

Bandeja, inicio automático del sistema, atajos globales, servicio Media3 y plugins de documentos de Android no existen como tales en Safari. La web ofrece navegación móvil, controles Media Session, atajos dentro de Antares, descarga/compartir archivos y actualización del service worker. Los ajustes sin capacidad web se explican y desactivan donde corresponde. Las vibraciones dependen de la API del navegador.

La cobertura de código no equivale a haber validado todas las funciones en ambos teléfonos. La etapa conserva abierta la matriz física y los arreglos visuales que el usuario quiera hacer.

## Audio al pasar a Inicio — corrección del 5 de noviembre de 2026

El usuario informó que el audio se cortaba al ir a Inicio o cambiar de aplicación, manteniendo Safari abierto. Se añadió la selección de `navigator.audioSession.type = "playback"` antes de crear Web Audio y al iniciar reproducción, con detección de capacidad. También se reanudan contextos en estado `interrupted`, además de `suspended`, cuando el usuario solicita reproducir. No se añadieron reintentos de reproducción por eventos de visibilidad.

Tras recargar, el usuario confirmó que la música siguió sonando al salir durante la prueba solicitada de unos 20 segundos. Duplicación mostró el iPhone en Inicio. La audibilidad la confirmó el usuario; la herramienta no captura sonido. No se extendió esta conclusión al fin de pista, a dos transiciones con pantalla bloqueada ni a Android físico.

Validación: dos pruebas nuevas del adaptador Audio Session aprobadas y compilación web correcta. Se mantuvo la cadena de efectos existente. Referencia de la categoría de música: [Audio Session, W3C](https://www.w3.org/TR/audio-session/).
