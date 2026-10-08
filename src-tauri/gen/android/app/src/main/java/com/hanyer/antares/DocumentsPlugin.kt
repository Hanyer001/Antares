package com.hanyer.antares

import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import androidx.appcompat.app.AppCompatActivity
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.Executors

/** Storage Access Framework: el usuario elige el destino, sin permisos de almacenamiento. */
@TauriPlugin
class DocumentsPlugin(private val activity: Activity) : Plugin(activity) {
    private val io = Executors.newSingleThreadExecutor()
    override fun onDestroy(activity: AppCompatActivity) {
        io.shutdown()
        super.onDestroy(activity)
    }
    @Command
    fun save(invoke: Invoke) {
        val args = invoke.getArgs()
        val contents = args.optString("contents", "")
        if (contents.toByteArray(Charsets.UTF_8).size > 64*1024*1024) return invoke.reject("El archivo supera 64 MB")
        val name = args.optString("name","antares.json").replace(Regex("[^\\p{L}\\p{N}._-]"),"_").take(120)
        startActivityForResult(invoke,Intent(Intent.ACTION_CREATE_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "application/json"
            putExtra(Intent.EXTRA_TITLE,name)
        },"saved")
    }
    @ActivityCallback
    fun saved(invoke: Invoke?, result: ActivityResult) {
        invoke ?: return
        val uri = result.data?.data
        if (result.resultCode != Activity.RESULT_OK || uri == null) {
            invoke.resolve(JSObject().put("cancelled",true)); return
        }
        io.execute {
            runCatching {
                activity.contentResolver.openOutputStream(uri,"wt")?.use {
                    it.write(invoke.getArgs().optString("contents").toByteArray(Charsets.UTF_8))
                } ?: error("No se pudo abrir el destino")
            }.onSuccess { invoke.resolve(JSObject().put("name",invoke.getArgs().optString("name"))) }
             .onFailure { invoke.reject("No se pudo guardar el archivo") }
        }
    }
}
