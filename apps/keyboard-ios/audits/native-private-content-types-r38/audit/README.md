R38 development behavior harness
===============================

These audit sources do not modify production code. They never search for cases;
the runner reads only explicitly supplied input/calibration paths. Fixtures here
are development execution smoke, with no heldout coverage claim.

From repository root, compile KeyboardCore directly on macOS:

```sh
python3 apps/keyboard-ios/audits/native-private-content-types-r38/audit/build-core-runner.py /tmp/r38-behavior-build
python3 apps/keyboard-ios/audits/native-private-content-types-r38/audit/verify-development-smoke.py /tmp/r38-behavior-build/r38-behavior
```

`build-core-runner.py` prints the complete `swiftc -swift-version 6
-parse-as-library` command, copies the two `.swift.txt` inputs into the supplied
temporary directory, and compiles those with all KeyboardCore Swift sources.
The CLI is separate from the runner:

```sh
/tmp/r38-behavior-build/r38-behavior CASES.json CALIBRATION.json LANGUAGE_DATA_DIRECTORY OUTPUT.json development
```

Exit codes: 0 for all expectations passing, 1 for retained execution/assertion
failures, 2 for startup/schema/IO errors. Use the last argument `baseline` or
`candidate` to preserve that run label in its output. Output paths are explicit:
use separate paths to retain both runs.

The shared helper is `@MainActor R38BehaviorRunner`, with initializers
`init(calibrationURL:languageDataURL:)` and
`init(calibrationData:languageDataURL:)`. Call
`run(casesData:label:) throws -> Data`. No XCTest or CLI dependencies are in the
macOS runner branch. Every case/language gets a fresh `LanguageStack` with nil
personal/touch URLs. Resources are never built or downloaded by the harness.

For a parent-managed native test build, generate the wrapper with fixed embedded
JSON and copy the runner temporarily into AppTests:

```sh
python3 apps/keyboard-ios/audits/native-private-content-types-r38/audit/prepare-native-wrapper.py \
  apps/keyboard-ios/audits/native-private-content-types-r38/audit/development-smoke-native.json \
  apps/keyboard-ios/audits/native-private-content-types-r38/calibration-baseline.json \
  /tmp/R38BehaviorNativeTests.swift
cp apps/keyboard-ios/audits/native-private-content-types-r38/audit/BehaviorRunner.swift.txt /tmp/R38BehaviorRunner.swift
```

The parent can add those two temporary sources to AppTests and select
`R38BehaviorNativeTests/testDevelopmentBehavior`. Do not add `BehaviorMain` to
AppTests. The wrapper resolves dictionaries using `KeyboardResources.url`, which
finds the embedded keyboard extension bundle. The `.swift.txt` template also
supports device-accessible `R38_CASES_PATH`, `R38_CALIBRATION_PATH`,
`R38_LANGUAGE_DATA_PATH`, `R38_OUTPUT_PATH`, and `R38_RESULT_LABEL` environment
overrides. Its normal output is the app Documents `r38-behavior-native.json`,
plus a keep-always JSON XCTest attachment. A host Mac path is not readable on a
physical device; embedded base64 avoids that dependency. No native build or
device operation is performed by these scripts.

Schema/reporting details
------------------------

The frozen contract remains unchanged. Unknown schema keys and enum values are
errors. `expect.text` and `expect.selection` are required on every step. Optional
expected properties are compared only when present; text uses exact UTF-16 unit
comparison, counts and weights use exact equality, and `plain` checks each of
the seven bits individually. The inactive platform's expected keys are retained
and listed as inactive. Acceptance keys refer to direct `automatic`/`confirm`
guard challenges, and must be explicitly supplied for the active platform on
those operations. Missing declarations fail even when a challenge refuses.

`automaticCore`/`automaticNative` snapshots describe permission at the recorded
post-step destination. Challenge acceptance is recorded separately under
`action`, including the pre-insertion destination/guard. Other platform actuals
are null. Native `TextViewDocument` has no ID: automatic permission stays false,
its outcome is `unavailable`, and it earns no explicit-refusal credit. Without a
guard origin, permission is false and availability is `noOrigin`. Confirmation
is measured independently of document identity. No recorder/controller start or
recovery is claimed. Only `invalidateGuard` explicitly invalidates the captured
guard; field/host changes still test the real guard's destination comparison.

Missing captures clear any previous choice and record an error. Choosing with
no capture records another error. Runtime operation/assertion failures never
stop later steps. Failed setup records its error and retains the entire input.
Pair counts are public `PersonalDictionary.successors` readbacks for the tracked
input/output vocabulary; normal positive controls verify the corresponding
`pairCount` evidence. Word counts, total count, and touch weight are also public
model readbacks. Expected text is used only as an oracle and vocabulary probe;
it never changes engine behavior or generates policy expectations.

`development-smoke.json` covers every operation and all four capture kinds on
core. `development-smoke-native.json` has independent literal text expectations
where the missing native document ID prevents automatic insertion.
`development-errors-smoke.json` intentionally produces 18 failures across the
three languages, while proving continued execution after failed captures,
missing choices/origins, invalid UTF-16 selection and missing acceptance keys.
The verification script asserts that behavior and saves both full core reports in a fresh temporary directory (or an explicit --output-directory), preserving the frozen archives.
