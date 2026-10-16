# PR782 Try It draft continuity follow-up

## Protocol frozen before implementation

Baseline: `7f6def76`, after cherry-picking reviewed settings commits `b4090f3a`, `1d7c51d1`, `dd61eda6`, `b091ea83` as `3e06e6e1`, `324bbfae`, `7ab9598c`, `7f6def76`. Prior H4 (empty draft after Keyboard Settings navigation) is now a development case. The development protocol below makes no fresh held-out or independent-author claim. Inputs are synthetic; no user text/accounts/services.

Acceptance fixed before production edits:

- D1 Settings round trip: type `hola`, open Keyboard Settings from the preview language menu, re-enter Try It. Preserve exact text. Hide/refocus before navigating back and returning; preserve text without automatically reopening a dismissed keyboard. Actual Settings route and ordinary navigation must both retain the same draft.
- D2 UTF-16 editing: recreate the native editor with `A👩🏽‍💻 café 🇪🇸 Z`, first with a caret after the first emoji and then with a selected `café`. Restore text before range and before optional focus; insertion must land at that caret or replace only the selection, preserving emoji and suffix. Exercise focused restoration as well as dismissed restoration. Invalid/stale/overflowing ranges must remain bounded to the restored text; valid UTF-16 ranges must remain exact.
- D3 Clear: clear while dismissed with a nonzero selected range, navigate away/back and switch editor mode. Text stays empty, selection is `{0,0}`, keyboard stays dismissed; subsequent typing is usable. Clear is explicit and clears memory state, with no disk persistence.
- D4 Preview/installed switching: retain the same draft and UTF-16 selection through both directions; the installed editor uses the system input view. Dismissed intent survives mode changes; focused switching remains editable. Also retain selected field kind and mode across Settings navigation.
- D5 Teardown: hold a removed editor's delegate and enqueue a focus/selection refresh, dismantle it, create its replacement, then deliver old callbacks. Old text, range, focus and URL callbacks must not overwrite or act on the live draft. Lifecycle disappearance must still run.
- Regressions: existing two PreviewDismissalTests, shared language/settings routing, and preview-not-confirming-installed-setup. No changes to dictionary, ranking, extension editing, permission inference, or dictation destination code.

Tests are frozen in `UITests/DraftNavigationTests.swift` and `AppTests/DraftEditorTests.swift` before implementation. AppTests uses the real UIViewRepresentable/UITextView in a hosted SwiftUI view and will be wired as a native app-hosted XCTest target. UI tests cover actual companion navigation. Native range tests avoid relying on remote extension accessibility or unsupported emoji injection by XCTest. Unit/bridge checks alone do not count as physical-device or installed-extension interaction proof.

Only iPhone 17 `1EDC5D9A-7E25-432A-B5B1-9A8B702306A7` is owned. Never touch the parent's 18 Pro, Android 5554, unrelated E1C6B89D, parent audit QUALITY_AUDIT, or root checkout. No push/deploy. Project generation and DerivedData are isolated to this worktree; artifacts stay under `/tmp/pulpo-draft-followup-*`. Device tools attempted: device_list reported host failure and device_open failed, both `Device list failed: The device command failed (exit code 127).`; documented pinned agent-device/simctl fallback is authorized. Successful build logs will not be read. Every test command must finish and produce a valid result bundle to count as a completed gate; terminal method results from a stalled runner are partial evidence only. No overlapping build/project regeneration while a test command is alive.

## Supplementary independent inputs, frozen before evaluation

Production candidate: `ba86a1b9`. Independent author `/root/independent_draft_cases` received only the scratch-editor contract and was explicitly forbidden source, tests, audit, device access, edits, and builds. Native same-provider delegation was selected after the live catalog confirmed inherited `codex` / `gpt-6.1-sol`. Author returned these scenarios without inspecting the candidate. Selection was frozen before executing them; no production tuning will follow their one-shot evaluation in this round.

1. `A👩🏽‍💻e\u0301中文\n終` (14 UTF-16 units), selected `{1,9}` = emoji + decomposed `é`. Settings return, preview → installed → preview: text/range exact after every step.
2. `مرحبا 🧪 e\u0301` (11 units), caret `{8,0}` immediately after the test tube. **Hide Keyboard** is the dismissal control. Settings return and both mode switches must keep text/caret/dismissal; explicit editor refocus must retain the caret.
3. `秘密 🔐 e\u0301` (8 units), selection `{6,2}`. Clear resets text/range, recreation/mode changes do not resurrect it. New sentinel `私密-🗝️-e\u0301` (9 units), caret `{9,0}`, must disappear after actual app-process termination/relaunch and remain absent through Settings/mode switching. This observable lifetime check alone cannot prove absence from every log or persistent byte store.

