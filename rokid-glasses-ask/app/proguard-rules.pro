# Debug builds are not minified. Release keeps CameraX's Camera2 config provider reachable.
-keep class androidx.camera.camera2.** { *; }
