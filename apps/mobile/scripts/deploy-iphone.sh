#!/usr/bin/env bash

set -u

readonly script_directory="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
readonly mobile_directory="$(cd "${script_directory}/.." && pwd)"
readonly device_name="${PULPO_IOS_DEVICE:-Isaac iphone}"
readonly instance_url="${PULPO_INSTANCE_URL:-https://pulpo.baby}"
readonly deploy_log="${PULPO_IOS_DEPLOY_LOG:-/tmp/pulpo-ios-deploy.log}"

echo "Deploying Pulpo Release to ${device_name}…"

if (
  cd "${mobile_directory}"
  EXPO_PUBLIC_DEFAULT_INSTANCE_URL="${instance_url}" \
    npx expo run:ios \
      --device "${device_name}" \
      --configuration Release \
      --no-bundler &&
  xcrun devicectl device process launch \
    --device "${device_name}" \
    com.isaacthoman.pulpo
) >"${deploy_log}" 2>&1; then
  echo "Deployed and launched Pulpo Release on ${device_name}."
  echo "Full log: ${deploy_log}"
else
  readonly status=$?
  echo "Deployment failed. Full log: ${deploy_log}" >&2
  echo "Last 80 log lines:" >&2
  tail -n 80 "${deploy_log}" >&2
  exit "${status}"
fi
