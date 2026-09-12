# Rokid Ask

Take a photo with Rokid Glasses, send it to the OpenAI API, read a short answer on the HUD.

One tap. One APK. No phone app, no Rokid developer account, no backend — just your own
OpenAI API key.

```
   tap            ask about what you are looking at
   swipe forward  next prompt   (What is this? / Read text / Translate / Describe / …)
   swipe backward previous prompt, or Settings from the first one
   double-tap     back — and quit from the Ask screen
```

## Why it is built this way

Rokid Glasses run YodaOS, which is Android 12 with Wi-Fi, a rear camera and a 480x640
monochrome HUD. So the simplest thing that works is an **ordinary standalone Android app
sideloaded onto the glasses**. That avoids the two things that make the comparable
community projects hard to get running:

| Approach | What it costs you |
| --- | --- |
| Phone companion app via Rokid's CXR-M / CXR-L SDK | a `ROKID_CLIENT_SECRET` from Rokid, two APKs to keep in sync, a Bluetooth/Caps transport to debug |
| **Standalone app on the glasses (this project)** | glasses must be on Wi-Fi |

The closest prior art is [`rokid__visual_agent`](https://github.com/im-sanjay-sai/rokid__visual_agent)
(long-press temple → photo + voice → vision model → HUD), but it needs a Rokid client
secret plus three paid API keys. The device-level patterns here — HUD viewport, touchpad
mapping, CameraX configuration — follow [GlassKit](https://github.com/RealComputer/GlassKit),
which is the best-maintained source of Rokid-specific guidance.

## Getting it onto the glasses

You need `adb` ([platform tools](https://developer.android.com/tools/releases/platform-tools))
and either the Rokid dev cable or wireless adb. You do **not** need Android Studio.

### 1. Get the APK

Every push builds one in CI. Open the repo's **Actions → Rokid Ask APK → latest run →
Artifacts → `rokid-ask-debug-apk`** and unzip it.

Or build locally if you have the Android SDK:

```sh
./gradlew :app:assembleDebug
```

### 2. Connect the glasses

With the dev cable plugged in:

```sh
adb devices          # the glasses should appear
```

Cable-free afterwards, once the glasses are on Wi-Fi:

```sh
adb shell cmd wifi set-wifi-enabled enabled
adb shell 'cmd wifi connect-network "YOUR_SSID" wpa2 "YOUR_PASSWORD"'
adb shell ip route get 1.1.1.1 | grep -oE 'src [0-9.]+' | awk '{print $2}'
adb tcpip 5555
adb connect <that-ip>:5555
```

### 3. Install, key, launch — one command

```sh
./tools/install.sh ~/Downloads/app-debug.apk --key sk-proj-...
```

That installs the APK, stores the key on the glasses and starts the app. If the glasses
are already set up, `./tools/install.sh path/to.apk` is enough.

## Setting the API key without a keyboard

The glasses have no keyboard, so the key is never typed on them. Three ways in:

1. **Over adb** — `./tools/set-key.sh sk-proj-...`
   (also `--model`, `--base-url`, `--prompt`; `--stdin` keeps the key out of shell history)
2. **From your phone's browser** — on the glasses, swipe backward on the Ask screen to
   reach Settings and tap once. The HUD shows a URL like `http://192.168.1.42:8711` and a
   6-digit PIN. Open that on your Samsung or iPhone on the same Wi-Fi, paste the key,
   enter the PIN, save. The server is off by default and the PIN is regenerated each time
   it starts, so being on the same network is not enough to write config.
3. **`adb shell am broadcast`** directly, if you prefer:
   ```sh
   adb shell am broadcast -n co.synphony.rokidask/.ConfigReceiver \
     -a co.synphony.rokidask.SET_CONFIG --es api_key sk-proj-...
   ```

The key lives in the app's private `SharedPreferences`. No other app can read it, but it
is stored in the clear, so treat the glasses like any logged-in device and use a key you
can rotate.

## Choosing a model

Default: **`gpt-5.6-luna`** — cheap, fast, accepts images. Swipe on the Settings screen to
cycle presets (`gpt-5.6-luna`, `gpt-5-nano`, `gpt-4o-mini`, `gpt-5.4-mini`), or set any
model with `--model`. Model IDs were checked against the
[LiteLLM model registry](https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json)
in September 2026; nothing is hardcoded into the request path, so a retired ID is a
one-command fix rather than a rebuild.

`--base-url` points the app at any OpenAI-compatible endpoint (OpenRouter, a proxy, a
local gateway), so "ChatGPT API" is the default, not a requirement.

At roughly 0.8 s of image tokens per ask, `gpt-5.6-luna` costs a fraction of a cent per
photo. A 1024-px JPEG at quality 80 is about 100 KB per request.

## What runs on the device

```
MainActivity              HUD shell: screen routing, touchpad input, the ask flow
  CaptureScreenController viewfinder + prompt selection        (root screen)
  AnswerScreenController  the answer, scrollable; also the error surface
  SettingsScreenController key/model/network status, config page toggle
CameraController          CameraX preview + still capture, upright JPEG re-encode
OpenAiVisionClient        POST /v1/chat/completions with a base64 data-URL image
AppConfig                 SharedPreferences-backed settings and prompt presets
ConfigReceiver            config pushed over adb
ConfigWebServer           dependency-free config page on port 8711, off by default
HudViewportLayout         scales the UI into Rokid's 3:4 480x640 design canvas
NavigationInputMapper     touchpad key events, plus touchscreen for phone testing
```

Dependencies: AndroidX Activity and CameraX. Nothing else — JSON uses the framework's
`org.json`, HTTP uses `HttpURLConnection`.

## Device notes and things that will bite you

These cost the most time when working on Rokid Glasses:

- **HUD is green monochrome, 480x640 portrait.** Black renders as *transparent*, white as
  full-brightness green, grays as dimmer green. Design in black and white only; a colour
  palette is wasted. Text below about 10dp is unreadable in practice.
- **Touchpad arrives as key events**, not touch: tap = `KEYCODE_ENTER`, swipe forward =
  `KEYCODE_DPAD_DOWN`, swipe backward = `KEYCODE_DPAD_UP`, double-tap = back.
- **Never disable back on your root screen.** Double-tap is the only way out of an app, so
  the Ask screen arms a quit confirmation rather than swallowing it.
- **Only the rear camera exists.** CameraX must be limited to the back camera at the
  `Application` level (see `RokidAskApplication`), or it burns time retrying front-camera
  validation.
- **Request the camera as landscape `1024x768` at 15 fps**, then set target rotation —
  not `768x1024`. Sub-15-fps requests are rejected. A rejected resolution or fps range
  throws, so binding is attempted with progressively looser constraints.
- **Photos are rotated here, not left to EXIF.** Some vision models read raw pixels, and a
  sideways image ruins text reading.
- **No runtime permission dialog appears on the HUD.** On-device requests behave as
  granted; the permission code exists so the app still works on a phone or emulator.
- **No cellular data.** If Wi-Fi drops, the app says so instead of timing out silently.
- **Errors go on the HUD.** There is no console on your face, so HTTP status, API message
  and a hint are rendered on the answer screen.
- **A reasoning model can spend its whole token budget before answering.** Hence
  `reasoning_effort: low` and a deliberately generous `max_completion_tokens`; brevity
  comes from the system prompt. If the API rejects `reasoning_effort`,
  `max_completion_tokens` or `detail`, the client drops that field and retries once.
- **Sideloaded apps may not appear in the Sprite launcher.** `adb shell am start -n
  co.synphony.rokidask/.MainActivity` always works; `./tools/install.sh` does it for you.

## Testing without glasses

The app installs and runs on an ordinary Android phone (your Z Flip 5) or an emulator:
the HUD viewport is letterboxed, and tap / double-tap / swipe left-right stand in for the
touchpad. Camera behaviour is the part that genuinely differs, so confirm that on the
glasses. An emulator matching the HUD:

```sh
avdmanager create avd -n glass_480x640 -k "system-images;android-36;google_apis;x86_64" -d pixel_9a
# then in ~/.android/avd/glass_480x640.avd/config.ini:
#   hw.lcd.width=480
#   hw.lcd.height=640
#   hw.lcd.density=240
emulator -avd glass_480x640 -camera-back emulated
```

Your iPhone cannot install this; it is an Android APK that runs on the glasses themselves.
Nothing here needs a phone at all.

## Debugging

```sh
./tools/logs.sh     # tail just this app's logs
```

Log tags: `RokidAsk/Camera`, `RokidAsk/OpenAI`, `RokidAsk/Config`, `RokidAsk/ConfigWeb`.
The API key is never logged — only the names of the fields that changed.

## Ideas worth adding next

- Speak the answer. The glasses have speakers, but standard Android TTS may be absent;
  [`rokid-private-tts-kit`](https://github.com/bzerk/rokid-private-tts-kit) wraps Rokid's
  TTS binder.
- Ask by voice instead of picking a preset — `AudioRecord` at 16 kHz mono, then Whisper.
- Keep a scrollable history of recent answers.
- Stream tokens so the first words appear sooner.

## Credits

- [GlassKit](https://github.com/RealComputer/GlassKit) (MIT) — HUD viewport, touchpad
  mapping and CameraX configuration patterns, and the device references behind the notes
  above.
- [rokid-docs](https://github.com/buildwithfenna/rokid-docs) — YodaOS and CXR SDK
  documentation.
- [awesome-rokid](https://github.com/Anezium/awesome-rokid) — the ecosystem survey that
  located the closest prior art.
