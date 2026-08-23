#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
temporary_directory="$(mktemp -d)"
runtime_env="${temporary_directory}/pulpo.env"
trap 'rm -rf "${temporary_directory}"' EXIT

PULPO_SELFHOST_ENV_FILE="${runtime_env}" \
  "${repository_root}/scripts/self-host-init.sh" https://pulpo.example.com >/dev/null

compose_config="$({
  PULPO_SELFHOST_ENV_FILE="${runtime_env}" docker compose \
    --project-directory "${repository_root}" \
    --env-file "${runtime_env}" \
    -f "${repository_root}/compose.selfhost.yaml" \
    config --format json
})"

jq -e '
  .services.api.environment as $env
  | $env.NODE_ENV == "production"
    and $env.PUBLIC_URL == "https://pulpo.example.com"
    and $env.COOKIE_SECURE == "true"
    and $env.STORAGE_DRIVER == "local"
    and $env.POSTGRES_HOST == "postgres"
    and ($env.POSTGRES_PASSWORD | length) == 64
    and ($env.ENCRYPTION_KEY | length) == 64
' <<< "${compose_config}" >/dev/null || {
  echo 'The generated self-host environment was not preserved by Compose.' >&2
  exit 1
}

jq -e '
  .services.api.depends_on.migrate.condition == "service_completed_successfully"
    and .services.worker.depends_on.migrate.condition == "service_completed_successfully"
    and .services.web.depends_on.api.condition == "service_healthy"
    and .services.migrate.restart == "no"
    and (.services.api.build != null)
    and (.services.worker.build == null)
    and (.services.migrate.build == null)
' <<< "${compose_config}" >/dev/null || {
  echo 'The self-host startup dependency gates are incomplete.' >&2
  exit 1
}

jq -e '
  .services.web.ports
  | any(.target == 80 and .published == "8080" and .host_ip == "127.0.0.1")
' <<< "${compose_config}" >/dev/null || {
  echo 'The self-host web gateway is not bound to loopback by default.' >&2
  exit 1
}

jq -e '.services.web.environment.CLIENT_MAX_BODY_SIZE == "25m"' <<< "${compose_config}" >/dev/null || {
  echo 'The self-host web gateway upload limit is not configured.' >&2
  exit 1
}

if grep -Eq '^(POSTGRES_PASSWORD|ENCRYPTION_KEY)=change-me$' "${runtime_env}"; then
  echo 'The self-host initializer left a placeholder secret behind.' >&2
  exit 1
fi

bash -n "${repository_root}/scripts/self-host-init.sh"
echo 'Validated generated secrets and the self-host Compose startup gates.'
