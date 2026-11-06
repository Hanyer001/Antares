# Antares Web

La PWA utiliza la interfaz y los estilos originales de Android en iPhone/Android. El adaptador `src/js/platform.js` conserva Tauri en las aplicaciones nativas y usa `web-runtime.js` en la web. La API comparte catálogo, listas, estadísticas, aprendizaje, recomendaciones, ajustes y formato de copia con el código Rust original.

## Desarrollo

```sh
npm run web:build
cargo run --locked --manifest-path web-api/Cargo.toml
```

Por defecto abre `http://127.0.0.1:4173`. Para la revisión física, usa `ANTARES_WEB_BIND` con la IP de la interfaz local o `0.0.0.0:4173`. El teléfono debe compartir la red. No hace falta agregar un ícono mientras se revisa en Safari.

`ANTARES_WEB_DATA` selecciona el directorio de datos. Por defecto es `.antares-web-data` respecto al directorio de ejecución; está excluido de Git. Usa una ruta absoluta y un volumen persistente al desplegar. Ejecuta una sola instancia de escritura sobre ese directorio.

## Datos privados y concurrencia

Cada instalación genera 256 bits aleatorios y conserva la clave en localStorage. Los comandos privados requieren `X-Antares-Account`; el servidor deriva su directorio con SHA-256. `X-Antares-Profile` selecciona un perfil que debe existir dentro de esa instalación. La selección es por petición, de modo que dos pestañas pueden usar perfiles diferentes.

Los comandos se envían por `POST /api/command/:command`; la respuesta contiene `value` y `revision`. El cliente serializa sus operaciones y envía `X-Antares-Revision`; una escritura atrasada devuelve 409. Los eventos de escucha llevan un ID estable y se conservan en una cola local si falla la red. El servidor recuerda los IDs ya aplicados.

La clave identifica una biblioteca, no una cuenta con correo o inicio de sesión. Compartirla mediante «Biblioteca en tus dispositivos» permite usar esa biblioteca desde otro dispositivo/origen HTTPS conectado a la misma API; los cambios se sincronizan con los límites descritos abajo. Borrar los datos del sitio o cerrar la sesión privada puede perder la clave local. Las copias permiten transportar los datos a otro servidor. La publicación actual no añade autenticación HTTP de un túnel de prueba. Para un servicio público permanente, revisar recuperación administrada y límites de registro/tráfico.

## Copias e importación

`backup_model.rs` define el formato compatible y la validación comunes. Antes de restaurar se genera un respaldo del estado del servidor y se valida todo el archivo. La marca pendiente permite repetir la aplicación si se interrumpe. Los datos se recargan antes de reabrir la interfaz.

La importación crea un trabajo sin bloquear otras acciones del perfil. El cliente consulta el progreso, presenta coincidencias, faltantes y duplicados, y solo crea la lista al confirmar. La revisión puede cancelarse. La importación idéntica no crea otra lista con el mismo nombre y orden.

## Publicación y capacidades

GitHub Pages sirve los archivos generados en `dist/web`. La API requiere un alojamiento HTTPS persistente. Compila con `ANTARES_WEB_API=https://tu-servidor/api/` y configura `ANTARES_WEB_ORIGIN` en la API si el origen es distinto. La PWA usa rutas relativas para la ruta del repositorio. Falta probar CORS y autorización de archivos multimedia desde el alojamiento definitivo.

La caché guarda la interfaz y las fuentes que se usan. El audio se transmite por red. El service worker se registra en paralelo con el arranque y la actualización se activa al cerrar las pestañas anteriores o al solicitarla en Ajustes. El compilado genera `dist/web/build-report.json` con los tamaños de JavaScript antes y después de minificar y una estimación comprimida con gzip. En móvil, «Preparar la siguiente canción» reutiliza los metadatos de la pista y prepara su enlace cuando la página está visible.

Consulta `PARIDAD-WEB.md` para separar implementación de pruebas físicas, y `ADAPTADORES-WEB.md` para el límite con Tauri.

## Comprobaciones

```sh
npm test
cargo test --locked --manifest-path web-api/Cargo.toml
npm run web:build
```

Para comprobar los tipos de la aplicación nativa en una máquina sin el sidecar de yt-dlp, se usó una sobrescritura de configuración de compilación con `bundle.externalBin=[]`. No se modificó el empaquetado original.

## Usar la misma biblioteca en PC y teléfono

En la web, abre **Ajustes → Tus datos → Biblioteca en tus dispositivos**. Guarda la clave de recuperación desde un origen HTTPS y úsala en **Usar una clave** desde el otro equipo. La clave da acceso a todos los perfiles de esa biblioteca. Guárdala como una contraseña. Cada equipo conserva su cola, posición, volumen y calidad de audio. El historial, los gustos y las listas del mismo perfil se consultan en el servidor. Usa **Sincronizar ahora** para actualizar la vista al momento.

