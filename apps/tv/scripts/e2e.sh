#!/usr/bin/env bash
# Run the Siri Remote UI tests against the Pulpo app installed on a tvOS simulator.
#   PULPO_EMAIL=… PULPO_PASSWORD=… apps/tv/scripts/e2e.sh <simulator-udid> [-only-testing:PulpoTVUITests/RemoteTests/testX]
set -euo pipefail
cd "$(dirname "$0")/../e2e"
simulator="${1:?Pass the tvOS simulator UDID}"
shift
: "${PULPO_EMAIL:?Set PULPO_EMAIL}" "${PULPO_PASSWORD:?Set PULPO_PASSWORD}"
xcodegen generate --quiet
TEST_RUNNER_PULPO_EMAIL="$PULPO_EMAIL" TEST_RUNNER_PULPO_PASSWORD="$PULPO_PASSWORD" \
  xcodebuild test -project PulpoTVE2E.xcodeproj -scheme PulpoTVUITests \
  -destination "id=$simulator" -derivedDataPath build -parallel-testing-enabled NO "$@"
