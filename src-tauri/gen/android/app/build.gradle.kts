import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// La clave de firma del APK de release. Vive fuera del repositorio
// (keystore.properties apunta a ella y tampoco se sube): sin ella no se puede
// publicar una actualización que se instale encima de la anterior.
val keystoreProperties = Properties().apply {
    val propFile = rootProject.file("keystore.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    signingConfigs {
        create("release") {
            if (keystoreProperties.containsKey("storeFile")) {
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("keyPassword")
            }
        }
    }
    namespace = "com.hanyer.antares"
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        applicationId = "com.hanyer.antares"
        minSdk = 24
        // MainActivity aplica los insets de barras, recortes y teclado.
        targetSdk = 36
        val buildVersion = project.findProperty("antaresVersion")?.toString()
        versionName = buildVersion ?: tauriProperties.getProperty("tauri.android.versionName", "1.0")
        versionCode = if (buildVersion != null) {
            val parts = buildVersion.split('.').map(String::toInt)
            parts[0] * 1000000 + parts[1] * 1000 + parts[2]
        } else tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
    }
    buildTypes {
        getByName("debug") {
            applicationIdSuffix = ".preview"
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (keystoreProperties.containsKey("storeFile")) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    testOptions { unitTests.isIncludeAndroidResources = true }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    // El reproductor nativo (PlaybackService): ExoPlayer y la sesión multimedia
    // que pone la notificación y los controles de la pantalla de bloqueo.
    implementation("androidx.media3:media3-exoplayer:1.8.0")
    implementation("androidx.media3:media3-session:1.8.0")
    implementation("androidx.media3:media3-datasource:1.8.0")
    testImplementation("junit:junit:4.13.2")
    testImplementation("org.robolectric:robolectric:4.14.1")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")

androidComponents {
    onVariants(selector().withBuildType("debug")) { variant ->
        variant.outputs.forEach { output ->
            output.versionCode.set(output.versionCode.get() * 100 + 8)
            output.versionName.set(output.versionName.get() + "-preview.8")
        }
    }
}

tasks.withType<Test>().configureEach {
    val testHome = file(System.getenv("ANTARES_TEST_HOME") ?: File(System.getProperty("java.io.tmpdir"), "antares-robolectric").absolutePath)
    testHome.mkdirs()
    val testTemp = File(testHome, "tmp").apply { mkdirs() }
    systemProperty("java.io.tmpdir", testTemp.absolutePath)
    systemProperty("user.home", testHome.absolutePath)
    systemProperty("robolectric.dependency.repo.url", "https://repo.maven.apache.org/maven2")
    System.getenv("ANTARES_TEST_SDKS")?.let {
        systemProperty("robolectric.offline", "true")
        systemProperty("robolectric.dependency.dir", it)
    }
}
