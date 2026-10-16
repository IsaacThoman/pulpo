# Parent R17 integration protocol

Authored after inspecting frozen candidate `85e7158a`, before parent baseline
execution or integration. These are exposed review regressions, not fresh blind
gains. `PreviewCursorBoundaryTests` checks exact UTF-16 documents and caret ranges
through real UITextView/PreviewHost: bidirectional stepping over eight complete
clusters (ZWJ emoji, flag, keycap, combining accent, CRLF, skin tone, Indic and
Arabic), selection-start movement, the existing zero-offset collapse contract,
and Int.min/Int.max clamping. Expected documents are explicit prefix/cluster/suffix
conservation, with insertion through native UITextView.

Run the identical fixture before and after importing R17, together with all nine
DraftEditorTests. Preserve failed assertions/crashes separately from setup errors.
The latter suite's historical intermittent unowned-reference crashes are not
assumed resolved by a caret-only change. Parent source review identifies a separate
baseline lifetime hazard in TextViewDocument; R21 owns proving and fixing it.

Assigned parent device: iPhone17 1EDC5D9A-7E25-432A-B5B1-9A8B702306A7 only.
T3 device_list/device_open fail with `Device list failed: The device command failed
(exit code 127).` Use repository XCTest/CoreSimulator fallback, serialized native
commands and disabled diagnostic collection. R21 separately owns iPhone18Pro.

## Parent baseline evidence

The finalized `/tmp/pulpo-r17-parent-baseline.xcresult` exits65: **7/12 methods
pass**, three cursor methods fail their exact movement/document assertions, and
the two previously reported draft methods crash. There are no setup/casing
failures or skipped methods. No R17 production change is present in this run.

The crash attachment from
`testEmojiCaretAndSelectedRangeSurviveRecreationBeforeEditing` records SIGABRT,
`Attempted to read an unowned reference`, and this symbolized call chain:
`swift_unownedRetainStrong` → `TextViewDocument.textView.getter` →
`documentContextAfterInput.getter` → `KeyboardEngine.cursorInsideWord` →
`refreshSuggestions` → `KeyboardController.renderBar` → the delayed
`scheduleBarUpdate` closure. It occurs while a draft test mounts an editor.
This proves the lifetime hazard for this parent baseline crash; it does not
retroactively identify every earlier agent crash. The raw attachment and logs
remain outside Git at `/tmp/pulpo-r17-parent-baseline-crash.ips` and the matching
baseline log. R21's separately scoped experiment must validate its own fix.

R17 imports are followed by a test-only portability repair: exploratory and
component report writers create their requested directories. Without an explicit
report request, exploratory output uses the runner's temporary directory. The
parent integration run requests a new `/tmp/pulpo-r17-parent-clean-reports/`
directory without external creation. No product source is retuned after reveal.
