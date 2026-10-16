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
