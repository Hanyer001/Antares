---
tags:
  - antares
  - ui-ux
  - desarrollo
date: 2026-10-16
type: ui-implementation
status: implementado-validado-en-frontend
---

# Antares — Etapa 2: distribución adaptable

## Referencias que guían el cambio

| Referencia investigada | Aplicación concreta |
|---|---|
| Gapless | Ajustar paneles al espacio disponible, sin animar continuamente el redimensionado |
| High Tide | Cola y Letras comparten un panel con pestañas |
| Muzika | Conservar búsqueda, selección y contexto al cambiar la disposición |
| Elisa | Mantener una separación clara entre navegación, biblioteca y sesión |

El color ambiental de Amberol/Resonance sigue reservado para la etapa 4. Esta etapa no añade cristal, un visualizador ni animaciones decorativas.

## Comportamiento implementado

- Un botón **Cola y letras** permite mostrar u ocultar el panel de sesión desde la cabecera central.
- En ventanas amplias, navegación, contenido y sesión conservan columnas independientes.
- Para fijar el panel lateral se reservan al menos **480 px** al contenido central y se exige un ancho de aplicación de **1080 px** o superior. Los anchos personalizados pueden hacer que el panel pase a superpuesto antes.
- Por debajo de **1040 px**, la navegación se presenta con iconos. Al ampliar se recupera la preferencia original.
- En disposición estrecha, el panel se superpone sobre el contenido. No se reconstruye el DOM de listas, resultados, letras ni controles.
- El panel superpuesto incluye transporte y volumen cuando corresponde, porque la barra inferior queda temporalmente fuera de interacción mientras se usa el diálogo.
- Escape, el botón Cerrar y el fondo exterior cierran el panel superpuesto. El foco vuelve al control que lo abrió.
- El contenido exterior queda `inert` durante la apertura modal. Tab/Mayús+Tab permanecen dentro; los menús y diálogos internos conservan sus propios controles.
- Cola y Letra incorporan relaciones accesibles con sus paneles, una sola parada de Tab y navegación con flechas, Inicio y Fin.
- Los botones Cola/Letra de la barra abren el panel correspondiente. La pestaña Cola de navegación y **Ver cola** conservan el acceso a la vista completa.
- El diseño en espejo mantiene el lado elegido, tanto con el panel fijo como superpuesto.
- Los tiradores mantienen ajuste inmediato durante el arrastre y persistencia al soltar; ahora anuncian su ancho actual y límites mediante ARIA.
- El modo escucha y el modo mini conservan su lógica de reproducción y restauración.
- Los tamaños elegidos de navegación, panel y portada siguen siendo preferencias. El plegado automático no las sobrescribe.
- La preferencia de ocultar A continuación se conserva al iniciar; abrir explícitamente Cola y letras permite consultar ese contenido sin guardar una preferencia nueva.
- La portada de tamaño medio ocupa menos altura en el panel fijo para dejar espacio a la cola o las letras. Los tamaños pequeño/grande siguen disponibles.

## Archivos

| Archivo | Cambio |
|---|---|
| `src/js/shell-layout.js` | Política de espacio independiente del DOM |
| `src/js/desktop-shell.js` | Apertura, cierre, foco y adaptación del panel |
| `src/desktop-shell.css` | Distribución fija/superpuesta y navegación plegada |
| `src/js/layout.js` | Integración con preferencias, tiradores y modos existentes |
| `src/index.html` | Controles de apertura/cierre y paneles accesibles |
| `src/js/dom.js` | Referencia del panel de cola |
| `src/main.js` | Integración de Cola/Letra con la barra y sincronización de pestañas |
| `src/styles.css` | Reglas compartidas mínimas; controles nuevos ocultos sin shell de escritorio |
| `tests/shell-layout.test.mjs` | Límites de ancho y conservación de preferencias |

## Revisión general de etapas 1 y 2

Se utilizó una vista local aislada con el HTML, CSS, renderizadores, preferencias y módulo de layout reales. Los datos musicales y el puente nativo fueron simulados: no se modificó la biblioteca personal ni se generó audio.

- [x] **177 pruebas JavaScript aprobadas**, sin fallos.
- [x] Sintaxis de los módulos modificados y revisión de espacios en los diffs.
- [x] Tres columnas en ancho amplio; plegado y panel superpuesto en 980 px.
- [x] Recuperación de navegación completa y panel fijo al ampliar.
- [x] Ocultar el panel amplio devuelve espacio al centro, también en espejo.
- [x] Escape devuelve el foco al botón de cabecera o al botón Letra de la barra, según el origen.
- [x] Contenido exterior y barra inertes durante apertura modal; restauración al cerrar.
- [x] Mayús+Tab permanece dentro del panel.
- [x] Alternancia Cola/Letra y navegación de pestañas con flechas.
- [x] Búsqueda y selección múltiple conservadas al plegar, abrir, cerrar y ampliar.
- [x] Selección múltiple y pista actual de la etapa 1 continúan diferenciadas.
- [x] Ajuste por teclado del tirador mediante el módulo real de layout, con ancho ARIA actualizado.
- [x] Entrada y salida de modo escucha con el módulo real de layout.
- [x] Temas oscuro/claro, diseño en espejo y barra superior/inferior.
- [x] Preferencia A continuación oculta y apertura explícita del contenido.

La suite se ejecutó con `node --test --test-isolation=none "tests/*.test.mjs"`, por la restricción de creación de procesos hijos del entorno.

> [!info] Límites de la revisión
> La revisión general realizada corresponde al frontend y sus interacciones. Queda pendiente la aceptación visual dentro de la ventana nativa con la biblioteca real, el escalado de Windows y la reproducción nativa. El redimensionado real del mini reproductor no se prueba mediante un puente nativo simulado. No es una certificación de publicación ni una prueba en teléfono Android.

## Pendientes de aceptación

- [ ] Revisar ambas etapas dentro de Antares en modo desarrollo.
- [ ] Comprobar escalado real de Windows al 125 %, 150 % y 200 %.
- [ ] Probar ventana mínima, letras extensas y listas grandes con contenido real.
- [ ] Confirmar continuidad de audio al abrir/cerrar el panel y al entrar/salir de los modos especiales.
- [ ] Elegir los ajustes visuales finales antes de iniciar la etapa 3.

**No se generaron instaladores, APK, paquetes de publicación ni cambios de versión.**
