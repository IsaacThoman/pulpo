#!/usr/bin/env bash
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

readonly xcodegen_version="2.46.0"
readonly archive_checksum="4d9e34b62172d645eed6457cac13fc222569974098ef4ee9c3368bedf0196806"
readonly install_directory="${RUNNER_TEMP}/xcodegen-${xcodegen_version}"
readonly archive_path="${RUNNER_TEMP}/xcodegen-${xcodegen_version}.zip"

curl --fail --silent --show-error --location \
  "https://github.com/yonaskolb/XcodeGen/releases/download/${xcodegen_version}/xcodegen.zip" \
  --output "${archive_path}"
printf '%s  %s\n' "${archive_checksum}" "${archive_path}" | shasum -a 256 --check --status
rm -rf "${install_directory}"
mkdir -p "${install_directory}"
unzip -q "${archive_path}" -d "${install_directory}"

# XcodeGen finds its setting presets relative to the binary, so keep the layout.
printf '%s\n' "${install_directory}/xcodegen/bin" >> "${GITHUB_PATH}"
"${install_directory}/xcodegen/bin/xcodegen" --version
