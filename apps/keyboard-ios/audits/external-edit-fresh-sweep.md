# Fresh external edit sweep

The protocol was frozen before opening source or previous audit reports at
baseline `7f926560`. Its original `/tmp/pulpo-external-edit-fresh-protocol.json`
is retained byte-for-byte as `external-edit-fresh-protocol.json`, SHA-256
`eea2f19519cc3daf6eeed518e3fab33f1d20b26630d89a1766d8244813def42c`.
The root subsequently integrated the completion sweep while this work proceeded;
that work was excluded from this sweep.

## Reproduced failure

Frozen case E3 produced an actual selection deletion/undo failure, with fully
fresh host snapshots and no proxy delay. A standalone `/tmp` executable compiled
the production `KeyboardCore` sources with a faithful host that really replaces
selected ranges. The regression tests use the same host semantics rather than
`MockDocument.selectionOverride`, which does not physically edit a selected range.

For `prefix [chosen] suffix`, `documentDidChange()` reports the selection before
`deleteWordsBackward(1)`. The baseline issues seven delete primitives: one removes
`chosen`, and six remove unrelated prefix characters. The result is `p suffix`.
Its undo record contains `prefix ` rather than `chosen`, and undo produces
`pprefix  suffix`. With the actual gesture-origin context supplied, undo instead
produces `prefix chosen suffix suffix`. A selected range at document start is
ignored entirely because the prefix-based deletion length is zero.

The intended behavior follows the existing `deleteWordBackward` selection rule:
delete the selected range once, retain its actual contents for undo, and leave
surrounding text intact. The fix checks the reconciled selection before deriving
the number of word-deletion primitives. An old gesture-origin prefix cannot
replace the selected-text undo payload. Undo now also requires matching following
context, so a fresh external suffix edit cannot authorize stale restoration.
The existing delayed-proxy reconciliation policy is unchanged.

Production UI reachability was inspected: `KeyboardController.documentDidChange`
does not cancel an active delete swipe, and `commitWordDeletion` delegates to
`engine.deleteWordsBackward` with the remembered gesture origin. Thus a host
selection arriving during the gesture can reach the failing primitive. This sweep
did not execute a controller/simulator reproduction; native gesture validation
is owned by the root agent.

## Red and green evidence

Tests were committed before the fix in `01eca561`. Command, from
`apps/keyboard-ios/PulpoKeyboardKit`:

```sh
swift test --scratch-path /tmp/pulpo-external-selection-build --filter ExternalSelectionWordDeletionTests
```

Baseline: 4 tests ran, 3 failed. The existing zero-count no-op passed. Failures
covered a fresh mid-document selection with stale gesture origin, a selected
Unicode range at the beginning, and undo following a fresh external suffix edit.

After the fix:

```sh
swift test --scratch-path /tmp/pulpo-external-selection-build --filter 'ExternalSelectionWordDeletionTests|WordDeletionTests|EditingRegressionTests|ContextVisibilityTests|SpaceSlipTests|KeyboardEngineTests'
```

Passed: 92 tests in 6 suites, including all 4 new regressions, ordinary word
deletion/undo, correction undo, selection handling, hidden contexts, delayed own
snapshots, phantom spacing, and space-slip behavior. Existing unrelated warnings
in `TouchModel.swift` and `WordDeletionTests.swift` remained.

## Limits

This is executable engine evidence plus inspected UI reachability. It does not
establish UIKit callback ordering, native swipe behavior, or an exhaustive pass
over every frozen case. E1/E2/E4 received source tracing and the existing targeted
regression coverage above; no new failure is claimed for those cases. Permanently
stale or indistinguishable proxies remain fundamentally ambiguous and were not
used as a failure oracle. No dictation, ranking, language caching, or Spanish key
UX changes were made. No simulator operations or deployments were performed by
this sweep.
