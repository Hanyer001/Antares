package com.hanyer.antares

import android.media.audiofx.DynamicsProcessing
import android.media.audiofx.Equalizer
import android.os.Build
import androidx.annotation.RequiresApi
import org.json.JSONObject
import kotlin.math.ln

/** Procesamiento del sistema, sin copiar PCM ni mantener un AudioContext web. */
class NativeEffects {
    companion object {
        fun headroom(values: FloatArray): Float = (values.maxOrNull() ?: 0f).coerceAtLeast(0f)
    }
    private var equalizer: Equalizer? = null
    private var dynamics: Any? = null
    private var bands = FloatArray(10)
    private var level = true
    private val frequencies = floatArrayOf(31f,62f,125f,250f,500f,1000f,2000f,4000f,8000f,16000f)

    fun attach(sessionId: Int) {
        release()
        if (sessionId <= 0) return
        if (Build.VERSION.SDK_INT >= 28) dynamics = runCatching { createDynamics(sessionId) }.getOrNull()
        if (dynamics == null) equalizer = runCatching { Equalizer(0, sessionId) }.getOrNull()
        apply()
    }
    @RequiresApi(28)
    private fun createDynamics(id: Int): DynamicsProcessing {
        val config = DynamicsProcessing.Config.Builder(DynamicsProcessing.VARIANT_FAVOR_FREQUENCY_RESOLUTION,
            2, true, 10, true, 1, false, 0, true).build()
        return DynamicsProcessing(0, id, config)
    }
    fun configure(values: FloatArray, normalize: Boolean) {
        bands = FloatArray(10) { values.getOrElse(it) { 0f }.coerceIn(-12f,12f) }
        level = normalize; apply()
    }
    private fun apply() {
        runCatching {
            if (Build.VERSION.SDK_INT >= 28 && dynamics != null) {
                applyDynamics(dynamics as DynamicsProcessing)
            } else equalizer?.let { eq ->
                val range = eq.bandLevelRange
                for (i in 0 until eq.numberOfBands.toInt()) {
                    val hz = eq.getCenterFreq(i.toShort()) / 1000f
                    val upper = frequencies.indexOfFirst { it >= hz }.let { if (it < 0) 9 else it }
                    val lower = (upper - 1).coerceAtLeast(0)
                    val fraction = if (upper == lower) 0f else
                        (ln(hz / frequencies[lower]) / ln(frequencies[upper] / frequencies[lower])).coerceIn(0f, 1f)
                    val gain = bands[lower] + (bands[upper] - bands[lower]) * fraction - headroom(bands)
                    eq.setBandLevel(i.toShort(), (gain * 100).toInt().coerceIn(range[0].toInt(),range[1].toInt()).toShort())
                }
                eq.enabled = bands.any { it != 0f }
            }
        }.onFailure { release() }
    }
    @RequiresApi(28)
    private fun applyDynamics(dp: DynamicsProcessing) {
        dp.setInputGainAllChannelsTo(-headroom(bands))
        val eq = DynamicsProcessing.Eq(true, bands.any { it != 0f }, 10)
        for (i in 0..9) eq.setBand(i, DynamicsProcessing.EqBand(true,
            if (i == 9) 22000f else frequencies[i] * 1.414214f, bands[i]))
        dp.setPreEqAllChannelsTo(eq)
        val mbc = DynamicsProcessing.Mbc(true, level, 1)
        // Compresión suave: no subir toda la señal a volumen máximo.
        mbc.setBand(0, DynamicsProcessing.MbcBand(level,22000f,5f,300f,3f,-18f,12f,
            -80f,1f,0f,0f))
        dp.setMbcAllChannelsTo(mbc)
        dp.setLimiterAllChannelsTo(DynamicsProcessing.Limiter(true,true,0,1f,60f,10f,-1f,0f))
        dp.enabled = level || bands.any { it != 0f }
    }
    fun capabilities() = JSONObject().put("equalizer", equalizer != null || dynamics != null)
        .put("leveler", dynamics != null).put("bands", if (dynamics != null) 10 else equalizer?.numberOfBands?.toInt() ?: 0)
    fun release() {
        equalizer?.release(); equalizer = null
        if (Build.VERSION.SDK_INT >= 28) (dynamics as? DynamicsProcessing)?.release()
        dynamics = null
    }
}
