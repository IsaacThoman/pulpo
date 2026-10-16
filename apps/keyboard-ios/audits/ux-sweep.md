# Independent keyboard UX and safety sweep

## Frozen acceptance protocol — 2026-10-15

Frozen before reading implementation, tests, or any QUALITY_AUDIT findings. Baseline commit: `433e54adf29dc6960f2ffb5acafbf63699fb6494`. This branch is an isolated implementation worktree for PR #782. No simulator interaction or builds are permitted in this sweep; the parent owns simulator verification. Language selection and language features are excluded. QUALITY_AUDIT.md will not be read or changed.

These independently chosen tasks are the acceptance protocol. Findings and implementation choices below must be traced back to them; do not retroactively change the tasks to fit a fix.

| ID | Task | Acceptance metric |
| --- | --- | --- |
| U1 | Type a phrase, move the caret into its middle, select text, delete, then undo/recover where offered. Repeat with emoji and composed characters. | Each explicit editing action affects exactly its intended grapheme/selection; zero unexpected adjacent-text loss. |
| U2 | Start a press-and-hold editing gesture, drag outside its target, release, interrupt with dismissal, and reopen. | Zero edits after release/cancellation/dismissal; no stuck repeat or gesture state; explicit feedback for active gesture. |
| U3 | Dictate or request an AI edit, then move the caret or change the host document before completion. Cancel and retry. | Zero stale-result insertion or replacement; cancellation cannot apply a result; original text survives errors. |
| U4 | Reach companion setup and all nonlanguage settings using VoiceOver, large text, and reduced motion. Reach keyboard edit, mode, dismiss, and next-keyboard controls. | Every interactive control has a distinct meaningful accessible name and correct state; no essential action only available by gesture; no essential label clipped under large text. |
| U5 | Switch letters/symbols/numbers, shift/caps, return types, and app focus while composing. | Zero unintentional input/submit; visible state matches action; disabled/unavailable actions explain recovery. |
| U6 | Deny or revoke microphone/full access/network availability and attempt an AI/voice action; recover from companion. | Zero silent destructive edits; clear actionable failure; no request or recording continues after explicit cancellation. |
| U7 | Use compact portrait/landscape layouts and one-handed edge touches, including candidate/action strips. | No overlapping actionable targets; frequent noncharacter controls meet 44pt target where layout permits; alternate accessible action exists for precision-only gestures. |
| U8 | Preview and change a privacy-sensitive setting, leave/reopen companion, and revisit explanatory copy. | Persisted state matches displayed state; copy accurately identifies permissions/data effects; destructive actions require intentional activation. |

Measurements will distinguish executable unit evidence, static inspection, and parent-only device verification. Device latency, actual VoiceOver focus, physical target sizes, and visual clipping remain unmeasured until the parent runs the prescribed UI checks.

## Findings, changes, and verification

### Fixed findings

All baseline observations below come from source inspection after the freeze. They are reproducible callback/event sequences; no baseline device reproduction is claimed.

1. **U3/U6: cancelled or superseded permission callbacks could start recording.** `DictationService.start` previously called `beginRecording()` unconditionally when microphone permission returned, including after `cancel()` or a newer request. A late denial could also fail the newer attempt. The new platform-free `DictationRequestLifecycle` authorizes each callback by a unique attempt and expected stage. Recording and transcription transitions are one-shot, including when the same deep-link request ID is reused.
2. **U3/U6: cancellation left an upload running, and old uploads could win a reused request ID.** The service now retains and cancels its upload task, checks cancellation before uploading, and accepts completions only for the current transcribing attempt. Delayed host-return callbacks likewise cannot reopen the host of an obsolete attempt. Failed recordings remove the captured file and shut down the microphone engine instead of leaving an untimed engine running after a startup failure.
3. **U3/U6: cancelling in the companion could strand the keyboard on Listening.** Previously `cancel()` cleared `request` before publishing idle; the keyboard requires the response ID to match its pending ID and therefore ignored that idle response. The lifecycle now retains a cancellation response ID separately from active callback authorization. Repeated idle/standby publications still match the waiting keyboard. A new attempt replaces that response ID.
4. **U4/U6: companion preparation/transcription offered no cancellation control.** Both phases now expose `app-dictation-cancel`. Preparation has visible progress. Delayed automatic dismissal now uses a task tied to the displayed phase, so a previous idle/finished delay is cancelled when another attempt begins.
5. **U2: emoji delete could keep editing after drag-out or picker removal/hiding.** Only touch-up/cancel events invalidated the timer. A retained picker could keep calling its delegate after leaving the hierarchy. Delete now ends on drag-out, removal, window detachment, hiding, and host disappearance. Each press has an identity checked both before and after the delegate call, so synchronous dismissal during a deletion cannot schedule another repeat.
6. **U1/U4: emoji delete had no accessibility activation path.** Its only edit handler was touch-down; an accessibility activation has no touch-down/up pair. An explicit activation now deletes once and never starts the hold timer.
7. **U1/U4/U5: caret movement was gesture-only; disabled/empty keys misrepresented their state.** Space now offers Move cursor left/right custom actions through the existing host caret API. Emoji search suppresses these actions, including previously captured actions. Disabled return exposes the not-enabled trait and rejects activation. The number-pad spacer is absent from accessibility navigation.

