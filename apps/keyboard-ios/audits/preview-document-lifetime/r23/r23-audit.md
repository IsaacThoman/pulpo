# R23 consumer retention investigation

R21 remains **INCOMPLETE**. Its final 14/15 result and every failed standalone
fixture version are preserved in `audit.md`, `evidence.json` and the imported
commits. The original standalone consumer nil assertions remain enabled and
unchanged. Its later document reads/mutations remain **UNEXECUTED**. No production
fix or corrected acceptance fixture is proposed by R23.

## Concrete ownership evidence

The assigned iPhone 18 Pro runs iOS Simulator 27.0, build `24A434`, arm64.
UIKitCore image UUID is `E9CBEBE9-BFEE-3385-AF52-D32C606E46BE`.
This is evidence about that runtime, not a claim about every OS or physical device.

After the unchanged standalone factory returned and its two-second drain expired,
targeted `leaks --noContent --traceTree=<known address> <synthetic app PID>`
identified `_UIInputViewContent._inputView` as a **strong** incoming reference to
the surviving PreviewInputView. That input's strong `controller` field leads to
the surviving controller and its engine. Host was nil. Reverse stack/raw-layer
references were also reported; those conservative paths alone do not establish
strong ownership and are not the basis of the conclusion.

Read-only LLDB checks close the UIKit cycle in candidate process `67042`:

- input `0x116b74000` owns left content `0x11809c380` and right content
  `0x11809c540` at measured ivar offsets 440 and 448.
- Both content objects' `_inputView` fields at offset 432 equal `0x116b74000`.
- Runtime `class_getIvarLayout(UIInputView)` returned `11 12 b6`; its superclass
  size is 416. This marks offsets 440/448 strong (and other fields).
- `_UIInputViewContent` has superclass size 416 and strong layout `21`, marking
  offset 432 strong. Both weak layouts are empty.
- UIKitCore's `-[_UIInputViewContent initWithFrame:inputView:]` disassembly stores
  the supplied input using `objc_storeStrong` at method offset +128. Its
  `.cxx_destruct` clears that field with `objc_storeStrong`.
- `-[UIInputView initWithFrame:inputViewStyle:]` allocates both content objects,
  passes itself to them, stores them, and adds them as subviews. This agrees with
  the ivar metadata and live pointer identities.

