#!/usr/bin/env bash
set -euo pipefail

: "${COOLIFY_URL:?COOLIFY_URL is required}"
: "${COOLIFY_TOKEN:?COOLIFY_TOKEN is required}"
: "${COOLIFY_APP_UUID:?COOLIFY_APP_UUID is required}"
: "${PULL_REQUEST_ID:?PULL_REQUEST_ID is required}"
: "${PULL_REQUEST_SHA:?PULL_REQUEST_SHA is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

coolify_api_url="${COOLIFY_URL%/}"
if [[ "${coolify_api_url}" != */api/v1 ]]; then
  coolify_api_url="${coolify_api_url}/api/v1"
fi

deployment_history_url="${coolify_api_url}/deployments/applications/${COOLIFY_APP_UUID}?skip=0&take=20"

for attempt in $(seq 1 30); do
  deployment_history="$(
    curl --fail --silent --show-error \
      --header "Authorization: Bearer ${COOLIFY_TOKEN}" \
      "${deployment_history_url}"
  )"
  deployment_uuid="$(
    jq -r \
      --arg pull_request_id "${PULL_REQUEST_ID}" \
      --arg pull_request_sha "${PULL_REQUEST_SHA}" \
      '.deployments
        | map(select(
            (.pull_request_id | tostring) == $pull_request_id
            and .commit == $pull_request_sha
          ))
        | first
        | .deployment_uuid // empty' \
      <<< "${deployment_history}"
  )"
  if [[ -n "${deployment_uuid}" ]]; then
    printf 'deployment_uuid=%s\n' "${deployment_uuid}" >> "${GITHUB_OUTPUT}"
    echo "Found automatic Coolify preview deployment ${deployment_uuid} for PR ${PULL_REQUEST_ID}."
    exit 0
  fi
  sleep 2
done

echo "Coolify did not register an automatic deployment for PR ${PULL_REQUEST_ID} at ${PULL_REQUEST_SHA} within 60 seconds." >&2
exit 1
