#!/usr/bin/env bash
set -euo pipefail

commit_sha="${1:?release commit SHA is required}"
: "${COOLIFY_APP_UUID:?production API UUID is required}"
: "${COOLIFY_WORKER_APP_UUID:?production worker UUID is required}"
: "${COOLIFY_WEB_APP_UUID:?production web UUID is required}"
if [[ "$COOLIFY_APP_UUID" == "$COOLIFY_WORKER_APP_UUID" || "$COOLIFY_APP_UUID" == "$COOLIFY_WEB_APP_UUID" || "$COOLIFY_WORKER_APP_UUID" == "$COOLIFY_WEB_APP_UUID" ]]; then
  echo 'Production API, worker, and web must be separate Coolify applications.' >&2
  exit 1
fi

# Reject configuration drift before touching any application. Orphan removal
# deletes the serving container before replacement readiness is known.
for application_uuid in "$COOLIFY_APP_UUID" "$COOLIFY_WORKER_APP_UUID" "$COOLIFY_WEB_APP_UUID"; do
  coolify app get "$application_uuid" --format json | \
    jq -e '.build_pack == "dockerfile" and .health_check_enabled == true' >/dev/null || {
      echo "Production application $application_uuid must use Dockerfile deployment with health checks." >&2
      exit 1
    }
  coolify app env list "$application_uuid" --format json | \
    jq -e '[.[] | select(.key == "COMPOSE_REMOVE_ORPHANS" and .is_preview != true)] | length > 0 and all(.value == "false" or .value == "0")' >/dev/null || {
      echo "Set COMPOSE_REMOVE_ORPHANS=false on production application $application_uuid before deploying." >&2
      exit 1
    }
done

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
deployment_output="$(mktemp)"
trap 'rm -f "$deployment_output"' EXIT

# The API image runs locked migrations before opening its listener. Coolify
# retains the previous API unless the replacement's readiness check passes.
# Do not update consumers or clients until that schema/API gate succeeds.
for application_uuid in "$COOLIFY_APP_UUID" "$COOLIFY_WORKER_APP_UUID" "$COOLIFY_WEB_APP_UUID"; do
  : > "$deployment_output"
  COOLIFY_APP_UUID="$application_uuid" GITHUB_OUTPUT="$deployment_output" \
    bash "$script_dir/deploy-coolify-commit.sh" "$commit_sha"
  deployment_uuid="$(sed -n 's/^deployment_uuid=//p' "$deployment_output")"
  [[ -n "$deployment_uuid" ]] || { echo 'Missing deployment UUID.' >&2; exit 1; }
  bash "$script_dir/wait-coolify-deployment.sh" "$deployment_uuid"
done
