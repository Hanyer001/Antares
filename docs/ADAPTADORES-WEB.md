# Adaptadores de Antares Web

La interfaz original importa `platform.js`. En Tauri conserva el objeto de API real del contenedor; en web carga `web-runtime.js`. No se escribe `window.__TAURI__` ni se simula un contenedor global.

| Flujo | Adaptación web | Código compartido |
| --- | --- | --- |
| Buscar pistas/canciones, artista, álbum, lista y estanterías | Rutas HTTP de catálogo; búsqueda móvil musical. | `catalog-client.js`, `search-cache.js`, `ytmusic.rs`, `innertube.rs`. |
| Resolver y preparar audio | Metadatos y proxy AAC por ID; reintento con renovación de enlaces rechazados. | Resolutor InnerTube, caché, reproductor y recuperación. |
| Letras y enlaces de pista | API de letras y comando privado `track_links`. | `lyrics.rs`, `ytmusic.rs`, vistas y política de letras originales. |
| Listas, favoritos y valoraciones | Comandos privados autenticados por instalación y perfil. | `playlists.rs`, `stats.rs`, `library-model.js`, `lists.js`, `library-tools.js`. |
| Historial, escuchas y resumen | Comandos privados; cola local de envío y deduplicación de eventos. | `store.rs`, `stats.rs`, políticas originales de escucha e incógnito. |
| Inicio, radio y descubrimiento | Motor Rust con estadísticas del perfil y Mix musicales. | `home.rs`, `recommend.rs`, `related.rs`, vistas y momentos originales. |
| Ajustes y fondo | Persistencia por perfil; imagen validada. | `settings.rs`, `prefs-schema.js`, `appearance.js`, temas y diseños. |
| Usuarios | Registro por instalación; selección por cabecera de cada petición. | `users.rs` y vistas de usuarios/perfiles. |
| Copias | Codec compartido, respaldo anterior y restauración pendiente recuperable. | `backup_model.rs`, validación original y vistas de copias. |
| Importación | Trabajos separados: iniciar, consultar progreso, revisar, cancelar y confirmar. | `importer.rs` para proveedores, CSV, texto y coincidencias. |
| Exportar archivos | Compartir archivos cuando existe la capacidad; descarga con enlace como alternativa. | Vistas de exportación y formato de documentos original. |
| Sonido, temporizador y fundidos | HTMLMediaElement/Web Audio en vez del plugin nativo. | `player.js`, `sound.js`, `sleep.js`, visualizador y ajustes. |
| Controles del sistema | Media Session. | `mediasession.js`. |
| Sesión | IndexedDB v2 con caché en memoria y respaldo; migración del prototipo por origen. | `session.js`, `session-model.js`, `queue.js`. |
| Tacto y navegación | Navegación y gestos originales de Android también en iPhone. | `mobile.js`, `mobile-interactions.js`, `interaction-policy.js`, menús e iconos. |
| Actualizaciones | Service worker y recarga guardando sesión; motor junto con despliegue del servidor. | Vistas originales de actualización con adaptación web. |

## Capacidades propias del contenedor

Bandeja, Media3, atajos globales, arranque del sistema, puente de voz de Windows y apertura de ventanas del sistema requieren un equivalente o quedan identificados como capacidad nativa. Los atajos dentro de Antares, reproducción compacta/enfocada, archivos y controles multimedia conservan sus flujos web. `platform-ui.js` explica ajustes no disponibles.

## Contrato de datos

`POST /api/command/:command` recibe los argumentos originales en camelCase. Requiere clave aleatoria de instalación y perfil válido. Responde `{value, revision}`; las escrituras del cliente incluyen la revisión y se serializan. Una revisión atrasada produce conflicto en vez de sobrescribir otra ventana.

La cobertura funcional y la evidencia física están separadas en `PARIDAD-WEB.md`. La plantilla completa está montada; esto no acredita por sí solo la paridad física de cada función ni la reproducción en segundo plano.
