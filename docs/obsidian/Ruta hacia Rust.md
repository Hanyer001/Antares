---
tags:
  - antares
  - rust
estado: planificado
---
# Ruta hacia Rust

[[Antares|Volver al proyecto]]

El objetivo es que Rust concentre las reglas del producto y, después, el código de la interfaz mediante WebAssembly. HTML y CSS seguirán describiendo la presentación. Los adaptadores nativos se reducen después de comprobar las funciones de cada plataforma.

## Primera entrega

1. Crear un workspace de Cargo y una biblioteca de dominio `antares-core`. Empezar por tipos de cola y sesión, sin dependencias de Tauri, del navegador ni de HTTP.
2. Portar las operaciones básicas de la cola. Empezar por añadir, poner a continuación y avanzar. Después cubrir retroceso, repetición, aleatorio, cola automática y deshacer.
3. Usar los casos de las pruebas existentes como referencia de comportamiento. Incluir la lectura de sesiones del formato anterior, con pista, posición y modo de reproducción.
4. Conectar la cola Rust a la interfaz actual de escritorio. Mantener un solo estado de cola activo. Compilar en macOS y comprobar la sesión al cerrar y abrir.
5. Usar la biblioteca desde la PWA mediante WebAssembly cuando la integración de escritorio esté estable. Preservar el almacenamiento y las operaciones pendientes al actualizar.

## Entregas posteriores

- Compartir más código Rust entre Tauri y Axum mediante dependencias de Cargo.
- Migrar el orden de búsqueda y las reglas de recuperación de audio. Volver a probar «Talento Yan Block», el salto después del primer minuto y el avance al finalizar.
- Construir la vista Buscar en Leptos y migrar después biblioteca, historial y ajustes. Dejar el reproductor visual y sus efectos para una etapa propia.
- Evaluar por separado la retirada de Node en la compilación, de yt-dlp en el catálogo y del código que aún quede en los adaptadores móviles.

Cada entrega debe anotar qué pasó en Mac, qué se verificó en la PWA y qué sigue pendiente en dispositivos móviles. La referencia y el alcance actual están en [[Antares]].
