#!/usr/bin/env bash
set -euo pipefail

: "${COOLIFY_URL:?COOLIFY_URL is required}"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is required}"
: "${RUNNER_TEMP:?RUNNER_TEMP is required}"

readonly coolify_version="1.6.2"
readonly archive_name="coolify-cli_${coolify_version}_linux_amd64.tar.gz"
readonly archive_checksum="269b131ebeebc41bc8889d3f76fdf2704d0261f3d77414232d700b8255f67ea5"
readonly install_directory="${RUNNER_TEMP}/coolify-cli"
readonly archive_path="${RUNNER_TEMP}/${archive_name}"

mkdir -p "${install_directory}"
curl --fail --silent --show-error --location \
  "https://github.com/coollabsio/coolify-cli/releases/download/v${coolify_version}/${archive_name}" \
  --output "${archive_path}"
printf '%s  %s\n' "${archive_checksum}" "${archive_path}" | sha256sum --check --status
tar -xzf "${archive_path}" -C "${install_directory}" coolify
chmod 700 "${install_directory}/coolify"

printf '%s\n' "${install_directory}" >> "${GITHUB_PATH}"
"${install_directory}/coolify" context add --default --force ci "${COOLIFY_URL}" "${COOLIFY_TOKEN}" >/dev/null
"${install_directory}/coolify" context verify
