package com.hanyer.antares

import android.os.Bundle

// Sin `enableEdgeToEdge()`: la app va entre la barra de estado y la de
// navegación, no por debajo (ver targetSdk en build.gradle.kts).
class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
  }
}
