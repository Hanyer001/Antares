# Reglas de ProGuard/R8 para la compilación de release de Antares.

# Tauri busca los plugins y sus órdenes por nombre (reflexión) desde Rust: si
# R8 los renombra o los quita por "no usados", la app no encuentra el
# reproductor. Se conservan enteros.
-keep class com.hanyer.antares.** { *; }
-keep class app.tauri.** { *; }
-keepattributes *Annotation*
