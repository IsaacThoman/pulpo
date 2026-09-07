#!/usr/bin/env bash

set -eu

readonly script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
exec python3 "${script_directory}/deploy-iphone.py"
