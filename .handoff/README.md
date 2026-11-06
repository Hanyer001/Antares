# Entrega temporal: Antares → ThinkPad con Fedora

Estado preparado el 6 de noviembre de 2026. Esta carpeta sirve para trasladar el trabajo a otra IA y otra máquina. No es documentación de producto ni contenido que deba mostrarse en Antares.

## Objetivo del propietario

Hanyer quiere alojar Antares en su **ThinkPad con Fedora**, que también usará para otros proyectos y sus bases de datos. Mantener compatibilidad de la PWA con iPhone y Android y conservar el código de las aplicaciones nativas. El nombre anterior «Steam Park» fue un error de transcripción: no es otro servidor.

El trabajo de esta entrega consiste en guardar código, estado e instrucciones en GitHub. **La migración al ThinkPad todavía no se ha ejecutado**. No hay acceso SSH, versión de Fedora, dominio, dirección de red ni configuración del servidor confirmados.

## Orden de lectura para la siguiente IA

1. [MIGRACION-FEDORA.md](MIGRACION-FEDORA.md): código existente, limitaciones, preparación, traslado, comprobación y vuelta atrás.
2. [RETIRADA.md](RETIRADA.md): elementos temporales y condiciones para retirarlos.
3. Documentación permanente relevante: `docs/WEB.md`, `docs/PUBLICACION-WEB.md`, `docs/PARIDAD-WEB.md`, `docs/ADAPTADORES-WEB.md`, `docs/data.md`, `docs/IOS.md`.

Trabaja sobre la rama **`pwa`**. La rama `main` no contiene el port completo: contiene la base nativa y el flujo que publica `pwa`. `docs/LINUX.md` explica la aplicación de escritorio en Fedora; para servir la PWA sin escritorio usa esta entrega y `deploy/`.

## Texto para iniciar el siguiente trabajo

> Repositorio: https://github.com/Hanyer001/Antares/tree/pwa . Lee primero `.handoff/README.md`, `.handoff/MIGRACION-FEDORA.md` y `.handoff/RETIRADA.md` en la rama pwa. Quiero migrar Antares web al ThinkPad con Fedora, compartido con otros proyectos. Conserva los datos, comprueba reproducción real en iPhone y Android y documenta el servidor final. Revisa el rechazo 403 de YouTube observado en Render; no des por hecho que cambiar de servidor lo soluciona. La carpeta .handoff es temporal: retírala solo después de cumplir sus condiciones de aceptación y dejar documentación permanente. No borres datos, volúmenes, copias ni claves del usuario como parte de esa limpieza.

## Visibilidad y duración

El punto inicial hace que la carpeta sea interna por convención; **no la hace privada en GitHub**. No contiene contraseñas, tokens, claves de biblioteca, bases de datos ni archivos personales. No se enlaza desde la interfaz ni se copia a `dist/web`; también se excluye del contexto Docker.

Debe borrarse de la versión vigente después de completar la migración y trasladar las decisiones útiles a documentación permanente. Borrar los archivos en un commit no los borra del historial Git. No reescribir el historial ni borrar ramas automáticamente.
