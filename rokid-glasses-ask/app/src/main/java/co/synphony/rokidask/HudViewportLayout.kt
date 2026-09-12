/*
 * Derived from the Rokid Hello World starter in GlassKit
 * (https://github.com/RealComputer/GlassKit), MIT License, Copyright (c) 2025 @tash-2s.
 * See THIRD_PARTY_NOTICES.md.
 */
package co.synphony.rokidask

import android.content.Context
import android.util.AttributeSet
import android.view.View
import android.view.View.MeasureSpec
import android.widget.FrameLayout
import kotlin.math.min
import kotlin.math.roundToInt

/**
 * Scales its children into the Rokid Glasses HUD design viewport.
 *
 * Rokid's 480x640px HUD at 240dpi maps to a 320dp-wide Android design canvas. On the
 * glasses the viewport fills the display; on a phone or emulator it is letterboxed so
 * layouts look the same during development.
 */
class HudViewportLayout @JvmOverloads constructor(
    context: Context,
    attrs: AttributeSet? = null
) : FrameLayout(context, attrs) {

    companion object {
        private const val HUD_ASPECT_RATIO = 3f / 4f
        private const val HUD_DESIGN_WIDTH_DP = 320f
        private const val HUD_DESIGN_HEIGHT_DP = HUD_DESIGN_WIDTH_DP / HUD_ASPECT_RATIO
    }

    override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
        val availableWidth = MeasureSpec.getSize(widthMeasureSpec)
        val availableHeight = MeasureSpec.getSize(heightMeasureSpec)
        if (availableWidth == 0 || availableHeight == 0) {
            super.onMeasure(widthMeasureSpec, heightMeasureSpec)
            return
        }

        val availableAspectRatio = availableWidth.toFloat() / availableHeight.toFloat()
        val measuredWidth: Int
        val measuredHeight: Int

        if (availableAspectRatio > HUD_ASPECT_RATIO) {
            measuredHeight = availableHeight
            measuredWidth = (measuredHeight * HUD_ASPECT_RATIO).roundToInt()
        } else {
            measuredWidth = availableWidth
            measuredHeight = (measuredWidth / HUD_ASPECT_RATIO).roundToInt()
        }

        val childWidthSpec = MeasureSpec.makeMeasureSpec(designWidthPx(), MeasureSpec.EXACTLY)
        val childHeightSpec = MeasureSpec.makeMeasureSpec(designHeightPx(), MeasureSpec.EXACTLY)

        for (index in 0 until childCount) {
            val child = getChildAt(index)
            if (child.visibility == View.GONE) continue
            child.measure(childWidthSpec, childHeightSpec)
        }

        setMeasuredDimension(measuredWidth, measuredHeight)
    }

    override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
        val designWidthPx = designWidthPx()
        val designHeightPx = designHeightPx()
        val scale = min(width.toFloat() / designWidthPx, height.toFloat() / designHeightPx)
        val translationX = (width - designWidthPx * scale) / 2f
        val translationY = (height - designHeightPx * scale) / 2f

        for (index in 0 until childCount) {
            val child = getChildAt(index)
            if (child.visibility == View.GONE) continue

            child.layout(0, 0, designWidthPx, designHeightPx)
            child.pivotX = 0f
            child.pivotY = 0f
            child.scaleX = scale
            child.scaleY = scale
            child.translationX = translationX
            child.translationY = translationY
        }
    }

    private fun designWidthPx(): Int = dpToPx(HUD_DESIGN_WIDTH_DP)

    private fun designHeightPx(): Int = dpToPx(HUD_DESIGN_HEIGHT_DP)

    private fun dpToPx(dp: Float): Int = (dp * resources.displayMetrics.density).roundToInt()
}
