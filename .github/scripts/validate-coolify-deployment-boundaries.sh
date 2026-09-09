#!/usr/bin/env bash
set -euo pipefail

workflow="${1:-.github/workflows/release.yml}"

job_block() {
  local job="$1"
  awk -v heading="  ${job}:" '
    $0 == heading { printing = 1 }
    printing && seen && $0 ~ /^  [[:alnum:]_-]+:$/ { exit }
    printing { print; seen = 1 }
  ' "${workflow}"
}

require_preview_boundary() {
  local job="$1"
  local block
  block="$(job_block "${job}")"

  [[ -n "${block}" ]] || {
    echo "Missing ${job} job in ${workflow}." >&2
    return 1
  }
  grep -Fq "github.event.pull_request.base.ref == 'dev'" <<< "${block}" || {
    echo "${job} must be limited to pull requests targeting dev." >&2
    return 1
  }
  grep -Fq 'COOLIFY_APP_UUID: ${{ vars.COOLIFY_PULPO_PREVIEW_APP_UUID }}' <<< "${block}" || {
    echo "${job} must use only the dedicated preview Coolify application." >&2
    return 1
  }
  if grep -Eq 'COOLIFY_PULPO_(DEV_)?(APP|WORKER_APP|WEB_APP)_UUID' <<< "${block}"; then
    echo "${job} must never reference a persistent Coolify application." >&2
    return 1
  fi
}

require_preview_boundary deploy-preview
require_preview_boundary cleanup-preview

echo 'Coolify preview deploy and cleanup jobs are isolated from persistent development and production.'
