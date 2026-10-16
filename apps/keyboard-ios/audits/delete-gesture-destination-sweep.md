# Delete gesture destination follow-up

The protocol was frozen before reopening source at baseline `5153837d`. The
original `/tmp/pulpo-delete-gesture-destination-protocol.json` is copied unchanged
to `delete-gesture-destination-protocol.json`, SHA-256
`20e5862c4da6d7fa1b0c814371ad5d9ee1b9a5d3cbfe4d78fd8215050c6dd6cf`.
This follow-up concerns a gesture already in progress crossing to a new
destination. It preserves the previous sweep's explicit same-field selection rule.

## Executable baseline and controller reachability

A standalone `/tmp/pulpo-delete-gesture-destination/repro` compiled the production
`KeyboardCore` sources with a faithful immediate host. It replayed the exact
engine calls inspected in the controller; it did not instantiate UIKit.

1. Field A contains `shared old content!`. Delete touch-down remembers that prefix
   and removes `!`; preview offers `content`.
2. The host switches to a different identified field B containing `shared new`
   and supplies a fresh callback.
3. Releasing the old swipe issues three deletion primitives against B, leaving
   `shared `. The controller supplies A's old prefix as `originalContext`, so the
   undo payload becomes `old content!`.
4. Undo succeeds in B and changes it to `shared old content!`.

The same executable demonstrated a freshly reported caret move from the end of
`one two three` to after `one `: old-swipe release deletes `one ` instead of the
previewed `three`. A public-to-secure transition before release also permits the
old swipe to delete `secret` from `account secret`. These observations use fresh,
distinct snapshots; no ambiguous proxy delay is part of the failure oracle.

The production source path is `KeyboardController.keysView(touchDown:)`, which
stored only `deleteStartContext`; `documentDidChange()`, which reconciled the engine
without cancelling the gesture; and `commitWordDeletion`, which unconditionally
passed the old prefix to the current engine. Engine field/privacy reconciliation
already cleared its own composition state, but did not own the controller's gesture.

## Fix and regression coverage

The controller now captures document identity, privacy and the engine's accepted
external-change count for the delete press. A changed field or privacy context
cancels it. Accepted external caret/context changes without a selected range also
cancel it. A fresh same-field selection remains eligible for selection-only
deletion and exact selected-text undo. Clearing the cancelled origin prevents a
late preview from rearming the gesture.

Validation covers callbacks, preview, commit, held repeats and deferred correction
release. Silent changes visible in the proxy are rechecked using the small named
`KeyboardEngine.reconcileHostChanges()` entry point. That method delegates to the
existing production reconciliation routine and does not change its algorithm or
recognition of delayed own snapshots.

Controller regressions were committed before the fix as `eb0f3339`. They use the
production controller/view-controller callbacks, `ProxyDocument`, `SimulatedProxy`,
delegate entry points and the actual visible Undo button. They cover identified
field switches with/without selections and callbacks, caret/text changes with and
without callbacks, privacy transitions and held repeats, silent same-field
selection, known delayed own reports, and deferred correction release. Existing
same-field selection callback coverage is retained. The test-only proxy gained
a secure-entry trait so privacy tests use real UIKit trait adaptation.

These new UIKit tests have **not been executed by this sweep**. They are intended
to fail on the old controller for the demonstrated destination changes and pass
after the guard, but executable native red/green evidence remains root-owned.

Checks run from `apps/keyboard-ios`:

```sh
swiftc -frontend -parse -target arm64-apple-ios18.0 -sdk "$(xcrun --sdk iphoneos --show-sdk-path)" PulpoKeyboardKit/Sources/KeyboardUI/KeyboardController.swift UITests/ControllerHarness.swift UITests/DeleteGestureDestinationControllerTests.swift
```

Passed syntax parsing only; this is not iOS typechecking or native execution.
From `PulpoKeyboardKit`:

```sh
swift test --scratch-path /tmp/pulpo-external-selection-build --filter 'ExternalSelectionWordDeletionTests|WordDeletionTests|EditingRegressionTests|ContextVisibilityTests|KeyboardEngineTests'
```

Passed 85 tests in 5 suites. This validates the unchanged core paths and new
no-edit synchronization wrapper; UIKit is excluded on macOS. The existing unused
expression warning in `WordDeletionTests.swift` remains.

## Limits

No simulator or device operations were performed. The controller tests still
need the root's native run, including existing delete-touch/swipe coverage.
Unknown field identity, permanently withheld snapshots and changes that are
indistinguishable from known delayed own states cannot establish a different
destination. Long-context window classification remains the engine's existing
policy. This focused sweep does not claim exhaustive frozen-case acceptance or
zero errors, and makes no dictionary, ranking, settings, dictation or spacing edits.

## Independent follow-up: overlapping delete contacts

Independent review found an introduced gap in the first controller guard:
`KeysView` permitted two simultaneous delete contacts, while the controller owned
one origin. Down A, down B, up A cleared B's origin, so B's repeat/swipe stopped.
There was also stale-contact risk: cancelling the controller's origin on a field
switch did not stop the old contact's repeat timer. A new delete in B could create
an origin that an old timer callback then reused. The single-contact native tests
did not exercise this contact ownership boundary.

The follow-up gives each new delete press sole ownership of delete tracking.
Before the new tracking is inserted, `KeysView` finishes the previous valid press
through the existing DeleteEnded delegate, then retires its contact and timer.
This ordering preserves a deferred correction Undo before the second intentional
Backspace deletes the next character: corrected `And the ` becomes `And te` after
the two presses. If the old destination expired, controller validation rejects
that deferred action while the new tracking does not yet exist, so cancellation
cannot consume the fresh press.

Destination invalidation silently removes only delete contacts and timers; letter
and modifier contacts remain intact. Retired contacts become inert, so late moves
or lifts cannot end the new press. Repeat scheduling checks exact tracking identity
both before and after delegation, including cancellation during a repeat callback.
Accessibility delete follows the same previous-press ordering.

`DeleteContactOwnershipControllerTests` was added before the production follow-up
in `fcf4161a`. Its six methods drive actual `KeysView.touchesBegan`, `touchesMoved`
and `touchesEnded` through the production controller and proxy; they do not merely
invoke controller delegates. Coverage includes overlapping swipe and real repeat
timer, rapid two-delete taps in either release order, deferred two-press ordering,
an old contact's late events after field switch and a fresh press, and preservation
of an unrelated letter contact. The stale-contact case covers observed and silent
field switches, with both ordinary and deferred old presses. Undo is exercised
through the actual bar button.

The source and new test passed iPhone SDK syntax parsing. No simulator operation
was performed by this sweep, and the new contact tests have not been executed here.
Executable native red/green validation remains root-owned; a tests-first commit
and source-traced failure are not reported as an executed native red run.
