#!/bin/zsh
set -e
# Prerequisite: no live build/task uses either R11 cache. Inputs/client were frozen before the recorded run.
root=/Users/isaacthoman/.t3/worktrees/pulpo/t3-131c283c
out=/tmp/pulpo-r11-review-diagnostic
baseline=/tmp/pulpo-r11-baseline/apps/keyboard-ios/PulpoKeyboardKit/.build/out/Products/Release
candidate=$root/apps/keyboard-ios/PulpoKeyboardKit/.build/out/Products/Release
swiftc -O -I "$baseline" -L "$baseline" -lKeyboardCore "$out/Client.swift" -o "$out/baseline-client"
swiftc -O -I "$candidate" -L "$candidate" -lKeyboardCore "$out/Client.swift" -o "$out/candidate-client"
"$out/baseline-client" "$out/cases.json" "$root/apps/keyboard-ios/LanguageData" "$out/baseline.json"
"$out/candidate-client" "$out/cases.json" "$root/apps/keyboard-ios/LanguageData" "$out/candidate.json"
