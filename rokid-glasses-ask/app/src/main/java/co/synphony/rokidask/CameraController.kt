package co.synphony.rokidask

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.Matrix
import android.hardware.camera2.CaptureRequest
import android.util.Log
import android.util.Range
import android.util.Size
import android.view.Surface
import androidx.camera.camera2.interop.Camera2Interop
import androidx.camera.camera2.interop.ExperimentalCamera2Interop
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.ImageProxy
import androidx.camera.core.Preview
import androidx.camera.core.resolutionselector.ResolutionSelector
import androidx.camera.core.resolutionselector.ResolutionStrategy
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.core.content.ContextCompat
import java.io.ByteArrayOutputStream
import androidx.activity.ComponentActivity

/**
 * Owns the CameraX session: a framing preview plus a still-image capture.
 *
 * Rokid-specific choices, from GlassKit's device notes:
 *  - the practical capture floor is 1024x768 at 15 fps, and the request must be
 *    landscape (1024x768, not 768x1024) with target rotation set so CameraX applies
 *    the right transform into the portrait HUD;
 *  - only the rear camera exists (see [RokidAskApplication]);
 *  - binding is attempted with progressively looser constraints, because a rejected
 *    resolution or fps range throws rather than silently falling back.
 */
@OptIn(ExperimentalCamera2Interop::class)
class CameraController(private val activity: ComponentActivity) {

    companion object {
        private const val TAG = "RokidAsk/Camera"

        private val REQUESTED_SIZE = Size(1024, 768)
        private val REQUESTED_FPS = Range(15, 15)

        /** Longest edge of the uploaded JPEG. Keeps uploads ~100KB on glasses Wi-Fi. */
        private const val UPLOAD_MAX_EDGE = 1024
        private const val UPLOAD_JPEG_QUALITY = 80
    }

    private data class BindingAttempt(val useTargetResolution: Boolean, val useExactFps: Boolean)

    private var cameraProvider: ProcessCameraProvider? = null
    private var imageCapture: ImageCapture? = null

    val isReady: Boolean
        get() = imageCapture != null

    /**
     * Starts preview and still capture. [onResult] reports a short status string for the
     * HUD, or null once the camera is live.
     */
    fun start(previewView: PreviewView, onResult: (errorStatus: String?) -> Unit) {
        val providerFuture = ProcessCameraProvider.getInstance(activity)
        providerFuture.addListener(
            {
                val provider = runCatching { providerFuture.get() }.getOrNull()
                if (provider == null) {
                    onResult(activity.getString(R.string.capture_camera_unavailable))
                    return@addListener
                }
                cameraProvider = provider
                if (activity.isFinishing || activity.isDestroyed) {
                    provider.unbindAll()
                    return@addListener
                }
                onResult(bindWithFallback(provider, previewView))
            },
            ContextCompat.getMainExecutor(activity)
        )
    }

    fun stop() {
        runCatching { cameraProvider?.unbindAll() }
        cameraProvider = null
        imageCapture = null
    }

    private fun bindWithFallback(
        provider: ProcessCameraProvider,
        previewView: PreviewView
    ): String? {
        previewView.implementationMode = PreviewView.ImplementationMode.COMPATIBLE
        previewView.scaleType = PreviewView.ScaleType.FIT_CENTER

        val attempts = listOf(
            BindingAttempt(useTargetResolution = true, useExactFps = true),
            BindingAttempt(useTargetResolution = true, useExactFps = false),
            BindingAttempt(useTargetResolution = false, useExactFps = false)
        )

        val rotation = previewView.display?.rotation ?: Surface.ROTATION_0

        for (attempt in attempts) {
            if (activity.isFinishing || activity.isDestroyed) {
                provider.unbindAll()
                return null
            }
            val bound = runCatching {
                provider.unbindAll()
                val preview = buildPreview(attempt, rotation).also {
                    it.setSurfaceProvider(previewView.surfaceProvider)
                }
                val capture = buildImageCapture(attempt, rotation)
                provider.bindToLifecycle(
                    activity,
                    CameraSelector.DEFAULT_BACK_CAMERA,
                    preview,
                    capture
                )
                imageCapture = capture
            }.isSuccess

            if (bound) return null
            Log.w(TAG, "Camera binding attempt failed: $attempt")
        }

        imageCapture = null
        return activity.getString(R.string.capture_camera_unavailable)
    }

