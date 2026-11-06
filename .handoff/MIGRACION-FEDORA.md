# Migración de Antares al ThinkPad con Fedora

Guía temporal para la IA que tenga acceso al servidor. No ejecutar comandos contra un host supuesto. Usar rutas, dominio y versión confirmados con el propietario. Las comprobaciones de publicación que siguen son históricas, del 6 de noviembre de 2026; volver a comprobar los servicios antes de modificarlos.

## 1. Qué está implementado

| Componente | Ubicación / comportamiento |
| --- | --- |
| PWA | `src/`, `web/`, `scripts/build-web.mjs`; usa la interfaz móvil original de Android. |
| Adaptador web | `src/js/platform.js`, `web-runtime.js`, `web-storage.js`, `web-library-sync.js`, `web-account-ui.js`. |
| API Rust / Axum | `web-api/`, comparte módulos de `src-tauri/src/`; no requiere Tauri ni entorno gráfico en el servidor. |
| Compilación / alojamiento | `deploy/Dockerfile`, `deploy/compose.yaml`, `deploy/Caddyfile`, `deploy/.env.example`. |
| Datos del servidor | Archivos JSON por biblioteca/perfil, revisión y recibos de sincronización; **no PostgreSQL ni SQLite**. Una sola instancia de API escribiendo en el directorio de datos. |
| Identidad actual | Clave aleatoria de biblioteca de 256 bits guardada en el navegador; directorio derivado con SHA-256 en el servidor. Es una credencial de acceso, no inicio de sesión por correo. |
| Compartir biblioteca | Ajustes → Tus datos → Biblioteca en tus dispositivos. La misma clave permite usar la biblioteca en otro dispositivo/origen HTTPS si los datos existen en la API destino. |
| Audio propio | No se alojan archivos musicales locales del PC. Las copias contienen metadatos/ajustes. Subir y compartir archivos de audio sería trabajo adicional. |
| Nativas | Windows y Android mantienen almacenamiento propio. iOS nativo experimental: `docs/IOS.md`. No asumir que usan automáticamente esta API. |

El ThinkPad podrá alojar bases de datos de otros proyectos, pero **no hace falta añadir una base SQL para levantar la versión actual de Antares**. Si se solicita posteriormente SQL y autenticación por correo, diseñar e implementar una migración independiente con exportación/restauración y pruebas; no basta con definir `DATABASE_URL`.

## 2. Publicación existente y fallos conocidos

- Código completo del port: https://github.com/Hanyer001/Antares/tree/pwa . Base publicada: `84ecefe`; ajustes de Pages: `84d031b`; documentación de publicación: `5c73150`. Esta entrega añade commits posteriores: clonar el HEAD actual de `pwa`.
- PWA pública: https://hanyer001.github.io/Antares/ . GitHub Actions: `.github/workflows/antares-pages.yml`. Se lanza desde `main` y hace checkout explícito de `pwa`.
- Variable de Actions `ANTARES_WEB_API`: `https://antares-prueba.onrender.com/api/`. **Conservar el sufijo `/api/`**; omitirlo hace que las peticiones lleguen al fallback HTML en vez de la API.
- Render: `antares-prueba`, plan Free, Docker; blueprint raíz `render.yaml`, rama `pwa`, despliegue manual. ID del servicio: `srv-dbml5uetlv9c73bbcm90`. Datos temporales en `/tmp/antares-demo`; no es la biblioteca definitiva.
- Render compiló correctamente y se comprobaron salud, búsqueda, CORS y creación/lectura de listas con una biblioteca aislada. En el iPhone físico se abrió Pages y se comprobaron interfaz, recomendaciones y búsqueda.
- **Audio bloqueado en Render:** varios videos devolvieron `HTTP 403 Forbidden en player` desde la API. Uno de esos mismos videos se resolvió correctamente desde el Mac. El iPhone mostró «No se pudo continuar esta canción». La causa concreta del rechazo no se ha aislado; no atribuirlo con certeza a la IP ni prometer que Fedora lo resolverá.
- Pruebas locales anteriores en iPhone: segundo plano, avance automático y controles con pantalla bloqueada funcionaron. No equivalen a validación del servidor nuevo. No se ha validado Android físico.
- PWA necesita HTTPS para instalación y capacidades del navegador. El audio se transmite por red; la caché offline conserva interfaz/datos, no toda la música.

