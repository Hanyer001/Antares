---
tags:
  - antares
  - ui-ux
  - desarrollo
  - motion-design
date: 2026-10-16
type: ui-implementation
status: implementado-validado-en-frontend
---

# Antares — Etapas 5 y 6

Continuación de [[ui-etapas-3-4]]. Cambios de escritorio, sobre los módulos existentes. Sin instaladores, APK ni paquetes de distribución.

## Referencias aplicadas

| Referencia | Adaptación |
|---|---|
| Gapless | Transiciones cortas de presentación; redimensionado inmediato |
| Monophony | Separación de búsqueda, espera y contenido vacío |
| Mousai | Estados visuales con significado; el espectro representa datos del audio |
| Harmonoid / Muzika | Lectura de letras y escucha expandida con contexto estable |

Las duraciones siguientes son decisiones para Antares, no medidas atribuidas al código de esas aplicaciones.

## Etapa 5 — Movimiento y carga

- Roles de movimiento: respuesta de controles **140 ms**, navegación **200 ms**, apertura de panel **260 ms**.
- Hover de fila de **120 ms**; cambios Play/Pause por opacidad sin modificar el área pulsable.
- Entradas con opacidad y desplazamiento de **6–8 px**, curva `cubic-bezier(.2,.8,.2,1)`.
- Una entrada interrumpida parte del estado visual actual. Las acciones se ejecutan sin esperar a la animación.
- Se cancelan las entradas al redimensionar, arrastrar separadores o reducir el movimiento. La biblioteca no anima cada fila al aparecer.
- La búsqueda muestra un estado textual inmediato y un skeleton tras **150 ms**. Operaciones rápidas no llegan a mostrarlo.
- Skeleton de seis filas, portada de 44 px y altura de fila ligada a la densidad. Pulso tenue de **1400 ms**, estático con movimiento reducido.
- Navegar a Cola mientras una búsqueda sigue pendiente no oculta sus canciones ni deja un skeleton en esa vista.
- Error de búsqueda separado del resultado vacío, con **Reintentar búsqueda** sobre la consulta fallida.
- Preparación de canción, espera de audio y falta de conexión tienen mensajes diferentes. Título y artista permanecen visibles.
- El error de reproducción conserva la recuperación existente; no se añade otra política de reintentos.

> [!tip] La espera no es un único estado
> «Preparando la canción» corresponde a resolver/cargar una pista; «Esperando audio para continuar» corresponde al buffering de la reproducción. La búsqueda tiene su propio estado y no modifica el transporte.

## Etapa 6 — Escucha expandida y letras

- Superficies de lectura estables, portada ajustada a la altura y espacio compartido de Cola/Letra.
- La salida del modo escucha recibe foco al entrar; al salir, se recupera el control que lo abrió si sigue visible.
- Verso activo con peso, fondo tonal y marcador lateral, además de `aria-current`. No se añade blur a los versos.
- Rueda, arrastre o teclas de lectura suspenden el seguimiento hasta pulsar **Volver a la letra actual**. Ya no se recupera automáticamente a los cuatro segundos.
- El retorno lleva el foco al verso actual. Pulsar un verso conserva el salto de audio y el ajuste de sincronía.
- Las teclas de lectura no se propagan a los atajos generales de volumen/reproducción.
- Scroll suave solo con movimiento completo y desplazamientos menores que una pantalla. Movimiento reducido y saltos grandes usan scroll instantáneo.
- Al mostrar la pestaña o cambiar de tamaño, se centra el verso si el seguimiento está activo, sin animar el redimensionado.
- Cada petición de letras tiene su propia generación: una respuesta tardía se descarta incluso si ambas peticiones corresponden al mismo identificador.
- Se filtran tiempos inválidos y se ordenan las marcas válidas antes de mostrarlas.

> [!info] Lectura manual
> La canción puede seguir avanzando mientras lees otros versos. El resaltado refleja el audio, pero la posición de lectura permanece bajo tu control hasta pedir volver.

