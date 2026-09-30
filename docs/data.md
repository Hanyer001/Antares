# Datos y copias de seguridad

En Windows, los datos de Antares se guardan en `%APPDATA%\com.hanyer.antares\`, fuera del código y de la instalación. El usuario principal usa ese directorio; los demás tienen su carpeta `users/<id>/`.

| Archivo o carpeta | Contenido |
| --- | --- |
| `history.json` | Historial reciente. |
| `searches.json` | Resultados de búsquedas guardados. |
| `playlists.json` | Listas, metadatos y reglas de listas inteligentes. |
| `stats.json` | Escuchas, saltos, tiempo y valoraciones. |
| `taste.json` | Señales usadas para aprender los gustos habituales. |
| `settings.json` | Preferencias y perfiles. |
| `wallpaper.json` | Fondo personalizado. |
| `workspace.json` | Estado de la interfaz incluido en las copias. |
| `backups/` | Copias diarias y respaldo anterior a una restauración. |
| `*.json.bak` | Versión anterior válida de cada archivo de datos. |
| `users.json` | Usuarios y selección activa. |
| `related.json` | Caché compartida de Mix de YouTube. |
| `updater.json` / `bin/` | Estado de actualización y copia local de yt-dlp. |

La cola, posición de reproducción y preferencias de momentos también usan almacenamiento del WebView separado por usuario. Las copias completas incluyen ese estado. Las URLs temporales de audio no se guardan en las listas ni se exportan.

## Crear y restaurar una copia

En **Ajustes → Tus datos → Copia completa** puedes guardar una copia o seleccionar una para restaurar. En escritorio también puedes exportarla como archivo.

Antares crea una copia interna a los 30 segundos de abrir y la actualiza cada 15 minutos. Conserva los últimos siete días con actividad, con una copia por día.

Antes de restaurar se valida el contenido y se muestra una vista previa. La restauración guarda un respaldo de los datos actuales y se aplica al reiniciar, antes de cargar la biblioteca. Si se interrumpe, vuelve a intentarse en el siguiente arranque.

Cada copia corresponde al usuario activo. Para respaldar varias personas, crea una copia desde cada usuario.

## Cambiar de versión

El identificador `com.hanyer.antares` determina la ubicación de datos y debe conservarse al actualizar. En Android, las actualizaciones sobre una instalación existente también necesitan la misma clave de firma.

Los archivos del usuario y las claves de firma no forman parte de este repositorio.
