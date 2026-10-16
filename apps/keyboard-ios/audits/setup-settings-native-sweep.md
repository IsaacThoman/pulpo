# PR782 independent native setup/settings/privacy sweep

## Frozen protocol (before source, tests, or prior audit inspection)

Baseline: `5153837dbc25913d03a03ee53fe972589f844213`. Scope: the iOS companion app and keyboard extension's setup state, language preferences, permission transitions, reset/learning explanations, and keyboard dismissal. Expectations below are specified from the user brief and ordinary iOS user expectations, not inferred from implementation or existing tests. This is a coherent preference/setup continuity sweep, not an exhaustive application checklist.

Excluded: language models/dictionaries/assets; cache/performance; Suggester/typo ranking; inserted-text spacing; dictation sessions/destinations/return paths; selected-range reconciliation; Shift algorithms; key layouts/alternates. No production server, real-account messages, physical deployment, parent changes, or push. Only assigned iPhone 17 `1EDC5D9A-7E25-432A-B5B1-9A8B702306A7`; build output `/tmp/pulpo-settings-native-build`.

### Development tasks

- D1 Setup truth: open the companion before/after enabling its keyboard in iOS Settings. Setup instructions must distinguish installation/enabling from Full Access, reflect actual current state on return, and never imply that simply opening Settings completes setup.
- D2 Language continuity: select English, Spanish, and bilingual in companion settings, reopen the app and extension. Each explicit choice must persist and agree across the two surfaces when shared storage is available; labels must identify the active choice. Defaults must be deterministic.
- D3 Surface ownership: open settings from the companion and from the keyboard. Explain controls in the context where they take effect; make companion navigation and return/dismissal reachable. An extension-only limitation must not be represented as a successful global settings change.
- D4 Permission transition: inspect Full Access off, then on, then off again. Explain what permission enables and what still works without it; refresh state on returning from iOS Settings. Do not claim all local typing requires permission or promise unavailable capabilities.
- D5 Reset and learning: inspect personalization controls and any destructive reset. State what is learned, where it remains, and what reset removes. Require explicit confirmation for destructive learning reset; cancellation preserves preferences and learning. Avoid implying that learning reset changes language or iOS permission.
- D6 Keyboard show/hide: open the companion's local typing preview, show keyboard, open/dismiss settings, then hide keyboard and focus again. Reachable dismissal must work and reopening must remain possible without abandoning the page.

### Held-out tasks (do not execute until candidate selection is frozen)

- H1 Cold preference transfer: choose Spanish in one surface, terminate the companion, reopen the other surface, then choose bilingual and revisit the first. Expected: last explicit choice survives and remains consistent whenever the app group is available; no silent English fallback overwrites it.
- H2 Permission recovery: with Spanish selected, revoke Full Access in iOS Settings, revisit companion setup, re-enable it and return. Expected: permission status updates on each return, language survives, and local typing remains available where supported.
- H3 Destructive-action boundary: choose bilingual, cancel learning reset, then confirm learning reset and reopen settings. Expected: clear confirmation and accurate scope; language, setup state and permission remain unchanged.
- H4 Dismissal recovery: enter local preview text, dismiss keyboard through an available UI action, open/close settings, then focus the same field. Expected: text retained, settings closes, keyboard can be shown again; no external service required.

### Selection and acceptance

Inspect and exercise D1–D6 first. Select only reproducible, worthwhile production behavior/copy defects within this scope, then freeze candidate selection before evaluating H1–H4 once. Favor a general state/ownership fix over fixture-specific behavior. Validate changed production paths with native build and focused meaningful regression coverage. Record blocked/unpassed expectations separately from passes; simulator accessibility limitations are not product bugs. Do not broaden to excluded subsystems to obtain a pass. Held-out results may reveal limits but do not become an iterative tuning set.

### Evidence and reporting

Keep screenshots, transient harnesses and build output outside Git, under `/tmp/pulpo-settings-native-evidence` where applicable. Record exact protocol/implementation commits, commands, actual results and limitations here. Device tools attempted first: `device_list` reported iOS available but host failure `Device list failed: The device command failed (exit code 127).`; `device_open` returned the same error. Use the user-supplied pinned agent-device launcher/config/session fallback. Never read build logs unless the build command indicates an error.

## Development inspection and candidate selection

Protocol commit: `b4090f3a`. Initial native `build-for-testing` succeeded (exit 0), using the isolated project generated in this checkout and `/tmp/pulpo-settings-native-build`; successful build log not read.

D2/D3 live preview: opened Try It, selected Español from EN, and observed the ES label and Spanish initial suggestions. Companion settings is available through the language menu. Source inspection confirms shared `SettingsStore` for companion/Full Access and a persistent extension-local store without Full Access. No claim of cross-container synchronization when Full Access is off.

D1/D4: setup uses real enabled-keyboard state and last installed-keyboard appearance, with distinct unknown/on/off permission states. Opening Settings does not itself confirm permission. Existing native setup/privacy and permission tests selected for development execution; remote extension AX absence may block their key-based assertions. No production permission change selected from source inspection alone.

