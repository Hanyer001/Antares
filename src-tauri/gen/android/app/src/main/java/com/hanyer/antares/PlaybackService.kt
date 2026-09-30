package com.hanyer.antares

import android.content.Intent
import androidx.annotation.OptIn
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.common.ForwardingPlayer
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DefaultHttpDataSource
import androidx.media3.exoplayer.ExoPlayer
import androidx.media3.exoplayer.source.DefaultMediaSourceFactory
import androidx.media3.session.MediaSession
import androidx.media3.session.MediaSessionService

/**
 * El reproductor de Antares en Android: ExoPlayer dentro de un servicio en
 * primer plano.
 *
 * Asi la musica sigue con la pantalla apagada o con otra app delante, y
 * Android pone solo la notificacion multimedia, los controles de la pantalla
 * de bloqueo y los de los auriculares o el coche.
 *
 * La cola no vive aqui sino en la interfaz (JavaScript): "siguiente" y
 * "anterior" se le pasan a ella (ver [PlayerBridge]), que decide que suena y
 * vuelve a llamar a PlayerPlugin.load.
 */
@OptIn(UnstableApi::class)
class PlaybackService : MediaSessionService() {
    private var session: MediaSession? = null

    override fun onCreate() {
        super.onCreate()

        // Las URLs de audio que da YouTube al cliente ANDROID_VR se piden con
        // su mismo User-Agent (el de innertube.rs).
        val http = DefaultHttpDataSource.Factory()
            .setUserAgent(USER_AGENT)
            .setAllowCrossProtocolRedirects(true)

        val exo = ExoPlayer.Builder(this)
            .setMediaSourceFactory(DefaultMediaSourceFactory(http))
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(C.USAGE_MEDIA)
                    .setContentType(C.AUDIO_CONTENT_TYPE_MUSIC)
                    .build(),
                /* handleAudioFocus = */ true,
            )
            // Pausa al desconectar los auriculares, como cualquier reproductor.
            .setHandleAudioBecomingNoisy(true)
            // Mantiene la wifi y la CPU despiertas mientras suena.
            .setWakeMode(C.WAKE_MODE_NETWORK)
            .build()

        session = MediaSession.Builder(this, QueuePlayer(exo)).build()
    }

    override fun onGetSession(controllerInfo: MediaSession.ControllerInfo): MediaSession? = session

    /**
     * Si se quita la app de recientes, la cola (que vive en la interfaz) ya no
     * existe: seguir con la cancion actual y luego quedarse mudo seria raro.
     * Se para todo.
     */
    override fun onTaskRemoved(rootIntent: Intent?) {
        session?.player?.run {
            pause()
            stop()
        }
        stopSelf()
    }

    override fun onDestroy() {
        session?.run {
            player.release()
            release()
        }
        session = null
        super.onDestroy()
    }

    companion object {
        const val USER_AGENT =
            "com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip"
    }
}

/**
 * ExoPlayer con "siguiente" y "anterior" siempre disponibles, aunque solo
 * tenga una cancion cargada: los botones de la notificacion y de los
 * auriculares se los pasan a la cola de la interfaz.
 */
@OptIn(UnstableApi::class)
class QueuePlayer(player: Player) : ForwardingPlayer(player) {
    override fun getAvailableCommands(): Player.Commands =
        super.getAvailableCommands().buildUpon()
            .add(Player.COMMAND_SEEK_TO_NEXT)
            .add(Player.COMMAND_SEEK_TO_NEXT_MEDIA_ITEM)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS)
            .add(Player.COMMAND_SEEK_TO_PREVIOUS_MEDIA_ITEM)
            .build()

    override fun isCommandAvailable(command: Int): Boolean = availableCommands.contains(command)

    override fun seekToNext() = PlayerBridge.command("next")
    override fun seekToNextMediaItem() = PlayerBridge.command("next")
    override fun seekToPrevious() = PlayerBridge.command("prev")
    override fun seekToPreviousMediaItem() = PlayerBridge.command("prev")
}

/** Puente entre el servicio y el plugin: las ordenes que no son del reproductor. */
object PlayerBridge {
    var listener: ((String) -> Unit)? = null

    fun command(action: String) {
        listener?.invoke(action)
    }
}
