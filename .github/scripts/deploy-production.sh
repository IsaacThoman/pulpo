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
