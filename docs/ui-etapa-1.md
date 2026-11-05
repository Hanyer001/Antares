---
tags:
  - antares
  - ui-ux
  - desarrollo
date: 2026-10-16
type: ui-implementation
status: implementado-validado-en-frontend
---

# Antares — Etapa 1: base visual y filas

> [!info] Alcance
> Primera etapa aplicada al código fuente. No se generaron instaladores, APK, paquetes de publicación ni cambios de versión. La revisión visual utiliza el HTML, CSS y renderizadores reales con datos de prueba locales, sin acceder a la biblioteca del usuario ni reproducir audio.

## Decisiones y cambios

- Se conserva Inter, los temas, la densidad y el redondeado configurables.
- La hoja `src/desktop-rows.css` reúne los ajustes de escritorio; sus selectores excluyen Android.
- Los tamaños de referencia son: portada de 44 px, fila de 60 px, título de 14 px, artista de 12.5 px y duración de 12 px. La densidad sigue ajustando portada y altura.
- Espaciados compartidos: 4, 8, 12, 16, 24 y 32 px.
- Hover: superficie suave sin un borde nuevo ni encogimiento de la fila completa.
- Selección múltiple: checkbox, superficie y borde propios. Puede coexistir con la pista actual.
- Pista actual: raíl lateral, título destacado e insignia sobre la portada.
- Insignias distintas para reproducción, pausa, preparación de audio y error. Derivan del estado ya existente del motor; no controlan audio.
- Foco de teclado con contorno visible y espacio reservado dentro del área de scroll.
- Acciones de 30 × 32 px, accesibles mediante hover o foco dentro de la fila.
- En columnas de hasta 400 px se oculta la duración y se conserva visible el menú que contiene las acciones. No cambian los anchos al aparecer el hover.
- Los separadores de cola usan espacio y encabezados legibles, sin línea ornamental ni mayúsculas espaciadas.
- Portadas ausentes o fallidas muestran un icono musical local. Se conserva su espacio durante la carga diferida.
- Duraciones desconocidas muestran `--:--`; cero segundos muestra `0:00`.
- Los nombres accesibles de las filas incluyen pista, artista y estado actual.

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `src/desktop-rows.css` | Jerarquía, tokens y estados de escritorio |
| `src/index.html` | Carga de la hoja nueva |
| `src/styles.css` | Contenedor de miniatura y respaldo compartido |
| `src/js/results.js` | Portadas robustas y representación del estado |
| `src/js/ui.js` | Sincronización entre motor e indicador de fila |
| `src/js/icons.js` | Iconos dentro del sistema SVG existente |
| `src/js/lists.js` | Reutilización del respaldo en portadas de listas |

## Validación realizada

- [x] Sintaxis de los módulos JavaScript modificados.
- [x] Suite existente: **172 pruebas aprobadas**, sin fallos.
- [x] Búsqueda, cola y lista con los renderizadores de la aplicación.
- [x] Estados de preparación, reproducción, pausa y error sin cambios de altura.
- [x] Añadir a la cola y abrir artista sin activar el clic de reproducción.
- [x] Activación con Enter y visibilidad de acciones al navegar con Tab.
- [x] Reordenación con Alt+flechas.
- [x] Selección múltiple real y pista actual simultáneas.
- [x] Menú de acciones en columna de 320 px, sin desbordamiento de filas.
- [x] Temas oscuro/claro, densidades normal/compacta/cómoda y esquinas suaves/rectas.
- [x] Movimiento reducido sin rotación del indicador de carga.
- [x] Portada válida, ausente y fallida; títulos largos, artista ausente y duraciones largas/desconocidas/cero.
- [x] Comprobación web de los tamaños móviles existentes: portada de 48 px, acción de 44 px, fila de 68 px e insignia de escritorio oculta.

La suite se ejecutó con `node --test --test-isolation=none "tests/*.test.mjs"`, porque el entorno restringe la creación de procesos hijos del runner predeterminado.

El contraste de metadatos frente a los colores base consultados es de 7.03:1 en oscuro y 6.19:1 en claro; frente a `surface2`, de 6.34:1 y 6.59:1. Son verificaciones de las paletas estándar, no de todas las combinaciones personalizadas o fondos de imagen.

> [!tip] Pendiente de aceptación visual
> Abrir Antares en modo desarrollo y revisar el resultado con la biblioteca real. La revisión aislada del frontend no sustituye una prueba de reproducción nativa, escalado real de Windows o un teléfono Android.

## Siguiente paso

- [ ] Revisar esta base con el usuario antes de iniciar la etapa 2 de distribución de paneles.
- [ ] Comprobar escalado real de Windows al 125 %, 150 % y 200 %.
- [ ] Revisar temas personalizados y fondos de carátula con contenido real.

No se implementaron todavía nuevos fondos ambientales, cristal, visualizadores ni animaciones de layout.
