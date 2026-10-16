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

## Parent integrated outcomes

The cursor-only integration command finalizes **24/24 methods passing**, zero
skips, failures or runtime warnings, in
`/tmp/pulpo-r17-parent-integrated.xcresult` (exit0, approximately 314 seconds).
It includes all AppTests, the three actual exploration workflows, draft
navigation, dismissal/refocus and every KeyboardLanguageTests method. All four
component outcomes exactly match retained `development-final.json`, including
raw UTF-16 documents and ranges. Both actual cursor-gesture outcomes also match
the retained final cases. Original v1 displacement expectations remain misses.

A separate unchanged heldout replay finalizes exit65 with the single expected
document assertion for `r17-cursor-02`. All six entire outcome objects exactly
equal retained `heldout-candidate.json`: **5/6 exact documents, 6/6 selections**.
Result `/tmp/pulpo-r17-parent-heldout.xcresult`, output
`/tmp/pulpo-r17-parent-heldout/report.json`. It is exposed integration evidence,
not a second blind evaluation or six passing cases. Zero-offset selection
collapse and the six broader original unexecuted UX cases remain unaccepted.

After the independently reviewed weak-host R21 fix, the combined command
finalizes **47/48 passing**, no skips or runtime crashes, approximately 316
seconds: `/tmp/pulpo-preview-integrated.xcresult`. It adds all six lifetime
methods and eighteen dictation destination methods to the earlier selection.
The sole failure is consumer-release timing in the standalone countercheck;
host deallocation succeeds, input/controller/engine remain alive, and later
standalone-document checks are unexecuted. All cursor, draft and actual UI flows
pass. Counts overlap earlier commands and must not be added.

Importing the final independently reviewed fixture refinements does not resolve
that failure: `/tmp/pulpo-preview-lifetime-final-fixture.xcresult` finalizes
**3/4**, zero skips/crashes, with all three primary lifetime cases passing and
the same standalone countercheck failing. The retaining path is not established.
The narrow weak-host fix adds no consumer retention edge and directly removes
the demonstrated stale-host trap; full R21 frozen acceptance remains incomplete.
R23 investigates retention separately with the failing assertions enabled. R24
owns broader companion usability work; historical R17 nonexecution is unchanged.
