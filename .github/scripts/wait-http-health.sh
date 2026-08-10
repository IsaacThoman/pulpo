#!/usr/bin/env bash
set -euo pipefail

health_url="${1:?health URL is required}"
description="${2:-deployment}"
attempts="${3:-60}"
delay_seconds="${4:-2}"

for ((attempt = 1; attempt <= attempts; attempt += 1)); do
  response=''
  if response="$(curl --fail --silent --max-time 10 "${health_url}")" \
    && jq -e '.status == "ok"' <<< "${response}" >/dev/null 2>&1; then
    echo "${description} health check passed: ${health_url}"
    exit 0
  fi

  if (( attempt % 10 == 0 )); then
    echo "Waiting for ${description} health endpoint (${attempt}/${attempts})…"
  fi
  sleep "${delay_seconds}"
done

echo "${description} health endpoint did not become ready: ${health_url}" >&2
curl --fail --show-error --max-time 10 "${health_url}" >&2 || true
exit 1
