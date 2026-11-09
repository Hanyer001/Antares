---
tags:
  - antares
  - arquitectura
---
# Cómo funciona Antares

[[Antares|Volver al proyecto]]

| Parte | Implementación actual |
| --- | --- |
| Interfaz | Tauri muestra la interfaz HTML, CSS y JavaScript en el WebView de cada plataforma. El adaptador de plataforma conecta la interfaz con Tauri o con la API de la PWA. |
| Catálogo | Rust coordina búsquedas, listas y resolución de pistas. En escritorio, yt-dlp todavía interviene en parte de la búsqueda e importación. La búsqueda de escritorio combina los resultados y prioriza la grabación y el canal del artista cuando logra identificarlos. |
| Reproducción | En escritorio, Web Audio aplica volumen, ecualización y fundidos. En macOS y Linux, un puente HTTP local en Rust transmite el rango completo de audio. En Android, Media3 y ExoPlayer gestionan la reproducción nativa. El adaptador de iOS usa AVQueuePlayer. |
| Cola y sesión | JavaScript mantiene la cola, el modo aleatorio, la repetición y las decisiones de avance. La sesión guarda la pista, la posición y el estado de la cola para recuperarlos al abrir. |
| Biblioteca | Rust gestiona listas, favoritos, historial, estadísticas y copias. La PWA habla con la API Rust de Axum y usa IndexedDB para conservar estado y operaciones pendientes. |

## Dos problemas resueltos en la versión de referencia

1. El reproductor de Mac podía tomar el primer fragmento de audio como si fuera la pista completa. La ruta HTTP entrega el rango solicitado sin cortarlo al primer MiB. La prueba con «Talento» mostró aproximadamente 2:30 y llegó a la pista siguiente.
2. Las primeras filas dependían de qué fuente respondía antes. Ahora el buscador de escritorio reúne las fuentes antes de ordenar. Las coincidencias del artista y de su canal van arriba, y las otras versiones de la canción aparecen debajo. El paquete de Mac también conserva la firma original de yt-dlp para que el ejecutable pueda arrancar.

## Cómo seguir el trabajo

Registrar cada cambio con la rama o commit, qué comportamiento cambió, cómo se probó y qué falta comprobar. Distinguir las pruebas automáticas de las pruebas en dispositivos reales. Ver [[Ruta hacia Rust]].
