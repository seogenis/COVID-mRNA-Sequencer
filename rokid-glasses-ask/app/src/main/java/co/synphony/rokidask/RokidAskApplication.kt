package co.synphony.rokidask

import android.app.Application
import androidx.camera.camera2.Camera2Config
import androidx.camera.core.CameraSelector
import androidx.camera.core.CameraXConfig

/**
 * Rokid Glasses expose only the rear/outward camera. Limiting CameraX to the back
 * camera before any ProcessCameraProvider is created avoids front-camera validation
 * retries on hardware that reports no front camera, and still works on a phone or
 * emulator that has a back camera.
 */
class RokidAskApplication : Application(), CameraXConfig.Provider {
    override fun getCameraXConfig(): CameraXConfig =
        CameraXConfig.Builder.fromConfig(Camera2Config.defaultConfig())
            .setAvailableCamerasLimiter(CameraSelector.DEFAULT_BACK_CAMERA)
            .build()
}
