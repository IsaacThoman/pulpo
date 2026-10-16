#!/bin/bash
set -euo pipefail
# R17 owns this simulator only. Native runs must stay serialized.
repo=$(git rev-parse --show-toplevel)
phase=${1:-development}
output=${2:-/tmp/pulpo-r17}
mkdir -p "$output"
case "$phase" in
  exploration) only='PulpoKeyboardUITests/EditingUXR17Tests/testBlindExploration' ;;
  accessibility) only='PulpoKeyboardUITests/EditingUXR17Tests/testBlindAccessibilityExploration' ;;
  *) echo "Unknown phase: $phase" >&2; exit 2 ;;
esac
xcodegen generate --spec "$repo/apps/keyboard-ios/project.yml"
python3 "$repo/apps/keyboard-ios/scripts/simulator_keyboard.py" 7E1D7979-7307-4C53-8466-BB41154B383C
xcodebuild -project "$repo/apps/keyboard-ios/PulpoKeyboard.xcodeproj" -scheme PulpoKeyboard \
  -destination 'platform=iOS Simulator,id=7E1D7979-7307-4C53-8466-BB41154B383C' \
  -derivedDataPath "$output/native" -parallel-testing-enabled NO -collect-test-diagnostics never \
  -only-testing:"$only" test > "$output/$phase-build.txt" 2>&1
