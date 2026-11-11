# Antares en Fedora

El soporte de Fedora x86_64 es experimental. Puedes compilar y ejecutar Antares desde el código fuente con Tauri 2 y WebKitGTK.

## Preparar el entorno

Instala las herramientas de compilación y las bibliotecas de desarrollo de Fedora. La lista de dependencias por distribución está en los [prerrequisitos de Tauri](https://v2.tauri.app/start/prerequisites/).

```bash
sudo dnf install gcc gcc-c++ make pkgconf-pkg-config git curl tar xz \
  webkit2gtk4.1-devel gtk3-devel openssl-devel librsvg2-devel \
  libappindicator-gtk3-devel libxdo-devel
```

Desde la raíz del repositorio, elige un directorio de trabajo con espacio para las herramientas y compilaciones. `preparar` instala allí Rust, las versiones de la CLI de Tauri y de wasm-bindgen fijadas en el asistente, y Node para las pruebas JavaScript. Ejecuta el asistente con tu usuario habitual.

```bash
export ANTARES_LINUX_ROOT="$HOME/.local/share/antares-dev"
bash scripts/linux.sh preparar
bash scripts/linux.sh diagnostico
```

Si compartes el código con Windows, usa el mismo valor de `ANTARES_LINUX_ROOT` en cada sesión de Linux. El asistente separa las herramientas, compilaciones y datos de la aplicación del entorno de Windows.

## Comandos

| Comando | Qué hace |
| --- | --- |
| `bash scripts/linux.sh comprobar` | Comprueba que compila la biblioteca Rust con el lockfile. |
| `bash scripts/linux.sh pruebas` | Ejecuta las pruebas de JavaScript y Rust. |
| `bash scripts/linux.sh abrir` | Compila y abre Antares en desarrollo. |
| `bash scripts/linux.sh compilar` | Genera un ejecutable optimizado para uso local. |
| `bash scripts/linux.sh ejecutar` | Abre el ejecutable optimizado existente. |

## Comportamiento en Linux

- WebKitGTK recibe el audio mediante un puente HTTP local que admite búsquedas dentro de la pista y transmite los rangos solicitados.
- Al cerrar la ventana, Antares guarda la sesión y sale. Los atajos de la ventana funcionan en Wayland. Los atajos globales requieren una sesión compatible con el plugin X11.
- La actualización de Antares para Windows se deshabilita en Linux.
- En sesiones Wayland con NVIDIA, el asistente configura el compositor de WebKitGTK para el proceso de Antares. Puedes probar Skia con `WEBKIT_USE_SKIA_FOR_COMPOSITION=1` al ejecutar el asistente.
