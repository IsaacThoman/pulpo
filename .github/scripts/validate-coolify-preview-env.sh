#!/usr/bin/env bash
set -euo pipefail

application_uuid="${1:?application uuid is required}"

preview_environment="$(
  coolify app env list "${application_uuid}" \
    --preview \
    --show-sensitive \
    --format json
)"

preview_value() {
  local key="$1"
  jq -r --arg key "${key}" \
    '.[] | select(.key == $key and .is_preview == true) | .value // empty' \
    <<< "${preview_environment}" \
    | tail -n 1
}

require_runtime_value() {
  local key="$1"
  if ! jq -e --arg key "${key}" \
    'any(.[]; .key == $key and .is_preview == true and .is_runtime == true and ((.value // "") | length > 0))' \
    <<< "${preview_environment}" >/dev/null; then
    echo "Missing non-empty preview runtime variable: ${key}" >&2
    return 1
  fi
}

required_variables=(
  NODE_ENV
  PUBLIC_URL
  COOKIE_SECURE
  ENCRYPTION_KEY
  WORKSPACE_CONTROLLER_URL
  WORKSPACE_CONTROLLER_TOKEN
  WORKSPACE_CONTROLLER_CA_CERT_BASE64
  PULPO_BOOTSTRAP_PRESET
  PULPO_PREVIEW_ADMIN_EMAIL
  PULPO_PREVIEW_ADMIN_PASSWORD
  PULPO_PREVIEW_PROVIDER_API_KEY
  PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST
)

for key in "${required_variables[@]}"; do
  require_runtime_value "${key}"
done

[[ "$(preview_value NODE_ENV)" == "production" ]] || {
  echo 'Preview NODE_ENV must be production.' >&2
  exit 1
}
[[ "$(preview_value COOKIE_SECURE)" == "true" ]] || {
  echo 'Preview COOKIE_SECURE must be true.' >&2
  exit 1
}
[[ "$(preview_value PULPO_BOOTSTRAP_PRESET)" == "ci-preview" ]] || {
  echo 'Preview PULPO_BOOTSTRAP_PRESET must be ci-preview.' >&2
  exit 1
}

public_url="$(preview_value PUBLIC_URL)"
if [[ "${public_url}" != 'https://$SERVICE_FQDN_WEB' && "${public_url}" != 'https://${SERVICE_FQDN_WEB}' ]]; then
  echo 'Preview PUBLIC_URL must derive its HTTPS origin from SERVICE_FQDN_WEB.' >&2
  exit 1
fi

encryption_key="$(preview_value ENCRYPTION_KEY)"
if (( ${#encryption_key} < 32 )) || [[ "${encryption_key}" == 'development-only-key-change-me-000000' ]]; then
  echo 'Preview ENCRYPTION_KEY must be a non-development key of at least 32 characters.' >&2
  exit 1
fi

admin_password="$(preview_value PULPO_PREVIEW_ADMIN_PASSWORD)"
if (( ${#admin_password} < 8 )); then
  echo 'Preview administrator password must contain at least 8 characters.' >&2
  exit 1
fi

controller_token="$(preview_value WORKSPACE_CONTROLLER_TOKEN)"
if (( ${#controller_token} < 32 )); then
  echo 'Preview workspace controller token must contain at least 32 characters.' >&2
  exit 1
fi

workspace_image="$(preview_value PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST)"
if [[ ! "${workspace_image}" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]]; then
  echo 'Preview workspace image must be an immutable GHCR digest.' >&2
  exit 1
fi

provider_key="$(preview_value PULPO_PREVIEW_PROVIDER_API_KEY)"
models="$(
  curl --fail --silent --show-error --max-time 15 \
    --header "Authorization: Bearer ${provider_key}" \
    https://pulpo.baby/v1/models
)"
if ! jq -e 'any(.data[]?; .id == "gpt-5.6-luna")' <<< "${models}" >/dev/null; then
  echo 'Preview provider key does not allow gpt-5.6-luna.' >&2
  exit 1
fi

echo "Validated ${#required_variables[@]} preview runtime variables and Luna provider access."