### Measurements and evidence

| Metric | Frozen baseline | After | Evidence/limit |
| --- | --- | --- | --- |
| Focused existing macOS regression tests | 47 passed / 47, 5 suites | Same 47 passed / 47 | Separate archived baseline checkout and isolated SwiftPM scratch directories; no simulator |
| New asynchronous dictation lifecycle scenarios | No corresponding lifecycle suite | 9 passed / 9 | Permission cancellation/supersession, same-ID retry, duplicate permission/stop, cancelled upload, terminal completion, failed preparation, stale host return, cancellation reply identity |
| Total focused host test result | 47 passed | 56 passed, 6 suites | Baseline 0.459s test phase; after 0.439s. Different test counts mean these times are **not** a performance comparison |
| Companion active phases offering Cancel | 1: recording | 3: preparation, recording, transcription | Source inspection; actual button reachability still needs device validation |
| Space-key accessible caret actions | 0 | 2 | Source inspection; new UIKit test exercises handlers; VoiceOver rotor behavior unmeasured |
| Emoji delete touch termination event kinds | 3 | 4, plus 4 lifecycle cleanup paths | Source inspection; 7 interruption cases and 2 synchronous-dismissal cases are encoded in pending UIKit tests |
| New UIKit regression methods | 0 | 7 authored | Syntax parsed only; neither compiled for iOS nor executed here |

Host command (executed successfully):

```sh
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit \
  --scratch-path /tmp/pulpo-ux-sweep-spm \
  --filter 'DictationRequestLifecycleTests|EditingRegressionTests|WordDeletionTests|SetupStatusTests|EmojiSelectionTests|OneHandedTests'
```

Baseline command used the same five pre-existing suites, with the package and LanguageData archived from `433e54ad` into `/tmp/pulpo-ux-sweep-baseline` and scratch path `/tmp/pulpo-ux-sweep-baseline-spm`. Logs are `/tmp/pulpo-ux-sweep-unit.log` and `/tmp/pulpo-ux-sweep-baseline-unit.log` in this environment. The existing TouchModel Sendable and unused WordDeletion result compiler warnings also occur on the baseline.

`swiftc -frontend -parse` passed for the changed companion/UIKit sources and UIKit tests; `git diff --check` passed. Parsing is not an iOS typecheck. No simulator was queried, driven, mutated, built, or tested. No push, PR modification, language feature, subagent, or QUALITY_AUDIT read/write occurred.

### Exact parent-run verification

After the parent has exclusive use of its simulator, generate the project using the normal repository workflow and run these new methods. Replace `PARENT_SIMULATOR_UDID` with the parent's already-owned device. This command was **not** executed by this sweep.

```sh
cd apps/keyboard-ios
xcodebuild -project PulpoKeyboard.xcodeproj -scheme PulpoKeyboard \
  -destination 'platform=iOS Simulator,id=PARENT_SIMULATOR_UDID' \
  -parallel-testing-enabled NO \
  -only-testing:PulpoKeyboardUITests/EmojiPanelTests/testEmojiDeleteStopsOnEveryInterruption \
  -only-testing:PulpoKeyboardUITests/EmojiPanelTests/testEmojiDeleteRepeatsWhileHeldAndStopsAfterRelease \
  -only-testing:PulpoKeyboardUITests/EmojiPanelTests/testAccessibleEmojiDeleteActsOnceWithoutHolding \
  -only-testing:PulpoKeyboardUITests/EmojiPanelTests/testDeleteCallbackCannotRestartRepeatAfterSynchronousDismissal \
  -only-testing:PulpoKeyboardUITests/KeyTouchTests/testSpaceOffersAccessibleCursorStepsWithoutTypingASpace \
  -only-testing:PulpoKeyboardUITests/KeyTouchTests/testDisabledReturnIsAnnouncedAndCannotActivate \
  -only-testing:PulpoKeyboardUITests/KeyTouchTests/testNumberPadSpacerIsNotAnAccessibleEmptyKey \
  test
```