D5: both destructive operations require confirmation. `clearLearnedWords()` clears the personal dictionary and learned touch adjustments, while settings reset resets preferences and one-handed mode. Language is unaffected by learning clear. The learning-clear dialog omitted touch adjustments, so its description understated the destructive scope.

D6 reproduced visually and in the AX snapshot: Try It offers Tips/Clear but no keyboard-dismiss action; the preview is passed a constant `focused: true` and re-requests first responder on subsequent updates. Evidence: `/tmp/pulpo-settings-native-evidence/development-preview-before.png`. Device screenshot tool failed (`Device screenshot failed.`); screenshot captured with assigned-UDID `simctl io` instead.

**Selection frozen before held-out evaluation:** (1) add an accessible Hide Keyboard action for both preview and installed-field modes, make preview focus bidirectional and current-binding-safe, and forward actual preview appear/disappear lifecycle; (2) accurately describe learned touch adjustments and preserved language/settings in the learning-clear confirmation. No selected change to permission inference, language stores, learning algorithms, keyboard layout, or excluded subsystems. Held-out H1–H4 will be evaluated once after implementation selection. Native failures and unexecuted acceptance will be reported explicitly.

## Implementation and native validation

Implementation commit: `dd61eda6a287b7798908b3871566e5e28bd6e6c3`. The focus bridge updates the coordinator's bindings, handles UIKit begin/end editing, guards queued focus requests against a later dismissal, and forwards keyboard-controller visibility lifecycle on actual focus changes. Try It offers a labeled/identified Hide Keyboard action in both modes. No keyboard key or algorithm is changed. The learning-clear confirmation now discloses touch adjustments and explicitly preserves language/settings.

Commands (from this isolated checkout; all native destinations explicitly pin the assigned iPhone 17):

```sh
cd apps/keyboard-ios && xcodegen generate
xcodebuild -project apps/keyboard-ios/PulpoKeyboard.xcodeproj -scheme PulpoKeyboard \
  -destination 'platform=iOS Simulator,id=1EDC5D9A-7E25-432A-B5B1-9A8B702306A7' \
  -derivedDataPath /tmp/pulpo-settings-native-build build-for-testing
# For each test selection below, same project/scheme/destination/DerivedData:
xcodebuild ... -parallel-testing-enabled NO -only-testing:PulpoKeyboardUITests/<selection> \
  test-without-building -resultBundlePath /tmp/pulpo-settings-native-evidence/<result>.xcresult
xcrun xcresulttool get test-results summary --path <result>.xcresult --compact
xcrun xcresulttool export attachments --path <result>.xcresult --output-path <attachments>
```

All stdout/stderr redirected outside Git. `build-before.log` and `build-after.log` each exited 0 and were not read. Native development selection, `development.xcresult`: **4 passed, 0 failed, 0 skipped** on iOS 27.0 iPhone 17:

- `SetupGuideTests/testGuideShowsLiveStepsAndPrivacy`
- `SetupGuideTests/testKeyboardWithoutFullAccessIsReported`
- `SetupGuideTests/testInAppPreviewDoesNotConfirmFullAccess`
- `KeyboardLanguageTests/testHostSettingsAndKeyboardShareLanguageSelection`

Native selected-fix regression, `dismissal-regression.xcresult`: **2 passed, 0 failed, 0 skipped**: `PreviewDismissalTests/testHideAndRefocusPreviewPreservesTextAndClearBinding` and `testInstalledFieldCanHideAndRefocusWithoutLosingText`. They check actual dismissal, retained text, no forced reappearance after a SwiftUI update, and editable/re-clearable text after refocusing. The installed-field test does not depend on remote extension key AX.

Observed screenshots outside Git in `/tmp/pulpo-settings-native-evidence`: `development-preview-before.png` (no dismiss control); `setup-guide-start.png`; `setup-privacy.png`; `setup-guide-full-access-off.png` (actual installed keyboard and truthful Off state); `preview-dismissal-refocused.png` (new Hide Keyboard control, reopened keyboard, Clear/Tips remain reachable). Original screenshots/attachment manifests and complete result bundles are retained in the same directory.

Held-out harness archived outside Git as `HeldOutSettingsSweepTests.swift`, SHA-256 `0b8c8740cd66f85ca8e16e5601bc4758b1d009027081f2bf28c54d2f37df7fbd`. One run only: `HeldOutSettingsSweepTests` plus `SetupGuideTests/testH2PermissionRecoveryPreservesLanguage`, result bundle `heldout-once.xcresult`. The transient harness is removed from the checkout after evaluation; held-out outcomes are not used to tune production.

## One-shot held-out outcomes and limitations

The held-out test log records all four cases completed in 151.233 seconds: **1 passed, 3 failed, 0 skipped**. Xcode subsequently stalled while finalizing its operations/result bundle. After over ten minutes total, SIGINT did not finish it; SIGTERM ended the command with exit **143**. The bundle has Data/Staging but no finalized Info.plist; do not treat it as a valid complete xcresult. The raw `heldout-once.log` was read only after the command reported this failure. Its case-level results are the evidence below. A final clean-source project regeneration/build was performed while this xcodebuild process remained active; that overlap may have interfered with result finalization. This is a harness/procedure limitation, not evidence of a production hang. The final regression command runs alone, with no overlapping project generation/build. No held-out rerun or production tuning followed.

