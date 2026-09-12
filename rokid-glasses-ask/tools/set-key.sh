#!/usr/bin/env bash
# Pushes configuration to the glasses over adb, so nothing has to be typed on the HUD.
#
#   ./tools/set-key.sh sk-proj-...
#   ./tools/set-key.sh --model gpt-5-nano
#   ./tools/set-key.sh sk-proj-... --model gpt-4o-mini --prompt "Name the bird"
#
# The key is passed as an intent extra and is not written to this repo. It does appear in
# the device log and in your shell history, so prefer --stdin on a shared machine.
set -euo pipefail
cd "$(dirname "$0")/.."
# shellcheck source=tools/common.sh
. tools/common.sh

API_KEY=""
MODEL=""
BASE_URL=""
PROMPT=""
READ_STDIN=0

while [ $# -gt 0 ]; do
  case "$1" in
    --model)    MODEL="${2:?--model needs a value}"; shift 2 ;;
    --base-url) BASE_URL="${2:?--base-url needs a value}"; shift 2 ;;
    --prompt)   PROMPT="${2:?--prompt needs a value}"; shift 2 ;;
    --stdin)    READ_STDIN=1; shift ;;
    -h|--help)  sed -n '2,9p' "$0"; exit 0 ;;
    -*)         die "unknown option: $1" ;;
    *)          API_KEY="$1"; shift ;;
  esac
done

if [ "$READ_STDIN" = 1 ]; then
  printf 'OpenAI API key: ' >&2
  IFS= read -r API_KEY
fi

if [ -z "$API_KEY" ] && [ -z "$MODEL" ] && [ -z "$BASE_URL" ] && [ -z "$PROMPT" ]; then
  die "nothing to set. Pass an API key, or --model/--base-url/--prompt. See --help."
fi

require_adb
# shellcheck disable=SC2046
TARGET=$(adb_target)

# Built with if-blocks rather than `[ ... ] && ...` so that an unset option does not
# return non-zero and trip `set -e`.
args=()
if [ -n "$API_KEY" ];  then args+=(--es api_key "$API_KEY"); fi
if [ -n "$MODEL" ];    then args+=(--es model "$MODEL"); fi
if [ -n "$BASE_URL" ]; then args+=(--es base_url "$BASE_URL"); fi
if [ -n "$PROMPT" ];   then args+=(--es custom_prompt "$PROMPT"); fi

# shellcheck disable=SC2086
adb $TARGET shell am broadcast -n "$RECEIVER" -a "$ACTION_SET_CONFIG" "${args[@]}" >/dev/null

echo "Configuration sent."
if [ -n "$API_KEY" ];  then echo "  api key: set (${#API_KEY} chars)"; fi
if [ -n "$MODEL" ];    then echo "  model:   $MODEL"; fi
if [ -n "$BASE_URL" ]; then echo "  base:    $BASE_URL"; fi
if [ -n "$PROMPT" ];   then echo "  prompt:  $PROMPT"; fi
echo
echo "Open Settings on the glasses (swipe backward on the Ask screen) to confirm."