Para traer la biblioteca que ya vive en Antares de Windows, usa **Exportar copia completa** en el PC y restaura el archivo en la cuenta web del perfil correspondiente. La restauración sustituye los datos del perfil y genera una copia previa. Desde entonces, usar Antares web en ambos dispositivos comparte los cambios. El ejecutable nativo de Windows sigue escribiendo en sus propios archivos. Las copias contienen metadatos y ajustes de Antares. Los archivos de música requieren una importación y un almacenamiento de audio independientes.

Si se cae la red, IndexedDB conserva la última biblioteca consultada, el historial consultado, los ajustes, la sesión y las letras abiertas. Crear una lista, agregar o quitar una pista y cambiar una valoración se pueden hacer sin conexión. La interfaz muestra los cambios locales y los envía al reconectar. Si una operación apunta a una lista que ya no existe, el panel permite ver el error y descartar esa operación. Renombrar, reordenar, restaurar una copia e importar un catálogo requieren conexión. La música se transmite en línea.

La versión actual conserva el almacenamiento de archivos del servidor y usa recibos persistentes para las operaciones de sincronización. Para cuentas por correo con recuperación administrada, la siguiente migración puede usar [Supabase Auth](https://supabase.com/docs/guides/auth) y [PostgreSQL con permisos por fila](https://supabase.com/docs/guides/database/postgres/row-level-security). Conviene modelar por separado cuenta, perfil, lista, pistas en lista, valoraciones y escuchas. Una restricción única por cuenta, perfil y operación permite guardar cada cambio y su recibo en la misma transacción. Los archivos de audio del usuario irían a un [bucket privado](https://supabase.com/docs/guides/storage/buckets/fundamentals).

## Preparar la publicación

1. Para alojar la API, copia `deploy/.env.example` a `deploy/.env` y configura `ANTARES_DOMAIN` con el nombre del servidor y `ANTARES_RELEASE` con la etiqueta de la versión. Apunta el DNS al servidor y permite HTTP y HTTPS para que [Caddy configure TLS](https://caddyserver.com/docs/automatic-https). Ejecuta `docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build` y comprueba `/api/health`. El volumen `antares-data` conserva las bibliotecas. Antes de mover datos existentes o cambiar de versión, conserva una copia del volumen con el proceso detenido.
2. Para usar [GitHub Pages](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages), configura `ANTARES_WEB_ORIGIN=https://hanyer001.github.io` en la API y define la variable `ANTARES_WEB_API` en GitHub Actions con la URL HTTPS terminada en `/api/`. Selecciona GitHub Actions como fuente de Pages y ejecuta el flujo manual **Publicar Antares Web en Pages**. El navegador se conecta directamente a la API autorizada. El sitio puede usar el subdominio de GitHub sin comprar un dominio para la interfaz.
3. La versión web aparece en Ajustes y en `build-report.json`. El navegador prepara el service worker en paralelo y guarda la sesión antes de activar la versión que elijas. Para revertir el servidor, usa una etiqueta de imagen previa y ejecuta el mismo comando Compose con `--no-build` en vez de `--build`. Para revertir Pages, ejecuta el flujo desde la referencia anterior que quieras publicar. Mantén las versiones de API y web compatibles durante el cambio.

## Prueba gratuita independiente del Mac

El archivo `render.yaml` despliega la rama `pwa` como servicio Docker gratuito. Sirve la interfaz y la API desde su dirección HTTPS de Render. El aviso de prueba recuerda que los datos del servidor son temporales. Render puede suspender el servicio tras 15 minutos de inactividad y borrar los datos locales al reiniciar. Conserva exportaciones de tu biblioteca para esta prueba.

Abre [crear la prueba en Render](https://dashboard.render.com/select-repo?type=blueprint&repo=https://github.com/Hanyer001/Antares&branch=pwa), inicia sesión y revisa que el servicio use el plan Free y el archivo `render.yaml` de la rama `pwa`. Tras desplegar, usa la URL HTTPS que Render confirme. Esa misma URL funciona en iPhone y Android, con el Mac apagado.

Para publicar también la interfaz en Pages, configura `ANTARES_WEB_API` con la URL real del servicio seguida de `/api/`, usa GitHub Actions como fuente de Pages y ejecuta el flujo desde la rama `main`; su checkout publica explícitamente el código de `pwa`. La dirección de Render ya aloja la app completa y permite probarla antes de configurar Pages.
