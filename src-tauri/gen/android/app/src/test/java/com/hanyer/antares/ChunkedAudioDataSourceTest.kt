package com.hanyer.antares

import android.net.Uri
import androidx.media3.common.C
import androidx.media3.datasource.DataSource
import androidx.media3.datasource.DataSpec
import androidx.media3.datasource.TransferListener
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.ByteArrayOutputStream

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class ChunkedAudioDataSourceTest {
    private val uri = Uri.parse("https://audio.example.test/file")
    private val chunk = ChunkedAudioDataSource.CHUNK_BYTES.toInt()

    /** Simula un servidor que solo acepta rangos finitos y devuelve Content-Range. */
    private class Server(val bytes: ByteArray, val advertiseTotal: Boolean = true) : DataSource {
        val requests = mutableListOf<DataSpec>()
        private var cursor = 0
        private var end = 0
        override fun addTransferListener(listener: TransferListener) {}
        override fun getUri(): Uri? = requests.lastOrNull()?.uri
        override fun getResponseHeaders(): Map<String,List<String>> = if(advertiseTotal)
            mapOf("content-range" to listOf("bytes ${requests.last().position}-${end-1}/${bytes.size}")) else emptyMap()
        override fun open(spec: DataSpec): Long {
            // El HTTP 403 original ocurría con LENGTH_UNSET; la prueba lo rechaza.
            require(spec.length in 1..ChunkedAudioDataSource.CHUNK_BYTES)
            requests.add(spec)
            cursor=spec.position.toInt(); end=minOf(bytes.size, cursor+spec.length.toInt())
            return spec.length
        }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if(cursor == end) return C.RESULT_END_OF_INPUT
            val count=minOf(length, end-cursor)
            bytes.copyInto(buffer,offset,cursor,cursor+count); cursor+=count
            return count
        }
        override fun close() {}
    }
    private fun drain(source: DataSource): ByteArray {
        val output=ByteArrayOutputStream(); val buffer=ByteArray(8192)
        while(true) {
            val count=source.read(buffer,0,buffer.size)
            if(count == C.RESULT_END_OF_INPUT) break
            output.write(buffer,0,count)
        }
        source.close(); return output.toByteArray()
    }
    @Test fun fullSongCrossesBlocksWithoutDroppingOrRepeatingBytes() {
        val data=ByteArray(chunk*3+73) { (it % 251).toByte() }
        val server=Server(data); val source=ChunkedAudioDataSource(server)
        assertEquals(data.size.toLong(),source.open(DataSpec.Builder().setUri(uri).build()))
        assertArrayEquals(data,drain(source))
        assertEquals(listOf(0L,chunk.toLong(),chunk*2L,chunk*3L),server.requests.map { it.position })
        assertEquals(73L,server.requests.last().length)
    }
    @Test fun seekAndExplicitLengthKeepTheirOriginalRangeAndHeaders() {
        val data=ByteArray(chunk*2+100) { (it % 127).toByte() }
        val server=Server(data); val source=ChunkedAudioDataSource(server)
        val start=chunk-5
        val spec=DataSpec.Builder().setUri(uri).setPosition(start.toLong()).setLength(20)
            .setHttpRequestHeaders(mapOf("X-Test" to "kept")).build()
        assertEquals(20L,source.open(spec))
        assertArrayEquals(data.copyOfRange(start,start+20),drain(source))
        assertEquals(start.toLong(),server.requests.single().position)
        assertEquals("kept",server.requests.single().httpRequestHeaders["X-Test"])
    }
    @Test fun unknownTotalStopsAfterTheShortLastBlock() {
        val data=ByteArray(chunk+17) { (it % 199).toByte() }
        val server=Server(data,false); val source=ChunkedAudioDataSource(server)
        assertEquals(C.LENGTH_UNSET.toLong(),source.open(DataSpec.Builder().setUri(uri).build()))
        assertArrayEquals(data,drain(source)); assertEquals(2,server.requests.size)
    }
    @Test fun reopeningAfterPauseOrRetryStartsAtTheRequestedPosition() {
        val data=ByteArray(100) { it.toByte() }; val server=Server(data)
        val source=ChunkedAudioDataSource(server)
        source.open(DataSpec.Builder().setUri(uri).build())
        source.read(ByteArray(10),0,10); source.close()
        assertEquals(70L,source.open(DataSpec.Builder().setUri(uri).setPosition(30).build()))
        assertArrayEquals(data.copyOfRange(30,100),drain(source))
    }

    /** Una conexión se corta una sola vez, después de entregar audio válido. */
    private class InterruptedServer(private val server: Server, private val cutAt: Long, private val throws: Boolean) : DataSource by server {
        private var cursor = 0L
        private var interrupted = false
        override fun open(spec: DataSpec): Long { cursor=spec.position; return server.open(spec) }
        override fun read(buffer: ByteArray, offset: Int, length: Int): Int {
            if (!interrupted && cursor >= cutAt) {
                interrupted=true
                if (throws) throw java.net.SocketTimeoutException("corte simulado")
                return C.RESULT_END_OF_INPUT
            }
            val wanted=if(!interrupted) minOf(length.toLong(),cutAt-cursor).toInt() else length
            val count=server.read(buffer,offset,wanted)
            if(count>0) cursor+=count
            return count
        }
    }
    @Test fun shortResponseWithoutContentRangeMustNotEndTheSong() {
        val data=ByteArray(chunk*3+73) { (it % 251).toByte() }
        val server=Server(data,false)
        val cut=chunk+123L
        val source=ChunkedAudioDataSource(InterruptedServer(server,cut,false))
        source.open(DataSpec.Builder().setUri(uri.buildUpon().appendQueryParameter("clen",data.size.toString()).build()).build())
        assertArrayEquals(data,drain(source))
        assertTrue(server.requests.any { it.position == cut })
    }
    @Test fun timeoutResumesFromTheLastByteWithoutRestartingTheSong() {
        val data=ByteArray(chunk*3+73) { (it % 251).toByte() }
        val server=Server(data); val cut=chunk+123L
        val source=ChunkedAudioDataSource(InterruptedServer(server,cut,true))
        source.open(DataSpec.Builder().setUri(uri).build())
        assertArrayEquals(data,drain(source))
        assertTrue(server.requests.any { it.position == cut })
    }

    private class ExpiringServer(private val server: Server, private val rejectNew: Boolean = false) : DataSource by server {
        val attempted = mutableListOf<DataSpec>()
        override fun open(spec: DataSpec): Long {
            attempted.add(spec)
            if (spec.position >= ChunkedAudioDataSource.CHUNK_BYTES && (rejectNew || spec.uri.getQueryParameter("token") == "old")) {
                throw androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException(403,"Forbidden",null,emptyMap(),spec,byteArrayOf())
            }
            return server.open(spec)
        }
    }
    @Test fun expiredUrlRenewsTheSameTrackAndKeepsItsBytePosition() {
        val data=ByteArray(chunk*3+73) { (it % 251).toByte() }
        val server=ExpiringServer(Server(data))
        val old=uri.buildUpon().appendQueryParameter("itag","140").appendQueryParameter("clen",data.size.toString()).appendQueryParameter("token","old").build()
        var renewed=0
        val source=ChunkedAudioDataSource(server) { spec ->
            assertEquals("XFkzRNyygfk",spec.key);renewed++
            old.buildUpon().clearQuery().appendQueryParameter("itag","140").appendQueryParameter("clen",data.size.toString()).appendQueryParameter("token","new").build()
        }
        source.open(DataSpec.Builder().setUri(old).setKey("XFkzRNyygfk").setHttpRequestHeaders(mapOf("X-Test" to "kept")).build())
        assertArrayEquals(data,drain(source));assertEquals(1,renewed)
        val request=server.attempted.first { it.uri.getQueryParameter("token") == "new" }
        assertEquals(chunk.toLong(),request.position);assertEquals("kept",request.httpRequestHeaders["X-Test"])
    }
    @Test fun renewalNeverSplicesAChangedFormatIntoTheCurrentStream() {
        val data=ByteArray(chunk*2);val server=ExpiringServer(Server(data))
        val old=uri.buildUpon().appendQueryParameter("itag","140").appendQueryParameter("token","old").build()
        val source=ChunkedAudioDataSource(server) { uri.buildUpon().appendQueryParameter("itag","251").build() }
        source.open(DataSpec.Builder().setUri(old).build())
        assertThrows(java.io.IOException::class.java) { drain(source) }
        assertFalse(server.attempted.any { it.uri.getQueryParameter("itag") == "251" });source.close()
    }
    @Test fun repeatedForbiddenResponsesRenewOnlyOnce() {
        val data=ByteArray(chunk*2);val server=ExpiringServer(Server(data),true)
        val old=uri.buildUpon().appendQueryParameter("itag","140").appendQueryParameter("token","old").build()
        var renewed=0
        val source=ChunkedAudioDataSource(server) { renewed++; uri.buildUpon().appendQueryParameter("itag","140").appendQueryParameter("token","new").build() }
        source.open(DataSpec.Builder().setUri(old).build())
        assertThrows(java.io.IOException::class.java) { drain(source) }
        assertEquals(1,renewed);assertEquals(3,server.attempted.size);source.close()
    }
    @Test fun emptyResponsesAreBoundedErrorsRatherThanAFalseEndOfSong() {
        val server=Server(ByteArray(100),false)
        val empty=object : DataSource by server {
            override fun read(buffer: ByteArray, offset: Int, length: Int)=C.RESULT_END_OF_INPUT
        }
        val source=ChunkedAudioDataSource(empty)
        source.open(DataSpec.Builder().setUri(uri.buildUpon().appendQueryParameter("clen","100").build()).build())
        assertThrows(java.io.IOException::class.java) { source.read(ByteArray(10),0,10) }
        assertEquals(ChunkedAudioDataSource.MAX_RECOVERIES+1,server.requests.size);source.close()
    }
    @Test fun anInterruptedLoadDoesNotReconnectAfterCancellation() {
        val server=Server(ByteArray(100))
        val cancelled=object : DataSource by server {
            override fun read(buffer: ByteArray, offset: Int, length: Int): Int { throw java.io.InterruptedIOException("cancelado") }
        }
        val source=ChunkedAudioDataSource(cancelled);source.open(DataSpec.Builder().setUri(uri).build())
        assertThrows(java.io.InterruptedIOException::class.java) { source.read(ByteArray(10),0,10) }
        assertEquals(1,server.requests.size);source.close()
    }
    @Test fun exactEndWithUnknownLengthAcceptsTheServers416Size() {
        val data=ByteArray(chunk);val server=Server(data,false)
        val ranges=object : DataSource by server {
            override fun open(spec: DataSpec): Long {
                if(spec.position == data.size.toLong()) {
                    throw androidx.media3.datasource.HttpDataSource.InvalidResponseCodeException(416,"End",null,mapOf("Content-Range" to listOf("bytes */${data.size}")),spec,byteArrayOf())
                }
                return server.open(spec)
            }
        }
        val source=ChunkedAudioDataSource(ranges);source.open(DataSpec.Builder().setUri(uri).build())
        assertArrayEquals(data,drain(source))
    }
    @Test fun realHttpConnectionClosingMidBodyResumesWithoutMissingAudioBytes() {
        val data=ByteArray(chunk*3+73) { (it % 251).toByte() }
        val server=java.net.ServerSocket(0,4,java.net.InetAddress.getLoopbackAddress())
        val positions=java.util.Collections.synchronizedList(mutableListOf<Long>())
        var failure: Throwable?=null
        val worker=kotlin.concurrent.thread(name="audio-http-test",isDaemon=true) {
            try {
                while(!server.isClosed) server.accept().use { client ->
                    client.soTimeout=3000
                    val reader=client.getInputStream().bufferedReader()
                    var range=""
                    while(true) { val line=reader.readLine() ?: break; if(line.isEmpty())break; if(line.startsWith("Range:",true))range=line.substringAfter(':').trim() }
                    val match=Regex("bytes=(\\d+)-(\\d+)").matchEntire(range) ?: error("El rango debe ser finito")
                    val start=match.groupValues[1].toInt();val end=minOf(match.groupValues[2].toInt(),data.size-1)
                    positions.add(start.toLong())
                    val output=client.getOutputStream()
                    val headers="HTTP/1.1 206 Partial Content\r\nContent-Type: audio/mp4\r\nContent-Length: ${end-start+1}\r\nContent-Range: bytes $start-$end/${data.size}\r\nConnection: close\r\n\r\n"
                    output.write(headers.toByteArray(Charsets.US_ASCII))
                    val length=if(start == chunk) 123 else end-start+1
                    output.write(data,start,length);output.flush()
                }
            } catch (error: java.net.SocketException) { if(!server.isClosed)failure=error }
              catch (error: Throwable) { failure=error }
        }
        val http=androidx.media3.datasource.DefaultHttpDataSource.Factory().setConnectTimeoutMs(3000).setReadTimeoutMs(3000).createDataSource()
        val source=ChunkedAudioDataSource(http)
        try {
            source.open(DataSpec.Builder().setUri("http://127.0.0.1:${server.localPort}/audio?clen=${data.size}").build())
            assertArrayEquals(data,drain(source));assertTrue(positions.contains(chunk+123L))
        } finally { source.close();server.close();worker.join(3000) }
        failure?.let { throw AssertionError("Servidor local de audio",it) }
    }

    /** URLs de una extracción reciente en un archivo local; nunca se registran ni se suben. */
    @Test fun liveYouTubeReadsEveryByteAndSeeksBeyondTheReportedCut() {
        val fixtures=System.getenv("ANTARES_LIVE_FIXTURES")
        org.junit.Assume.assumeTrue("Prueba opcional contra YouTube",fixtures != null)
        val tracks=java.io.File(checkNotNull(fixtures)).readLines().filter { it.isNotBlank() }
        assertTrue("Se requieren Esclava y al menos otras dos canciones",tracks.size >= 3)
        for (line in tracks) {
            val track=org.json.JSONObject(line)
            val http=androidx.media3.datasource.DefaultHttpDataSource.Factory()
                .setUserAgent(PlaybackService.USER_AGENT).setConnectTimeoutMs(15000).setReadTimeoutMs(15000)
            val source=ChunkedAudioDataSource(http.createDataSource())
            val spec=DataSpec.Builder().setUri(track.getString("url")).setKey(track.getString("id")).build()
            val size=track.getLong("size")
            try {
                assertEquals(size,source.open(spec))
                var read=0L;var checksum=0L;val buffer=ByteArray(8192)
                while(true) {
                    val count=source.read(buffer,0,buffer.size)
                    if(count == C.RESULT_END_OF_INPUT)break
                    for(i in 0 until count)checksum=checksum*31+(buffer[i].toInt() and 255)
                    read+=count
                }
                assertEquals("Tamaño completo para ${track.getString("id")}",size,read)
                assertEquals(track.getString("checksum"),java.lang.Long.toUnsignedString(checksum,16).padStart(16,'0'))
                source.close()
                // 3 MiB está después de 2:41 en el AAC de Esclava; validar seek real y final.
                val start=minOf(3L*chunk,size-100)
                assertEquals(size-start,source.open(spec.subrange(start)))
                var tail=0L
                while(true) { val count=source.read(buffer,0,buffer.size);if(count == C.RESULT_END_OF_INPUT)break;tail+=count }
                assertEquals(size-start,tail)
            } finally { source.close() }
        }
    }
}