Adapter fixed before execution: `testIndependentCombiningEmojiSelectionAndArabicCaretOnce` and `testIndependentClearOfSelectedCombiningTextOnce` exercise exact new UTF-16 inputs through the actual native bridge, recreation, mode switches, Clear implementation, dismissal/refocus. They **do not** assert the actual HomeView Settings route for those exact inputs; the real route is exercised separately by development UI tests. Exact combined independent scenarios 1/2 therefore remain incomplete acceptance even if component checks pass. For scenario 3's process boundary, use pinned agent-device `fill` with the exact sentinel, terminate/relaunch the real companion using pinned simctl, inspect Try It, navigate and switch modes. No extra production test hooks. If fill or selection is obstructed, report it; do not replace the data silently or count an attempted input as a pass. No rerun of these supplementary inputs after evaluation.

## Implementation and development evidence

Development protocol/tests frozen at `51965b9a`. Production selected at `ba86a1b9`: HomeView owns a scene-memory `TryItDraft` containing text, UTF-16 selection, field kind and keyboard mode. Focus is separate, and leaving Try It dismisses it. Both keyboard modes use the same UITextView bridge, replacing the installed mode's SwiftUI TextField so its selection can survive too. Restoration suppresses intermediate delegate writes, assigns text then clamps/assigns selection, configures/reloads input views, then optionally requests focus. Clear resets text and range together. There are no draft persistence calls, app-group keys or restoration hooks. A cold process creates a new empty draft.

The first candidate guarded explicit dismantling but a native test exposed a retained, detached editor whose callbacks arrived before SwiftUI invoked dismantle. The selected implementation additionally checks current editor identity/window attachment, suppresses queued focus/document callbacks when detached, invalidates the old PreviewHost URL/text attachment, disconnects delegates, and forwards controller disappearance during teardown. The native test retains the removed view/delegate/host and delivers late text/selection/begin/end/URL callbacks against a replacement, rather than merely asserting a Boolean flag.

Test fixture adaptations after initial freeze: attach its UIWindow to the actual UIWindowScene; use async XCTest setup/teardown for Swift 6 isolation; add explicit `self` in the recursive view search; exercise actual same-view input-mode replacement and add focused mode-switch coverage. Expectations/inputs D1–D5 stayed fixed. Initial fixture compilation attempts `build-candidate.log`, `build-candidate-2.log`, `build-candidate-3.log` failed with Swift 6 isolation/closure diagnostics (exit 65). `build-baseline.log`, `build-candidate-4.log`, and `build-detached-guard.log` each exited 0; their successful logs were not read.

Baseline UI reproduction on imported source: `baseline-navigation.log` records `DraftNavigationTests/testSettingsRoundTripKeepsDraftAndDismissedReturnStaysHidden` failed in 19.420s at the first return, actual `""`, expected `"Hola"`. Runner then stalled finalizing results. SIGINT did not finish; SIGTERM ended it with exit 143 after about three minutes. `xcresulttool` reports no Info.plist. **Not a finalized baseline gate.** Log was read only after failure/termination.

First native bridge execution, `editor-first.log`: 5 test methods passed, the stale editor method failed three assertions (stale text/range and URL callback affected live state), 6.225s total methods. Xcode stalled after method completion; stopped via SIGINT then SIGTERM, exit 143 after about two minutes. **No finalized xcresult.** This drove the detached-view ownership fix before production selection. No independent supplementary input had yet been evaluated.

Initial combined regression `candidate-regression.log`, selected production source: 6/6 native editor methods passed (6.172s); 5/6 UI methods passed (112.010s). Actual Settings draft return, dismissed return, Clear, field/mode continuity, both prior dismissal regressions and preview-not-confirming-permission passed at method level. `KeyboardLanguageTests/testHostSettingsAndKeyboardShareLanguageSelection` failed at the absent keyboard label because its old harness assumed automatic keyboard focus on returning from Settings. `469425b9` explicitly taps the restored field before asserting the same bilingual label; no production workaround or weakened language assertion. Completion/finalization status is recorded below.

Commands use this worktree's project and assigned destination only:

```sh
xcodegen generate --spec apps/keyboard-ios/project.yml
xcodebuild -project apps/keyboard-ios/PulpoKeyboard.xcodeproj -scheme PulpoKeyboard \
  -destination 'platform=iOS Simulator,id=1EDC5D9A-7E25-432A-B5B1-9A8B702306A7' \
  -derivedDataPath /tmp/pulpo-draft-followup-build build-for-testing
# test-without-building: same project/scheme/destination/DerivedData, plus
# -parallel-testing-enabled NO -resultBundlePath /tmp/pulpo-draft-followup-evidence/<run>.xcresult
# Final development selections: PulpoKeyboardAppTests/DraftEditorTests, excluding the
# two testIndependent* methods; PulpoKeyboardUITests/DraftNavigationTests;
# PulpoKeyboardUITests/PreviewDismissalTests; KeyboardLanguageTests/testHostSettingsAndKeyboardShareLanguageSelection;
# SetupGuideTests/testInAppPreviewDoesNotConfirmFullAccess.
# The two supplementary testIndependent* methods run separately once.
xcrun xcresulttool get test-results summary --path <run>.xcresult --compact
```

