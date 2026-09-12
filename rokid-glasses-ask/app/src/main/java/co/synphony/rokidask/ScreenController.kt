package co.synphony.rokidask

import android.view.View

internal enum class ScreenId(val titleResId: Int) {
    CAPTURE(R.string.screen_capture_title),
    ANSWER(R.string.screen_answer_title),
    SETTINGS(R.string.screen_settings_title)
}

internal enum class NavigationAction {
    SELECT,
    BACK,
    NEXT,
    PREVIOUS
}

internal sealed interface ScreenCommand {
    /** Stay on this screen and re-render. */
    object Stay : ScreenCommand

    object ExitApp : ScreenCommand

    data class Open(val screen: ScreenId) : ScreenCommand
}

internal interface ScreenController {
    val screen: ScreenId

    fun setVisible(visible: Boolean)

    fun render()

    fun handleAction(action: NavigationAction): ScreenCommand

    /** Footer hint text. Keep it short: the HUD footer is two lines. */
    fun navigationHint(): String

    /** Overridden when a screen needs a title other than its default. */
    fun title(): String? = null

    fun onEnter() {}

    fun onExit() {}

    /** Called from Activity.onStart / onStop so screens can release hardware. */
    fun onHostStart() {}

    fun onHostStop() {}
}

internal abstract class ViewScreenController(
    final override val screen: ScreenId,
    protected val panelView: View
) : ScreenController {

    override fun setVisible(visible: Boolean) {
        panelView.visibility = if (visible) View.VISIBLE else View.GONE
    }

    override fun render() = Unit
}
