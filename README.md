<p align="center">
  <img src="assets/branding/icon.svg" alt="Antares" width="96" />
</p>

<h1 align="center">Antares</h1>

<p align="center">Tu música, tus listas y nuevas canciones por descubrir.</p>
<p align="center"><strong>Windows · Android · Tauri 2 · Rust · JavaScript</strong></p>

Antares es un reproductor de música que permite buscar canciones en YouTube, organizar una biblioteca personal y descubrir música a partir de tus escuchas. Combina una interfaz personalizable con listas inteligentes, letras sincronizadas y controles de reproducción integrados en el sistema.

La versión del proyecto es **0.3.3**. El código de Windows y Android se mantiene en este repositorio; los paquetes de actualización de Windows se distribuyen por separado en [antares-actualizaciones](https://github.com/Hanyer001/antares-actualizaciones/releases).

## Novedades de 0.3.3

- Listas de Spotify con más de 100 canciones, paginación y resumen de coincidencias.
- Álbumes completos en orden y enlaces de listas de otros servicios reconocidos desde la búsqueda.
- Cinco principales al reproducir un artista, con continuación habitual y una vista compacta.
- Botón **Solo este artista** para escuchar su catálogo desde la cola, sin recomendaciones ajenas.
- Código Android con recuperación de cortes, diseños predefinidos, gestos, Deshacer en la cola y control del descubrimiento. Continúa como versión de pruebas.

La copia de `rusty_ytdl` y su parche de cliente YouTube se documentan en [ANTARES_PATCH.md](src-tauri/vendor/rusty_ytdl/ANTARES_PATCH.md). No cambia la arquitectura de reproducción de Tauri ni el proxy de audio.

[Descargar Antares 0.3.3 para Windows](https://github.com/Hanyer001/antares-actualizaciones/releases/download/v0.3.3/Antares-Setup.exe) · [Página de Antares](https://hanyer001.github.io/Pagina-Antares/)

## Funciones principales

| | Qué puedes hacer |
| --- | --- |
| **Reproducción** | Buscar por canción o enlace, gestionar la cola, repetir, barajar y retomar la última sesión. |
| **Álbumes y artistas** | Escuchar discos completos en orden, cinco principales con continuación habitual, o elegir Solo este artista. |
| **Biblioteca** | Crear listas, fijarlas, agruparlas en carpetas y añadir portadas y descripciones. Buscar y mover varias canciones a la vez. |
| **Listas inteligentes** | Combinar reglas de favoritos, artista, escuchas, saltos y tiempo sin reproducir. |
| **Descubrimiento** | Crear radios, ajustar la proporción de canciones nuevas y elegir momentos como Trabajo, Fiesta o Relax. |
| **Letras y sonido** | Seguir letras sincronizadas; usar ecualizador, nivelador y fundidos con las capacidades de cada plataforma. |
| **Personalización** | Elegir temas, colores, fuentes, fondos, distribución y atajos. Guardar combinaciones como perfiles. |
| **Datos** | Consultar estadísticas, usar modo incógnito y crear o restaurar copias completas por usuario. |

También permite importar listas públicas de otros servicios y canciones desde texto o CSV. La guía de [funciones](docs/features.md) explica los formatos y las diferencias entre plataformas.

## Plataformas

| Característica | Windows | Android |
| --- | --- | --- |
| Búsqueda, biblioteca y recomendaciones | Sí | Sí |
| Reproducción | rusty_ytdl y WebView2 | InnerTube y ExoPlayer |
| Audio en segundo plano | Bandeja del sistema | Servicio de reproducción |
| Letras y copias internas | Sí | Sí |
| Ecualizador, nivelador y fundidos | Sí | Efectos nativos según dispositivo; fundidos opcionales |
| Usuarios y copias completas | Sí | Sí, con selector de documentos |
| Mini ventana y atajos globales | Sí | Controles multimedia y navegación táctil |

La adaptación Android es una **versión de pruebas**, con navegación táctil personalizable y ahorro de recursos activado por defecto. La [guía Android](docs/android.md) describe funciones, compilación del APK y verificaciones pendientes en un teléfono.

La búsqueda y la reproducción requieren conexión a internet. La disponibilidad de canciones y letras depende de los servicios consultados.

## Ejecutar en desarrollo

Para Windows necesitas **Node.js 22 o posterior**, npm, Rust con el target MSVC, Microsoft C++ Build Tools y WebView2. La [guía de desarrollo](docs/development.md) detalla la preparación y la configuración de Android.

```powershell
git clone https://github.com/Hanyer001/Antares.git
cd Antares
npm ci
```

Descarga `yt-dlp.exe` desde las [versiones oficiales de yt-dlp](https://github.com/yt-dlp/yt-dlp/releases/latest) y guárdalo con este nombre:

```text
src-tauri/binaries/yt-dlp-x86_64-pc-windows-msvc.exe
```

Crea la carpeta `binaries` si no existe. El ejecutable no se incluye en Git. Se conserva para búsquedas y listas; la extracción de audio de Windows usa el crate nativo `rusty_ytdl`.

```powershell
npm run dev
```

La interfaz utiliza las API de Tauri: abrir `src/index.html` directamente en el navegador no sustituye el modo de desarrollo.

## Estructura del proyecto

```text
Antares/
├── assets/
│   └── branding/          # Icono fuente del proyecto
├── docs/                  # Funciones, desarrollo, arquitectura y publicación
├── scripts/               # Herramientas de Android, publicación y diagnóstico
├── src/                   # Interfaz web
│   ├── fonts/             # Fuentes locales y sus créditos
│   ├── js/                # Módulos de reproducción, biblioteca y vistas
│   ├── boot-theme.js      # Tema inicial
│   ├── index.html
│   ├── main.js            # Inicialización y coordinación
│   └── styles.css
├── src-tauri/
│   ├── capabilities/      # Permisos de Tauri
│   ├── gen/android/       # Proyecto Android y reproductor Kotlin
│   ├── icons/             # Iconos de la aplicación
│   ├── src/               # Backend Rust
│   ├── vendor/rusty_ytdl/  # Crate nativo y parche de extracción de YouTube
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tests/                 # Pruebas de JavaScript
├── CHANGELOG.md
├── package.json
└── README.md
```

## Generar el instalador de Windows

Con los archivos de firma del canal configurados según la [guía de publicación](docs/releases.md), ejecuta desde la raíz del proyecto:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\release-windows.ps1 -Notas "Listas completas, albumes y modo Solo este artista"
```

Para esta versión, el script prepara `Antares_0.3.3_x64-setup.exe`, `Antares-Setup.exe` y `latest.json` en `../publicar/v0.3.3/`. El manifiesto contiene la firma del instalador que comprueba la aplicación. Los tres archivos se adjuntan a la release `v0.3.3` del repositorio de actualizaciones.

## Comprobaciones

Desde la raíz del proyecto:

```powershell
npm test
npm run check:rust
npm run test:rust
```

Las pruebas que necesitan servicios externos o paquetes firmados están marcadas como ignoradas y se ejecutan por separado. Estos comandos no generan instaladores.

## Documentación

- [Funciones y uso](docs/features.md)
- [Entorno de desarrollo y pruebas](docs/development.md)
- [Arquitectura y responsabilidades](docs/architecture.md)
- [Datos locales y copias de seguridad](docs/data.md)
- [Compilación y publicación de versiones](docs/releases.md)
- [Cambios de la versión 0.3.3](CHANGELOG.md)

## Reportar un problema

Abre un [issue](https://github.com/Hanyer001/Antares/issues) indicando la versión, el sistema operativo, los pasos para reproducirlo y qué esperabas que ocurriera. Para problemas de reproducción, incluye el enlace de una canción de ejemplo si es público.

## Tecnologías

[Tauri](https://v2.tauri.app/), [Rust](https://www.rust-lang.org/), HTML, CSS y JavaScript con módulos ES. En Windows, Antares extrae el audio con [rusty_ytdl](https://github.com/Mithronn/rusty_ytdl) y conserva [yt-dlp](https://github.com/yt-dlp/yt-dlp) para búsquedas y listas. Android usa InnerTube y ExoPlayer y [LRCLIB](https://lrclib.net/) para las letras. La fuente Inter se incluye localmente; sus créditos están en [src/fonts/LEEME.txt](src/fonts/LEEME.txt).


### Antares Android 0.3.3 Beta 1

La primera edición pública **0.3.3 Beta 1** incorpora la interfaz móvil compacta, playlists, búsqueda musical, audio nativo y doce tipografías locales. [Descargar para Android](https://github.com/Hanyer001/antares-actualizaciones/releases/download/android-v0.3.3-beta.1/Antares-Android.apk) · [Instalación, migración y validación](docs/android.md). Las actualizaciones públicas conservan el identificador y la firma; el aviso automático en Android aún no está implementado.
