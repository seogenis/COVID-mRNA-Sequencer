#!/usr/bin/env bash
# Installs the app on Rokid Glasses, optionally sets the API key, and launches it.
#
#   ./tools/install.sh                        # build locally, install, launch
#   ./tools/install.sh path/to/app-debug.apk  # install a CI-built APK
#   ./tools/install.sh --key sk-proj-...      # also store the API key
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=tools/common.sh
. tools/common.sh

APK=""
API_KEY=""

while [ $# -gt 0 ]; do
  case "$1" in
    --key)     API_KEY="${2:?--key needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,6p' "$0"; exit 0 ;;
    -*)        die "unknown option: $1" ;;
    *)         APK="$1"; shift ;;
  esac
done

require_adb
# shellcheck disable=SC2046
TARGET=$(adb_target)

if [ -z "$APK" ]; then
  APK="app/build/outputs/apk/debug/app-debug.apk"
  if [ ! -f "$APK" ]; then
    echo "No APK given and none built yet. Building..."
    ./gradlew :app:assembleDebug
  fi
fi

[ -f "$APK" ] || die "APK not found: $APK"

echo "Installing $APK ..."
# -r reinstalls over an existing copy; -d allows a downgrade during iteration.
# shellcheck disable=SC2086
adb $TARGET install -r -d "$APK"

if [ -n "$API_KEY" ]; then
  ./tools/set-key.sh "$API_KEY"
fi

echo "Launching..."
# shellcheck disable=SC2086
adb $TARGET shell am start -n "$ACTIVITY" >/dev/null

cat <<'DONE'

Installed and launched.

On the glasses:
  tap            ask about what you see
  swipe forward  next prompt
  swipe backward previous prompt (Settings from the first one)
  double-tap     back, and quit from the Ask screen
DONE
