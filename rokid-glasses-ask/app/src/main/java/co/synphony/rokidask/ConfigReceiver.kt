package co.synphony.rokidask

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Sets configuration from a computer over adb, so nothing has to be typed on the glasses:
 *
 *   adb shell am broadcast -n co.synphony.rokidask/.ConfigReceiver \
 *     -a co.synphony.rokidask.SET_CONFIG --es api_key sk-...
 *
 * Accepted extras: api_key, model, base_url, reasoning_effort, image_detail,
 * custom_prompt, max_completion_tokens.
 *
 * This receiver only writes; it never returns a stored value, so a key cannot be read
 * back out through it.
 */
class ConfigReceiver : BroadcastReceiver() {

    companion object {
        private const val TAG = "RokidAsk/Config"
        const val ACTION_SET_CONFIG = "co.synphony.rokidask.SET_CONFIG"
    }

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_SET_CONFIG) return

        val config = AppConfig(context)
        val applied = mutableListOf<String>()

        intent.getStringExtra("api_key")?.let {
            config.apiKey = it
            applied += "api_key"
        }
        intent.getStringExtra("model")?.let {
            config.model = it
            // Keep the on-device model cycle in sync with an explicitly set model.
            val presetIndex = AppConfig.MODEL_PRESETS.indexOf(it.trim())
            if (presetIndex >= 0) config.modelIndex = presetIndex
            applied += "model"
        }
        intent.getStringExtra("base_url")?.let {
            config.baseUrl = it
            applied += "base_url"
        }
        intent.getStringExtra("reasoning_effort")?.let {
            config.reasoningEffort = it
            applied += "reasoning_effort"
        }
        intent.getStringExtra("image_detail")?.let {
            config.imageDetail = it
            applied += "image_detail"
        }
        intent.getStringExtra("custom_prompt")?.let {
            config.customPrompt = it
            applied += "custom_prompt"
        }
        intent.getStringExtra("max_completion_tokens")?.toIntOrNull()?.let {
            config.maxCompletionTokens = it
            applied += "max_completion_tokens"
        }

        // Deliberately logs field names only, never values.
        Log.i(TAG, "Applied config: ${applied.joinToString().ifEmpty { "nothing" }}")
    }
}
