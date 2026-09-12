package co.synphony.rokidask

import android.content.Context
import android.view.GestureDetector
import android.view.KeyEvent
import android.view.MotionEvent
import kotlin.math.abs

/**
 * Maps Rokid Glasses temple-touchpad gestures to app navigation actions.
 *
 * On the glasses the touchpad arrives as key events:
 *   tap -> KEYCODE_ENTER, swipe forward -> KEYCODE_DPAD_DOWN,
 *   swipe backward -> KEYCODE_DPAD_UP, double-tap -> back (KEYCODE_BACK).
 *
 * Touchscreen handling exists only so the app is testable on a phone or emulator.
 */
class NavigationInputMapper(
    context: Context,
    private val onSelect: () -> Unit,
    private val onBack: () -> Unit,
    private val onNext: () -> Unit,
    private val onPrevious: () -> Unit
) {

    companion object {
        private const val TOUCHSCREEN_FLING_DISTANCE_THRESHOLD_DP = 56f
    }

    private val touchscreenFlingDistanceThresholdPx =
        TOUCHSCREEN_FLING_DISTANCE_THRESHOLD_DP * context.resources.displayMetrics.density

    private val touchscreenGestureDetector = GestureDetector(
        context,
        object : GestureDetector.SimpleOnGestureListener() {
            override fun onDown(e: MotionEvent): Boolean = true

            override fun onSingleTapConfirmed(e: MotionEvent): Boolean {
                onSelect()
                return true
            }

            override fun onDoubleTap(e: MotionEvent): Boolean {
                onBack()
                return true
            }

            override fun onFling(
                e1: MotionEvent?,
                e2: MotionEvent,
                velocityX: Float,
                velocityY: Float
            ): Boolean {
                val start = e1 ?: return false
                val horizontalMovement = e2.x - start.x
                val verticalMovement = e2.y - start.y
                if (!isHorizontalTouchscreenFling(horizontalMovement, verticalMovement)) {
                    return false
                }
                if (horizontalMovement > 0f) onNext() else onPrevious()
                return true
            }
        }
    )

    /** Phone/emulator touchscreen input. */
    fun onTouchEvent(event: MotionEvent): Boolean =
        touchscreenGestureDetector.onTouchEvent(event)

    /** Rokid touchpad gesture input. */
    fun onKeyUp(keyCode: Int): Boolean = when (keyCode) {
        KeyEvent.KEYCODE_ENTER, KeyEvent.KEYCODE_DPAD_CENTER -> {
            onSelect()
            true
        }

        KeyEvent.KEYCODE_DPAD_DOWN -> {
            onNext()
            true
        }

        KeyEvent.KEYCODE_DPAD_UP -> {
            onPrevious()
            true
        }

        else -> false
    }

    private fun isHorizontalTouchscreenFling(
        horizontalMovement: Float,
        verticalMovement: Float
    ): Boolean {
        val horizontalDistance = abs(horizontalMovement)
        val verticalDistance = abs(verticalMovement)
        return horizontalDistance >= touchscreenFlingDistanceThresholdPx &&
            horizontalDistance > verticalDistance
    }
}
