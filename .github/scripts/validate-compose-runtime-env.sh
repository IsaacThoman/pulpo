#!/usr/bin/env bash
set -euo pipefail

runtime_env="$(mktemp)"
trap 'rm -f "${runtime_env}"' EXIT

printf '%s\n' \
  'POSTGRES_USER=preview-user' \
  'POSTGRES_PASSWORD=preview-database-password' \
  'POSTGRES_DATABASE=preview-database' \
  'S3_ACCESS_KEY_ID=preview-storage-key' \
  'S3_SECRET_ACCESS_KEY=preview-storage-secret' \
  'S3_PUBLIC_ENDPOINT=https://objects.preview.example' \
  'ENCRYPTION_KEY=preview-encryption-key-000000000000' \
  'WORKSPACE_CONTROLLER_URL=https://controller.preview.example' \
  'WORKSPACE_CONTROLLER_TOKEN=preview-controller-token' \
  'WORKSPACE_CONTROLLER_CA_CERT_BASE64=preview-ca' \
  'PULPO_INSTANCE_ID=preview-123' \
  'PULPO_BOOTSTRAP_PRESET=ci-preview' \
  'PULPO_PREVIEW_ADMIN_EMAIL=preview@example.com' \
  'PULPO_PREVIEW_ADMIN_PASSWORD=preview-admin-password' \
  'PULPO_PREVIEW_PROVIDER_API_KEY=preview-provider-key' \
  'PULPO_PREVIEW_WORKSPACE_IMAGE_DIGEST=ghcr.io/example/workspace@sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' \
  > "${runtime_env}"

compose_config="$(
  SERVICE_USER_POSTGRES='preview-db-user' \
    SERVICE_PASSWORD_64_POSTGRES='preview-database-magic-password' \
    SERVICE_USER_S3='preview-storage-user' \
    SERVICE_PASSWORD_64_S3='preview-storage-magic-password' \
    PULPO_ENV_FILE="${runtime_env}" \
    docker compose --env-file .env.example config --format json
)"

for service in api worker; do
  jq -e --arg service "${service}" '
    .services[$service].environment as $env
    | $env.POSTGRES_USER == "preview-db-user"
      and $env.POSTGRES_PASSWORD == "preview-database-magic-password"
      and $env.POSTGRES_DATABASE == "pulpo"
      and $env.S3_ACCESS_KEY_ID == "preview-storage-user"
      and $env.S3_SECRET_ACCESS_KEY == "preview-storage-magic-password"
      and $env.S3_PUBLIC_ENDPOINT == "https://objects.preview.example"
      and $env.ENCRYPTION_KEY == "preview-encryption-key-000000000000"
      and $env.WORKSPACE_CONTROLLER_TOKEN == "preview-controller-token"
      and $env.PULPO_BOOTSTRAP_PRESET == "ci-preview"
      and $env.PULPO_PREVIEW_ADMIN_EMAIL == "preview@example.com"
      and $env.PULPO_PREVIEW_ADMIN_PASSWORD == "preview-admin-password"
      and $env.PULPO_PREVIEW_PROVIDER_API_KEY == "preview-provider-key"
      and $env.PULPO_OLLAMA_URL == "http://ollama:11434"
  ' <<< "${compose_config}" >/dev/null || {
    echo "Compose did not preserve runtime env-file values for ${service}." >&2
    exit 1
  }
done

preview_routing_config="$(
  COOLIFY_RESOURCE_UUID='preview-resource' \
    SERVICE_NAME_WEB='web' \
    SERVICE_FQDN_WEB='pulpo-dev-pr-319.deathgrips.org' \
    SERVICE_USER_POSTGRES='preview-db-user' \
    SERVICE_PASSWORD_64_POSTGRES='preview-database-magic-password' \
    SERVICE_USER_S3='preview-storage-user' \
    SERVICE_PASSWORD_64_S3='preview-storage-magic-password' \
    PULPO_ENV_FILE="${runtime_env}" \
    docker compose --env-file .env.example config --format json
)"

jq -e '
  .services.web.labels as $labels
  | $labels["traefik.enable"] == "true"
    and $labels["traefik.http.routers.preview-resource-web-https.entryPoints"] == "https"
    and $labels["traefik.http.routers.preview-resource-web-https.rule"] == "Host(`pulpo-dev-pr-319.deathgrips.org`) && PathPrefix(`/`)"
    and $labels["traefik.http.routers.preview-resource-web-https.service"] == "preview-resource-web"
    and $labels["traefik.http.routers.preview-resource-web-https.tls"] == "true"
    and $labels["traefik.http.routers.preview-resource-web-https.tls.certresolver"] == "letsencrypt"
    and $labels["traefik.http.services.preview-resource-web.loadbalancer.server.port"] == "80"
    and ($labels | has("traefik.http.services.web.loadbalancer.server.port") | not)
' <<< "${preview_routing_config}" >/dev/null || {
  echo 'Compose did not namespace the HTTPS router and service by Coolify resource.' >&2
  exit 1
}

jq -e '
  .services.postgres.environment as $env
  | $env.POSTGRES_USER == "preview-db-user"
    and $env.POSTGRES_PASSWORD == "preview-database-magic-password"
    and $env.POSTGRES_DB == "pulpo"
' <<< "${compose_config}" >/dev/null || {
  echo 'Compose did not preserve runtime database credentials for Postgres.' >&2
  exit 1
}

