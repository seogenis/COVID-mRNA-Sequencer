package co.synphony.rokidask

import android.view.View
import android.widget.ScrollView
import android.widget.TextView
import java.util.Locale

/**
 * Shows the model's answer, and doubles as the error surface: a failure the wearer
 * cannot see is a failure they cannot fix, and there is no console on the glasses.
 *
 * Swipe scrolls, since an answer can exceed the 480x640 HUD.
 */
internal class AnswerScreenController(
    panelView: View
) : ViewScreenController(ScreenId.ANSWER, panelView) {

    companion object {
        /** One swipe moves most of a screen, leaving a little overlap for context. */
        private const val SCROLL_FRACTION = 0.8f
    }

    private val scrollView: ScrollView = panelView.findViewById(R.id.answerScrollView)
    private val textView: TextView = panelView.findViewById(R.id.answerTextView)
    private val statusView: TextView = panelView.findViewById(R.id.answerStatusView)

    private var headerTitle: String? = null
    private var bodyText: String = ""
    private var statusText: String = ""

    override fun render() {
        textView.text = bodyText
        statusView.text = statusText
    }

    override fun title(): String? = headerTitle

    /** Puts the screen into its pending state while the request is in flight. */
    fun showPending(promptLabel: String, message: String) {
        headerTitle = promptLabel
        bodyText = message
        statusText = ""
        scrollView.scrollTo(0, 0)
        render()
    }

    fun showAnswer(answer: OpenAiVisionClient.Answer) {
        bodyText = answer.text.orEmpty()
        statusText = String.format(
            Locale.US,
            "%s · %.1fs",
            answer.model,
            answer.elapsedMs / 1000.0
        )
        scrollView.scrollTo(0, 0)
        render()
    }

    fun showError(message: String, status: String = "") {
        bodyText = message
        statusText = status
        scrollView.scrollTo(0, 0)
        render()
    }

    override fun handleAction(action: NavigationAction): ScreenCommand = when (action) {
        // Both tap and double-tap return to the viewfinder, so there is no way to get
        // stuck on an answer.
        NavigationAction.SELECT, NavigationAction.BACK -> ScreenCommand.Open(ScreenId.CAPTURE)

        NavigationAction.NEXT -> {
            scrollView.smoothScrollBy(0, (scrollView.height * SCROLL_FRACTION).toInt())
            ScreenCommand.Stay
        }

        NavigationAction.PREVIOUS -> {
            scrollView.smoothScrollBy(0, -(scrollView.height * SCROLL_FRACTION).toInt())
            ScreenCommand.Stay
        }
    }

    override fun navigationHint(): String = panelView.context.getString(R.string.nav_answer)
}
