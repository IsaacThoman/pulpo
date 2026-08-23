#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
template_file="${repository_root}/.env.selfhost.example"
target_file="${PULPO_SELFHOST_ENV_FILE:-${repository_root}/.env.selfhost}"
public_url="${1:-http://localhost:8080}"

usage() {
  cat <<'EOF'
Usage: ./scripts/self-host-init.sh [PUBLIC_URL]

Creates .env.selfhost with generated database and encryption secrets. HTTP is
accepted only for localhost; use the final HTTPS URL for a network deployment.
Set PULPO_SELFHOST_ENV_FILE to write to a different path.
EOF
}

if [[ "${public_url}" == "-h" || "${public_url}" == "--help" ]]; then
  usage
  exit 0
fi

case "${public_url}" in
  https://*) cookie_secure=true ;;
  http://localhost|http://localhost:*|http://127.0.0.1|http://127.0.0.1:*|http://\[::1\]|http://\[::1\]:*) cookie_secure=false ;;
  *)
    echo "PUBLIC_URL must use HTTPS unless it points to localhost." >&2
    exit 1
    ;;
esac

command -v openssl >/dev/null 2>&1 || {
  echo "openssl is required to generate deployment secrets." >&2
  exit 1
}
command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1 || {
  echo "Docker with the Compose plugin is required." >&2
  exit 1
}

if [[ -e "${target_file}" ]]; then
  echo "Refusing to overwrite existing configuration: ${target_file}" >&2
  exit 1
fi

umask 077
cp "${template_file}" "${target_file}"

replace_value() {
  local key="$1"
  local value="$2"
  local temporary
  temporary="$(mktemp "${target_file}.XXXXXX")"
  awk -v key="${key}" -v value="${value}" '
    index($0, key "=") == 1 { print key "=" value; next }
    { print }
  ' "${target_file}" > "${temporary}"
  mv "${temporary}" "${target_file}"
}

replace_value PUBLIC_URL "${public_url%/}"
replace_value COOKIE_SECURE "${cookie_secure}"
replace_value POSTGRES_PASSWORD "$(openssl rand -hex 32)"
replace_value ENCRYPTION_KEY "$(openssl rand -hex 32)"

PULPO_SELFHOST_ENV_FILE="${target_file}" docker compose \
  --project-directory "${repository_root}" \
  --env-file "${target_file}" \
  -f "${repository_root}/compose.selfhost.yaml" \
  config --quiet

echo "Created ${target_file} with mode 0600."
echo "Review it, then start Pulpo with:"
echo "docker compose -f compose.selfhost.yaml --env-file ${target_file} up --build -d"
