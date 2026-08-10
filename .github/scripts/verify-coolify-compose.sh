#!/usr/bin/env bash
set -euo pipefail

if [[ "$#" -lt 1 || "$#" -gt 2 ]]; then
  echo "Usage: $0 <application-uuid> [compose-file]" >&2
  exit 2
fi

readonly application_uuid="$1"
readonly repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
readonly compose_file="${2:-${repository_root}/compose.yaml}"
readonly temporary_directory="$(mktemp -d)"
readonly coolify_compose_file="${temporary_directory}/compose.yaml"

cleanup() {
  rm -rf "${temporary_directory}"
}
trap cleanup EXIT

if [[ ! -f "${compose_file}" ]]; then
  echo "Compose file not found: ${compose_file}" >&2
  exit 1
fi

coolify app get "${application_uuid}" --format json \
  | jq -er '.docker_compose_raw | select(type == "string" and length > 0)' \
  > "${coolify_compose_file}"

normalize_compose() {
  docker compose \
    --project-directory "${repository_root}" \
    -f "$1" \
    config \
    --format json \
    | jq --sort-keys .
}

if ! diff --brief \
  <(normalize_compose "${compose_file}") \
  <(normalize_compose "${coolify_compose_file}") \
  >/dev/null; then
  echo "Coolify's stored Docker Compose definition does not match ${compose_file}." >&2
  echo "Use 'Reload Compose File' in the Coolify application configuration, then retry the deployment." >&2
  exit 1
fi

echo "Coolify's stored Docker Compose definition matches ${compose_file}."
