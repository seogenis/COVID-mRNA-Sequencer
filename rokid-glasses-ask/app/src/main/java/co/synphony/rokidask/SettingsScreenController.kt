package co.synphony.rokidask

import android.view.View
import android.widget.TextView

/**
 * Read-mostly status screen. Everything here can be changed without a keyboard:
 * tap toggles the browser config page, swipe cycles the model presets.
 */
internal class SettingsScreenController(
    panelView: View,
    private val config: AppConfig,
    private val configServer: ConfigWebServer
) : ViewScreenController(ScreenId.SETTINGS, panelView) {

    private val textView: TextView = panelView.findViewById(R.id.settingsTextView)

    private var lastActionMessage: String? = null

    override fun render() {
        val ip = NetworkInfo.localIpv4Address()
        val online = NetworkInfo.isOnline(panelView.context)

        textView.text = buildString {
            appendLine("API key")
            appendLine("  ${config.maskedApiKey()}")
            appendLine()
            appendLine("Model")
            appendLine("  ${config.model}")
            appendLine()
            appendLine("Endpoint")
            appendLine("  ${config.baseUrl}")
            appendLine()
            appendLine("Network")
            appendLine("  ${if (online) "online" else "OFFLINE — join Wi-Fi"}")
            appendLine("  ip ${ip ?: "none"}")
            appendLine()
            if (configServer.isRunning) {
                appendLine("CONFIG PAGE IS ON")
                appendLine("  Open on your phone:")
                appendLine("  http://${ip ?: "?"}:${ConfigWebServer.PORT}")
                appendLine("  PIN ${configServer.pin}")
            } else {
                appendLine("Config page: off")
                appendLine("  Tap to start it, then open")
                appendLine("  the URL on your phone to")
                appendLine("  paste an API key.")
            }
            lastActionMessage?.let {
                appendLine()
                appendLine(it)
            }
        }
    }

    override fun handleAction(action: NavigationAction): ScreenCommand = when (action) {
        NavigationAction.SELECT -> {
            if (configServer.isRunning) {
                configServer.stop()
                lastActionMessage = "Config page stopped."
            } else {
                lastActionMessage = if (configServer.start()) {
                    null
                } else {
                    "Could not open port ${ConfigWebServer.PORT}."
                }
            }
            ScreenCommand.Stay
        }

        NavigationAction.NEXT -> {
            cycleModel(1)
            ScreenCommand.Stay
        }

        NavigationAction.PREVIOUS -> {
            cycleModel(-1)
            ScreenCommand.Stay
        }

        NavigationAction.BACK -> ScreenCommand.Open(ScreenId.CAPTURE)
    }

    override fun navigationHint(): String =
        panelView.context.getString(R.string.nav_settings)

    override fun onExit() {
        lastActionMessage = null
    }

    private fun cycleModel(delta: Int) {
        val presets = AppConfig.MODEL_PRESETS
        // Start from whichever preset matches the stored model, so a model set over adb
        // or the config page is the starting point rather than a stale index.
        val current = presets.indexOf(config.model).takeIf { it >= 0 } ?: config.modelIndex
        val next = ((current + delta) % presets.size + presets.size) % presets.size
        config.modelIndex = next
        config.model = presets[next]
        lastActionMessage = null
    }
}
