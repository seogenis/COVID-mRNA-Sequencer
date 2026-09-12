package co.synphony.rokidask

import android.view.View
import android.widget.TextView
import androidx.camera.view.PreviewView

/**
 * Root screen: live viewfinder, the prompt that will be sent, and a status line.
 *
 * Tap captures. Swipe changes the prompt, which keeps the common case one tap away
 * instead of behind a menu. Swiping backward from the first prompt opens Settings, and
 * double-tap on this screen is the only way out of the app, so it asks for confirmation.
 */
internal class CaptureScreenController(
    panelView: View,
    private val config: AppConfig,
    private val camera: CameraController,
    private val hasCameraPermission: () -> Boolean,
    private val onCaptureRequested: () -> Unit
) : ViewScreenController(ScreenId.CAPTURE, panelView) {

    private val previewView: PreviewView = panelView.findViewById(R.id.cameraPreviewView)
    private val promptView: TextView = panelView.findViewById(R.id.capturePromptView)
    private val statusView: TextView = panelView.findViewById(R.id.captureStatusView)

    private var isEntered = false
    private var quitConfirmationArmed = false
    private var statusOverride: String? = null

    override fun render() {
        promptView.text = config.currentPrompt().label
        statusView.text = statusOverride ?: defaultStatus()
    }

    /** Transient status such as "Capturing…"; cleared when the screen is re-entered. */
    fun setStatus(status: String?) {
        statusOverride = status
        render()
    }

    override fun handleAction(action: NavigationAction): ScreenCommand {
        if (action != NavigationAction.BACK) quitConfirmationArmed = false

        return when (action) {
            NavigationAction.SELECT -> {
                onCaptureRequested()
                ScreenCommand.Stay
            }

            NavigationAction.NEXT -> {
                val prompts = config.prompts()
                config.promptIndex = (config.promptIndex + 1) % prompts.size
                ScreenCommand.Stay
            }

            NavigationAction.PREVIOUS -> {
                if (config.promptIndex == 0) {
                    ScreenCommand.Open(ScreenId.SETTINGS)
                } else {
                    config.promptIndex -= 1
                    ScreenCommand.Stay
                }
            }

            NavigationAction.BACK -> {
                if (quitConfirmationArmed) {
                    ScreenCommand.ExitApp
                } else {
                    quitConfirmationArmed = true
                    ScreenCommand.Stay
                }
            }
        }
    }

    override fun navigationHint(): String = when {
        quitConfirmationArmed -> panelView.context.getString(R.string.nav_capture_quit_confirm)
        config.promptIndex == 0 -> panelView.context.getString(R.string.nav_capture_first)
        else -> panelView.context.getString(R.string.nav_capture)
    }

    override fun onEnter() {
        isEntered = true
        quitConfirmationArmed = false
        statusOverride = null
        startCamera()
    }

    override fun onExit() {
        isEntered = false
        camera.stop()
    }

    override fun onHostStart() {
        if (isEntered) startCamera()
    }

    override fun onHostStop() {
        camera.stop()
    }

    /** Re-starts the camera after the permission result arrives (phone/emulator only). */
    fun onPermissionsUpdated() {
        if (isEntered) startCamera()
    }

    private fun startCamera() {
        if (!hasCameraPermission()) {
            setStatus(panelView.context.getString(R.string.capture_camera_permission_needed))
            return
        }
        setStatus(panelView.context.getString(R.string.capture_camera_starting))
        camera.start(previewView) { errorStatus ->
            if (!isEntered) return@start
            setStatus(errorStatus)
        }
    }

    private fun defaultStatus(): String {
        val context = panelView.context
        return when {
            !hasCameraPermission() ->
                context.getString(R.string.capture_camera_permission_needed)
            !camera.isReady -> context.getString(R.string.capture_camera_starting)
            !config.hasApiKey -> "No API key — swipe back for settings"
            else -> "${config.model} · ${config.prompts().size} prompts"
        }
    }
}
