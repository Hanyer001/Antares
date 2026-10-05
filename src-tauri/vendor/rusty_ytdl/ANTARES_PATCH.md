# Parche de extraccion de Antares

Origen: Mithronn/rusty_ytdl, revision b1c6eb7c83f0d6189f256ed5df50019a5803c734.
Se conserva la licencia original en LICENSE.

Esta copia local permite seguir usando rusty_ytdl sin procesos externos.
Los cambios funcionales se limitan a src/constants.rs y src/info.rs:

- Usar VISIONOS 1.02 para obtener las URLs directas de videos normales.
  ANDROID SDKLESS devuelve URLs que fallan con HTTP 403 al continuar el audio.
- Enviar visitorData tanto en el contexto como en la cabecera y usar el
  User-Agent del cliente seleccionado en la llamada player.
- Validar los errores despues de la respuesta del cliente nativo. La pagina
  web puede pedir iniciar sesion incluso cuando el cliente nativo puede
  reproducir el video publico.
- Mantener los errores para videos no disponibles o restringidos.

La definicion del cliente se puede contrastar con:
https://github.com/yt-dlp/yt-dlp/blob/master/yt_dlp/extractor/youtube/_base.py

Cargo.toml solo elimina el miembro CLI del workspace, que no se distribuye
con esta copia. El backend, el proxy de audio y las funciones de busqueda
existentes de Antares no se modifican por este parche.