All build logs/results/images remain under `/tmp/pulpo-draft-followup-evidence`; DerivedData is `/tmp/pulpo-draft-followup-build`. Neither is tracked. Project regeneration/build occurs only after the preceding xcodebuild exits. The fallback CLI initially rejected a new session as DEVICE_IN_USE; the authorized prior sweep session was reused, as the error instructed. Pinned command for this assigned simulator:

```sh
/Users/isaacthoman/.t3/userdata/device/bin/agent-device <command> \
  --platform ios --udid 1EDC5D9A-7E25-432A-B5B1-9A8B702306A7 \
  --config /Users/isaacthoman/.t3/userdata/device/hosts/25bf8e1a2393f1108d37029b.json \
  --session t3-049b8d6a3178083de18d10fd
```

## Finalized gates and one-shot supplementary outcome

`candidate-regression.xcresult` never finalized after the 11 passing/1 failing method results above. SIGINT did not finish; SIGTERM ended it with exit **143** after about three minutes total. Its missing Info.plist means it is **not a completed gate**. The language-test adaptation was committed, the command ended, then `build-final.log` exited **0**; successful build log was not read.

**Final development/regression gate: PASS.** `final-regression.xcresult` is finalized and readable; command exit **0**. Summary: **12 passed, 0 failed, 0 skipped**, `runtimeWarnings: []`, assigned iPhone 17 / iOS 27.0. Six native bridge tests (6.173s), six UI tests (114.156s). Both new DraftNavigationTests pass (44.691s combined); corrected shared-language test passes (27.405s), both PreviewDismissalTests pass (28.577s), setup-status regression passes (13.483s). The final command adds `-collect-test-diagnostics never` and explicitly excludes the two `testIndependent*` methods, which had not been evaluated. It runs the production candidate `ba86a1b9` with test harness updates through `469425b9`. Full summary JSON and exported screenshot/attachment manifest are beside the result bundle outside Git. This completes D1–D5's focused native acceptance; no assertion of physical-device coverage.

**Supplementary native components, one run only: PASS.** `independent-once.xcresult` is finalized/readable; command exit **0**. Exact selections: the two `testIndependent*` methods frozen at `a79e1281`, using the same project/scheme/destination/DerivedData, `-parallel-testing-enabled NO -collect-test-diagnostics never`. Summary: **2 passed, 0 failed, 0 skipped**, no result-summary runtime warnings, 3.062s total test methods. These validate new decomposed/ZWJ/Arabic/Chinese inputs through editor recreation, selection, mode changes, dismissal/refocus and Clear. No production change followed evaluation. **Combined independent scenarios 1/2 remain incomplete**: the exact new strings/ranges were not exercised through the actual HomeView Settings route end to end. Development UI navigation and independent editor components are separate evidence, not a substituted full held-out pass.

**Supplementary process-lifetime observation: PASS for visible text boundary, with caret limitation.** After the XCTest command ended, pinned `simctl launch --terminate-running-process <assigned UDID> com.isaacthoman.pulpo.keyboard -PKPreview` started a fresh real companion. `agent-device fill @e17 '私密-🗝️-é' --settle` succeeded. `sentinel-before.txt` includes the exact decomposed sentinel; a standalone byte/string check confirms the intended 9 UTF-16 units. Saved `sentinel-before.png`. A second pinned `simctl launch --terminate-running-process ... -PKPreview` returned a different process PID (47078 → 47626). AX then shows an empty Type here field and disabled Clear. Opened the real preview language menu → Keyboard Settings → Try It, then switched installed → preview: all snapshots remain empty, Clear disabled, and dismissed after Settings. `sentinel-after-relaunch.txt`, `sentinel-after-settings-installed.txt`, `sentinel-after-settings-preview.txt`, and `sentinel-after-settings.png` retain the observation. No reseeding or rerun. Agent-device used its XCTest fallback when simulator AX was unavailable. One stale pinned reference during the final mode switch required a fresh snapshot and retry; the action then succeeded within the same workflow.

AX does not expose numeric caret/range here, so scenario 3's exact prelaunch `{9,0}` and postlaunch `{0,0}` are not independently measured by that process-boundary observation. The native bridge/Clear tests assert numeric ranges separately. This observation cannot prove absence from all storage/logs; source inspection shows no draft persistence. It is not a full fresh hold-out claim for the earlier H4 development case.

