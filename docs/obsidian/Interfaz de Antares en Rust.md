# Interfaz de Antares en Rust

[[Ruta hacia Rust|Volver a la ruta anterior]]

La ruta continúa el buscador que ya usa Leptos. El objetivo es escribir en Rust los componentes, el estado de la interfaz y las reglas de Antares, y reutilizarlos en Tauri y la PWA. Los estilos CSS, los recursos visuales y los adaptadores de audio del sistema tienen responsabilidades separadas.

## Opciones evaluadas

| Opción | Qué aporta | Encaje en Antares |
| --- | --- | --- |
| Leptos + Tauri | Componentes Rust compilados a WebAssembly, con HTML y CSS en el WebView o navegador. | Reutiliza Buscar, los estilos y la integración actual. Es la ruta principal. |
| Dioxus | Componentes Rust con RSX. Sus renderizadores web y WebView son los más maduros. Blitz ofrece un renderizador propio experimental. | Cambiar ahora implicaría reescribir Buscar y rehacer parte de la integración. Revisar si aparece una necesidad concreta que Leptos no cubra. |
| Slint | Interfaz renderizada por Slint en escritorio y móvil. Usa un lenguaje declarativo en archivos `.slint`. | Candidato para un prototipo sin WebView. Su salida web usa canvas y la documentación indica que carece de soporte para lectores de pantalla. |
| egui / Iced | Interfaces escritas en Rust con su propio renderizado. | Alternativas para una prueba de escritorio. Sus plataformas documentadas no cubren juntas el objetivo de escritorio, iPhone, Android y PWA con la paridad requerida. |

