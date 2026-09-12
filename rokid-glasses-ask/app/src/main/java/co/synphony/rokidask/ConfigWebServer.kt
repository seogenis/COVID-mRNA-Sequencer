package co.synphony.rokidask

import android.util.Log
import java.io.BufferedReader
import java.io.IOException
import java.io.InputStreamReader
import java.io.OutputStream
import java.net.InetSocketAddress
import java.net.ServerSocket
import java.net.Socket
import java.net.URLDecoder
import kotlin.concurrent.thread
import kotlin.random.Random

/**
 * A tiny HTTP server so the API key can be pasted from a phone or laptop browser on the
 * same Wi-Fi. This is the no-cable path: the glasses have no keyboard, and retyping a key
 * through adb requires a computer.
 *
 * Deliberately small: no dependencies, one request at a time, only two routes. It is off
 * by default, started from the Settings screen, and guarded by a one-time PIN shown on
 * the HUD so that being on the same network is not enough to write config.
 */
class ConfigWebServer(private val config: AppConfig) {

    companion object {
        private const val TAG = "RokidAsk/ConfigWeb"
        const val PORT = 8711
        private const val MAX_REQUEST_BYTES = 64 * 1024
    }

    @Volatile
    private var serverSocket: ServerSocket? = null

    /** Shown on the HUD and required by the form. Regenerated on every start. */
    var pin: String = ""
        private set

    val isRunning: Boolean
        get() = serverSocket != null

    fun start(): Boolean {
        if (isRunning) return true
        pin = Random.nextInt(100_000, 1_000_000).toString()
        return try {
            val socket = ServerSocket().apply {
                reuseAddress = true
                bind(InetSocketAddress(PORT))
            }
            serverSocket = socket
            thread(name = "rokid-ask-config", isDaemon = true) { acceptLoop(socket) }
            true
        } catch (e: IOException) {
            Log.e(TAG, "Could not start config server", e)
            serverSocket = null
            false
        }
    }

    fun stop() {
        val socket = serverSocket ?: return
        serverSocket = null
        runCatching { socket.close() }
    }

    private fun acceptLoop(socket: ServerSocket) {
        while (serverSocket === socket && !socket.isClosed) {
            val client = try {
                socket.accept()
            } catch (e: IOException) {
                if (serverSocket === socket) Log.w(TAG, "Accept failed", e)
                return
            }
            runCatching { handle(client) }
                .onFailure { Log.w(TAG, "Request failed", it) }
            runCatching { client.close() }
        }
    }

    private fun handle(client: Socket) {
        client.soTimeout = 10_000
        val reader = BufferedReader(InputStreamReader(client.getInputStream(), Charsets.UTF_8))

        val requestLine = reader.readLine() ?: return
        val parts = requestLine.split(' ')
        if (parts.size < 2) return
        val method = parts[0]
        val path = parts[1]

        var contentLength = 0
        while (true) {
            val header = reader.readLine() ?: break
            if (header.isEmpty()) break
            val lower = header.lowercase()
            if (lower.startsWith("content-length:")) {
                contentLength = header.substringAfter(':').trim().toIntOrNull() ?: 0
            }
        }

        when {
            method == "GET" && (path == "/" || path.startsWith("/?")) ->
                respondHtml(client.getOutputStream(), page(null))

            method == "POST" && path == "/save" -> {
                if (contentLength !in 1..MAX_REQUEST_BYTES) {
                    respondHtml(client.getOutputStream(), page("Request too large."))
                    return
                }
                val raw = CharArray(contentLength)
                var read = 0
                while (read < contentLength) {
                    val count = reader.read(raw, read, contentLength - read)
                    if (count <= 0) break
                    read += count
                }
                val message = applyForm(parseForm(String(raw, 0, read)))
                respondHtml(client.getOutputStream(), page(message))
            }

            else -> respondHtml(client.getOutputStream(), page(null), status = "404 Not Found")
        }
    }

