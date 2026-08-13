#!/usr/bin/env bash

set -euo pipefail

readonly script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly repository_root="$(cd "${script_directory}/.." && pwd)"
readonly config_template="${repository_root}/deploy/local-preview.env.example"

config_path() {
  if [[ -n "${PULPO_LOCAL_PREVIEW_ENV_FILE:-}" ]]; then
    printf '%s\n' "${PULPO_LOCAL_PREVIEW_ENV_FILE}"
    return
  fi

  if [[ -n "${XDG_CONFIG_HOME:-}" ]]; then
    printf '%s/pulpo/local-preview.env\n' "${XDG_CONFIG_HOME}"
    return
  fi

  : "${HOME:?HOME is required when XDG_CONFIG_HOME is not set}"
  printf '%s/.config/pulpo/local-preview.env\n' "${HOME}"
}

readonly local_preview_config="$(config_path)"
[[ "${local_preview_config}" == /* ]] || {
  echo 'PULPO_LOCAL_PREVIEW_ENV_FILE must be an absolute path.' >&2
  exit 1
}

usage() {
  cat <<'EOF'
Usage: scripts/local-preview.sh init
       scripts/local-preview.sh reset [--yes]
EOF
}

initialize_config() {
  if [[ -e "${local_preview_config}" ]]; then
    echo "Local preview config already exists: ${local_preview_config}" >&2
    exit 1
  fi

  mkdir -p "$(dirname "${local_preview_config}")"
  umask 077
  cp "${config_template}" "${local_preview_config}"
  chmod 600 "${local_preview_config}"

  echo "Created local preview config: ${local_preview_config}"
  echo 'Replace every replace-* value before running npm run local:preview:reset.'
}

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "Required command is unavailable: ${command_name}" >&2
    exit 1
  }
}

compose() {
  PULPO_ENV_FILE="${local_preview_config}" \
    docker compose \
      --project-directory "${repository_root}" \
      --file "${repository_root}/compose.yaml" \
      --file "${repository_root}/compose.override.yaml" \
      --env-file "${local_preview_config}" \
      "$@"
}

invalid_config() {
  echo "Invalid local preview config: $1" >&2
  echo "Edit ${local_preview_config} and try again." >&2
  exit 1
}

validate_config() {
  [[ -f "${local_preview_config}" ]] || {
    echo "Local preview config is missing: ${local_preview_config}" >&2
    echo 'Run npm run local:preview:init first.' >&2
    exit 1
  }
  chmod 600 "${local_preview_config}"

  local compose_config="$1"
  jq -e '
    .services.api.environment as $env
    | $env.NODE_ENV == "development"
      and $env.PUBLIC_URL == "http://localhost:8080"
      and $env.PULPO_INSTANCE_ID == "local-preview"
      and $env.PULPO_BOOTSTRAP_PRESET == "ci-preview"
  ' <<< "${compose_config}" >/dev/null \
    || invalid_config 'NODE_ENV, PUBLIC_URL, PULPO_INSTANCE_ID, and PULPO_BOOTSTRAP_PRESET must retain the local-preview template values.'

  # These values either protect real credentials, grant external access, or are
  # required for the preview seed to function. Disposable local PostgreSQL and
  # Seaweed S3 credentials intentionally use known defaults and are excluded.
  local required_custom_value value
  for required_custom_value in \
    ENCRYPTION_KEY \
    WORKSPACE_CONTROLLER_URL \
    WORKSPACE_CONTROLLER_TOKEN \
    PULPO_PREVIEW_ADMIN_EMAIL \
    PULPO_PREVIEW_ADMIN_PASSWORD \
    PULPO_PREVIEW_PROVIDER_API_KEY \
    PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST; do
    value="$(jq -er --arg key "${required_custom_value}" '.services.api.environment[$key]' <<< "${compose_config}")" \
      || invalid_config "${required_custom_value} is required."
    [[ -n "${value}" && "${value}" != replace-* && "${value}" != *replace-with* ]] \
      || invalid_config "${required_custom_value} still contains a template placeholder."
  done

  local encryption_key controller_url controller_token admin_email admin_password workspace_digest
  encryption_key="$(jq -r '.services.api.environment.ENCRYPTION_KEY' <<< "${compose_config}")"
  controller_url="$(jq -r '.services.api.environment.WORKSPACE_CONTROLLER_URL' <<< "${compose_config}")"
  controller_token="$(jq -r '.services.api.environment.WORKSPACE_CONTROLLER_TOKEN' <<< "${compose_config}")"
  admin_email="$(jq -r '.services.api.environment.PULPO_PREVIEW_ADMIN_EMAIL' <<< "${compose_config}")"
  admin_password="$(jq -r '.services.api.environment.PULPO_PREVIEW_ADMIN_PASSWORD' <<< "${compose_config}")"
  workspace_digest="$(jq -r '.services.api.environment.PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST' <<< "${compose_config}")"

  (( ${#encryption_key} >= 32 )) || invalid_config 'ENCRYPTION_KEY must contain at least 32 characters.'
  [[ "${encryption_key}" != 'development-only-key-change-me-000000' ]] \
    || invalid_config 'ENCRYPTION_KEY must not use the development default.'
  [[ "${controller_url}" =~ ^https?://[^[:space:]]+$ ]] \
    || invalid_config 'WORKSPACE_CONTROLLER_URL must be an HTTP(S) URL.'
  (( ${#controller_token} >= 32 )) || invalid_config 'WORKSPACE_CONTROLLER_TOKEN must contain at least 32 characters.'
  [[ "${admin_email}" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]] \
    || invalid_config 'PULPO_PREVIEW_ADMIN_EMAIL must be an email address.'
  (( ${#admin_password} >= 8 && ${#admin_password} <= 1024 )) \
    || invalid_config 'PULPO_PREVIEW_ADMIN_PASSWORD must contain between 8 and 1024 characters.'
  [[ "${workspace_digest}" =~ ^ghcr\.io/[a-z0-9._/-]+@sha256:[a-f0-9]{64}$ ]] \
    || invalid_config 'PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST must be a pinned ghcr.io sha256 digest.'
}

confirm_reset() {
  local source_ref="$1"
  local source_commit="$2"

  echo "Source worktree: ${repository_root}"
  echo "Source revision: ${source_ref} (${source_commit})"
  echo 'This will delete every volume in the shared local Pulpo Compose stack.'

  if [[ ! -t 0 ]]; then
    echo 'Interactive confirmation is unavailable; pass --yes to continue.' >&2
    exit 1
  fi

  local answer
  read -r -p 'Reset the local Pulpo stack? [y/N] ' answer
  case "${answer}" in
    y|Y|yes|YES|Yes) ;;
    *)
      echo 'Local preview reset cancelled.'
      exit 0
      ;;
  esac
}

reset_stack() {
  local assume_yes=false
  if [[ "${1:-}" == '--yes' ]]; then
    assume_yes=true
    shift
  fi
  if (( $# != 0 )); then
    usage >&2
    exit 2
  fi

  require_command docker
  require_command jq
  require_command curl

  [[ -f "${local_preview_config}" ]] || {
    echo "Local preview config is missing: ${local_preview_config}" >&2
    echo 'Run npm run local:preview:init first.' >&2
    exit 1
  }

  local compose_config
  if ! compose_config="$(compose config --format json)"; then
    echo "Docker Compose could not parse ${local_preview_config}." >&2
    exit 1
  fi
  validate_config "${compose_config}"

  docker info >/dev/null 2>&1 || {
    echo 'Docker is unavailable or the daemon is not running.' >&2
    exit 1
  }
  local compose_up_help
  compose_up_help="$(compose up --help)"
  grep -q -- '--wait' <<< "${compose_up_help}" || {
    echo 'The installed Docker Compose version does not support up --wait.' >&2
    exit 1
  }

  local source_ref source_commit
  source_ref="$(git -C "${repository_root}" symbolic-ref --quiet --short HEAD 2>/dev/null || echo detached)"
  source_commit="$(git -C "${repository_root}" rev-parse --short HEAD)"
  if [[ "${assume_yes}" != true ]]; then
    confirm_reset "${source_ref}" "${source_commit}"
  else
    echo "Resetting shared local Pulpo stack from ${source_ref} (${source_commit})…"
  fi

  compose down --volumes --remove-orphans

  if ! compose build; then
    echo 'Local preview image build failed; the previous stack volumes have already been removed.' >&2
    exit 1
  fi
  if ! compose up --detach --force-recreate --wait; then
    echo 'Local preview stack failed to start.' >&2
    compose ps >&2 || true
    exit 1
  fi

  bash "${repository_root}/.github/scripts/wait-http-health.sh" 'http://localhost:8080/health' 'local preview'

  local setup_status admin_email admin_password cookie_jar
  setup_status="$(curl --fail --silent --show-error --max-time 10 'http://localhost:8080/api/auth/setup-status')"
  jq -e '.required == false' <<< "${setup_status}" >/dev/null || {
    echo 'Local preview bootstrap did not create the initial administrator.' >&2
    exit 1
  }

  admin_email="$(jq -r '.services.api.environment.PULPO_PREVIEW_ADMIN_EMAIL' <<< "${compose_config}")"
  admin_password="$(jq -r '.services.api.environment.PULPO_PREVIEW_ADMIN_PASSWORD' <<< "${compose_config}")"
  cookie_jar="$(mktemp)"
  trap 'rm -f "${cookie_jar}"' EXIT
  curl --fail --silent --show-error --max-time 10 \
    --cookie-jar "${cookie_jar}" \
    --header 'content-type: application/json' \
    --data "$(jq -cn --arg email "${admin_email}" --arg password "${admin_password}" '{email: $email, password: $password}')" \
    'http://localhost:8080/api/auth/login' >/dev/null

  echo "Local preview stack is ready: http://localhost:8080"
  echo "Seeded administrator: ${admin_email}"
}

case "${1:-}" in
  init)
    shift
    (( $# == 0 )) || { usage >&2; exit 2; }
    initialize_config
    ;;
  reset)
    shift
    reset_stack "$@"
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac
