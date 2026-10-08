package com.hanyer.antares

import android.app.Activity
import android.content.ComponentName
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.WebView
import android.view.HapticFeedbackConstants
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.media3.common.MediaItem
import androidx.media3.common.MediaMetadata
import androidx.media3.common.PlaybackException
import androidx.media3.common.Player
import androidx.media3.session.MediaController
import androidx.media3.session.SessionToken
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import com.google.common.util.concurrent.ListenableFuture

/**
 * El reproductor nativo visto desde la interfaz (`plugin:player|...`).
 *
 * Ordenes: load, play, pause, seek, setVolume, stop, background.
 * Eventos: "state" (sonando, cargando, terminada), "time" (posicion y
 * duracion, cuatro veces por segundo mientras suena), "error" y "command"
 * ("next" / "prev" desde la notificacion, los auriculares o el coche).
 *
 * native-deck.js lo envuelve para que el resto de la interfaz lo use como si
 * fuera un <audio>.
 */
@TauriPlugin
class PlayerPlugin(private val activity: Activity) : Plugin(activity) {
    private val main = Handler(Looper.getMainLooper())
    private var controllerFuture: ListenableFuture<MediaController>? = null
    private var controller: MediaController? = null
    private var visible = true
    private var stateSequence = 0L

    private val ticker = object : Runnable {
        override fun run() {
            emitTime()
            if (visible && controller?.isPlaying == true) main.postDelayed(this, TICK_MS)
        }
    }

    override fun load(webView: WebView) {
        super.load(webView)

        PlayerBridge.sleepExpired = { main.post { trigger("sleep", JSObject().put("expired", true)) } }

        val token = SessionToken(activity, ComponentName(activity, PlaybackService::class.java))
        val future = MediaController.Builder(activity, token).buildAsync()
        controllerFuture = future
        future.addListener({
            val c = runCatching { future.get() }.getOrNull() ?: return@addListener
            controller = c
            c.addListener(listener)
            emitItem(); emitState(); emitTime()
        }, ContextCompat.getMainExecutor(activity))
    }

    override fun onDestroy(activity: AppCompatActivity) {
        main.removeCallbacks(ticker)
        PlayerBridge.sleepExpired = null
        controllerFuture?.let { MediaController.releaseFuture(it) }
        controller = null
        super.onDestroy(activity)
    }

    override fun onPause(activity: AppCompatActivity) {
        visible = false; main.removeCallbacks(ticker)
        super.onPause(activity)
    }
    override fun onResume(activity: AppCompatActivity) {
        super.onResume(activity)
        visible = true
        emitItem(); emitState(); emitTime()
        main.removeCallbacks(ticker)
        if (controller?.isPlaying == true) main.post(ticker)
    }
    private fun emitItem() {
        val c = controller ?: return
        val item = c.currentMediaItem ?: return
        trigger("item", JSObject().put("id", item.mediaId)
            .put("title", item.mediaMetadata.title?.toString())
            .put("uploader", item.mediaMetadata.artist?.toString())
            .put("thumbnail", item.mediaMetadata.artworkUri?.toString()))
    }
    private val listener = object : Player.Listener {
        override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
            if (visible) { emitItem(); emitTime() }
        }
        override fun onIsPlayingChanged(isPlaying: Boolean) {
            emitState()
            main.removeCallbacks(ticker)
            if (isPlaying && visible) main.post(ticker) else if (visible) emitTime()
        }

