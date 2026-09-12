#!/usr/bin/env bash
# Tails just this app's log output from the glasses.
#   ./tools/logs.sh
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=tools/common.sh
. tools/common.sh

require_adb
# shellcheck disable=SC2046
TARGET=$(adb_target)

# shellcheck disable=SC2086
PID=$(adb $TARGET shell pidof -s "$PACKAGE" | tr -d '\r')
if [ -z "$PID" ]; then
  echo "App is not running; showing all RokidAsk log lines instead." >&2
  # shellcheck disable=SC2086
  exec adb $TARGET logcat -v time -s RokidAsk/Camera RokidAsk/OpenAI RokidAsk/Config RokidAsk/ConfigWeb
fi

# shellcheck disable=SC2086
exec adb $TARGET logcat -v time --pid "$PID"
