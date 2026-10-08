package com.hanyer.antares

import android.net.Uri
import androidx.annotation.OptIn
import androidx.media3.common.C
import androidx.media3.common.util.UnstableApi
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.HttpDataSource
import androidx.media3.datasource.TransferListener
import java.io.EOFException
import java.io.IOException
import java.io.InterruptedIOException
import java.net.SocketTimeoutException

/** Rangos finitos; un corte de conexión no es el final de la canción. */
@OptIn(UnstableApi::class)
class ChunkedAudioDataSource(
    private val upstream: DataSource,
    private val refreshUri: ((DataSpec) -> Uri)? = null,
) : DataSource {
    private var original: DataSpec? = null
    private var position = 0L
    private var remaining = C.LENGTH_UNSET.toLong()
    private var total: Long? = null
    private var chunkRead = 0L
    private var chunkRequested = 0L
    private var recoveries = 0
    private var refreshed = false

    override fun addTransferListener(listener: TransferListener) = upstream.addTransferListener(listener)
    override fun getUri(): Uri? = upstream.uri ?: original?.uri
    override fun getResponseHeaders(): Map<String, List<String>> = upstream.responseHeaders

    override fun open(dataSpec: DataSpec): Long {
        close()
        original = dataSpec
        position = dataSpec.position
        remaining = dataSpec.length
        // La URL de YouTube incluye el tamaño aun cuando el CDN omite Content-Range.
        total = dataSpec.uri.getQueryParameter("clen")?.toLongOrNull()?.takeIf { it > 0 }
        recoveries = 0; refreshed = false
        constrainRemaining()
        try {
            openWithRecovery()
            return remaining
        } catch (error: IOException) {
            closeQuietly(); original = null
            throw error
        }
    }

    private fun constrainRemaining() {
        total?.let { size ->
            val available = (size - position).coerceAtLeast(0)
            remaining = if (remaining == C.LENGTH_UNSET.toLong()) available else minOf(remaining, available)
        }
    }

    private fun header(headers: Map<String,List<String>>, name: String): String? =
        headers.entries.firstOrNull { it.key.equals(name,true) }?.value?.firstOrNull()?.trim()

    private fun openChunk() {
        if (remaining == 0L) return
        val spec = checkNotNull(original)
        var length = CHUNK_BYTES
        if (remaining != C.LENGTH_UNSET.toLong()) length = minOf(length, remaining)
        chunkRead = 0; chunkRequested = length
        try {
            // Conserva URI, cabeceras, clave y flags; cambia únicamente el rango.
            upstream.open(spec.subrange(position - spec.position, length))
        } catch (error: HttpDataSource.InvalidResponseCodeException) {
            val size = header(error.headerFields,"Content-Range")?.substringAfterLast('/')?.toLongOrNull()
            if (error.responseCode == 416 && size == position) {
                total = size; remaining = 0
                closeQuietly(); return
            }
            throw error
        }
        val value = header(upstream.responseHeaders,"Content-Range")
        val endedAt = value?.let { END_RANGE.matchEntire(it) }?.groupValues?.get(1)?.toLongOrNull()
        if (endedAt != null && endedAt == position) {
            total = endedAt; remaining = 0; closeQuietly(); return
        }
        val range = value?.let { CONTENT_RANGE.matchEntire(it) }
        if (range != null) {
            val start = range.groupValues[1].toLongOrNull()
            val end = range.groupValues[2].toLongOrNull()
            val size = range.groupValues[3].toLongOrNull()
            if (start != position || end == null || end < position || (size != null && end >= size)) {
                throw IOException("Rango de audio no válido")
            }
            if (size != null) {
                if (total != null && total != size) throw IOException("El tamaño del audio cambió")
                total = size; constrainRemaining()
            }
            // Algunos CDN entregan un rango menor que el solicitado.
            chunkRequested = minOf(length, end - position + 1)
        }
    }

    private fun openWithRecovery() {
        while (true) {
            try { openChunk(); return } catch (error: IOException) { recover(error) }
        }
    }

    private fun recover(error: IOException) {
        closeQuietly()
        if (Thread.currentThread().isInterrupted ||
            (error is InterruptedIOException && error !is SocketTimeoutException)) throw error
        if (++recoveries > MAX_RECOVERIES) throw IOException("No se pudo continuar la descarga del audio",error)
        if (error is HttpDataSource.InvalidResponseCodeException) {
            if (error.responseCode == 403 || error.responseCode == 410) {
                if (refreshed || refreshUri == null) throw error
                refreshed = true
                val spec = checkNotNull(original)
                val renewed = refreshUri.invoke(spec)
                // No mezclar bytes de otro formato con el decodificador actual.
                val oldFormat = spec.uri.getQueryParameter("itag")
                val newFormat = renewed.getQueryParameter("itag")
                val newSize = renewed.getQueryParameter("clen")?.toLongOrNull()
                if ((oldFormat != null && oldFormat != newFormat) || (total != null && newSize != null && total != newSize)) {
                    throw IOException("El formato del audio cambió al renovar el enlace")
                }
                original = spec.withUri(renewed)
            } else if (error.responseCode !in 500..599 && error.responseCode != 408 && error.responseCode != 429) {
                throw error
            }
        }
    }

    override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
        if (length == 0) return 0
        checkNotNull(original) { "Fuente de audio cerrada" }
        while (true) {
            if (remaining == 0L) return C.RESULT_END_OF_INPUT
            if (chunkRead == chunkRequested) {
                closeQuietly(); recoveries = 0; openWithRecovery(); continue
            }
            var wanted = minOf(length.toLong(),chunkRequested - chunkRead)
            if (remaining != C.LENGTH_UNSET.toLong()) wanted = minOf(wanted,remaining)
            val count = try { upstream.read(buffer,offset,wanted.toInt()) } catch (error: IOException) {
                recover(error); openWithRecovery(); continue
            }
            if (count > 0) {
                position += count; chunkRead += count
                if (remaining != C.LENGTH_UNSET.toLong()) remaining -= count
                return count
            }
            if (count == C.RESULT_END_OF_INPUT && total == null && remaining == C.LENGTH_UNSET.toLong() && chunkRead > 0) {
                // Solo puede ser el último bloque si no hay tamaño conocido.
                remaining = 0; closeQuietly(); return C.RESULT_END_OF_INPUT
            }
            recover(EOFException("El bloque de audio se interrumpió"))
            openWithRecovery()
        }
    }

    private fun closeQuietly() { try { upstream.close() } catch (_: IOException) {} }
    override fun close() {
        try { upstream.close() } finally { original = null }
    }

    class Factory(private val http: DataSource.Factory, private val refreshUri: ((DataSpec) -> Uri)? = null) : DataSource.Factory {
        override fun createDataSource(): DataSource = ChunkedAudioDataSource(http.createDataSource(),refreshUri)
    }
    companion object {
        const val CHUNK_BYTES = 1024L * 1024L
        const val MAX_RECOVERIES = 3
        private val END_RANGE = Regex("bytes \\*/(\\d+)",RegexOption.IGNORE_CASE)
        private val CONTENT_RANGE = Regex("bytes (\\d+)-(\\d+)/(\\d+|\\*)",RegexOption.IGNORE_CASE)
    }
}
