# R42 exposed validation execution

Owned simulator: `5D99D484-2D74-4F77-A3BA-223BBCC13B9F`, created with device type `com.apple.CoreSimulator.SimDeviceType.iPhone-17` and runtime `com.apple.CoreSimulator.SimRuntime.iOS-27-0` (24A434). Every native command pins this UUID. `device_list` twice returned `Device list failed: The device command failed (exit code 127).` `device_open` twice returned `No device 5D99D484-2D74-4F77-A3BA-223BBCC13B9F on host local. Call device_list for current ids.` iOS was reported available. The authorized CoreSimulator/XCTest fallback was used. The original iPhone17, other workers' devices and protected paths were never driven/reset/cleared.

Project generated using `xcodegen generate --spec apps/keyboard-ios/project.yml`. Own DerivedData `/tmp/pulpo-r42-derived`; output `/tmp/pulpo-r42-validation`. All xcodebuild invocations use this project/scheme, destination `platform=iOS Simulator,id=5D99D484-2D74-4F77-A3BA-223BBCC13B9F`, `-parallel-testing-enabled NO -collect-test-diagnostics never`. Build output is redirected. Structured summaries are obtained with `xcrun xcresulttool get test-results summary --path RESULT --format json`. Successful build/test logs were never read.

- `swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --scratch-path /tmp/pulpo-r42-swift --filter PulpoClientTests`: exit0. Focused services verification. No full core rerun.
- Initial `xcodebuild test ... -only-testing:PulpoKeyboardAppTests CODE_SIGNING_ALLOWED=NO`: exit65; 22 pass, 5 failing tests, 1 skip. Four account tests encountered session-storage failure; one previously known PreviewInputView lifetime countercheck failed. All receipts retained. This invocation was a parent build-configuration error, not a source/oracle alteration or successful Keychain fault-injection test.
- Standard-signing `xcodebuild test ... -only-testing:PulpoKeyboardAppTests/AccountLifecycleR35Tests`: exit0, all6 account/presentation tests passed. Same six imported source/test bytes; removing the signing override was the only build change. No unsupported OSStatus is inferred from a Bool failure.
- UI runs use the separately frozen `AccountLifecycleR42UITests.swift`, fake loopback native-server.py, and `TEST_RUNNER_R35_NATIVE_SERVER` / `TEST_RUNNER_R35_NATIVE_EVIDENCE` environment variables. `xcrun simctl ui UUID content_size large` or `accessibility-extra-extra-extra-large` selects system text size. The repository simulator_keyboard.py was called with exactly the owned UUID. Native screenshots and structured summaries record actual actions/outcomes; no model callback drives dismissal.

Original R35 source/runner/schema/comparison remains frozen. The R42 normal/-O explicit verifier reads all24 pairs, exact step inventories, every checkpoint memory/persisted/snapshot verdict, tasks, issuance/dispositions, request bodies/bearers, and event counters. The historical normal-mode schema/comparison also pass; recomputed comparison is byte-identical to its archived original. The original assert-based scripts are not claimed to enforce checks with -O. Six independent malformed-report probes are rejected by the new explicit verifier. Native parent validation is exposed development evidence; no new blind accuracy gain or benchmark timing claim is made.

Exposed UI execution inventory (all runs serial on the owned simulator):

- Normal v1, frozen driver v1, all3 account UI tests: exit65,2 pass/1 fail; Cancel root sign-in hit assertion failed after full-screen scrolling.
- Normal v2, frozen driver v2, all3: exit0,3 pass.
- Largest v2, same driver v2, all3: exit65,2 pass/1 fail; navigation-bar-center drag left the sign-in sheet present. No signed-out account assertion reached in that case.
- Largest v3, frozen driver v3, all3: exit0,3 pass. Before/after screenshots prove top-right chrome drag dismissal, actual signed-out account root after held-response release and relaunch, then successful retry. The preceding attempted Form scrolling displayed Select All, not a proven return to top.
- Normal v3, frozen driver v3, changed drag workflow only: exit0,1 pass. It reruns only the changed drag workflow; unchanged Cancel/Settings and 2FA retain their full normal-v2 execution. This is an exposed fixture-driver check, not a conditional blind case rerun.

All original pinned R35 replay/native sources are archival evidence; R42 did not execute their original-device replay commands.

Final static check: active source/tests/audit code pass diff whitespace validation. The unrestricted archival check flags unified-diff blank context lines and one exact failed-gesture log line; those historical bytes are deliberately preserved, not reformatted. No code/timing check was relaxed.