## 3. Inspeccionar el ThinkPad antes de instalar

Confirmar Fedora/arquitectura (`cat /etc/os-release`, `uname -m`), RAM/disco, acceso administrativo y servicios existentes. Revisar el runtime ya usado (Docker o Podman), los puertos ocupados y el proxy común de otros proyectos. No desinstalar paquetes ni sustituir su infraestructura automáticamente.

La configuración incluida usa **Docker Compose**. Si ya se usa Podman, adaptar y validar salud, usuarios de volúmenes, redes, SELinux y arranque; no tratar los comandos como equivalentes sin probar. Para Docker, seguir la [instalación oficial para Fedora](https://docs.docker.com/engine/install/fedora/) correspondiente al sistema instalado, habilitar su servicio y verificar `docker compose version`. No hace falta instalar Node/Rust en el host si la imagen se construye con Docker.

Elegir una carpeta estable para el checkout (por ejemplo `/srv/antares`, con permisos del operador). Clonar sin copiar credenciales de esta máquina:

```sh
git clone --branch pwa https://github.com/Hanyer001/Antares.git
cd Antares
git rev-parse HEAD
cp deploy/.env.example deploy/.env
```

Editar `deploy/.env` en el servidor: `ANTARES_DOMAIN` = dominio real y `ANTARES_RELEASE` = etiqueta nueva e identificable (ejemplo `fedora-001`). `.env` está excluido de Git. No subir datos del volumen ni credenciales al repositorio.

Para alojar interfaz y API juntas, dejar `ANTARES_WEB_ORIGIN` vacío: la imagen compila con API relativa `./api/`. Si se conserva Pages, configurar `ANTARES_WEB_ORIGIN=https://hanyer001.github.io` en la API y apuntar después la variable de Actions a `https://DOMINIO-REAL/api/`.

## 4. Elegir la entrada HTTPS sin interferir con otros proyectos

**Sin proxy previo:** la composición incluida levanta Caddy en 80/443 y la API solo en la red interna. El dominio debe resolver al servidor y tener conectividad entrante. Mantener persistentes los volúmenes de Caddy. Comprobar NAT/CGNAT/IPv6 y firewall antes de prometer acceso desde fuera de casa. Ver [requisitos de HTTPS automático de Caddy](https://caddyserver.com/docs/automatic-https).

**Con proxy previo:** no levantar un segundo Caddy en los mismos puertos. Preparar un override de Compose que publique únicamente la API en loopback o la una a la red privada del proxy existente; configurar allí el dominio y HTTPS. La API interna usa el puerto 4173. Conservar el volumen de Antares. Documentar el override efectivo y el nombre de proyecto antes de arrancar.

No deshabilitar SELinux como solución. Para bind mounts, aplicar etiquetas adecuadas; el montaje de `deploy/Caddyfile` debe revisarse en Fedora (por ejemplo, `:ro,Z` cuando sea exclusivo de ese contenedor). Los datos usan volúmenes nombrados y el proceso de Antares corre como UID/GID 10001. Verificar permisos de escritura reales.

Si se usa la composición incluida sin override, ejecutar desde la raíz:

```sh
sudo docker compose -p antares --env-file deploy/.env -f deploy/compose.yaml config --quiet
sudo docker compose -p antares --env-file deploy/.env -f deploy/compose.yaml up -d --build
sudo docker compose -p antares --env-file deploy/.env -f deploy/compose.yaml ps
sudo docker compose -p antares --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 antares caddy
```

Conservar siempre `-p antares` y los mismos archivos/overrides. El [nombre de proyecto Compose](https://docs.docker.com/compose/how-tos/project-name/) separa recursos de otros proyectos; cambiarlo puede hacer aparecer una biblioteca vacía al conectar otro volumen. El volumen esperado en este ejemplo es `antares_antares-data`, montado en `/data`; verificarlo con `docker inspect`, no asumirlo al copiar datos.

## 5. Trasladar bibliotecas sin perder el acceso

1. Desde cada perfil/origen actual, guardar una **copia completa** y su clave de biblioteca en un lugar privado. Vaciar las operaciones offline pendientes con «Sincronizar ahora» antes del corte. Pages, el origen local y el nuevo dominio tienen almacenamientos del navegador distintos.
2. Distinguir dos caminos: una exportación/restauración transporta un perfil; una copia completa del directorio de la API conserva todas las bibliotecas, hashes, perfiles, revisiones y recibos. No copiar solo `playlists.json`. No mezclar árboles activos de dos servidores.
3. Si se puede acceder a los datos del servidor antiguo, detener sus escrituras y tomar una copia consistente de todo `ANTARES_WEB_DATA`; cargarla en un volumen nuevo del ThinkPad y comprobar propietario 10001, manteniendo una copia intacta del origen. Render Free puede haber perdido sus datos y no debe suponerse que ofrece acceso al volumen.
4. Si solo hay exportaciones, crear primero una biblioteca en la nueva API y restaurar cada perfil con la función de la app, conservando el respaldo previo. La clave vieja no se registra automáticamente en el nuevo servidor: «Usar una clave» valida que la biblioteca ya exista. Compartir la **nueva** clave con los otros dispositivos solo después de verificar la restauración.
5. No borrar la antigua biblioteca ni la caché del teléfono para forzar una actualización. Las aplicaciones nativas no migran al servidor automáticamente; exportar/restaurar sus datos si el propietario lo solicita.

Para copias del volumen, detener la API y archivar el volumen completo con una herramienta que conserve permisos; guardarlo fuera del repositorio y en otro dispositivo. Verificar restauración en un volumen de prueba. Una sola API escribe por directorio: las exclusiones mutuas actuales no coordinan múltiples procesos.

## 6. Aceptación antes de cambiar el servicio usado

- `/api/health` devuelve JSON con `ready: true` y `demo: false` en el servidor definitivo. La API rechaza claves ausentes/incorrectas para comandos privados.
- Buscar música, abrir álbum/artista y **reproducir audio real**, adelantar y cambiar de pista. Inspeccionar estado HTTP/rangos si falla. Investigar el rechazo 403 si se repite; no eludirlo marcando salud como éxito.
- Crear/editar una lista, registrar una escucha, recargar y comprobar los mismos datos desde otro dispositivo con la misma clave. Verificar aislamiento entre dos bibliotecas distintas.
- Reiniciar contenedor y servidor y confirmar que la biblioteca sigue ahí, que el servicio vuelve y que el proxy funciona. No usar `down -v` para reiniciar.
- iPhone físico: Safari y modo instalado, segundo plano, dos avances automáticos y pausa/reanudación en pantalla bloqueada. Android físico: repetir cuando haya uno disponible; si falta, marcar pendiente.
- Probar exportación/restauración y una recuperación real desde la copia del volumen; documentar ubicación y responsable de copias sin publicar secretos.
- Si se conserva Pages, cambiar `ANTARES_WEB_API` al nuevo `/api/`, lanzar el flujo desde `main` y verificar en el teléfono que usa Fedora. Revisar CORS, service worker y versión activa; no afirmar que cambió con solo guardar la variable.

## 7. Vuelta atrás y continuidad

Antes de cada actualización, registrar commit, etiqueta de imagen, configuración y copia consistente de datos. Conservar la imagen anterior (reconstruir con la misma etiqueta sobrescribe esa referencia). Para revertir, detener la API y restaurar imagen/configuración y una copia compatible en un volumen separado si cambia el formato. Comprobar antes de volver a apuntar usuarios. Render sigue siendo una demo con audio fallido; volver a él no garantiza recuperar reproducción ni bibliotecas.

No convertir Antares en el contenedor de las bases de otros proyectos: separar servicios, volúmenes y credenciales. No exponer directamente puertos de bases de datos para que Pages acceda a ellas. El navegador habla con la API.

Al completar, escribir documentación permanente del estado **real** en `docs/SERVIDOR-FEDORA.md`: instalación, runtime, proxy, dominio, almacenamiento, copias/restauración, actualización, rollback y pruebas pendientes. Después aplicar [RETIRADA.md](RETIRADA.md).
