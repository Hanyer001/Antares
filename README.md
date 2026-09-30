<p align="center">
  <img src="assets/branding/icon.svg" alt="Antares" width="96" />
</p>

<h1 align="center">Antares</h1>

<p align="center">Tu música, tus listas y nuevas canciones por descubrir.</p>
<p align="center"><strong>Windows · Android · Tauri 2 · Rust · JavaScript</strong></p>

Antares es un reproductor de música que permite buscar canciones en YouTube, organizar una biblioteca personal y descubrir música a partir de tus escuchas. Combina una interfaz personalizable con listas inteligentes, letras sincronizadas y controles de reproducción integrados en el sistema.

La versión del proyecto es **0.3.0**. El código de Windows y Android se mantiene en este repositorio; los paquetes de actualización de Windows se distribuyen por separado en [antares-actualizaciones](https://github.com/Hanyer001/antares-actualizaciones/releases).

## Funciones principales

| | Qué puedes hacer |
| --- | --- |
| **Reproducción** | Buscar por canción o enlace, gestionar la cola, repetir, barajar y retomar la última sesión. |
| **Biblioteca** | Crear listas, fijarlas, agruparlas en carpetas y añadir portadas y descripciones. Buscar y mover varias canciones a la vez. |
| **Listas inteligentes** | Combinar reglas de favoritos, artista, escuchas, saltos y tiempo sin reproducir. |
| **Descubrimiento** | Crear radios, ajustar la proporción de canciones nuevas y elegir momentos como Trabajo, Fiesta o Relax. |
| **Letras y sonido** | Seguir letras sincronizadas; en Windows, usar ecualizador, nivelador y fundidos entre canciones. |
| **Personalización** | Elegir temas, colores, fuentes, fondos, distribución y atajos. Guardar combinaciones como perfiles. |
| **Datos** | Consultar estadísticas, usar modo incógnito y crear o restaurar copias completas por usuario. |

También permite importar listas públicas de otros servicios y canciones desde texto o CSV. La guía de [funciones](docs/features.md) explica los formatos y las diferencias entre plataformas.

## Plataformas

| Característica | Windows | Android |
| --- | --- | --- |
| Búsqueda, biblioteca y recomendaciones | Sí | Sí |
| Reproducción | yt-dlp y WebView2 | InnerTube y ExoPlayer |
| Audio en segundo plano | Bandeja del sistema | Servicio de reproducción |
| Letras y copias internas | Sí | Sí |
| Ecualizador, nivelador y fundidos | Sí | No |
| Mini reproductor, atajos globales y varios usuarios | Sí | No |

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

Crea la carpeta `binaries` si no existe. El ejecutable no se incluye en Git.

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
│   ├── Cargo.toml
│   └── tauri.conf.json
├── tests/                 # Pruebas de JavaScript
├── CHANGELOG.md
├── package.json
└── README.md
```

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
- [Cambios de la versión 0.3.0](CHANGELOG.md)

## Reportar un problema

Abre un [issue](https://github.com/Hanyer001/Antares/issues) indicando la versión, el sistema operativo, los pasos para reproducirlo y qué esperabas que ocurriera. Para problemas de reproducción, incluye el enlace de una canción de ejemplo si es público.

## Tecnologías

[Tauri](https://v2.tauri.app/), [Rust](https://www.rust-lang.org/), HTML, CSS y JavaScript con módulos ES. Antares utiliza [yt-dlp](https://github.com/yt-dlp/yt-dlp) en Windows, ExoPlayer en Android y [LRCLIB](https://lrclib.net/) para las letras. La fuente Inter se incluye localmente; sus créditos están en [src/fonts/LEEME.txt](src/fonts/LEEME.txt).
