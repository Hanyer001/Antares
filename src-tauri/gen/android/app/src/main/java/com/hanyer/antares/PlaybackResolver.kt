package com.hanyer.antares

import android.net.Uri
import androidx.annotation.Keep
import org.json.JSONObject
import java.io.IOException

/** JNI usa el backend Rust existente; las URLs temporales nunca se guardan en disco. */
@Keep
object PlaybackResolver {
    @JvmStatic external fun resolve(id: String, fresh: Boolean): String?
    @JvmStatic external fun record(event: String)

    fun audioUri(id: String, fresh: Boolean = false): Uri {
        val result = JSONObject(resolve(id,fresh) ?: throw IOException("Backend no disponible"))
        val url = result.optString("url")
        if (!url.startsWith("https://")) throw IOException("No se pudo resolver el audio")
        return Uri.parse(url)
    }
}