- **H1: native test passed (25.289s).** Spanish survives companion termination into the in-app preview, and bilingual chosen there returns to the companion picker. This exercises shared production settings/controller paths, but is not independent proof of a cold installed-extension process reading the same choice.
- **H2: failed/incomplete acceptance (77.702s), harness obstruction.** Revoking Full Access succeeds, but tapping the setup field did not show the installed keyboard. The failure hierarchy places the field at y=817…859 and the pinned Open Settings action at y=778…830; unlike the existing development helper, the one-shot harness did not scroll the field above that action or explicitly switch keyboards. Setup remains truthfully `Not confirmed yet` rather than the expected `Off`. The existing native development test *did* pass both actual installed-keyboard permission transitions. Independent read-only group-preference observation after revocation records `language: es` in `shared-preferences-after-revoke.json`. Language plus full permission recovery as a combined held-out task remains unpassed. No permission-state product fix is inferred from the failed harness.
- **H3: failed/incomplete acceptance (27.347s), harness obstruction.** The clear confirmation and new touch-adjustment description appear. The harness assumes an explicit `Cancel` button, but iOS 27 presents no matching button for this confirmation presentation (`Failed to tap "Cancel" Button: No matches found`). It stops before confirming reset. Cancellation/data removal and subsequent language preservation therefore remain unpassed; learned data was not seeded/count-verified. No claim that this is a product inability to cancel: outside-tap/system dismissal was not evaluated in this one-shot case.
- **H4: genuine unmet product acceptance (20.887s).** Hide/refocus and Tips-sheet dismissal retain `Hola`. Following Keyboard Settings and re-entering Try It produces `""` rather than `"Hola"`. The navigation route clears `HomeView.path`, destroying Try It's local `@State` text. This is a worthwhile follow-up for preserving a scratch draft across companion settings navigation. It is outside the frozen selected fix and was **not fixed/tuned** against held-out evidence. The selected fix preserves the field while it remains on the page; it does not promise navigation lifetime persistence.

Observed late screenshots (`heldout-progress-observation.png`, `heldout-progress-late.png`) show actual iOS Settings with keyboard enabled and Full Access off. Full Access was restored afterward through the pinned device CLI and the system Allow confirmation; the post-action snapshot reports both switches `1`. This restoration is cleanup, not another held-out evaluation.

Additional limits: no physical-device validation, clean reinstall, account/network flow, or explicit native add/remove-keyboard round-trip; initial simulator already had the extension enabled. Settings-reset implementation was inspected, not destructively exercised. Default English and shared/local settings ownership were inspected; shared companion/preview continuity was exercised, while cold extension-local preference transitions were not comprehensively asserted. Excluded subsystems were not changed. Existing tests use their own reset flags in the isolated simulator; no parent checkout, other simulator, language data/assets, or production server was mutated.

Pinned CLI used for all agent-device calls (with `snapshot -i`, `open`, or `tap` before the flags):

```sh
/Users/isaacthoman/.t3/userdata/device/bin/agent-device snapshot -i \
  --platform ios --udid 1EDC5D9A-7E25-432A-B5B1-9A8B702306A7 \
  --config /Users/isaacthoman/.t3/userdata/device/hosts/25bf8e1a2393f1108d37029b.json \
  --session t3-049b8d6a3178083de18d10fd
```

PR782 was registered with T3 (`link_pull_request` succeeded and `list_thread_pull_requests` confirmed it, not watching). No push, PR-content edit, merge, or physical deployment was performed.

## Final regression result

After removing the transient harness and regenerating the isolated project, `build-final.log` exited **0** (successful log not read). Strengthened the installed-field regression to wait for its Hide Keyboard action to re-enable after refocusing. `final-regression.xcresult` is finalized and valid: **4 passed, 0 failed, 0 skipped**, no runtime warnings, iPhone 17/iOS 27.0, command exit **0**. Selected final tests: both `PreviewDismissalTests`, `KeyboardLanguageTests/testHostSettingsAndKeyboardShareLanguageSelection`, and `SetupGuideTests/testInAppPreviewDoesNotConfirmFullAccess`. This confirms changed production preview lifecycle preserves shared-language routing and cannot falsely mark installed setup complete. Held-out cases were excluded from final validation and never rerun. Final summary JSON and exported attachments are retained beside the valid bundle outside Git. `git diff --check` passed.

Simulator cleanup: reopened Try It, selected Installed Keyboard to restore a real keyboard appearance after test heartbeat resets, observed the Pulpo keyboard visually (`cleanup-installed-keyboard.png`; remote AX keys still absent as expected), and returned to the companion home screen. Full Access and keyboard remain enabled. iPhone 17 is released to the parent when this task returns; no sweep-owned xcodebuild remains active.