The high-nibble skip / low-nibble scan interpretation, relative to the class's
own aligned ivars, is independently specified by Apple's
[Objective-C runtime implementation](https://github.com/apple-oss-distributions/objc4/blob/main/runtime/objc-class.mm#L235-L295).
The live framework metadata, machine code and pointer identities are the
authoritative evidence for this particular cycle. These are stronger evidence
than inferring a framework problem from weak counts. No private field was
modified, owner forcibly invalidated, or deallocation induced by the debugger.

## Controls and scope

`PreviewConsumerOwnershipTests` contains informed diagnostic controls. Plain
UIView releases and KeyboardController without an input releases. A plain UIKit
UIInputView with one plain UIView child survives with self-sizing false, with
self-sizing true, and with default input style. The first plain UIKit control's
trace independently identifies the same strong `_UIInputViewContent._inputView`
edge, and its content pointer's input field matches the known input address.
It has no Pulpo host/controller/engine/feedback generator/handler/task.

Unpresented PreviewInputView also survives. Both plain and preview inputs survive
a real responder lifecycle: assign to UITextView.inputView, make a window
visible, become first responder, clear inputView, reload input views, resign,
remove editor and hide window. The helper asserts the first-responder setup;
these controls do not claim a document-after-release pass. No public release
boundary has been demonstrated to break the measured cycle within two seconds.
The final plain responder control constructs no Pulpo consumer.

A separate living-host comparison constructed the same real PreviewInputView /
controller / engine with baseline `f17109e7`'s entire KeyboardPreview.swift,
then with the starting candidate file restored byte-for-byte. Both failed the
same three consumer nil assertions. This **deliberately keeps the host alive for
the process lifetime**, avoiding undefined baseline unowned accesses from queued
callbacks; it is not a standalone host-release acceptance case. No claim is made
that the original crashing baseline can safely run the post-host-release checks.

The demonstrated retaining cycle is inside UIKit, with the expected app-owned
input → controller → engine chain hanging from it. No additional app-owned cycle
was proved. Source inspection finds weak controller host, weak UI handlers,
weak static KeyboardFeedback.current and weak queued-controller captures. The
controller-without-input control releases despite those app resources. This
does not prove the absence of every possible app leak, nor assign every raw heap
reference to that one cycle.

Apple's [UIInputView documentation](https://developer.apple.com/documentation/uikit/uiinputview)
describes its responder role and styling; it does not promise deallocation by a
two-second deadline. Its [self-sizing documentation](https://developer.apple.com/documentation/uikit/uiinputview/allowsselfsizing)
describes sizing, not ownership. Neither document establishes intended retention
or an Apple-confirmed bug. The observed native strong cycle is the narrower
claim. Changing the superclass, shipping private UIKit mutation, or making an
input discard its controller to satisfy probes would require separate product
design and lifecycle validation; none is justified as a narrow R21 source fix.

## Preservation and reproducibility

Imports: `b52d176b` ← `6b69906e`, `8b80e260` ← `026968d2`, `6ad8d719` ←
`b1dd21be`. Diagnostic contract frozen at `00515cab`. Capture-capable synthetic
fixtures are preserved at `4f23dcf1`; `42b1fa40` removes the temporary pause/probe
hooks and leaves every nil assertion enabled. The original countercheck file is
byte-identical to the imported R21 version. R23 changes no production source.

Capture reproduction: use the preserved capture fixture, create only the
appropriate `/tmp/pulpo-r23-evidence/capture` (original standalone) or
`capture-controls` (UIKit control) gate, and run the focused native method. The
probe file supplies only its synthetic PID and known object addresses. Capture
targeted reference paths, class ivar metadata, known pointer fields and named
UIKit methods; remove the gate to continue. The pause is bounded at 55 seconds.
The final tests contain neither gate nor debugger code. Raw logs, lldb scripts,
trace trees and xcresults remain in `/tmp/pulpo-r23-evidence` outside Git.

Some diagnostic attempts failed before producing their intended extra evidence:
an initially guessed private initializer symbol was wrong; a generic LLDB local
name collided with internal symbols; a variadic NSString expression lacked the
module declaration; an offline framework path was unavailable because the image
is in the runtime shared cache. Each is preserved outside Git and included in
the native run costs. The successful final capture uses targeted SBProcess reads
at measured offsets, avoids expression-created object references, and detaches.

## Final validation, review and release

Final uninstrumented AppTests (`42b1fa40`): exit **65**, **34.95 seconds** wall,
**28 methods: 20 passed, 8 failed, 0 skipped**, no runtime crash. The eight
failing methods have 16 failed nil assertions. Original AppTests are **18/19**:
DraftEditor **9/9**, R17 frozen cursor **1/1**, cursor boundary **3/3**, primary
lifetime **3/3**, independent lifecycle **2/3**. The original standalone method
still fails its three input/controller/engine nil assertions, with host nil;
its document-after-consumer-release guard still prevents the later checks.
New ownership controls are **2/9**: UIView and controller-without-input pass;
the seven UIInputView consumer controls fail. All assertions remain enabled.
Result-summary runtimeWarnings is empty; the original fixture's unbalanced
appearance warning and simulator haptic-library/entitlement messages remain in
the raw log and are not represented as a clean-log result.

Independent read-only review `/root/r23_ownership_review` verified the actual
native pointer closure, metadata, machine code, plain UIKit controls, unchanged
production/original countercheck, safe living-host comparator and final native
counts. It approves the narrow ownership diagnosis and no-source-change
conclusion, with no source/test blocker. That is not acceptance of the failing
standalone contract. No corrected acceptance fixture has been proposed or
approved. No all-green claim.

Costs: **13 serialized xcodebuild invocations, 273.74 seconds summed wall time**,
including builds/test startup and bounded capture waits. There were six LLDB
attach attempts (two successful final metadata/pointer captures, four incomplete
extra symbol/expression attempts), four targeted leaks trace calls, one failed
offline framework-image inspection, and one independent review task. Separate
debugger/heap/query wall time, authoring and review time were not measured in the
xcodebuild sum. Exact token usage and dollar cost were unavailable; no estimate
or typing-performance claim is made. Per-run counts/costs and fingerprints are
in `r23-evidence.json`.

Hardware keyboard was restored **only** for the assigned UUID;
`device_close(shutdown:false)` succeeded. No agent-device launcher/session was
created because open failed. The simulator is released, booted, with no native
run outstanding. PR782 is linked and list confirmation succeeded; unwatch
confirmed false. No push or deployment.

R17 six broader UX heldouts remain **NOT RUN**. The prior six R21 UI regression
passes are not those heldouts; no new UI pass or physical-device claim is made.

Execution uses only `7E1D7979-7307-4C53-8466-BB41154B383C` with separate
`/tmp/pulpo-r23-build` DerivedData and serial xcodebuild,
`-parallel-testing-enabled NO -collect-test-diagnostics never`.
device_list/open both failed with the known exit-127 error before fallback.
No parent edits, iPhone17/protected device use, physical deployment or push.