## Remaining limits and cleanup

No physical-device run, app suspension/memory-pressure test, permission-recovery rerun, account/network flow, or clean reinstall. Prior H2/H3 from the imported audit remain incomplete; this focused follow-up does not convert them into passes. Selected-range behavior is exercised with real UIKit/native bridge and input-view switching, but remote installed-extension key AX remains unavailable, so there is no new end-to-end installed-extension multilingual range-editing claim. Valid UTF-16 ranges are retained; invalid-range coverage checks bounds/overflow, not arbitrary malformed surrogate or grapheme-interior edits. Independent combined routes and numeric process-boundary caret assertions remain incomplete as described above.

Cleanup only: selected Installed Keyboard and focused the empty field, visually confirmed actual Pulpo keys/EN through the system keyboard surface (`cleanup-installed.png`) to restore the installed-keyboard heartbeat after setup tests. No iOS permission switch was changed. A final attempted back action used a ref absent from the current diff frame and was rejected; the last saved app screen is the empty installed-mode Try It view (`cleanup-installed.txt`), **not** a verified home-screen return. Earlier cleanup selector quoting errors were corrected before focusing the real installed editor. These are harness errors, not app failures.

The pinned agent-device session was then **closed successfully**, and `device_close` for only the assigned iPhone 17 returned success with `shutdown:false`. Ownership is released; simulator remains booted. No sweep-owned xcodebuild remains active. Parent/other devices, root checkout, and QUALITY_AUDIT were untouched. No push, deployment, PR-content change, or merge. PR782 linking succeeded and `list_thread_pull_requests` confirmed it, not watching. `git diff --check` passed. Only source, tests, project test-target configuration and Markdown audit are committed; no raw xcresults/build logs/images are in Git.

## Parent integration and detached-editor verification protocol

The parent imports the reviewed candidate through `a33ea24f`, after independently
reviewing text/range restoration, dismissal intent, memory lifetime and stale
callbacks. The full independent Settings workflows and process-boundary numeric
caret checks remain incomplete; parent reruns will be exposed regression evidence.

Before any additional production edit, review freezes a focused lifecycle check:
retain the actual editor/coordinator/controller and SwiftUI hosting controller,
hold a real KeysView delete contact, detach only the editor without invoking
representable teardown, deliver the late end-editing callback, and observe the
old editor through the repeat deadline. A replacement window sharing the draft
checks that old text/range/focus/URL callbacks remain inert. Natural UIKit cleanup
must remain enabled; a passing natural detach must be retained as positive evidence
rather than disabling callbacks to manufacture a bug. Only an executed failure
can justify changing the end-editing guard. The author adds tests first; no new
production change has yet been selected.

The first parent native command finalizes with one failed method, but stops at
its precondition: the hosted unit-test editor is focused while its input view has
zero key width. No initial delete or repeat occurs, so this is a fixture failure,
not a lifecycle reproduction. Test-only `8c7d00a2` first requests normal keyboard
presentation/layout, then, if unpresented, lays out the same real PreviewInputView
using its actual UIWindow width and intrinsic height. It does not reparent the
keyboard, fake appearance, or suppress native end-editing callbacks; geometry,
hit testing and attached delete/repeat preconditions fail fast.

After disabling the hardware keyboard on only the assigned simulator through the
repository host helper, the parent reruns the native case. It **passes 1/1** with a
finalized result bundle, zero failures and no reported runtime warnings. Natural
UIKit detachment stops the already-running repeat before dismantling; the
replacement draft's text/range/focus/URL checks also pass. No additional production
cleanup change is justified by this observation. This verifies this concrete
natural detach path, not every possible delayed callback ordering. The broader
focused parent regression run completes with **34/34 methods passing**, zero
failures/skips and no summary runtime warnings, in a finalized result bundle on
the assigned iPhone 17 / iOS 27.0. It includes all nine hosted editor methods,
two actual draft-navigation methods, two dismissal/refocus methods, all four
language methods, all fifteen typing methods, the phone-field method, and the
setup-status preview regression. The 393.6-second run uses the same compiled
production source and test fixture as the isolated check; artifact-only commits
added during execution do not change that app binary. These checks overlap the
agent's 14 and the parent's isolated one; they are not 49 distinct checks.
The package core, script and dictionary trees remain unchanged from published
`e1865f3f`. Earlier independent-workflow, process-caret and physical-device limits
remain open. No raw native result bundle is committed.

The parent retries T3 device listing/opening for its newly released iPhone 17;
both still report command exit code 127. It uses native XCTest on that assigned UUID.
The 18 Pro is assigned to a separate compact-layout sweep and is not touched here.
