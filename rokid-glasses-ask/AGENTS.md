# Project Overview

Rokid Ask is a standalone Rokid Glasses app: tap the temple touchpad to photograph what
you are looking at, send the frame to an OpenAI-compatible vision model, and read a short
answer on the HUD. It runs entirely on the glasses — no companion phone app, no Rokid SDK,
no backend.

See [README.md](./README.md) for setup and device gotchas. Read that before changing
anything device-facing.

# About Rokid Glasses

- Android 12 (YodaOS) with Wi-Fi, a rear camera, microphones, speakers and a temple
  touchpad. No touchscreen, no keyboard, no cellular data.
- The HUD is a green monochrome binocular display with a portrait 480x640 viewport
  (3:4, 240dpi, a 320dp-wide design canvas). Use black backgrounds and white foregrounds:
  black renders as transparent, white as green, grays as dimmer green. Keep colour tokens
  grayscale.
- Touchpad gestures arrive as key events: tap = `KEYCODE_ENTER`, swipe forward =
  `KEYCODE_DPAD_DOWN`, swipe backward = `KEYCODE_DPAD_UP`, double-tap = back.
- Never disable back on the root screen; it is the only way to exit an app.
- Only the rear camera exists. CameraX is limited to it in `RokidAskApplication`.
- Request the camera as landscape `1024x768` at 15 fps with target rotation set; a
  rejected resolution or fps range throws rather than falling back.
- Runtime permission dialogs do not appear on the HUD and behave as granted. The
  permission code exists so the app still runs on a phone or emulator.
- Test on a phone or emulator for convenience, but confirm camera behaviour on the device.

# Key Files

- `MainActivity.kt` — activity shell, screen registration, input routing, and the
  capture → vision API → HUD flow.
- `CaptureScreenController.kt` — root screen: viewfinder, prompt cycling, quit
  confirmation.
- `AnswerScreenController.kt` — the answer, scrollable by swipe; also where every error is
  surfaced, because there is no console on the glasses.
- `SettingsScreenController.kt` — key/model/network status, config-page toggle, model
  cycling.
- `CameraController.kt` — CameraX preview + `ImageCapture`, and the upright JPEG re-encode.
- `OpenAiVisionClient.kt` — `POST /v1/chat/completions` with a base64 data-URL image, plus
  the retry that drops a parameter the API rejects.
- `AppConfig.kt` — SharedPreferences config, model presets, prompt presets.
- `ConfigReceiver.kt` / `ConfigWebServer.kt` — the two keyboard-free config paths.
- `HudViewportLayout.kt`, `NavigationInputMapper.kt`, `ScreenController.kt` — HUD framework.

# Conventions

- Kotlin, AndroidX views with XML layouts. No Compose: the HUD is static text and the
  device is weaker than a phone.
- Only two dependency groups: AndroidX Activity and CameraX. JSON uses the framework's
  `org.json`, HTTP uses `HttpURLConnection`. Keep it that way unless there is a real need.
- Kotlin is compiled by AGP's built-in Kotlin support; the Kotlin Android plugin is
  deliberately not applied.
- Never log an API key. Log changed field names only.
- Any new failure path must end up visible on the HUD.

# Useful Commands

- `./gradlew :app:assembleDebug` — build the debug APK.
- `./tools/install.sh [apk] [--key sk-...]` — install, configure and launch on the glasses.
- `./tools/set-key.sh sk-... [--model m] [--base-url u] [--prompt p]` — push config.
- `./tools/logs.sh` — tail this app's logs.
- CI (`.github/workflows/rokid-ask-apk.yml`) builds the APK on every push and uploads it
  as an artifact, so no local Android SDK is required.
