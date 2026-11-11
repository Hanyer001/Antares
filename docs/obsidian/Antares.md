---
tags:
  - antares
  - proyecto
estado: referencia
---
# Antares

## Estado del proyecto

- **Código de referencia:** [rama main en GitHub](https://github.com/Hanyer001/Antares/tree/main).
- **Rama de trabajo:** [feat/macos-desktop](https://github.com/Hanyer001/Antares/tree/feat/macos-desktop).
- **Verificación en Mac:** la pista «Talento» se reprodujo completa y la cola avanzó. La búsqueda «Talento Yan Block» mostró primero la grabación de Yan Block y Panda Black y el video del canal del artista.
- **Pruebas de la referencia:** 247 de JavaScript y 224 de Rust aprobadas. Hay 11 pruebas de Rust marcadas para ejecución manual.
- **Migración a Rust:** pasos 2 a 4 y la pantalla Buscar del paso 5 verificados en macOS y en la PWA local. `antares-core` reúne cola, sesión, orden de búsqueda y recuperación. Buscar usa Leptos.

## Trabajo de escritorio del 10 de noviembre de 2026

Los cambios y las mediciones locales de los puntos 4–7 están en [[Ruta de mejoras para macOS y Windows]]. Preferencias y migraciones se ejecutan en Rust. Los informes locales agregan mediana y p95. La entrega verifica versiones, firmas y sumas en Rust. Las pruebas nativas de Windows y la entrega con credenciales de distribución siguen pendientes.

## Notas

- [[Cómo funciona Antares]] describe el reproductor, el catálogo, la biblioteca y las diferencias por plataforma.
- [[Ruta hacia Rust]] recoge la secuencia de cambios, las pruebas y el alcance de la primera entrega.
- [Guía de macOS](https://github.com/Hanyer001/Antares/blob/feat/macos-desktop/docs/MACOS.md) documenta la compilación y las comprobaciones físicas.

Para usar estas notas en Obsidian, abre la carpeta que contiene este archivo con **Abrir carpeta como bóveda** y entra en **Antares**.


## Actualización de GitHub del 10 de noviembre de 2026

Se integran los cambios de Rust, Leptos, escritorio, API y herramientas de entrega en `main`, conservando la rama de trabajo de macOS. El README en inglés y español describe el workspace actual y los estados por plataforma.

La página de presentación se mantiene en `Hanyer001/Pagina-Antares`, publicada desde la raíz de `main`. Se actualizan su portada, las novedades de desarrollo, la información técnica y los enlaces por sistema. El repositorio `Hanyer001/antares-actualizaciones` conserva los paquetes publicados y documenta su relación con el código nuevo.

Las descargas existentes siguen correspondiendo a Windows 0.3.3 y Android 0.3.3 Beta 1. La página distingue estas versiones del desarrollo de macOS, PWA/iOS y la migración a Rust. La rama `feat/cuentas-web` mantiene el trabajo separado de autenticación.

Antes de subir se ejecutaron 249 pruebas del cliente, 203 de escritorio y núcleo Rust, 3 de las herramientas de entrega y 189 de la API. La PWA se compiló. La página se comprobó en Safari y sus enlaces se verificaron para Windows, Android, macOS, iPhone e iPad.
