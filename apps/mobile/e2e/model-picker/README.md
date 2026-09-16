# Model picker and native startup checks

Use disposable simulators with the current native build and Metro started with
`EXPO_PUBLIC_DEFAULT_INSTANCE_URL=http://localhost:8091`. Run
`node apps/mobile/e2e/model-picker-fixture.mjs` from the repository root.
This loopback fixture exercises the production mobile UI without a database,
production account, or model calls. Android also needs `adb reverse` for ports
8091 and 8081. Login: `picker@example.test` / `Picker-test-only-2026`.

Run `maestro --device <id> test apps/mobile/e2e/model-picker/login.yaml`, then
`maestro --device <id> test apps/mobile/e2e/model-picker/menu.yaml`.
The menu flow checks Favorites, changing labs, selecting models, and resuming
from the background. It finishes with Picker Alpha selected for another run.
Use Maestro's `--test-output-dir` outside the repository for raw artifacts.

Repeat the menu flow with enlarged system text:

- iOS: `xcrun simctl ui <id> content_size accessibility-extra-extra-extra-large`.
- Android: `adb -s <id> shell settings put system font_scale 2.0`.

Restore the simulator's original text size after the run. Check cold launches
and warm/cold `pulpo://` links separately on iOS 27 and iOS 26.5.

The iOS 27 launch regression terminates in
`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption` before JavaScript
loads. The Expo config plugin registers `PulpoSceneDelegate` and moves window
creation to scene connection, preserving the single React Native runtime and
forwarding links and lifecycle events to Expo's existing app delegate handlers.

## Build and harness notes

Use a locally signed iOS simulator build: SecureStore needs an app signature
for Keychain access. An unsigned simulator build starts but cannot save login.
Android builds were made with the JDK bundled with Android Studio (JDK 21).
When using `adb reverse`, set the React Native debug server to
`localhost:8081` in the development settings. Clearing Android app data removes
that setting. The login flow targets a fresh install; dismiss first-run system
password/keyboard prompts before running the picker flow. On the tested iOS
runtimes, Maestro could not see the password prompt's buttons in the
accessibility tree, so “Not Now” was dismissed manually during setup.

Run `startup.yaml` for cold launch and warm/cold URL-opening checks. This checks
that links open the app; it does not exercise authenticated shortcut actions,
universal-link association, attachment imports, or production model responses.

## Validation — 2026-09-15

The physical iPhone crash report ended in
`UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption`, before React
Native loaded. Its executable UUID matched the deployed SDK 27 build. Apple
requires scene adoption for apps built with the iOS 27 SDK:
[UIKit scene lifecycle migration](https://developer.apple.com/documentation/uikit/transitioning-to-the-uikit-scene-based-life-cycle).

- Android 17 / API 37 emulator: favorites, labs, selection, background/resume,
  and cold launch passed at default and 200% text.
- iOS 27 simulator: favorites, labs, selection, background/resume, and cold
  launch passed. Maximum accessibility text exposed an overflowing header
  label; constraining the native label fixed it, and selection was rechecked.
- iOS 26.5 simulator: the same normal-text menu flow and cold launch passed;
  maximum accessibility text also passed model selection.
- Warm and cold `pulpo://` app opening passed on both iOS versions.
- Both native debug builds compiled. Mobile typecheck, targeted lint, and
  44 unit tests passed (scene config, model menu/preferences, file URL routing,
  and shortcut inbox).

These runs use the real native controls with the isolated catalog fixture.
Screenshots, native crash reports, and Maestro output stay outside the repo.