[Leptos con Tauri](https://v2.tauri.app/start/frontend/leptos/) · [Dioxus y sus renderizadores](https://dioxuslabs.com/learn/0.7/beyond/project_structure/) · [Slint en iOS](https://docs.slint.dev/latest/docs/slint/guide/platforms/mobile/ios/) · [Slint en web](https://docs.slint.dev/latest/docs/slint/guide/platforms/web/) · [Plataformas de eframe](https://github.com/emilk/egui/blob/main/crates/eframe/README.md) · [Iced](https://github.com/iced-rs/iced)

## Entregas propuestas

1. **Fijar una referencia.** Registrar qué funciona hoy en Buscar, Listas, Reciente, Ajustes, Inicio y Reproductor. Guardar capturas en tamaños de escritorio y móvil, y medir arranque, búsqueda, inicio de audio, fluidez de desplazamiento, memoria y tamaño comprimido del paquete web. Usar un perfil de prueba y compilar en modo release. Comparar búsquedas repetidas con caché fría y caliente, y separar demora de red, resolución de URL, actualización de la vista y primer audio.
2. **Separar las vistas del núcleo.** Mantener cola, sesión, ranking y recuperación en `antares-core`. Crear un módulo de interfaz e independizarlo como `antares-ui` cuando tenga una segunda pantalla. Mover primero Buscar conservando su API de montaje, sus clases CSS y el artefacto WASM de la compilación inicial. La interfaz comparte modelos con el núcleo. Tauri y la PWA traducen acciones a sus mecanismos existentes.
3. **Migrar Reciente, luego Listas y Ajustes.** Reciente es el primer corte. Comprobar historial, estados vacíos, teclado, reproducción y reanudación con datos guardados. En Listas, cubrir crear, editar, reordenar, importar y exportar. En Ajustes, cubrir preferencias, temas y perfiles. Retirar el código reemplazado pantalla por pantalla después de verificar paridad. Mantener los formatos de datos existentes.
4. **Migrar Inicio y navegación.** Reutilizar filas, tarjetas y diálogos que ya tengan dos consumidores. Limitar el renderizado a las filas visibles si las mediciones muestran lentitud en bibliotecas largas. Mantener el diseño Android como referencia para la vista móvil y comprobar foco, zonas táctiles y lectores de pantalla.
5. **Migrar la interfaz del reproductor.** Pasar a Rust los controles, el estado visible y la coordinación con la cola. Conservar la reproducción de escritorio y web, el servicio Media3 de Android y el adaptador de iOS durante ese cambio. Verificar volumen con audio real al 20 %, 0 % y al volver a subir, y verificar salto de posición, final de pista, cambio automático, letras, modo mini y efectos donde ya existan. En teléfonos físicos, comprobar cambio de aplicación, pantalla bloqueada, pausa y reanudación, desconexión y reconexión de audífonos y recuperación tras perder la red.
6. **Simplificar la compilación y entregar.** Evaluar Trunk frente al generador de Antares. Quitar Node y esbuild de la entrega solamente cuando los nuevos artefactos pasen las pruebas y conserven la carga bajo la ruta de GitHub Pages, el caché versionado del service worker y el arranque tanto con la versión anterior como con la nueva. Pages puede seguir sirviendo la interfaz estática. Axum conserva las funciones que requieren servidor.
7. **Evaluar renderizado sin WebView en una prueba aparte.** Hacer en Slint solo búsqueda, cola y volumen conectados a datos de prueba o a los mismos contratos. Comparar arranque, memoria, desplazamiento, teclado y accesibilidad en macOS. Medir después el coste de integrar una compilación móvil y de mantener la PWA en paralelo. Considerar una migración únicamente si la mejora es repetible y se sostiene en las plataformas objetivo.

[Compilación estática de Leptos](https://book.leptos.dev/deployment/csr.html) · [Audio en segundo plano con Media3](https://developer.android.com/media/media3/session/background-playback)

## Criterios para avanzar

- La interfaz conserva las acciones de la pantalla anterior y las sesiones y listas guardadas siguen abriendo.
- La prueba en macOS y PWA registra resultados separados. La paridad móvil queda pendiente hasta verificarla en iPhone y Android físicos. Las funciones exclusivas de escritorio se validan en cada plataforma donde existían.
- Comparar mediana y percentil 95 con el mismo dispositivo, red y conjunto de consultas. Registrar el tamaño transferido en la primera visita y el arranque con caché. Medir el tiempo de red por separado para distinguir mejoras de interfaz de variación del proveedor.
- El cambio de interfaz y el cambio de motor de audio se validan en entregas distintas.

## Entrega de Buscar, Reciente, Listas y Ajustes

`antares-ui` contiene los componentes Leptos y los puentes WebAssembly. `antares-core` contiene las reglas compartidas de cola, sesión, búsqueda y recuperación y se puede compilar sin Leptos. La interfaz genera un solo paquete WebAssembly para Tauri y la PWA. Conserva el nombre anterior del artefacto para que el empaquetado y el service worker sigan encontrándolo.

- **Reciente** comparte con Buscar las filas, el mensaje vacío y el enlace a las acciones de la pista.
- **Listas** dibuja en Rust el índice, la barra lateral, las filas de una lista y la selección. Rust también filtra pistas y ordena listas. El navegador aporta su comparación de nombres según el idioma configurado.
- **Ajustes** usa Rust para construir los encabezados plegables, filtrar por palabras sin tildes, recordar qué secciones se abren y reflejar las preferencias en controles, valores y filas condicionales.
- Los estilos y el HTML declarativo de los controles siguen en la interfaz web. Las acciones compartidas de pista, el esquema y guardado de preferencias del cliente, los diálogos y la conexión con el sistema aún usan los adaptadores existentes.

### Referencia medida el 9 de noviembre de 2026

La prueba comparó dos compilaciones locales en el mismo navegador y el mismo Mac. La lista tenía 180 pistas sintéticas. Cada versión abrió la lista ocho veces y midió 240 fotogramas mientras se desplazaba. El arranque se midió una vez en primera carga y una vez después de recargar.

| Medición | Anterior | Nueva |
| --- | ---: | ---: |
| Primer arranque | 493,5 ms | 373,9 ms |
| Arranque con caché | 205,3 ms | 222,6 ms |
| Abrir 180 pistas, mediana / p95 | 71,7 / 91,3 ms | 73,6 / 83,9 ms |
| Fotogramas al desplazar, mediana / p95 | 16,6 / 17,6 ms | 16,7 / 17,7 ms |
| Memoria JavaScript al final, una lectura aproximada | 9,7 MiB | 15,0 MiB |
| WebAssembly comprimido con gzip | 608,7 KiB | 684,0 KiB |

El desplazamiento se mantuvo cerca de 60 fotogramas por segundo. Crecieron el paquete WebAssembly y la lectura puntual de memoria JavaScript. Esa lectura depende del momento de la recolección de memoria y excluye el consumo total de la aplicación.

En una prueba aparte con «Talento Yan Block», la búsqueda de la PWA anterior tardó 777 ms y el inicio de audio 1460 ms. En una compilación intermedia de la interfaz, la misma búsqueda tardó 1443 ms y el inicio de audio 1180 ms. En tres pasadas de red con tres canciones, la resolución directa en el backend tardó entre 57 y 91 ms. Descargar el primer KiB, incluida esa resolución, tardó entre 82 y 423 ms. Son mediciones locales del proveedor en ese momento.

### Comprobaciones

- En macOS se abrió la compilación con un perfil de prueba, se reprodujo «Talento» y se comprobó su entrada en Reciente. También abrieron Listas y Ajustes.
- En la PWA se creó una lista, se añadió una canción desde Reciente y se abrió de nuevo después de recargar. Se seleccionó por teclado la última pista de una lista de 180 elementos y se verificó que el contador cambiaba. Alt+↑ movió la pista del índice 179 al 178.
- En Ajustes se buscó «tamano interfaz», se cambió el tamaño a 110 % y se comprobó que el valor persistía al recargar. Se revisó el diseño en un ancho de 390 píxeles.
- Pasaron 383 pruebas de Rust y 245 pruebas JavaScript que cargan el módulo WebAssembly. También pasó la comprobación de compilación Rust para el simulador de iOS. Las pruebas físicas de esta entrega en iPhone y Android quedan pendientes.

## Entrega de Inicio, navegación y reproductor

- **Inicio y navegación.** Leptos construye la bienvenida, las estanterías y sus tarjetas de canciones, artistas y listas. Se reutilizan los nodos de las secciones cuando conservan el mismo contenido visible. Rust construye las pestañas, aplica su orden y visibilidad y marca la sección activa. En el diseño móvil, actualiza la sección antes de enfocar el buscador.
- **Reproductor.** Rust actualiza los controles de transporte, volumen y tiempo en la consola, la barra inferior y el minirreproductor. La barra y el mini comparten la lógica de avance, teclado y descarte de un gesto cuando cambia la pista. La cola entrega en Rust la ventana de próximas pistas y Leptos renderiza «A continuación».
- Los adaptadores de JavaScript conectan los eventos con el audio, la ventana, las preferencias y las acciones de pistas. Los motores de audio conservan sus integraciones de Web Audio, Media3 y AVQueuePlayer.

### Pruebas del 10 de noviembre de 2026

- En la PWA se reprodujo «Tren Al Sur» desde una tarjeta de Inicio con el teclado, se encoló «Talento» y se adelantó la primera pista hasta 5:17 de 5:21. «Talento» empezó automáticamente. Se abrió la pestaña Letra y se cambió el ecualizador a Rock mientras la señal seguía activa.
- La prueba local midió la señal real después del control general de volumen, con «Talento» reproduciéndose. El nivel RMS fue aproximadamente 0,089 al 80 %, 0,00063 al 20 %, cero al 0 % y 0,098 al volver al 80 %. La música varía de intensidad entre muestras. La prueba confirma atenuación, silencio y retorno de señal en la PWA.
- En macOS se reprodujo «Talento», se saltó a otra posición, se abrió el mini, se mostró su control de volumen y se volvió a la ventana normal. La comprobación acústica con los altavoces del Mac queda pendiente.
- En una vista web de 390 píxeles con el diseño móvil se abrió el organizador de Inicio y se comprobó que «Buscar música» deja el campo de búsqueda enfocado. Se verificaron los nombres de los controles en el árbol de accesibilidad. Queda pendiente probar con lector de pantalla y en iPhone y Android físicos, incluidos el bloqueo de pantalla, las interrupciones de audio y la recuperación de red.
- Pasaron 383 pruebas de Rust y 246 pruebas del cliente con WebAssembly. También pasó la comprobación Rust para el simulador de iOS.

La compilación unificada de macOS quedó en `/Applications/Antares.app` con el identificador del perfil principal. Se probó la reproducción, el salto de posición, la respuesta del volumen y el minirreproductor. Se retiraron las compilaciones anteriores a la Papelera y se guardó un respaldo separado de sus perfiles.

[[Ruta de mejoras para macOS y Windows|Siguiente ruta de escritorio]]
