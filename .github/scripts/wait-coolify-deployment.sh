#!/usr/bin/env bash
set -euo pipefail

deployment_uuid="${1:?deployment uuid is required}"

for attempt in $(seq 1 180); do
  deployment="$(coolify deploy get "${deployment_uuid}" --format json)"
  status="$(jq -r '.status // empty' <<< "${deployment}")"
  case "${status}" in
    finished)
      echo "Coolify deployment ${deployment_uuid} finished successfully."
      exit 0
      ;;
    failed|failed-*|cancelled|cancelled-*)
      echo "Coolify deployment ${deployment_uuid} ended with status ${status}." >&2
      exit 1
      ;;
    queued|in_progress|running|pending|'')
      if (( attempt % 6 == 0 )); then echo "Waiting for Coolify deployment ${deployment_uuid} (${status:-unknown})…"; fi
      sleep 10
      ;;
    *)
      echo "Coolify deployment ${deployment_uuid} reported ${status}; continuing to wait."
      sleep 10
      ;;
  esac
done

echo "Coolify deployment ${deployment_uuid} did not finish within 30 minutes." >&2
exit 1
