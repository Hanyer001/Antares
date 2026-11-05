---
tags:
  - antares
  - ui-ux
  - desarrollo
date: 2026-10-16
type: ui-implementation
status: implementado-validado-en-frontend
---

# Antares — Etapas 3 y 4

Continuación de [[ui-etapa-1]] y [[ui-etapa-2]]. Implementación para escritorio; sin generar instaladores, paquetes de distribución ni APK.

## Referencias aplicadas

| Referencia | Decisión en Antares |
|---|---|
| Spotube | Reproductor persistente con información y controles agrupados |
| Harmonoid | Jerarquía coherente entre carátula, canción, transporte y acciones secundarias |
| Amberol / Resonance | Ambiente derivado de la portada y color adaptativo existente |
| Gapless | Controles accesibles al reducir la ventana, con ajustes de espacio sin animar el layout |

Son adaptaciones de patrones de la investigación, no reproducciones exactas ni afirmaciones sobre sus constantes internas.

## Etapa 3 — Barra de reproducción

- En el diseño de progreso en el borde, metadatos a la izquierda, transporte y tiempos a continuación, y acciones secundarias a la derecha.
- Títulos con mayor peso, números de ancho tabular y marcador musical cuando no hay imagen válida.
- Progreso con área de interacción de 28 px en el borde y 20 px en el diseño centrado. La línea mantiene su aspecto fino.
- Tiempo de destino al pasar el puntero o enfocar el rango, sin modificar el audio durante el hover.
- Arrastre con vista previa: las actualizaciones de reproducción no pisan el valor elegido. El salto se confirma con el evento de cambio del rango.
- Escape, cancelación del puntero o cambio de pista descartan el gesto. Una revisión de metadatos distingue incluso dos pistas con título y artista iguales.
- Flechas: ±5 s. RePág/AvPág: ±10 s. Inicio/Fin: principio/final.
- Duración desconocida: `--:--`, rango desactivado y descripción accesible.
- Etiquetas y estados accesibles para silencio, Me gusta, No me gusta, aleatorio y repetición.
- Foco visible; pulsación de botones a escala `0.94`, transición de `140 ms`.
- Volumen accesible a 980 px, mínimo de la ventana de escritorio. Se corrige el ocultamiento del padre del progreso en el diseño de borde.
- Barra compacta centrada: controles y progreso conservan filas separadas dentro de sus 62 px.

> [!tip] El arrastre manda
> La posición visual y la posición de reproducción se mantienen separadas durante el gesto. Antes de confirmar se comprueba la pista actual de forma síncrona, sin depender de que ya haya llegado la notificación agrupada del estado.

## Etapa 4 — Ambiente de portada

- Dos capas por superficie; transición real de opacidad en lugar de intentar interpolar `background-image`.
- Fundido de **600 ms**, curva `cubic-bezier(.2,0,0,1)`.
- La imagen siguiente se carga y decodifica antes de presentarla.
- Los cambios durante un fundido se agrupan. Las descargas antiguas no recuperan una portada anterior y una carga rápida no espera al timeout de una descarga lenta.
- Si falla la portada, el primer plano muestra su marcador; el ambiente anterior permanece hasta recibir una imagen válida. Al limpiar explícitamente la portada se elimina también ese ambiente.
- Fondo propio y carátula usan el mismo mecanismo. Se conservan los modos Liso, Carátula e Imagen, y el modo escucha sigue usando la portada.
- Se conservan el desenfoque y la atenuación elegidos en Apariencia. La barra con estilo Carátula emplea desenfoque de **28 px**, intensidad **22 %** y una base del tema para el contraste.
- En las vistas normales con imagen de fondo, las superficies de lectura mezclan **88 %** del fondo del tema con transparencia.
- Sin animación ambiental con movimiento reducido/desactivado, tanto en preferencias de Antares como en el sistema.
- Caché acotada a 24 promesas de decodificación; solo dos capas por superficie, sin un visualizador ni animaciones permanentes de blur.

> [!info] Respeta tu apariencia
> No se activa automáticamente Carátula ni se cambia el tema guardado. Para ver el ambiente completo, selecciona el fondo Carátula en Apariencia; para teñir la barra, usa su estilo Carátula en Reproductor. Liso y una imagen propia siguen siendo opciones válidas.

## Archivos principales

| Archivo | Responsabilidad |
|---|---|
| `src/desktop-player.css` | Jerarquía de la barra, tamaños, foco y capas de ambiente |
| `src/js/playerbar.js` | Vista previa, teclado, cancelación y estados accesibles |
| `src/js/timeline.js` | Límites y política de saltos por teclado |
| `src/js/ambient.js` | Decodificación, capas, fundidos y preferencias de movimiento |
| `src/js/ambient-queue.js` | Coordinación de cargas y cambios consecutivos |
| `src/js/artwork.js` / `appearance.js` | Integración con portada y fondo propio |
| `src/js/ui.js` / `nowstate.js` | Revisión de la pista para invalidar gestos antiguos |
| `src/index.html` | Carga de los estilos de escritorio |

## Validación realizada

- [x] **187 pruebas de JavaScript aprobadas**, 0 fallos. Incluyen 10 pruebas nuevas sobre límites, teclado, cargas tardías, reintentos, limpieza y concurrencia de fundidos.
- [x] Comprobación de sintaxis de los módulos modificados.
- [x] Revisión en navegador con el HTML, CSS y módulos reales, metadatos y portadas sintéticos y controles de audio simulados.
- [x] Tema oscuro, tema claro, progreso de borde y centrado; ventana mínima de 980 px; barra compacta sin solapamiento vertical.
- [x] Un tick durante el arrastre conserva el 70 % elegido; cancelar recupera la posición real.
- [x] Cambio de pista con título y artista idénticos antes de confirmar el arrastre: el gesto se descarta.
- [x] Clic real en el centro del rango: 50 %; Inicio/Fin: extremos. Salto de 0:45 a 0:50 con flecha derecha; duración desconocida; etiquetas de Me gusta y silencio.
- [x] Cambios rápidos de portada e imagen fallida mantienen la última imagen válida.
- [ ] Revisión general con reproducción real en la ventana nativa: avanzar pistas, buscar posición, volumen, cola, letras y modos de ventana.
- [ ] Comprobar fluidez y legibilidad con portadas reales claras, oscuras y sin imagen en el equipo del usuario.

Comando ejecutado desde la raíz del proyecto:

```cmd
node --test --test-isolation=none "tests/*.test.mjs"
```

> [!info] Alcance de la comprobación
> La revisión visual usa el frontend real con datos de prueba; no verifica el motor de audio nativo ni los proveedores de música. El servidor de desarrollo de Tauri en el puerto 1430 no estaba activo al terminar la comprobación. No se han generado instaladores ni APK. La revisión general con reproducción real queda como siguiente paso.
