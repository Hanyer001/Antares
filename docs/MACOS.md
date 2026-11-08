# Antares en macOS

La compilación nativa se verificó en Apple Silicon. Antares usa Tauri con WKWebView y conserva la misma biblioteca, vistas, cola y comandos de Rust de la aplicación de escritorio. La prueba usa un identificador distinto para separar los datos.

## Compilar

Instala Xcode o sus herramientas de línea de comandos, Rust y Node con npm. Desde el repositorio, ejecuta:

```sh
sh scripts/build-macos.sh
```

El asistente detecta Apple Silicon o Intel, descarga el yt-dlp oficial para Mac si hace falta y valida SHA-256 antes de instalarlo como sidecar. Se puede ejecutar con `--prepare` para preparar solo el sidecar. La configuración de macOS empaqueta `.app` y `.dmg`. Para compilar solo la aplicación:

```sh
APPLE_SIGNING_IDENTITY=- sh scripts/build-macos.sh --bundles app
```

El paquete queda en `src-tauri/target/<target>/release/bundle/macos/`. Para validar desarrollo con datos separados:

```sh
sh scripts/build-macos.sh --debug --bundles app \
  --config '{"identifier":"com.hanyer.antares.macosqa","productName":"Antares QA"}'
```

La firma ad hoc permite la prueba local. Para distribuir en otros Mac, prepara la firma Developer ID y la notarización. Para publicar autoactualizaciones también hace falta generar el archivo de actualización firmado por Tauri y añadir la entrada `darwin-aarch64` al manifiesto del canal. La consulta de versiones muestra un mensaje específico si el manifiesto no ofrece un paquete para Mac. [Firma para macOS en Tauri](https://v2.tauri.app/distribute/sign/macos/).

## Controles y comprobaciones

- **Reproducción** en el menú de macOS ofrece reproducción/pausa, anterior, siguiente y Me gusta. Los controles siguen el estado real de la pista y la cola.
- **Ajustes → Sistema → Barra de menús** mantiene la sesión activa al cerrar la ventana. Puedes volver a mostrarla desde la barra de menús o el Dock. Comando+Q guarda la sesión y sale.
- **Abrir al iniciar sesión** registra un LaunchAgent. **Iniciar en la barra de menús** pasa el argumento para abrir la ventana oculta. Mueve la app a su ubicación definitiva antes de activar esta opción, porque se registra la ruta del ejecutable.
- **Ajustes → Atajos** permite configurar combinaciones locales y globales. En Mac se muestran Opción y Comando. macOS puede reservar combinaciones.

| Área | Resultado en Apple Silicon |
| --- | --- |
| App, catálogo, reproducción | Paquete nativo abierto, búsqueda con resultados, reproducción, pausa y cambio de posición. La cola avanzó automáticamente durante la prueba. |
| Menú Reproducción | Pausa y Me gusta verificados en el menú nativo. Los controles mostraron su estado según la pista y la cola. |
| Ventana | Mini reproductor y vuelta al tamaño normal. Cierre de ventana con reproducción activa y recuperación con el atajo global de mostrar y al volver a abrir el paquete desde Finder. |
| Biblioteca y sesión | Creación de una lista, favorito, respaldo interno y persistencia al salir con Comando+Q. La pista reanudó en la posición guardada. Se restauró una copia interna y se cambió a otro usuario. Ambos pasos reabrieron la ventana automáticamente y el segundo usuario tenía una biblioteca aislada. |
| Sistema | Se activó y desactivó el inicio automático en la app de prueba. Se observó el LaunchAgent. Se comprobó el mensaje del canal de actualización sin paquete de Mac. |
| Pendiente de validación física | Teclas multimedia, Centro de Control, entrega de notificaciones, inicio tras cerrar sesión y atajos globales de transporte. Los controles de audio se revisaron desde la app. La calidad acústica del ecualizador y la superposición del fundido requieren una escucha comparativa. |
| Otras rutas | Queda por probar de punta a punta cada proveedor de importación, la restauración desde archivo y el empaquetado Intel. |

Pruebas ejecutadas: 246 de JavaScript y 220 de Rust en macOS. Once pruebas de Rust estaban marcadas para ejecución manual. La compilación de la PWA también completó.
