package co.synphony.rokidask

import android.content.Context

/**
 * Everything the app needs to reach an OpenAI-compatible API, persisted in app-private
 * SharedPreferences.
 *
 * The glasses have no keyboard, so values are set from outside the app:
 *   - over adb, via [ConfigReceiver]
 *   - from a phone browser, via [ConfigWebServer]
 * Nothing here is readable by other apps, but it is stored in the clear. Treat the
 * glasses like a logged-in device and use a key you can rotate.
 */
class AppConfig(context: Context) {

    companion object {
        private const val PREFS_NAME = "rokid_ask"

        private const val KEY_API_KEY = "api_key"
        private const val KEY_BASE_URL = "base_url"
        private const val KEY_MODEL = "model"
        private const val KEY_REASONING_EFFORT = "reasoning_effort"
        private const val KEY_MAX_TOKENS = "max_completion_tokens"
        private const val KEY_IMAGE_DETAIL = "image_detail"
        private const val KEY_CUSTOM_PROMPT = "custom_prompt"
        private const val KEY_PROMPT_INDEX = "prompt_index"
        private const val KEY_MODEL_INDEX = "model_index"

        const val DEFAULT_BASE_URL = "https://api.openai.com/v1"

        /**
         * Model IDs that accept image input on the Chat Completions endpoint, cheapest
         * first. Verified against the LiteLLM model registry in September 2026. If
         * OpenAI retires one, set a different model with tools/set-key.sh --model or the
         * config page; nothing here is hardcoded into the request path.
         */
        val MODEL_PRESETS = listOf(
            "gpt-5.6-luna",
            "gpt-5-nano",
            "gpt-4o-mini",
            "gpt-5.4-mini"
        )

        const val DEFAULT_MODEL = "gpt-5.6-luna"

        /** "low" keeps latency down on reasoning models. Empty string omits the field. */
        const val DEFAULT_REASONING_EFFORT = "low"

        /**
         * Generous enough that reasoning tokens cannot starve the visible answer; the
         * system prompt, not this limit, is what keeps answers short.
         */
        const val DEFAULT_MAX_TOKENS = 800

        const val DEFAULT_IMAGE_DETAIL = "auto"
    }

    private val prefs = context.applicationContext
        .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)

    var apiKey: String
        get() = prefs.getString(KEY_API_KEY, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_API_KEY, value.trim()).apply()

    var baseUrl: String
        get() = prefs.getString(KEY_BASE_URL, DEFAULT_BASE_URL).orEmpty()
            .ifBlank { DEFAULT_BASE_URL }
            .trimEnd('/')
        set(value) = prefs.edit().putString(KEY_BASE_URL, value.trim()).apply()

    var model: String
        get() = prefs.getString(KEY_MODEL, DEFAULT_MODEL).orEmpty().ifBlank { DEFAULT_MODEL }
        set(value) = prefs.edit().putString(KEY_MODEL, value.trim()).apply()

    var reasoningEffort: String
        get() = prefs.getString(KEY_REASONING_EFFORT, DEFAULT_REASONING_EFFORT).orEmpty()
        set(value) = prefs.edit().putString(KEY_REASONING_EFFORT, value.trim()).apply()

    var maxCompletionTokens: Int
        get() = prefs.getInt(KEY_MAX_TOKENS, DEFAULT_MAX_TOKENS)
        set(value) = prefs.edit().putInt(KEY_MAX_TOKENS, value).apply()

    var imageDetail: String
        get() = prefs.getString(KEY_IMAGE_DETAIL, DEFAULT_IMAGE_DETAIL).orEmpty()
            .ifBlank { DEFAULT_IMAGE_DETAIL }
        set(value) = prefs.edit().putString(KEY_IMAGE_DETAIL, value.trim()).apply()

    /** Optional extra prompt, appended to the preset list when set. */
    var customPrompt: String
        get() = prefs.getString(KEY_CUSTOM_PROMPT, "").orEmpty()
        set(value) = prefs.edit().putString(KEY_CUSTOM_PROMPT, value.trim()).apply()

    var promptIndex: Int
        get() = prefs.getInt(KEY_PROMPT_INDEX, 0)
        set(value) = prefs.edit().putInt(KEY_PROMPT_INDEX, value).apply()

    var modelIndex: Int
        get() = prefs.getInt(KEY_MODEL_INDEX, 0)
        set(value) = prefs.edit().putInt(KEY_MODEL_INDEX, value).apply()

    val hasApiKey: Boolean
        get() = apiKey.isNotBlank()

    /** Safe to show on the HUD: enough to tell which key is loaded, not enough to use. */
    fun maskedApiKey(): String {
        val key = apiKey
        if (key.isBlank()) return "not set"
        if (key.length <= 10) return "set (${key.length} chars)"
        return key.take(6) + "…" + key.takeLast(4)
    }

    /** Prompt presets available on device, including the custom one if configured. */
    fun prompts(): List<Prompt> {
        val custom = customPrompt
        return if (custom.isBlank()) Prompt.PRESETS else Prompt.PRESETS + Prompt("Custom", custom)
    }

    fun currentPrompt(): Prompt {
        val all = prompts()
        return all[promptIndex.coerceIn(0, all.lastIndex)]
    }
}

/** A HUD-labelled instruction sent to the model alongside the photo. */
data class Prompt(val label: String, val text: String) {
    companion object {
        val PRESETS = listOf(
            Prompt("What is this?", "What is this? Identify the main subject."),
            Prompt("Read text", "Read the text in this image and return it verbatim. If there is a lot, return only the most important lines."),
            Prompt("Translate", "Translate any text in this image into English. Return only the translation."),
            Prompt("Describe", "Describe this scene."),
            Prompt("Explain", "Explain what I am looking at and why it matters."),
            Prompt("How do I use it?", "What is this and how do I use it? Give the single most useful step.")
        )
    }
}
