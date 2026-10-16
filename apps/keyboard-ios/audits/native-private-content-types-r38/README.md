R38: UIKit content-type privacy mapping
=====================================

Local implementation commit: `14f1f67c` (`fix(keyboard): recognize UIKit private content types`), based on `00e2a0e7`. PR: https://github.com/IsaacThoman/pulpo/pull/782. Parent independent validation is required before publishing. Nothing was pushed, merged or physically deployed.

The production change is eight added lines in InputTraits.swift: exact calibrated UIKit values plus the unchanged 24 legacy aliases. Named UIKit calibration found 22 mismatches, including oneTimeCode → one-time-code, emailAddress → email and creditCardMiddleName → cc-additional-name. Baseline recognizes 2/24 declared private categories; candidate recognizes 24/24. All 21 named ordinary controls remain nonprivate. Exact opaque-string matching, secure override, existing glide policy and public fields are unchanged. No Engine/AppModel/store/Emoji/language-resource/license changes or performance claims. The three real dictionary hashes and four unchanged fuzzer/harness hashes are retained.

Validation and qualified results
-------------------------------

- Focused core regressions fail actual baseline (550 assertions) and pass candidate. They use measured native values independently of the production set, real nil-URL personal/touch models and normal positive controls.
- Final focused native tests: baseline 0/3 behavior tests pass; candidate 4/4 pass including calibration. Real UITextView enum cases exercise PreviewHost → TextViewDocument/InputTraits → engine policy/literal edits/word and touch readbacks in EN/ES/BI, with default keyboards plus numeric direct guards. Actual controller callbacks exercise forced hidden private starts with synthetic account/temporary bridge, unavailable private recovery offers, an actually invoked late captured callback and successful normal recovery. No recorder, service, remote-keyboard, VoiceOver or physical-device acceptance is claimed.
- Full optimized Swift suite and its structured repeat exit 0: 445 core definitions (426 executed, 19 existing skipped) plus 3 services, zero unexpected failures. The concurrent debug run retains the same five known issues and four wall-clock threshold failures; its failure is not hidden. Optimized results are not a performance-improvement claim.
- Capability smoke executes all 13 operations and all four real capture kinds: 105 transitions/18 language variants, zero failures on each platform. Eighteen deliberate errors on each platform remain recorded, with later steps still executed.
- Frozen blind corpus: 18 cases × EN/ES/BI, 54 language cases and 1,272 transitions per platform. Core case passes 21 → 51; native 18 → 48. Each platform has 30 case gains, ten in each language, and zero whole-case regressions. Real word/pair/touch readbacks and three late-private confirmation acceptances changing to explicit denials support a meaningful mapping gain. Repeated cumulative transition readbacks are not independent incidents or additional case gains.

The blind run is NOT all green. Core retains 12 touch-positive assertions in three failed normal-learning controls. Its external insertText-space route learns the normal word but supplies no positive touch control. Baseline later leaks private-word touch learning, making three final transition oracles pass; candidate blocks that leak, so those three transitions score as losses. “No regressions” applies only to whole-case counts. All raw losses remain in paired-invariant-checks.json; no oracle or denominator was repaired after reveal.

Native retains those 12 assertions plus 45 secure-transition text/caret assertions (six unaccepted language cases total). The actual native field operation expands selection to the whole document in both versions, and subsequent typing replaces it. This is consistent with the secure-trait setter/host operation, not experimentally isolated to a universal UIKit rule. Secure-transition suffix/selection preservation is unaccepted. The mapping candidate introduces no setter and does not repair or conceal this common native observation.

All 39 native guard challenges fire; 21 automatic challenges are unavailable because TextViewDocument has no stable ID. They earn no refusal/safety credit. Eighteen candidate available confirmation challenges explicitly refuse; three had inserted on baseline. Guard checks are separate from controller/audio acceptance. A private recovery offer with nil callback is unavailable, not a fired refusal. The captured controller callback also avoids insertion on baseline through existing destination/revision checks, so it supplies no new late-callback gain. Forced private starts and withholding private recovery offers do show native mapping gains.

Blind coverage limits are retained: six actual literal offers are captured, but v2 never dispatches stale choose and never performs allowed nonempty transcript insertion. Those removed preseal claims are not validated by this corpus. Existing regressions and separate development smoke/native recovery are distinct evidence. Normal touch/pair positive controls pass in development; the failed blind control stays failed. See audit/postreveal-review.md and audit/native-postreveal-review.md for independent qualified assessments; neither found an unaddressed production mapping defect.

Freeze, evidence and reproduction
---------------------------------

Actual named-constant calibration, availability/hash provenance and independent domain review preceded the immutable public contract and production edit. Candidate/core/native admission and source review preceded candidate-freeze.json. A source/result-blind author and second reviewer worked from the contract and available named IDs only. The initial draft's six static objections, fresh author repair and second review are retained. V2 was sealed, then revealed/executed once. No production, behavior-runner, policy or oracle retuning followed reveal. Hashes establish retained consistency, not independent historical witnessing of blindness. All delegated task IDs and inherited provider/model metadata are in delegation.json.

Raw reports, original/rejected oracles, complete per-step reviews, all transitions/failures/unavailable states and command outputs are deterministically gzip-compressed where large. `verify.py` verifies original payload hashes through those archives, along with source/runner/seal/manifest integrity. Calibration-baseline.json remains plain because focused core tests load it. Generic native wrapper output labels remain `development`; sealed embedded input, source hashes, xcresult summaries and native-execution-provenance.json identify the heldout evaluation. Parent must independently reproduce before publishing.

From repository root:

```sh
python3 apps/keyboard-ios/audits/native-private-content-types-r38/verify.py
swift test -c release --package-path apps/keyboard-ios/PulpoKeyboardKit --xunit-output /tmp/r38-parent.xml
```

See audit/README.md for explicit-path core/native runner preparation. Decompress blind/heldout-v2.json.gz to a new temporary file before passing it to the CLI or wrapper generator. Compare baseline and candidate with compare.py, using separate output paths. Do not overwrite frozen reports: UUIDs and environment paths can differ on a new run. The normal native wrapper requires the app's embedded dictionaries. All native builds used own DerivedData, exact UUID, `-parallel-testing-enabled NO -collect-test-diagnostics never`, redirected logs and structured xcresult inspection; successful raw build logs were archived without inspection.

Native proof used iPhone16e/iOS27.0 Simulator with SDK27.1, minimum target18 (all declared private constants available by17); this is not an iOS18 runtime test. Device tools reported list exit127 and failed to recognize the new UUID, so the explicitly authorized exact-UUID CoreSimulator/XCTest fallback was used. Only owned UUID 55EF66B3-5080-48F0-B2DC-0B020185D786 was created/driven, then panel-closed, shut down and deleted. Original nonexistence is restored; no software-keyboard helper was used and no other device was driven. Device-state.json retains failures and cleanup.
