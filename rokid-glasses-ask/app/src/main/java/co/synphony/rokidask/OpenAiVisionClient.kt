package co.synphony.rokidask

import android.util.Base64
import android.util.Log
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/**
 * Minimal OpenAI Chat Completions client for one image plus one instruction.
 *
 * Chat Completions is used rather than the Responses API because its image payload
 * shape (`image_url` with a base64 data URL) has been stable across many model
 * generations, which matters for an app that is awkward to rebuild and reinstall.
 *
 * Works against any OpenAI-compatible base URL, so OpenRouter or a local proxy can be
 * substituted without code changes.
 */
class OpenAiVisionClient {

    companion object {
        private const val TAG = "RokidAsk/OpenAI"

        private const val CONNECT_TIMEOUT_MS = 15_000
        private const val READ_TIMEOUT_MS = 60_000

        /** Request parameters that may be dropped and retried if the API rejects them. */
        private val OPTIONAL_PARAMS = listOf("reasoning_effort", "max_completion_tokens", "detail")

        private const val SYSTEM_PROMPT =
            "You are a heads-up display assistant on smart glasses. The wearer sends a photo " +
                "taken from their point of view. Answer in plain text only: no markdown, no " +
                "bullet points, no preamble, no restating the question. Use at most two short " +
                "sentences and stay under 200 characters. If the photo is too blurry or dark " +
                "to tell, say so in one short sentence."
    }

    data class Answer(
        val text: String?,
        val error: String?,
        val elapsedMs: Long,
        val model: String
    ) {
        val isSuccess: Boolean get() = !text.isNullOrBlank()
    }

    /**
     * Blocking call. Must run off the main thread.
     *
     * On an HTTP 400 that names one of [OPTIONAL_PARAMS], that parameter is dropped and
     * the request retried, so a model that rejects (say) `reasoning_effort` still works
     * without the wearer having to change anything.
     */
    fun ask(config: AppConfig, jpeg: ByteArray, instruction: String): Answer {
        val startedAt = System.currentTimeMillis()
        val model = config.model
        val dropped = mutableSetOf<String>()

        repeat(OPTIONAL_PARAMS.size + 1) {
            val body = buildRequestBody(config, jpeg, instruction, dropped)
            val response = post(config, body)

            when {
                response.isSuccess -> {
                    val parsed = parseAnswer(response.body)
                    return Answer(
                        text = parsed.first,
                        error = parsed.second,
                        elapsedMs = System.currentTimeMillis() - startedAt,
                        model = model
                    )
                }

                response.status == 400 -> {
                    val offending = OPTIONAL_PARAMS.firstOrNull { param ->
                        param !in dropped && response.body.contains(param, ignoreCase = true)
                    }
                    if (offending == null) {
                        return Answer(
                            null,
                            describeHttpError(response),
                            System.currentTimeMillis() - startedAt,
                            model
                        )
                    }
                    Log.w(TAG, "API rejected '$offending'; retrying without it")
                    dropped += offending
                }

                else -> return Answer(
                    null,
                    describeHttpError(response),
                    System.currentTimeMillis() - startedAt,
                    model
                )
            }
        }

        return Answer(
            null,
            "API rejected every supported request shape.",
            System.currentTimeMillis() - startedAt,
            model
        )
    }

    private fun buildRequestBody(
        config: AppConfig,
        jpeg: ByteArray,
        instruction: String,
        dropped: Set<String>
    ): String {
        val dataUrl = "data:image/jpeg;base64," +
            Base64.encodeToString(jpeg, Base64.NO_WRAP)

        val imageUrl = JSONObject().put("url", dataUrl)
        if ("detail" !in dropped) {
            imageUrl.put("detail", config.imageDetail)
        }

        val userContent = JSONArray()
            .put(JSONObject().put("type", "text").put("text", instruction))
            .put(JSONObject().put("type", "image_url").put("image_url", imageUrl))

        val messages = JSONArray()
            .put(JSONObject().put("role", "system").put("content", SYSTEM_PROMPT))
            .put(JSONObject().put("role", "user").put("content", userContent))

        val body = JSONObject()
            .put("model", config.model)
            .put("messages", messages)

        if ("max_completion_tokens" !in dropped) {
            body.put("max_completion_tokens", config.maxCompletionTokens)
        } else {
            // Older deployments only accept the legacy field name.
            body.put("max_tokens", config.maxCompletionTokens)
        }

        val effort = config.reasoningEffort
        if (effort.isNotBlank() && "reasoning_effort" !in dropped) {
            body.put("reasoning_effort", effort)
        }

        return body.toString()
    }

    private data class HttpResponse(val status: Int, val body: String, val transportError: String?) {
        val isSuccess: Boolean get() = transportError == null && status in 200..299
    }

    private fun post(config: AppConfig, body: String): HttpResponse {
        val url = URL("${config.baseUrl}/chat/completions")
        var connection: HttpURLConnection? = null
        return try {
            connection = (url.openConnection() as HttpURLConnection).apply {
                requestMethod = "POST"
                connectTimeout = CONNECT_TIMEOUT_MS
                readTimeout = READ_TIMEOUT_MS
                doOutput = true
                setRequestProperty("Content-Type", "application/json; charset=utf-8")
                setRequestProperty("Authorization", "Bearer ${config.apiKey}")
                setRequestProperty("Accept", "application/json")
            }
            connection.outputStream.use { it.write(body.toByteArray(Charsets.UTF_8)) }

            val status = connection.responseCode
            val stream = if (status in 200..299) connection.inputStream else connection.errorStream
            val text = stream?.bufferedReader()?.use { it.readText() }.orEmpty()
            HttpResponse(status, text, null)
        } catch (e: IOException) {
            Log.e(TAG, "Request failed", e)
            HttpResponse(0, "", e.message ?: e.javaClass.simpleName)
        } finally {
            connection?.disconnect()
        }
    }

    /** Returns answer text, or an error string describing why there is none. */
    private fun parseAnswer(responseBody: String): Pair<String?, String?> {
        val json = runCatching { JSONObject(responseBody) }.getOrNull()
            ?: return null to "Unreadable API response."

        json.optJSONObject("error")?.let { error ->
            return null to (error.optString("message").ifBlank { "API returned an error." })
        }

        val choice = json.optJSONArray("choices")?.optJSONObject(0)
            ?: return null to "API response had no choices."

        val content = choice.optJSONObject("message")?.optString("content").orEmpty().trim()
        if (content.isNotBlank()) return content to null

        // A reasoning model can spend the whole token budget before emitting an answer.
        val finishReason = choice.optString("finish_reason").ifBlank { "unknown" }
        return null to if (finishReason == "length") {
            "Model hit the token limit before answering. Raise max_completion_tokens or " +
                "lower reasoning_effort."
        } else {
            "Model returned no text (finish_reason=$finishReason)."
        }
    }

    private fun describeHttpError(response: HttpResponse): String {
        response.transportError?.let { return "Network error: $it" }

        val apiMessage = runCatching {
            JSONObject(response.body).optJSONObject("error")?.optString("message")
        }.getOrNull().orEmpty()

        val detail = apiMessage.ifBlank { response.body.take(300) }
        val hint = when (response.status) {
            401 -> "\n\nCheck the API key."
            404 -> "\n\nCheck the model name and base URL."
            429 -> "\n\nRate limited or out of quota."
            in 500..599 -> "\n\nAPI server error; try again."
            else -> ""
        }
        return "HTTP ${response.status}: $detail$hint"
    }
}