jq -e '
  .services["seaweed-s3"] as $service
  | $service.environment.AWS_ACCESS_KEY_ID == "preview-storage-user"
    and $service.environment.AWS_SECRET_ACCESS_KEY == "preview-storage-magic-password"
' <<< "${compose_config}" >/dev/null || {
  echo 'Compose did not preserve runtime object-storage credentials for SeaweedFS.' >&2
  exit 1
}

local_preview_config="$(
  PULPO_ENV_FILE="${PWD}/deploy/local-preview.env.example" \
    docker compose --env-file deploy/local-preview.env.example config --format json
)"

for service in api worker; do
  jq -e --arg service "${service}" '
    .services[$service].environment as $env
    | $env.NODE_ENV == "development"
      and $env.PUBLIC_URL == "http://localhost:8080"
      and $env.POSTGRES_PASSWORD == "pulpo"
      and $env.S3_SECRET_ACCESS_KEY == "pulpo-local-storage-secret"
      and $env.PULPO_INSTANCE_ID == "local-preview"
      and $env.PULPO_BOOTSTRAP_PRESET == "ci-preview"
      and $env.PULPO_PREVIEW_ADMIN_EMAIL == "preview@example.com"
      and $env.PULPO_OLLAMA_URL == "http://ollama:11434"
  ' <<< "${local_preview_config}" >/dev/null || {
    echo "Compose did not preserve local preview template values for ${service}." >&2
    exit 1
  }
done

ollama_override_config="$(
  SERVICE_USER_POSTGRES='preview-db-user' \
    SERVICE_PASSWORD_64_POSTGRES='preview-database-magic-password' \
    SERVICE_USER_S3='preview-storage-user' \
    SERVICE_PASSWORD_64_S3='preview-storage-magic-password' \
    PULPO_OLLAMA_URL='http://external-ollama.example:12000' \
    PULPO_ENV_FILE="${runtime_env}" \
    docker compose --env-file .env.example config --format json
)"

for service in api worker; do
  jq -e --arg service "${service}" '
    .services[$service].environment.PULPO_OLLAMA_URL == "http://external-ollama.example:12000"
  ' <<< "${ollama_override_config}" >/dev/null || {
    echo "Compose did not preserve an explicit Ollama URL override for ${service}." >&2
    exit 1
  }
done

# The office converter is opt-in, and runs untrusted documents only under its restrictions.
jq -e '.services | has("office-converter") | not' <<< "${compose_config}" >/dev/null || {
  echo 'The office converter must only start with the office profile.' >&2
  exit 1
}
for compose_file in compose.yaml deploy/compose.production-infra.yaml deploy/compose.development-infra.yaml; do
  office_config="$(
    SERVICE_USER_POSTGRES='preview-db-user' \
      SERVICE_PASSWORD_64_POSTGRES='preview-database-magic-password' \
      SERVICE_USER_S3='preview-storage-user' \
      SERVICE_PASSWORD_64_S3='preview-storage-magic-password' \
      POSTGRES_USER=user POSTGRES_PASSWORD=password S3_ACCESS_KEY_ID=key S3_SECRET_ACCESS_KEY=secret PULPO_DATA_PREFIX=prefix PULPO_S3_DATA_VOLUME=volume \
      PULPO_ENV_FILE="${runtime_env}" \
      docker compose --env-file .env.example --file "${compose_file}" --profile office config --format json
  )"
  jq -e '
    .services["office-converter"] as $service
    | $service.read_only == true
      and ($service.cap_drop | index("ALL")) != null
      and ($service.security_opt | index("no-new-privileges:true")) != null
      and ($service.tmpfs | length) == 1
      and ($service.dns | index("127.0.0.1")) != null
      and ($service.ports // [] | length) == 0
      and ($service.volumes // [] | length) == 0
      and ($service.healthcheck.test | all(type == "string"))
  ' <<< "${office_config}" >/dev/null || {
    echo "${compose_file} must keep the office converter read-only, unprivileged, without host ports or volumes, and health-checked." >&2
    exit 1
  }
done
for compose_file in deploy/compose.production-infra.yaml deploy/compose.development-infra.yaml; do
  infra_config="$(
    POSTGRES_USER=user POSTGRES_PASSWORD=password S3_ACCESS_KEY_ID=key S3_SECRET_ACCESS_KEY=secret PULPO_DATA_PREFIX=prefix PULPO_S3_DATA_VOLUME=volume \
      docker compose --file "${compose_file}" --profile office config --format json
  )"
  jq -e '
    (.services["office-converter"].networks | keys) == ["office"]
      and .networks.office.internal == true
      and .services["office-converter"].environment.OFFICE_CONVERTER_REQUIRE_TOKEN == "true"
  ' <<< "${infra_config}" >/dev/null || {
    echo "${compose_file} must keep the office converter alone on an internal network and require a token." >&2
    exit 1
  }
  # Without the profile, the infrastructure must still parse exactly as before.
  POSTGRES_USER=user POSTGRES_PASSWORD=password S3_ACCESS_KEY_ID=key S3_SECRET_ACCESS_KEY=secret PULPO_DATA_PREFIX=prefix PULPO_S3_DATA_VOLUME=volume \
    docker compose --file "${compose_file}" config --quiet
done

bash -n scripts/local-preview.sh

echo 'Validated Compose runtime environment precedence for application and infrastructure services.'
