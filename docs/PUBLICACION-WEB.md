# Publicación web: 6 de noviembre de 2026

- Interfaz PWA: https://hanyer001.github.io/Antares/
- API: https://antares-prueba.onrender.com/api/
- Aplicación completa en Render: https://antares-prueba.onrender.com/
- Código de la versión web: rama `pwa` del mismo repositorio Antares.
- Render: servicio `antares-prueba`, Docker, plan Free, blueprint `render.yaml`.

## Actualizar la página

Sube los cambios de interfaz a `pwa`. Ejecuta manualmente **Publicar Antares Web en Pages** desde `main`. El flujo hace checkout de `pwa`; `main` contiene únicamente el flujo adicional para habilitar el lanzamiento y cumplir la regla de despliegue del entorno github-pages. La variable del repositorio `ANTARES_WEB_API` apunta a `https://antares-prueba.onrender.com/api/`.

Los despliegues de Render son manuales (`autoDeployTrigger: off`). Si cambia la API, usa Manual Deploy desde Render y el commit correspondiente de `pwa`.

## Verificación y límite detectado

Render terminó correctamente su primera compilación Docker. `/api/health` y las búsquedas devolvieron respuestas válidas. Se verificaron el registro y la creación/lectura de listas con una cuenta aislada, así como el origen CORS de GitHub Pages.

La prueba de audio de varios videos devolvió `HTTP 403 Forbidden en player` desde Render; uno de los mismos videos se resolvió correctamente desde el servidor del Mac. La publicación de la interfaz y del servidor está hecha, pero la reproducción alojada en Render queda pendiente por este rechazo de YouTube. No debe declararse equivalente a la prueba local ni totalmente funcional en este alojamiento.

La prueba gratuita no proporciona biblioteca persistente. Guarda exportaciones desde Ajustes. El servicio puede suspenderse por inactividad y los datos del servidor pueden perderse al reiniciar o desplegar. Las cuentas locales y su clave de recuperación no convierten ese almacenamiento temporal en persistente.
