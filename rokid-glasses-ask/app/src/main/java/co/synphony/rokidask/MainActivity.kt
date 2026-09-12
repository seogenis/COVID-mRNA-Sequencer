package co.synphony.rokidask

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.view.KeyEvent
import android.view.MotionEvent
import android.view.WindowManager
import android.widget.TextView
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import java.util.concurrent.Executors

/**
 * Single-activity HUD shell: owns the screens, routes touchpad input, and runs the
 * capture -> vision API -> HUD flow.
 */
class MainActivity : ComponentActivity() {

    private val config by lazy { AppConfig(this) }
    private val camera by lazy { CameraController(this) }
    private val visionClient = OpenAiVisionClient()
    private val configServer by lazy { ConfigWebServer(config) }

    /** One worker thread: only one request is ever in flight. */
    private val requestExecutor = Executors.newSingleThreadExecutor()
    private val mainHandler = Handler(Looper.getMainLooper())

    private val backCallback = object : OnBackPressedCallback(true) {
        override fun handleOnBackPressed() {
            handleAction(NavigationAction.BACK)
        }
    }

    private val navigationInputMapper by lazy {
        NavigationInputMapper(
            context = this,
            onSelect = { handleAction(NavigationAction.SELECT) },
            onBack = { onBackPressedDispatcher.onBackPressed() },
            onNext = { handleAction(NavigationAction.NEXT) },
            onPrevious = { handleAction(NavigationAction.PREVIOUS) }
        )
    }

    private val cameraPermissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) {
            captureController.onPermissionsUpdated()
            renderUi()
        }

    private lateinit var headerTitleView: TextView
    private lateinit var footerNavigationView: TextView
    private lateinit var captureController: CaptureScreenController
    private lateinit var answerController: AnswerScreenController
    private lateinit var screenControllers: Map<ScreenId, ScreenController>

    private var currentScreen = ScreenId.CAPTURE
    private var isRequestInFlight = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        onBackPressedDispatcher.addCallback(this, backCallback)
        // The HUD must not sleep mid-answer.
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        setContentView(R.layout.activity_main)

        headerTitleView = findViewById(R.id.headerTitleView)
        footerNavigationView = findViewById(R.id.footerNavigationView)
        bindScreenControllers()

        // Physical Rokid Glasses do not show a permission dialog in the HUD and behave as
        // granted; this request is what makes the app testable on a phone or emulator.
        if (!hasCameraPermission()) {
            cameraPermissionLauncher.launch(Manifest.permission.CAMERA)
        }

        currentScreenController().onEnter()
        renderUi()
    }

    override fun onStart() {
        super.onStart()
        screenControllers.values.forEach { it.onHostStart() }
    }

    override fun onStop() {
        screenControllers.values.forEach { it.onHostStop() }
        super.onStop()
    }

    override fun onDestroy() {
        configServer.stop()
        requestExecutor.shutdownNow()
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        super.onDestroy()
    }

    /** Phone/emulator touchscreen input. */
    override fun dispatchTouchEvent(event: MotionEvent): Boolean =
        navigationInputMapper.onTouchEvent(event) || super.dispatchTouchEvent(event)

    /** Rokid touchpad gesture input. */
    override fun onKeyUp(keyCode: Int, event: KeyEvent?): Boolean =
        navigationInputMapper.onKeyUp(keyCode) || super.onKeyUp(keyCode, event)

    private fun bindScreenControllers() {
        captureController = CaptureScreenController(
            panelView = findViewById(R.id.capturePanel),
            config = config,
            camera = camera,
            hasCameraPermission = ::hasCameraPermission,
            onCaptureRequested = ::captureAndAsk
        )
        answerController = AnswerScreenController(findViewById(R.id.answerPanel))
        val settingsController = SettingsScreenController(
            panelView = findViewById(R.id.settingsPanel),
            config = config,
            configServer = configServer
        )

        screenControllers = linkedMapOf(
            captureController.screen to captureController,
            answerController.screen to answerController,
            settingsController.screen to settingsController
        )
    }

    private fun handleAction(action: NavigationAction) {
        when (val command = currentScreenController().handleAction(action)) {
            ScreenCommand.Stay -> renderUi()
            ScreenCommand.ExitApp -> finish()
            is ScreenCommand.Open -> {
                navigateTo(command.screen)
                renderUi()
            }
        }
    }

    private fun navigateTo(screen: ScreenId) {
        if (currentScreen == screen) return
        currentScreenController().onExit()
        currentScreen = screen
        currentScreenController().onEnter()
    }

    private fun renderUi() {
        screenControllers.values.forEach { controller ->
            controller.setVisible(controller.screen == currentScreen)
            controller.render()
        }
        val controller = currentScreenController()
        headerTitleView.text = controller.title() ?: getString(controller.screen.titleResId)
        footerNavigationView.text = controller.navigationHint()
    }

    private fun currentScreenController(): ScreenController =
        screenControllers.getValue(currentScreen)

    private fun hasCameraPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * The whole point of the app: capture a frame, ask the model about it, show the
     * answer. Failures are routed to the answer screen so they are visible on the HUD.
     */
    private fun captureAndAsk() {
        if (isRequestInFlight) return

        val prompt = config.currentPrompt()

        if (!config.hasApiKey) {
            showFailure(prompt.label, getString(R.string.error_no_api_key))
            return
        }
        if (!NetworkInfo.isOnline(this)) {
            showFailure(prompt.label, getString(R.string.error_offline))
            return
        }

        isRequestInFlight = true
        captureController.setStatus(getString(R.string.capture_capturing))

        camera.capturePhoto(
            onJpeg = { jpeg ->
                answerController.showPending(prompt.label, getString(R.string.answer_thinking))
                navigateTo(ScreenId.ANSWER)
                renderUi()
                submitRequest(prompt, jpeg)
            },
            onFailure = { message ->
                isRequestInFlight = false
                showFailure(prompt.label, message)
            }
        )
    }

    private fun submitRequest(prompt: Prompt, jpeg: ByteArray) {
        requestExecutor.execute {
            val answer = visionClient.ask(config, jpeg, prompt.text)
            mainHandler.post {
                isRequestInFlight = false
                if (isFinishing || isDestroyed) return@post
                if (answer.isSuccess) {
                    answerController.showAnswer(answer)
                } else {
                    answerController.showError(
                        answer.error ?: "Unknown error.",
                        "${answer.model} · failed"
                    )
                }
                renderUi()
            }
        }
    }

    private fun showFailure(promptLabel: String, message: String) {
        answerController.showPending(promptLabel, message)
        navigateTo(ScreenId.ANSWER)
        renderUi()
    }
}
