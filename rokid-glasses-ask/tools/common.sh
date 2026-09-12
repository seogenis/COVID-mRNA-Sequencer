# Shared helpers for the Rokid Ask tools. Sourced, not executed.

PACKAGE="co.synphony.rokidask"
ACTIVITY="${PACKAGE}/.MainActivity"
RECEIVER="${PACKAGE}/.ConfigReceiver"
ACTION_SET_CONFIG="${PACKAGE}.SET_CONFIG"

die() {
  echo "error: $*" >&2
  exit 1
}

require_adb() {
  command -v adb >/dev/null 2>&1 ||
    die "adb not found. Install Android platform-tools: https://developer.android.com/tools/releases/platform-tools"
}

# Echoes the adb target flags to use. Prefers an explicit ADB_SERIAL, otherwise requires
# exactly one connected device so a command can never hit the wrong one.
adb_target() {
  if [ -n "${ADB_SERIAL:-}" ]; then
    printf -- '-s %s' "$ADB_SERIAL"
    return 0
  fi

  local devices
  devices=$(adb devices | awk 'NR>1 && $2=="device" {print $1}')
  local count
  count=$(printf '%s\n' "$devices" | grep -c . || true)

  case "$count" in
    0) die "no adb device. Connect the Rokid dev cable, or run: adb connect <glasses-ip>:5555" ;;
    1) printf '' ;;
    *)
      echo "Multiple devices connected:" >&2
      printf '%s\n' "$devices" >&2
      die "set ADB_SERIAL=<serial> to choose one"
      ;;
  esac
}
