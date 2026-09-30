// Aplica el tema guardado antes del primer renderizado.
// appearance.js guarda las variables y atributos resueltos en localStorage;
// las preferencias persistidas en Rust se cargan después.
(function () {
  // Aplicar el diseño de Android antes del primer renderizado.
  if (/Android/i.test(navigator.userAgent)) {
    document.documentElement.setAttribute("data-platform", "android");
  }

  try {
    // Cada usuario del PC tiene su copia (user.js): la del principal sin sufijo.
    var who = localStorage.getItem("antares.user");
    var suffix = who && who !== "main" ? "." + who : "";

    var look = JSON.parse(localStorage.getItem("antares.look" + suffix) || "null");
    if (!look) return;

    var root = document.documentElement;
    var name;
    for (name in look.vars) root.style.setProperty(name, look.vars[name]);
    for (name in look.attrs) root.setAttribute(name, look.attrs[name]);

    if (look.attrs["data-background"] === "image") {
      var wallpaper = localStorage.getItem("antares.wallpaper" + suffix);
      if (wallpaper) root.style.setProperty("--wallpaper-url", 'url("' + wallpaper + '")');
    }
  } catch (error) {
    // Sin almacenamiento o valor corrupto: arranca con el tema por defecto.
  }
})();