    private fun buildPreview(attempt: BindingAttempt, rotation: Int): Preview {
        val builder = Preview.Builder().setTargetRotation(rotation)
        if (attempt.useTargetResolution) {
            builder.setResolutionSelector(resolutionSelector())
        }
        if (attempt.useExactFps) {
            Camera2Interop.Extender(builder)
                .setCaptureRequestOption(CaptureRequest.CONTROL_AE_TARGET_FPS_RANGE, REQUESTED_FPS)
        }
        return builder.build()
    }

    private fun buildImageCapture(attempt: BindingAttempt, rotation: Int): ImageCapture {
        val builder = ImageCapture.Builder()
            .setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY)
            .setTargetRotation(rotation)
        if (attempt.useTargetResolution) {
            builder.setResolutionSelector(resolutionSelector())
        }
        return builder.build()
    }

    private fun resolutionSelector(): ResolutionSelector =
        ResolutionSelector.Builder()
            .setResolutionStrategy(
                ResolutionStrategy(
                    REQUESTED_SIZE,
                    ResolutionStrategy.FALLBACK_RULE_CLOSEST_HIGHER_THEN_LOWER
                )
            )
            .build()

    /**
     * Captures one frame and hands back an upright, re-compressed JPEG.
     *
     * The bitmap is rotated here rather than left to EXIF orientation, because some
     * vision models read raw pixels and would otherwise see a sideways image, which
     * wrecks text reading.
     */
    fun capturePhoto(onJpeg: (ByteArray) -> Unit, onFailure: (String) -> Unit) {
        val capture = imageCapture
        if (capture == null) {
            onFailure(activity.getString(R.string.capture_camera_unavailable))
            return
        }

        capture.takePicture(
            ContextCompat.getMainExecutor(activity),
            object : ImageCapture.OnImageCapturedCallback() {
                override fun onCaptureSuccess(image: ImageProxy) {
                    val jpeg = runCatching { toUprightJpeg(image) }
                        .onFailure { Log.e(TAG, "Failed to encode capture", it) }
                        .getOrNull()
                    image.close()
                    if (jpeg == null) onFailure("Could not encode photo") else onJpeg(jpeg)
                }

                override fun onError(exception: ImageCaptureException) {
                    Log.e(TAG, "Capture failed", exception)
                    onFailure(
                        "Capture failed: " +
                            (exception.message ?: exception.imageCaptureError.toString())
                    )
                }
            }
        )
    }

    private fun toUprightJpeg(image: ImageProxy): ByteArray {
        val buffer = image.planes[0].buffer
        val rawBytes = ByteArray(buffer.remaining()).also { buffer.get(it) }

        val decoded = BitmapFactory.decodeByteArray(rawBytes, 0, rawBytes.size)
            ?: error("Capture was not a decodable JPEG")

        val rotationDegrees = image.imageInfo.rotationDegrees
        val scale = minOf(
            1f,
            UPLOAD_MAX_EDGE.toFloat() / maxOf(decoded.width, decoded.height).toFloat()
        )

        val prepared = if (rotationDegrees == 0 && scale == 1f) {
            decoded
        } else {
            val matrix = Matrix().apply {
                if (scale != 1f) postScale(scale, scale)
                if (rotationDegrees != 0) postRotate(rotationDegrees.toFloat())
            }
            Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
        }

        val output = ByteArrayOutputStream()
        prepared.compress(Bitmap.CompressFormat.JPEG, UPLOAD_JPEG_QUALITY, output)

        if (prepared !== decoded) prepared.recycle()
        decoded.recycle()

        return output.toByteArray()
    }
}