## Visualizador opcional

- Apagado por defecto. Se activa con **Visualizador** dentro del modo escucha y su elección se guarda como `player.focusVisualizer`.
- **32 bandas**, distribución logarítmica, FFT de **1024**, suavizado **0.78**, dibujo máximo de **30 fps** y resolución limitada a DPR 2.
- Lee un `AnalyserNode` conectado como rama lateral al volumen maestro existente. No crea otro contexto, elemento de audio ni salida audible.
- Al pausar, cargar audio, salir del modo escucha, ocultar la página o reducir movimiento, cancela el dibujo y desconecta la rama.
- No hay animación simulada de amplitud en producción: con silencio los niveles son cero.
- Si no hay análisis de audio disponible, el control queda desactivado y explica el motivo.

> [!example] Uso
> Entra en Modo escucha con el control de expansión o la tecla F. Elige Letra. Activa Visualizador solo si quieres acompañar la lectura con el espectro. Las preferencias de movimiento reducido tienen prioridad sobre el dibujo continuo.

## Validación

- [x] **197 pruebas JavaScript**, 0 fallos. Diez pruebas nuevas cubren movimiento reducido, skeletons tardíos, estados de reproducción, tiempos de letras, ramas de análisis y condiciones de detención.
- [x] Sintaxis de los 14 módulos de producción modificados o nuevos.
- [x] Revisión interactiva con HTML, CSS y controladores reales; backend, reloj y espectro simulados para la prueba.
- [x] Una búsqueda rápida termina sin skeleton; una lenta lo muestra; cambiar a Cola mantiene visibles sus filas.
- [x] Búsqueda fallida con botón de reintento; mensaje de buffering en consola y barra.
- [x] Lectura manual: scroll 759 antes y después de cambiar el verso activo; retorno explícito al verso y recuperación de foco.
- [x] Dos peticiones de letras con el mismo id: la respuesta anterior lenta no sustituye a la nueva.
- [x] Visualizador de prueba: tras pausar, el contador de lectura permanece estable y se cierra la rama; movimiento reducido mantiene el dibujo detenido.
- [x] Salir del modo escucha recupera el foco del control de entrada.
- [x] Temas claro y oscuro; tamaño mínimo de escritorio **980 × 620**, sin desbordamiento del panel ni desplazamiento global.
- [ ] Verificación con reproducción real, proveedores, letras reales y sesión nativa de Tauri.
- [ ] Medición de consumo y fluidez con el audio real en el equipo del usuario.
- [ ] Revisión general de las seis etapas antes de considerar publicación.

Comando usado:

```cmd
node --test --test-isolation=none "tests/*.test.mjs"
```

## Archivos

| Archivo | Responsabilidad |
|---|---|
| `src/desktop-experience.css` | Movimiento, cargas y escucha expandida |
| `src/js/motion.js` / `motion-policy.js` | Entradas, interrupciones y reducción de movimiento |
| `src/js/loading.js` / `loading-policy.js` | Búsqueda, skeleton diferido y fases de reproducción |
| `src/js/lyrics.js` / `lyrics-policy.js` | Letras, lectura manual, peticiones y tiempos |
| `src/js/visualizer.js` / `spectrum.js` | Ciclo de dibujo y rama de análisis |
| `src/js/sound.js` | Acceso de lectura al grafo existente |
| `src/js/layout.js` / `desktop-shell.js` | Foco de escucha y entrada del panel |
| `src/main.js` / `ui.js` / `index.html` | Integración de estados, navegación y controles |
| `src/js/prefs-schema.js` | Preferencia del visualizador, apagada por defecto |
| `tests/experience.test.mjs` | Políticas y ciclo de análisis |

> [!info] Límite de la evidencia
> Las capturas usan portadas, letras y espectro sintéticos. Verifican la interfaz y sus controladores; no acreditan análisis de música real ni rendimiento del WebView nativo. No se ha generado ningún instalador ni APK.
