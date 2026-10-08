package com.hanyer.antares

import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import androidx.annotation.OptIn
import androidx.media3.common.Player
import androidx.media3.common.util.UnstableApi
import androidx.media3.exoplayer.ExoPlayer

/** Segundo decodificador solo durante una transición solicitada por el usuario. */
@OptIn(UnstableApi::class)
class NativeCrossfade(
    private val current: () -> ExoPlayer,
    private val create: () -> ExoPlayer,
    private val swap: (ExoPlayer) -> Unit,
) {
    private val main = Handler(Looper.getMainLooper())
    private var seconds = 0f
    private var pending: ExoPlayer? = null
    private var pendingId = ""
    private var outgoing: ExoPlayer? = null
    private var fading = false
    private var master = 1f
    private var fadeStart = 0L
    private var fadeDuration = 1L
    private var failedId = ""
    private val tick = object : Runnable {
        override fun run() {
            val active = current()
            if (fading) {
                if (!active.playWhenReady) { cancel(); return }
                val ratio = ((SystemClock.elapsedRealtime()-fadeStart).toFloat()/fadeDuration).coerceIn(0f,1f)
                active.volume = master * ratio
                outgoing?.volume = master * (1f-ratio)
                if (ratio >= 1f) { outgoing?.release(); outgoing=null; fading=false; schedule(); return }
                main.postDelayed(this,50); return
            }
            if (seconds <= 0 || !active.isPlaying) { releasePending(); return }
            val next = active.nextMediaItemIndex
            val remaining = active.duration - active.currentPosition
            if (active.repeatMode == Player.REPEAT_MODE_ONE || next < 0 || active.duration <= 0 || remaining > seconds*1000+3000) {
                releasePending(); main.postDelayed(this,500); return
            }
            val id = active.getMediaItemAt(next).mediaId
            if (pendingId != id) {
                releasePending()
                if (id != failedId) {
                    pendingId=id
                    pending=create().apply {
                        val items=(0 until active.mediaItemCount).map { active.getMediaItemAt(it) }
                        setMediaItems(items,next,0); repeatMode=active.repeatMode; volume=0f; prepare()
                    }
                }
            }
            val ready = pending
            if (ready?.playerError != null) { failedId=id; releasePending() }
            if (ready != null && ready.playbackState == Player.STATE_READY && remaining <= seconds*1000 && remaining > 0) {
                master=active.volume; fadeStart=SystemClock.elapsedRealtime(); fadeDuration=remaining.coerceAtLeast(1)
                outgoing=active; pending=null; pendingId=""; fading=true
                swap(ready); ready.play()
                main.postDelayed(this,50)
            } else main.postDelayed(this,500)
        }
    }
    fun configure(value: Float) {
        seconds=value.coerceIn(0f,12f)
        if (seconds == 0f) cancel() else schedule()
    }
    fun playbackChanged() {
        if (!current().playWhenReady || (fading && !current().isPlaying)) cancel() else schedule()
    }
    fun trackChanged() { failedId=""; if (!fading) releasePending(); schedule() }
    private fun schedule() {
        main.removeCallbacks(tick)
        if (seconds > 0 && current().isPlaying) main.postDelayed(tick,if (fading) 50 else 500)
    }
    private fun releasePending() { pending?.release(); pending=null; pendingId="" }
    fun cancel() {
        main.removeCallbacks(tick); releasePending()
        if (fading) { outgoing?.release(); outgoing=null; current().volume=master; fading=false }
    }
    fun setVolume(value: Float) {
        if (fading) master=value else current().volume=value
    }
    fun release() = cancel()
}
