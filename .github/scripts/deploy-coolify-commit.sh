#!/usr/bin/env bash
set -euo pipefail

: "${COOLIFY_URL:?COOLIFY_URL is required}"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is required}"
: "${COOLIFY_APP_UUID:?COOLIFY_APP_UUID is required}"

commit_sha="${1:?commit sha is required}"
[[ "${commit_sha}" =~ ^[0-9a-f]{40}$ ]] || {
  echo "Commit SHA must be a full 40-character lowercase Git SHA." >&2
  exit 1
}

coolify_api_url="${COOLIFY_URL%/}"
if [[ "${coolify_api_url}" != */api/v1 ]]; then
  coolify_api_url="${coolify_api_url}/api/v1"
fi
application_url="${coolify_api_url}/applications/${COOLIFY_APP_UUID}"
pinned=false

set_application_commit() {
  local target_commit="$1"
  curl --fail --silent --show-error \
    --request PATCH \
    --header "Authorization: Bearer ${COOLIFY_TOKEN}" \
    --header 'Content-Type: application/json' \
    --data "$(jq -cn --arg commit "${target_commit}" '{git_commit_sha: $commit}')" \
    "${application_url}" >/dev/null
}

restore_head() {
  if [[ "${pinned}" == true ]]; then
    set_application_commit HEAD
  fi
}
trap restore_head EXIT

set_application_commit "${commit_sha}"
pinned=true

response="$(coolify deploy uuid "${COOLIFY_APP_UUID}" --format json)"
deployment_uuid="$(
  jq -r '.deployments[0].deployment_uuid // .[0].deployment_uuid // .deployment_uuid // empty' \
    <<< "${response}"
)"
if [[ -z "${deployment_uuid}" ]]; then
  message="$(
    jq -r '.deployments[0].message // .[0].message // .message // "Coolify did not return a deployment UUID."' \
      <<< "${response}"
  )"
  echo "${message}" >&2
  exit 1
fi

set_application_commit HEAD
pinned=false
trap - EXIT

deployment="$(coolify deploy get "${deployment_uuid}" --format json)"
queued_commit="$(jq -r '.commit // .git_commit_sha // empty' <<< "${deployment}")"
if [[ "${queued_commit}" != "${commit_sha}" ]]; then
  echo "Coolify queued ${queued_commit:-an unknown commit}, expected ${commit_sha}." >&2
  exit 1
fi

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  printf 'deployment_uuid=%s\n' "${deployment_uuid}" >> "${GITHUB_OUTPUT}"
fi
echo "Queued Coolify deployment ${deployment_uuid} for validated commit ${commit_sha}."