Then run existing `DictationTests` and `BounceDictationTests` with their documented stub-server, sign-in, microphone and installed-keyboard prerequisites. Perform these explicit device checks:

1. **Interruption:** in a host with text `abc👩🏽‍💻é xyz`, open emoji, hold delete, drag out and wait one second; dismiss the keyboard while holding, refocus another field, wait one second. Only deletion while the original press was active is allowed. Repeat with portrait, landscape, and one-handed layouts. Confirm a fresh hold still repeats.
2. **VoiceOver editing:** focus emoji delete and activate once: exactly one grapheme/selection must disappear, with no further change after one second. On space, invoke each cursor action, then type a character to verify the insertion position. Open emoji search: these actions must disappear and never move the host caret. Verify disabled return is announced unavailable and the number-pad blank is skipped.
3. **Permission race:** reset microphone permission only on the parent's test device. Start dictation; while consent is outstanding, switch back to the host and cancel from the keyboard, then return and grant permission. No recording may begin for that cancelled attempt. Repeat with a new request superseding the old one. A late denial must not fail a newer recording. The host lifecycle suite covers the corresponding callback schedules without microphone APIs.
4. **Cross-process cancel:** start dictation from an installed keyboard, then cancel in the companion (both while recording and while transcribing). Return to the host: the keyboard must show letters, not remain Listening/Transcribing. With a slow transcription response, Cancel must prevent insertion; a second request must complete normally. Cancelling cannot retract audio that the server already received.
5. **Quick retry/dismissal:** after a finished or cancelled attempt, start another immediately. The old 0.2s/1.2s automatic dismissal must not close the new recorder. Try preparation/transcription Cancel at accessibility text sizes and with VoiceOver. Confirm Reduced Motion still disables the recording pulse.
6. **Failure recovery:** deny microphone permission, attempt dictation, open the offered Settings recovery, then retry after granting access. Force a network transcription failure; verify an actionable error, no document changes, and a working retry. Inspect the microphone indicator after a recorder startup failure: no untimed engine should remain active. Configured standby still intentionally keeps the engine ready while discarding audio after successful/cancelled captures.

### Outstanding findings and limits

- **U3 remains a material safety risk outside these fixes:** the keyboard's finished-result handler inserts into its current engine document without binding the result to a snapshot of the original field/caret/selection. Moving to a different field or changing a selection while a request is pending can therefore redirect the transcript. This is a source-confirmed missing guard, not a device-measured reproduction. Parent should explicitly exercise both a field switch and a caret/selection change during a slow response and decide an insertion/recovery policy before merge; this sweep does not claim to solve transcript destination safety.
- **U2 follow-up:** `KeysView.end` calls `keysViewDeleteEnded` even on a cancelled delete contact; deferred correction-undo deletion can consequently be flushed on cancellation. This is separate from the fixed emoji timer path. Parent should cancel a delete contact immediately after an autocorrection and inspect whether it makes an unwanted edit.
- U4/U7 companion setup/settings/privacy were inspected for recovery, destructive confirmations, and accessibility structure. No additional change was justified without device evidence. Dynamic Type clipping, actual VoiceOver focus/announcements, physical target size, compact layout overlap, and gesture latency remain unmeasured. The acceptance protocol is not a claim that every task passes.
- macOS cannot exercise UIKit, AVAudioEngine permissions, actual URLSession upload cancellation through the companion, SwiftUI presentation, or cross-process Darwin notification ordering. The nine executable lifecycle tests validate callback authorization/response identity; the seven UIKit methods and device steps close the remaining integration gap.

### Commits

- `b6f4aff2`: freeze the acceptance protocol before inspection.
- `9a3bf41d`: cancel obsolete dictation attempts safely, with nine host tests.
- `b12d2774`: stop hidden deletes and expose accessible editing, with seven parent-run UIKit tests.
- A final documentation commit records this report; use the branch tip for its ID.
