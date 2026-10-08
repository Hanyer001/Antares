# Funciones y uso

## Buscar y reproducir

Busca una canción o pega un enlace. Desde cada resultado puedes reproducir, añadir a la cola o poner a continuación. La navegación de artistas y álbumes permite reproducir una colección completa o guardarla como lista.

En un álbum, **Reproducir** empieza por la primera pista y sigue el orden del disco, incluso si antes tenías el aleatorio activado. Elegir una pista comienza desde ella y continúa con las siguientes. **Aleatorio** baraja solo las pistas de ese disco.

En un artista, **Reproducir**, elegir una canción o pulsar **Tus artistas** en Inicio usa sus cinco principales y la continuación habitual según tus ajustes. La página mantiene cinco canciones y sus álbumes: reproducir no despliega todo el catálogo.

**Solo este artista**, junto al título **Canciones más escuchadas**, carga su lista completa únicamente en la cola y sustituye lo pendiente de la colección anterior. Este modo no añade recomendaciones de otros artistas, se recuerda al retomar la sesión y termina al escoger otra colección o una canción nueva. **Radio** sigue disponible por separado. La disponibilidad depende del catálogo público de YouTube Music. Las colecciones cargadas se reutilizan durante 30 minutos y solo se resuelve el audio de las pistas necesarias para reproducir.

La cola distingue canciones añadidas manualmente, contenido de la lista actual y recomendaciones automáticas. Las canciones manuales se conservan al cambiar de lista. El modo aleatorio guarda el orden original para recuperarlo al desactivarlo.

Antares recuerda la pista, la cola y la posición al cerrar. Si falla el audio, intenta renovar el enlace conservando el segundo. Cuando no puede continuar, ofrece reintentar, buscar otra versión o saltar.

## Biblioteca

- Crea listas, cambia sus nombres y ordénalas.
- Usa **Editar detalles** para asignar carpeta, portada, descripción o fijar una lista.
- Busca dentro de una lista por título y artista, sin distinguir tildes.
- Activa **Seleccionar canciones** para copiar, mover o quitar varias pistas.
- Ordena manualmente, por título, artista o duración.
- Detecta canciones repetidas aunque provengan de vídeos distintos.

**Me gusta** se construye desde las valoraciones. Las listas inteligentes se crean desde **Listas → Lista inteligente** y combinan reglas de favoritos, artista, número de escuchas, porcentaje de saltos, días sin escuchar y descubrimiento reciente. Su contenido se recalcula a partir de esas reglas.

## Importación

Se admiten enlaces públicos de YouTube, YouTube Music, Spotify, Deezer y Apple Music, además de texto y CSV. Para texto, usa una canción por línea con el formato `Artista - Canción`.

En Desktop puedes pegar el enlace en el buscador principal: si es una lista o un álbum, abre **Importar una lista** con el enlace preparado. También puedes usar **Tus listas → + → Importar lista…**. Se reconocen enlaces completos, localizados, de compartir y URI de Spotify; los enlaces sin `https://` de esos servicios también se aceptan. La importación no cambia la canción ni la cola actuales.

Las canciones de otros servicios se buscan en YouTube Music, comparando sus metadatos y duración. Las que no se encuentran se muestran al terminar. Las listas privadas y los límites de cada servicio pueden impedir una importación completa.

Las playlists públicas de Spotify se leen con paginación y se comprueba su total: ya no se corta la lista en las primeras 100 canciones del reproductor incrustado. Si falla una página, cambia la lista o Spotify bloquea la lectura, la importación muestra un error y no crea una lista incompleta. El máximo de Spotify por importación es 500 canciones y se avisa si la lista lo supera. Se usa una sesión anónima temporal, sin guardar tokens ni claves; esta lectura depende del reproductor web público de Spotify y puede cambiar. El CSV completo sigue siendo la alternativa cuando el servicio impide leerla.

Al terminar se muestran las canciones importadas frente al total leído, las que no se encontraron en YouTube Music y las coincidencias repetidas. Deezer también usa paginación, hasta 500 pistas. Los álbumes de Spotify y las listas de Apple Music importan lo que exponen sus páginas públicas; para las más largas, usa un CSV exportado. Los enlaces de Tidal, Amazon Music y SoundCloud siguen requiriendo texto o CSV.

## Descubrir y momentos

**Descubrir** combina música conocida y nueva. El control de aventura cambia esa proporción; los filtros permiten excluir palabras, canales y duraciones.

Los momentos **Habitual**, **Trabajo**, **Fiesta** y **Relax**, además de los perfiles guardados, recuerdan las elecciones de la sesión. Fuera de Habitual, el aprendizaje del gusto habitual está desactivado por defecto. Las escuchas siguen contando en el resumen.

El menú de una canción incluye **Más de este estilo** y **Hoy no quiero esta canción**. La segunda opción evita recomendarla hasta la siguiente medianoche local y permite deshacer la acción.

## Letras, sonido y vistas

Las letras sincronizadas resaltan el verso actual y permiten saltar a su posición. Su disponibilidad depende de LRCLIB.

En Windows puedes usar ecualizador de diez bandas, nivelador de volumen y fundidos. El modo escucha amplía la carátula y la letra; el mini reproductor ofrece una ventana compacta. Los temas, colores, fuentes, fondos y distribución se ajustan desde **Ajustes**.

Android utiliza una cola nativa en segundo plano y efectos del sistema: ecualizador y nivelador según disponibilidad del dispositivo. Los fundidos son opcionales al desactivar el ahorro de recursos. Incluye navegación táctil, perfiles, usuarios y exportación de copias. Consulta la [guía Android](android.md) para las pruebas físicas pendientes y las diferencias con las ventanas y atajos de escritorio.

## Perfiles, usuarios y copias

Un **perfil** guarda una combinación de ajustes y se aplica al momento. Un **usuario** tiene su propia biblioteca, historial y preferencias; cambiar de usuario en Windows reinicia la aplicación.

Las copias completas están en **Ajustes → Tus datos**. Consulta [datos y respaldos](data.md) para conocer su contenido y restauración.

## Atajos predeterminados de escritorio

| Tecla | Acción |
| --- | --- |
| Espacio | Reproducir o pausar |
| Mayús + ← / → | Canción anterior o siguiente |
| ← / → | Retroceder o avanzar |
| ↑ / ↓ | Volumen |
| M | Silenciar |
| S / R | Aleatorio / repetir |
| L | Me gusta |
| / | Enfocar la búsqueda |
| F | Modo escucha |
| Ctrl + M | Mini reproductor |
| F11 | Pantalla completa |

Los atajos y los pasos de volumen y posición se pueden cambiar en Ajustes. Los atajos globales de Windows se habilitan por separado.
