package com.hanyer.antares

import android.content.Intent
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.datasource.ResolvingDataSource
import androidx.media3.exoplayer.DefaultLoadControl
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.upstream.DefaultLoadErrorHandlingPolicy
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService
import org.json.JSONObject

/** La cola, el temporizador y las escuchas sobreviven a la actividad/WebView. */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null
    private lateinit var exo: ExoPlayer
    private val main = Handler(Looper.getMainLooper())
    private var current: MediaItem? = null
    private var listenedMs = 0L
    private var playingSince = 0L
    private var recordedStart = false
    private var privateListen = false
    private var learnListen = true
    private var sleepMode = "off"
    private var sleepStopped = false
    private var oldRepeat = Player.REPEAT_MODE_OFF
    private var sleepDeadline = 0L
    private val expire = Runnable {
        if (sleepMode == "time") {
            sleepStopped = true
            exo.pause()
            sleepMode = "off"
            PlayerBridge.sleepExpired?.invoke()
        }
    }
    private val effects = NativeEffects()
    private lateinit var crossfade: NativeCrossfade
    private lateinit var playerListener: Player.Listener
    private var crossfadeSeconds = 0f
    private var energySaver = true
    private lateinit var mediaSources: DefaultMediaSourceFactory

    override fun onCreate() {
        super.onCreate()
        val http = DefaultHttpDataSource.Factory().setUserAgent(USER_AGENT)
            .setAllowCrossProtocolRedirects(true).setConnectTimeoutMs(15000).setReadTimeoutMs(15000)
        // Una sola resolución al abrir cada fuente. Los seeks reusan la URL
        // de esa apertura; la caché Rust coordina solicitudes concurrentes.
        // Renovar únicamente si el CDN rechaza una URL; mantener el ID y el byte actual.
        val chunks = ChunkedAudioDataSource.Factory(http) { spec ->
            val id = spec.key?.takeIf { it.matches(Regex("[A-Za-z0-9_-]{11}")) }
                ?: throw java.io.IOException("Falta el ID del audio para renovar el enlace")
            PlaybackResolver.audioUri(id,fresh=true)
        }
        val sources = ResolvingDataSource.Factory(chunks) { spec ->
            if (spec.uri.scheme == "antares") {
                val id = spec.uri.lastPathSegment ?: ""
                spec.buildUpon().setUri(PlaybackResolver.audioUri(id)).setKey(id).build()
            } else spec
        }
        // ChunkedAudioDataSource ya recupera la conexión: no multiplicar sus intentos
        // con otra ronda de Media3 que compita con la recuperación de la interfaz.
        mediaSources = DefaultMediaSourceFactory(sources)
            .setLoadErrorHandlingPolicy(DefaultLoadErrorHandlingPolicy(0))
        exo = createPlayer()
        crossfade = NativeCrossfade({ exo }, { createPlayer(false) }) { incoming ->
            accountTime(); if (recordedStart) record(ended=true)
            recordedStart=false
            exo.removeListener(playerListener)
            exo.setAudioAttributes(exo.audioAttributes, false)
            exo=incoming; exo.addListener(playerListener)
            incoming.setAudioAttributes(incoming.audioAttributes, true)
            current=incoming.currentMediaItem; listenedMs=0; playingSince=0
            privateListen=PlayerBridge.incognito; learnListen=PlayerBridge.learn
            effects.attach(incoming.audioSessionId)
            session?.setPlayer(incoming)
        }
        playerListener = object : Player.Listener {
            override fun onIsPlayingChanged(isPlaying: Boolean) {
                accountTime()
                if (isPlaying) {
                    playingSince = SystemClock.elapsedRealtime()
                    if (!recordedStart) { recordedStart = true; record(started = true) }
                }
                crossfade.playbackChanged()
            }
            override fun onMediaItemTransition(mediaItem: MediaItem?, reason: Int) {
                accountTime()
                if (recordedStart) record(ended = reason == Player.MEDIA_ITEM_TRANSITION_REASON_AUTO || reason == Player.MEDIA_ITEM_TRANSITION_REASON_REPEAT)
                current = mediaItem
                listenedMs = 0; recordedStart = false
                privateListen = PlayerBridge.incognito; learnListen = PlayerBridge.learn
                if (exo.isPlaying) {
                    playingSince = SystemClock.elapsedRealtime()
                    recordedStart = true; record(started = true)
                }
                crossfade.trackChanged()
            }
            override fun onPlaybackStateChanged(state: Int) {
                if (state == Player.STATE_ENDED && recordedStart) {
                    accountTime(); record(ended = true); recordedStart = false
                }
            }
            override fun onAudioSessionIdChanged(audioSessionId: Int) { effects.attach(audioSessionId) }
            override fun onPlayWhenReadyChanged(playWhenReady: Boolean, reason: Int) {
                if (playWhenReady) sleepStopped = false
                if (!playWhenReady && sleepMode == "track" && reason == Player.PLAY_WHEN_READY_CHANGE_REASON_END_OF_MEDIA_ITEM) {
                    sleepStopped = true
                    sleepMode = "off"; exo.pauseAtEndOfMediaItems = false; exo.repeatMode = oldRepeat
                    configureTransitions()
                    PlayerBridge.sleepExpired?.invoke()
                }
            }
        }
        exo.addListener(playerListener)
        PlayerBridge.service = this
        session = MediaSession.Builder(this, exo).build()
    }
    private fun createPlayer(handleFocus: Boolean = true): ExoPlayer = ExoPlayer.Builder(this)
            .setMediaSourceFactory(mediaSources)
            .setLoadControl(DefaultLoadControl.Builder().setBufferDurationsMs(15000, 30000, 1500, 3000).build())
            .setAudioAttributes(AudioAttributes.Builder().setUsage(C.USAGE_MEDIA)
                .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC).build(), handleFocus)
            .setHandleAudioBecomingNoisy(true)
            .setWakeMode(C.WAKE_MODE_LOCAL)
            .build()
    private fun accountTime() {
        if (playingSince > 0) listenedMs += SystemClock.elapsedRealtime() - playingSince
        playingSince = 0
    }
    private fun record(started: Boolean = false, ended: Boolean = false) {
        val item = current ?: return
        if (item.mediaId.length != 11) return
        val metadata = item.mediaMetadata
        val track = JSONObject().put("id", item.mediaId)
            .put("title", metadata.title?.toString()).put("uploader", metadata.artist?.toString())
            .put("duration", metadata.extras?.getDouble("duration")?.takeIf { it > 0 })
            .put("thumbnail", metadata.artworkUri?.toString())
            .put("is_music", metadata.extras?.takeIf { it.containsKey("is_music") }?.getBoolean("is_music"))
            .put("watch_url", "https://www.youtube.com/watch?v=${item.mediaId}")
        PlaybackResolver.record(JSONObject().put("track", track).put("started", started)
            .put("listened", listenedMs / 1000.0).put("ended", ended)
            .put("incognito", privateListen).put("learn", learnListen).toString())
    }

    fun privacyChanged() {
        // Una escucha iniciada o continuada en incógnito nunca se registra al terminar.
        privateListen = privateListen || PlayerBridge.incognito
        learnListen = learnListen && PlayerBridge.learn
    }
    fun setSleep(mode: String, milliseconds: Long) {
        main.removeCallbacks(expire)
        if (sleepMode == "track") exo.repeatMode = oldRepeat
        sleepStopped = false
        sleepMode = mode
        exo.pauseAtEndOfMediaItems = mode == "track"
        if (mode == "track") { oldRepeat = exo.repeatMode; exo.repeatMode = Player.REPEAT_MODE_OFF }
        sleepDeadline = if (mode == "time") SystemClock.elapsedRealtime() + milliseconds.coerceAtLeast(0) else 0
        if (mode == "time") main.postDelayed(expire, milliseconds.coerceAtLeast(0))
        configureTransitions()
    }
    fun sleepState() = JSONObject().put("mode", sleepMode)
        .put("remaining", (sleepDeadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
    fun setEffects(bands: FloatArray, level: Boolean) = effects.configure(bands, level)
    fun setPlaybackOptions(seconds: Float, saver: Boolean) {
        crossfadeSeconds=seconds; energySaver=saver; configureTransitions()
    }
    private fun configureTransitions() { crossfade.configure(if (energySaver || sleepMode == "track") 0f else crossfadeSeconds) }
    fun effectsState() = effects.capabilities()
    fun blocksAutomaticEnd() = sleepStopped || sleepMode == "track"
    fun repeatState() = if (sleepMode == "track") oldRepeat else exo.repeatMode
    fun setVolume(volume: Float) = crossfade.setVolume(volume)
    fun stopAndClear() {
        crossfade.cancel()
        exo.stop(); exo.clearMediaItems()
    }
    fun setRepeat(mode: Int) {
        if (sleepMode == "track") oldRepeat = mode else exo.repeatMode = mode
    }
    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? =
        if (controllerInfo.packageName == packageName || controllerInfo.isTrusted) session else null
    override fun onTaskRemoved(rootIntent: Intent?) {
        // Media3 mantiene su servicio foreground mientras se reproduce.
        if (!exo.playWhenReady || exo.mediaItemCount == 0) stopSelf()
    }
    override fun onDestroy() {
        accountTime(); if (recordedStart) record()
        main.removeCallbacksAndMessages(null)
        crossfade.release()
        effects.release()
        PlayerBridge.service = null
        session?.run { player.release(); release() }; session = null
        super.onDestroy()
    }
    companion object {
        const val USER_AGENT = "Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15"
    }
}

object PlayerBridge {
    var service: PlaybackService? = null
    var incognito = false
    var learn = true
    var sleepExpired: (() -> Unit)? = null
}
