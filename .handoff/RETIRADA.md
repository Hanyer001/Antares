# Retirada de la entrega temporal

El propietario pidió que la guía interna fuera temporal y se borre después de pasar Antares al ThinkPad. **No borrar ahora**: todavía falta ejecutar y validar la migración.

## Condiciones para retirar esta carpeta

1. El servidor Fedora está funcionando con datos persistentes y copias recuperables.
2. Se ha verificado la reproducción desde el servidor nuevo y se han registrado las pruebas físicas completadas y pendientes de iPhone/Android.
3. La dirección usada por el propietario apunta al servidor correcto. Las bibliotecas se han trasladado y comprobado; no hay operaciones de sincronización sin resolver.
4. Se ha creado `docs/SERVIDOR-FEDORA.md` con la operación real y los límites restantes; las referencias útiles de esta entrega se han trasladado allí.

Después, retirar `.handoff/` mediante un commit y subirlo. No añadir un borrado automático al arranque ni una fecha de caducidad que pueda eliminar instrucciones antes de terminar. Limpiar también su exclusión de `.dockerignore` si deja de ser útil.

## Revisar los recursos temporales por separado

| Elemento | Acción después de la migración |
| --- | --- |
| Servicio Render `antares-prueba` y blueprint | Primero verificar copias y ausencia de tráfico necesario. Suspender para una transición reversible; la eliminación definitiva del servicio requiere aprobación del propietario en ese momento. |
| `render.yaml` | Retirarlo del código si Render deja de usarse; antes comprobar/desconectar la gestión del blueprint para evitar cambios imprevistos en Render. |
| GitHub Pages | **Se puede conservar** como interfaz del ThinkPad. Si se mantiene, actualizar la variable de API y conservar su workflow; no borrarlo por ser parte de la prueba inicial. |
| `.github/workflows/antares-pages.yml` en `main` y `pwa` | Conservar si se usa Pages. Si toda la web pasa al ThinkPad y el propietario decide retirar Pages, desactivar su publicación y retirar el flujo de ambas ramas. |
| `docs/PUBLICACION-WEB.md` y sección de demo de `docs/WEB.md` | Actualizar con el servidor definitivo o resumir como antecedente; evitar instrucciones vigentes que sigan apuntando a Render. |
| Túneles y servidores de prueba del Mac | Identificar procesos y confirmar que ya no se necesitan antes de pararlos. No hay que copiar herramientas, logs o carpetas `work/`/`outputs/` de esta conversación al servidor. |

## Qué conservar

Conservar código fuente web/nativo, `deploy/Dockerfile`, Compose/proxy adaptados al servidor, documentación permanente, pruebas y lockfiles. No eliminar volúmenes, cuentas, claves de biblioteca, certificados, copias de seguridad ni archivos del usuario como parte de esta limpieza.

Eliminar una carpeta del último commit **no elimina su contenido del historial público de Git**. Esta entrega no debe contener secretos. Si alguno se publicase por accidente, revocarlo primero y tratar el historial como un trabajo separado; no hacer `push --force` para la limpieza rutinaria.
