#!/usr/bin/env bash

set -eu

readonly script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
case "${PULPO_IOS_APP:-pulpo}" in
  keyboard) exec python3 "${script_directory}/../../keyboard-ios/scripts/deploy-iphone.py" ;;
  pulpo) exec python3 "${script_directory}/deploy-iphone.py" ;;
  *) printf 'Unknown PULPO_IOS_APP: %s (use pulpo or keyboard)\n' "${PULPO_IOS_APP}" >&2; exit 2 ;;
esac
