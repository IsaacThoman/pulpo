# Parent validation of the native content-type mapping

The mapping correction meets its product requirement: all 24 previously declared
private categories now resolve through their actual UIKit raw values. The exact
eight-line change adds 22 missing strings, preserves every legacy alias and all
21 calibrated ordinary controls, and changes no policy, editor, learning or
dictation algorithm. Parent accepts that correction after the independent
validation below. The overall R38 frozen transition/native-preservation gate
remains **unaccepted**; its original failed results and oracles are unchanged.

Parent independently executed the new focused tests against an immutable
`b5451e42` baseline with only the test/calibration overlay. All three definitions
ran: two failed with **550 assertions**, including real literal input, learning
and guard consequences; ordinary/opaque controls passed. The integrated candidate
then passed the complete normal Release command: **445 core definitions in 66
suites plus 3 services**, with exactly the same five known issues. No test
allowance, threshold, source behavior or original oracle was changed.

Parent also ran all four focused native methods on its own fresh iPhone 16e,
iOS Simulator 27.0/SDK 27.1, Release with testability enabled. **4 passed, 0 failed,
0 skipped, 0 runtime warnings**. One method gathers named-constant calibration;
three exercise behavior. The independently collected calibration again matches
all 24 private and 21 ordinary categories. Real UITextView/PreviewHost editing
covers all private categories in EN/ES/bilingual, with literal text/UTF-16 caret,
word/touch readbacks and normal positive controls. Actual controller callbacks
cover forced private starts, recovery authorization and normal recovery. A forced
hidden callback is distinct from a visible tap or a recording/upload run.

The first parent native attempt failed before test execution because Release
modules lacked `-enable-testing`. Its error excerpt and receipt are retained.
Adding `ENABLE_TESTABILITY=YES`/`ONLY_ACTIVE_ARCH=YES` to the test command fixed the
build without changing source. Successful native build logs were not read. Only
the fresh parent simulator was driven, then shut down/deleted; absence was
verified. Source/binary hashes and structured summaries are in `parent/`.

Independent parent review recomputed all **5,088 recorded transitions** in the
original four blind reports and checked 35 frozen bindings. Core remains
21→51/54 whole cases; native remains 18→48/54, with 30 case gains each. There are
**three scored transition losses per platform**. Baseline passes those final
touch checks by wrongly learning a private word after a common failed normal
external-space touch control; candidate blocks that private learning. These stay
scored losses. The 12 touch assertions and 45 native secure-transition
text/selection assertions remain failed. Actual secure-case states are identical
between versions; no introduced mapping regression was identified. None of this
turns the full benchmark green or proves the adjacent behaviors complete.

Native automatic guard challenges without a stable document ID remain
unavailable. Stale-choice dispatch, allowed nonempty transcript insertion, actual
secure-field host transitions, recorder/upload, remote keyboard, VoiceOver,
physical devices and iOS 18 runtime behavior remain outside this parent proof.
Original benchmark flags, rows, denominators and reviews remain visible. The
active improvement goal continues to include these open areas.

The original `verify.py`/`compare.py` are preserved historical tools and use
Python assertions/trusted result flags. The independent parent checker validates
retained raw outcomes separately; hashes attest to retained consistency, not
historical blindness or execution authenticity. No original blind workload was
retuned or rerun to obtain this component validation.

The independent checker and peer originals are in `parent-review/`. It recomputes
all 5,088 transitions and 35 freeze bindings under normal and optimized Python;
its PASS means retained-evidence consistency, with the strict gate still FAILED.
Current production files need not remain frozen for historical verification:

```sh
python3 apps/keyboard-ios/audits/native-private-content-types-r38/parent-review/verify-parent.py --root .
python3 -O apps/keyboard-ios/audits/native-private-content-types-r38/parent-review/verify-parent.py --root . --git apps/keyboard-ios
```