    private fun applyForm(fields: Map<String, String>): String {
        if (fields["pin"]?.trim() != pin) return "Wrong PIN. Check the glasses display."

        val applied = mutableListOf<String>()
        fields["api_key"]?.trim()?.takeIf { it.isNotEmpty() }?.let {
            config.apiKey = it
            applied += "API key"
        }
        fields["model"]?.trim()?.takeIf { it.isNotEmpty() }?.let {
            config.model = it
            applied += "model"
        }
        fields["base_url"]?.trim()?.takeIf { it.isNotEmpty() }?.let {
            config.baseUrl = it
            applied += "base URL"
        }
        fields["custom_prompt"]?.trim()?.let {
            config.customPrompt = it
            if (it.isNotEmpty()) applied += "custom prompt"
        }

        return if (applied.isEmpty()) {
            "Nothing to save."
        } else {
            "Saved ${applied.joinToString()}. You can close this page."
        }
    }

    private fun parseForm(body: String): Map<String, String> =
        body.split('&')
            .mapNotNull { pair ->
                if (pair.isBlank()) return@mapNotNull null
                val name = pair.substringBefore('=')
                val value = pair.substringAfter('=', "")
                runCatching {
                    URLDecoder.decode(name, "UTF-8") to URLDecoder.decode(value, "UTF-8")
                }.getOrNull()
            }
            .toMap()

    private fun respondHtml(output: OutputStream, html: String, status: String = "200 OK") {
        val bytes = html.toByteArray(Charsets.UTF_8)
        val header = buildString {
            append("HTTP/1.1 $status\r\n")
            append("Content-Type: text/html; charset=utf-8\r\n")
            append("Content-Length: ${bytes.size}\r\n")
            append("Cache-Control: no-store\r\n")
            append("Connection: close\r\n\r\n")
        }
        output.write(header.toByteArray(Charsets.US_ASCII))
        output.write(bytes)
        output.flush()
    }

    /** The stored key is never echoed back into the page, only whether one is present. */
    private fun page(message: String?): String {
        val banner = message?.let { "<p class=\"msg\">${escape(it)}</p>" } ?: ""
        return """
            <!doctype html>
            <html><head><meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <title>Rokid Ask setup</title>
            <style>
              body { font: 16px -apple-system, system-ui, sans-serif; margin: 0; padding: 24px;
                     background: #111; color: #eee; }
              h1 { font-size: 20px; margin: 0 0 4px; }
              p.sub { color: #999; margin: 0 0 20px; font-size: 14px; }
              label { display: block; margin: 16px 0 4px; font-size: 14px; color: #bbb; }
              input { width: 100%; box-sizing: border-box; padding: 12px; font-size: 16px;
                      border: 1px solid #444; border-radius: 8px; background: #1c1c1c;
                      color: #eee; }
              button { margin-top: 20px; width: 100%; padding: 14px; font-size: 16px;
                       border: 0; border-radius: 8px; background: #2f7d32; color: #fff; }
              p.msg { padding: 12px; background: #23341f; border-radius: 8px; font-size: 14px; }
              code { color: #9c9; }
            </style></head>
            <body>
              <h1>Rokid Ask setup</h1>
              <p class="sub">Current key: <code>${escape(config.maskedApiKey())}</code><br>
                 Model: <code>${escape(config.model)}</code></p>
              $banner
              <form method="POST" action="/save">
                <label>PIN shown on the glasses</label>
                <input name="pin" inputmode="numeric" autocomplete="off" required>
                <label>OpenAI API key</label>
                <input name="api_key" type="password" autocomplete="off"
                       placeholder="leave blank to keep current">
                <label>Model</label>
                <input name="model" autocomplete="off" value="${escape(config.model)}">
                <label>Base URL</label>
                <input name="base_url" autocomplete="off" value="${escape(config.baseUrl)}">
                <label>Custom prompt (optional)</label>
                <input name="custom_prompt" autocomplete="off"
                       value="${escape(config.customPrompt)}">
                <button type="submit">Save</button>
              </form>
            </body></html>
        """.trimIndent()
    }

    private fun escape(value: String): String = value
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace("\"", "&quot;")
}