        override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) { emitState() }

        override fun onPlaybackStateChanged(playbackState: Int) {
            emitState()
            if (playbackState == Player.STATE_READY) emitTime()
        }

        override fun onPlayerError(error: PlaybackException) {
            trigger("error", JSObject().put("id", controller?.currentMediaItem?.mediaId).put("message", error.errorCodeName))
        }
    }

    private fun emitState() {
        val c = controller ?: return
        trigger("state", playbackState(c))
    }

    private fun playbackState(c: MediaController) = JSObject()
        .put("id", c.currentMediaItem?.mediaId)
        .put("sequence", ++stateSequence)
        .put("playWhenReady", c.playWhenReady)
        .put("playing", c.isPlaying)
        .put("buffering", c.playbackState == Player.STATE_BUFFERING)
        .put("ended", c.playbackState == Player.STATE_ENDED && PlayerBridge.service?.blocksAutomaticEnd() != true)
        .put("idle", c.playbackState == Player.STATE_IDLE)

    private fun emitTime() {
        val c = controller ?: return
        val duration = c.duration
        trigger(
            "time",
            JSObject()
                .put("id", c.currentMediaItem?.mediaId)
                .put("position", c.currentPosition / 1000.0)
                .put("duration", if (duration > 0) duration / 1000.0 else -1.0)
                .put("buffered", c.bufferedPosition / 1000.0),
        )
    }

    /** Ejecuta una orden en el hilo principal, con el controlador ya conectado. */
    private fun withController(invoke: Invoke, replyState: Boolean = false, action: (MediaController) -> Unit) {
        main.post {
            val c = controller
            if (c != null) {
                runCatching { action(c) }
                    .onSuccess { if (replyState) invoke.resolve(playbackState(c)) else invoke.resolve() }
                    .onFailure { invoke.reject(it.message ?: "error del reproductor") }
                return@post
            }
            // Aun conectando con el servicio (el primer uso tras abrir la app).
            val future = controllerFuture ?: return@post invoke.reject("reproductor no disponible")
            future.addListener({
                val ready = runCatching { future.get() }.getOrNull()
                if (ready == null) {
                    invoke.reject("reproductor no disponible")
                } else {
                    controller = ready
                    runCatching { action(ready) }
                        .onSuccess { if (replyState) invoke.resolve(playbackState(ready)) else invoke.resolve() }
                        .onFailure { invoke.reject(it.message ?: "error del reproductor") }
                }
            }, ContextCompat.getMainExecutor(activity))
        }
    }

    /** Carga una cancion: `{ url, title, artist, artwork, startAt, play }`. */
    @Command
    fun load(invoke: Invoke) {
        val args = invoke.getArgs()
        val url = args.getString("url", null) ?: return invoke.reject("falta la url")
        val metadata = MediaMetadata.Builder()
            .setExtras(Bundle().apply { putDouble("duration", args.optDouble("duration", 0.0)); if (args.has("is_music") && !args.isNull("is_music")) putBoolean("is_music", args.optBoolean("is_music")) })
            .setTitle(args.getString("title", null))
            .setArtist(args.getString("artist", null))
            .setArtworkUri(args.getString("artwork", null)?.let(Uri::parse))
            .build()
        val item = MediaItem.Builder().setMediaId(args.optString("id", "")).setCustomCacheKey(args.optString("id", "")).setUri(url).setMediaMetadata(metadata).build()
        val startMs = (args.optDouble("startAt", 0.0) * 1000).toLong()
        val play = args.getBoolean("play", false)

        withController(invoke) { c ->
            c.setMediaItem(item, startMs)
            c.prepare()
            c.playWhenReady = play
        }
    }

    @Command
    fun play(invoke: Invoke) = withController(invoke, replyState = true) { c ->
        // Terminada, "play" vuelve a empezar (repetir esta cancion).
        if (c.playbackState == Player.STATE_ENDED) c.seekTo(0)
        c.play()
    }

    @Command
    fun pause(invoke: Invoke) = withController(invoke, replyState = true) { it.pause() }

    @Command
    fun seek(invoke: Invoke) {
        val seconds = invoke.getArgs().optDouble("seconds", 0.0)
        withController(invoke) { c ->
            c.seekTo((seconds * 1000).toLong())
            main.postDelayed({ emitTime() }, 50)
        }
    }

    @Command
    fun setVolume(invoke: Invoke) {
        val volume = invoke.getArgs().optDouble("volume", 1.0).toFloat().coerceIn(0f, 1f)
        withController(invoke) { c -> PlayerBridge.service?.setVolume(volume) ?: run { c.volume = volume } }
    }

    @Command
    fun stop(invoke: Invoke) = withController(invoke) { c ->
        // Completar el registro antes de cambiar el usuario o restaurar sus datos.
        PlayerBridge.service?.stopAndClear() ?: run { c.stop(); c.clearMediaItems() }
    }

    /**
     * "Atras" en la pantalla principal: la app pasa al fondo en vez de
     * cerrarse, para que la musica y la cola sigan.
     */
    @Command
    fun background(invoke: Invoke) {
        main.post {
            activity.moveTaskToBack(true)
            invoke.resolve()
        }
    }

    /** Respetar las preferencias táctiles del sistema; sin permiso VIBRATE ni servicio. */
    @Command
    fun haptic(invoke: Invoke) {
        activity.runOnUiThread {
            if (!activity.isFinishing && activity.hasWindowFocus()) {
                activity.window.decorView.performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK)
            }
            invoke.resolve()
        }
    }

    /** Actualiza alrededor de la pista activa sin volver a abrir su fuente. */
    @Command
    fun syncQueue(invoke: Invoke) {
        val args = invoke.getArgs()
        val rows = args.optJSONArray("items") ?: return invoke.reject("falta la cola")
        val currentId = args.optString("currentId", "")
        val items = runCatching { (0 until rows.length()).map { index ->
            val row = rows.getJSONObject(index)
            val id = row.getString("id")
            require(id.matches(Regex("[A-Za-z0-9_-]{11}"))) { "ID inválido" }
            MediaItem.Builder().setMediaId(id).setCustomCacheKey(id).setUri("antares://video/$id")
                .setMediaMetadata(MediaMetadata.Builder().setTitle(if(row.isNull("title")) null else row.optString("title"))
                    .setArtist(if(row.isNull("uploader")) null else row.optString("uploader"))
                    .setArtworkUri(Uri.parse("https://i.ytimg.com/vi/$id/hqdefault.jpg"))
                    .setExtras(Bundle().apply { putDouble("duration", row.optDouble("duration",0.0)); if (row.has("is_music") && !row.isNull("is_music")) putBoolean("is_music", row.optBoolean("is_music")) }).build()).build()
        } }.getOrElse { return invoke.reject("cola inválida") }
        withController(invoke) { c ->
            if (c.currentMediaItem?.mediaId != currentId) return@withController
            val at = items.indexOfFirst { it.mediaId == currentId }
            if (at < 0) return@withController
            val same = c.mediaItemCount == items.size && items.indices.all { c.getMediaItemAt(it).mediaId == items[it].mediaId }
            if (!same) {
                // Conservar el MediaItem actual y su búfer evita cortes al encolar.
                val active = c.currentMediaItemIndex
                if (active > 0) c.removeMediaItems(0, active)
                if (c.mediaItemCount > 1) c.removeMediaItems(1, c.mediaItemCount)
                if (at > 0) c.addMediaItems(0, items.take(at))
                if (at + 1 < items.size) c.addMediaItems(c.mediaItemCount, items.drop(at + 1))
            }
            val mode = when(args.optString("repeat")) { "all" -> Player.REPEAT_MODE_ALL; "one" -> Player.REPEAT_MODE_ONE; else -> Player.REPEAT_MODE_OFF }
            PlayerBridge.service?.setRepeat(mode)
        }
    }
    @Command
    fun snapshot(invoke: Invoke) {
        main.post {
            val c = controller
            if (c == null) {
                val future = controllerFuture ?: return@post invoke.reject("reproductor no disponible")
                future.addListener({
                    val ready = runCatching { future.get() }.getOrNull()
                    if (ready == null) invoke.reject("reproductor no disponible")
                    else { controller = ready; snapshot(invoke) }
                },ContextCompat.getMainExecutor(activity))
                return@post
            }
            val items = org.json.JSONArray()
            for (i in 0 until c.mediaItemCount) {
                val item = c.getMediaItemAt(i); val meta = item.mediaMetadata
                items.put(JSObject().put("id", item.mediaId).put("title", meta.title?.toString())
                    .put("uploader",meta.artist?.toString()).put("thumbnail",meta.artworkUri?.toString())
                    .put("duration",meta.extras?.getDouble("duration"))
                    .put("is_music",meta.extras?.takeIf { it.containsKey("is_music") }?.getBoolean("is_music"))
                    .put("watch_url","https://www.youtube.com/watch?v=${item.mediaId}"))
            }
            invoke.resolve(JSObject().put("items",items).put("index",c.currentMediaItemIndex)
                .put("repeat",when(PlayerBridge.service?.repeatState() ?: c.repeatMode) { Player.REPEAT_MODE_ONE -> "one"; Player.REPEAT_MODE_ALL -> "all"; else -> "off" })
                .put("incognito",PlayerBridge.incognito)
                .put("playing",c.isPlaying).put("playWhenReady",c.playWhenReady)
                .put("buffering",c.playbackState == Player.STATE_BUFFERING).put("sequence",++stateSequence)
                .put("position",c.currentPosition / 1000.0)
                .put("sleep",PlayerBridge.service?.sleepState()))
        }
    }
    @Command
    fun setPrivacy(invoke: Invoke) {
        main.post {
            PlayerBridge.incognito = invoke.getArgs().optBoolean("incognito",true)
            PlayerBridge.learn = invoke.getArgs().optBoolean("learn",false)
            PlayerBridge.service?.privacyChanged(); invoke.resolve()
        }
    }
    @Command
    fun setRepeat(invoke: Invoke) = withController(invoke) {
        val mode = when(invoke.getArgs().optString("repeat")) {
            "all" -> Player.REPEAT_MODE_ALL; "one" -> Player.REPEAT_MODE_ONE; else -> Player.REPEAT_MODE_OFF
        }
        PlayerBridge.service?.setRepeat(mode)
    }
    @Command
    fun setSleep(invoke: Invoke) {
        withController(invoke) {
            val args = invoke.getArgs()
            val mode = args.optString("mode","off")
            require(mode in listOf("off","track","time"))
            PlayerBridge.service?.setSleep(mode,args.optLong("milliseconds",0))
        }
    }
    @Command
    fun setEffects(invoke: Invoke) {
        withController(invoke) {
            val args = invoke.getArgs(); val values = args.optJSONArray("bands")
            PlayerBridge.service?.setEffects(FloatArray(10) { values?.optDouble(it,0.0)?.toFloat() ?: 0f },args.optBoolean("level",false))
        }
    }
    @Command
    fun setPlaybackOptions(invoke: Invoke) = withController(invoke) {
        val args = invoke.getArgs()
        PlayerBridge.service?.setPlaybackOptions(args.optDouble("crossfade",0.0).toFloat(),args.optBoolean("energySaver",true))
    }
    @Command
    fun effectsState(invoke: Invoke) {
        main.post { invoke.resolve(JSObject((PlayerBridge.service?.effectsState() ?: org.json.JSONObject()).toString())) }
    }
    companion object {
        private const val TICK_MS = 250L
    }
}
