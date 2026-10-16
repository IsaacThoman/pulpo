# R43 v1 independent final proof review

Decision: **reject v1 as acceptance evidence; the frozen mandatory oracle fails both variants.** Baseline completes 5/18 workflows (27.78%); candidate completes 9/18 (50%). There are four newly passing rows, five retained passing rows, nine retained failing rows, and zero newly failing rows. No production-source regression was observed in this bounded comparison. That does not turn the nine failures into passes or establish the complete contract.

This review made no production, executor, oracle, input, gold, reference, or result edits. Only this report and its digest were written. Successful build/test logs were not read; structured event streams, summaries, source, and JSON results were used. No other checkout or device was accessed.

## Artifact integrity and paired execution

All 110 baseline and 112 candidate source-manifest entries matched their snapshot bytes at review, including the two added test files. The only production differences are `KeyboardLayout.swift` and the narrow layout-cache synchronization in `KeyboardController.swift`; engine, learning/privacy, storage, touch routing, accessibility, and host ownership implementations are unchanged. Both copied executor files and both App.swift files match the manifest. The final input, references, oracle, orchestrator, source manifest, and native executor match evaluation-freeze.json. No gold or scorer retuning was observed.

The eight receipt groups comprise both variants in all four locales, each with transport test exit zero. Every raw SHA matches its receipt. Each group contains exactly its requested IDs, with no extras; merged rows equal the raw rows. Both full outputs preserve all 18 input IDs in order and all 158 requested action observations, including failed rows. Re-running the unchanged oracle reproduced both saved verdicts exactly, with exit 1 for each. The wrapper's exit zero means transport completion only: `run-paired.py` records oracleExit but ultimately returns zero even for a failed semantic score. Acceptance therefore depends on the verdict, which explicitly fails here.

There are no unchanged-gold workflows in this authored input; the scorer's unchanged count is correctly zero. Ten rows have the same final text/advance/list response between variants, including failures, and remain in the denominator. No favorable subset replaces the full 18-row result.

Newly passing IDs:

- `us-compact-decimal-revise-switch`
- `spain-left-amount-refresh`
- `spain-english-comma-switch-refresh`
- `spain-left-field-and-page-roundtrip`

## Why final acceptance fails

The following nine candidate rows fail and remain failures in the frozen record:

- `mexico-right-secure-amount`
- `egypt-landscape-decimal-repair`
- `spain-compact-secure-ascii-switch`
- `egypt-ascii-double-delete`
- `mexico-landscape-private-fraction`
- `egypt-left-private-arabic-separator`
- `mexico-landscape-url-page-control`
- `egypt-compact-prose-symbol-control`
- `us-secure-field-roundtrip`

Four failed secure rows lose nonempty initial text on their first insertion; for example the Mexico secure amount records `60.4` instead of `M$60.4`. This occurs in both variants. The host sets secure entry and initial text but does not explicitly disable UITextField's secure clears-on-insertion behavior. The trace supports a fixture mismatch; it does not establish a production keyboard repair or authorize changing the v1 gold.

Every Egypt process actually reports current and autoupdating identifier `en_EG` with period, whereas the independently created `ar_EG` reference requires U+066B. Xcode's requested test language/region did not establish the requested effective Arabic locale. All four rows correctly fail. Candidate use of period in those processes follows its actual Foundation value, but these runs cannot prove native U+066B locale entry. The source-independent injected core test covers U+066B layout construction separately.

The URL control produces the exact gold text but fails the frozen oracle's `allowed` learning-policy expectation. Existing production InputPolicy explicitly disables learning for email and URL keyboard types as well as numeric/private fields. That policy is unchanged by R43. This is an oracle/protocol mismatch exposed by evaluation; it must remain a v1 failure. Correcting it requires a separately versioned, frozen evaluation and newly independent inputs, not rescoring this revealed set with changed rules.

## Adequacy and positive evidence

The oracle is nonvacuous: strict input/gold simulation rejects unavailable actions and unsupported values; scoring requires independent locale region/separator, measured nonempty dictionary hashes and actual requested loaded language, native stack identities, full literal intermediate/final text, cumulative callbacks, explicit post-action refresh counts, and no numeric/private/globe learning-count or dirty-state changes. It checks initial/final cap and sampled target containment, non-overlap, key identity/root routing, numeric controls, and bottom-control width/portrait height. Dictionary bytes/hashes were independently rechecked against all three actual resource files and match. The smoke positive control changes personal count 1→2 and dirty false→true on committing `quartz `, demonstrating that this observer can detect learning. Numeric smoke actions retain count and dirty state. Lifecycle data is recorded, but the oracle does not gate post-disappear observations; no lifecycle-wide no-learning guarantee follows.

The mandatory scorer stops each failed row at its first failure. Thus valid downstream geometry/language/learning fields in rejected rows must not be represented as a full contract pass. The executor's action lookup uses the first matching key, and geometry is captured initially/finally rather than at every intermediate page. These previously disclosed limits remain.

Structured core events report baseline 445 tests passed and candidate 448 passed, with the same five known issues: two recent-host-state ambiguity cases and three frozen multilingual completion cases. The focused baseline contract test fails the missing required numeric globe assertion. The native focused summary reports two tests passed, and their source checks literal decimal/delete behavior, original event/view identity, touch versus AX callbacks, compact/docked/landscape geometry and largest accessibility content-size trait. These are useful supporting checks, not substitutes for the failed paired oracle.

Source still supports the accepted pitch formula: four .75-pitch controls fit the existing three-pitch span after real gap subtraction. Upper rows, keyboard height and general layouts are preserved. Candidate measured numeric bottom targets in these initial snapshots have widths from 71.75 points upward; portrait bottoms are 44 points high. Landscape conservative bottoms are 33 points high, with 32-point caps. The domain addendum permits retaining this existing vertical limitation for the bounded repair; it does not grant a blanket 44×44 pass.

## Evidence boundary

This is an actual hosted UITextField plus production controller/KeysView test. UITouch/UIEvent objects are synthetic and touches are invoked directly; AX activation calls the native method directly. Two touch list callbacks and one AX advance callback demonstrate their separate hosted routes. They do not prove installed extension behavior, OS switch-menu opening, spoken VoiceOver operation, physical keyboard interactions, physical rotation or performance. Largest-accessibility and landscape checks are hosted trait/width geometry. The locale cache includes the resolved separator at actual synchronization, which is correct by source inspection; a live locale-transition runtime test remains absent. Defensive fallback is covered by injected core checks, not by static native process locales.

Conclusion: preserve v1 in full as a failed evaluation with a bounded four-row improvement and no observed new failures. Full native contract acceptance remains blocked; any corrected harness/oracle must start a separately frozen version without altering these originals.

## Reviewed result digests

| Artifact | SHA-256 |
| --- | --- |
| source-manifest.json | 4cd7d2a793978aa474ddd88fe7874dc3fb293a2b7e85f90e9a5c81e58667a8b2 |
| evaluation-freeze.json | 3d9f69d136ca4a290f1e429862bf68f09992c5ead3e1102e5f29dddcc1d9c045 |
| fresh-input.json | 5ac047960a31657bf7b472c7de41f4446f231a00275729dd205f11ecd2f5a7cd |
| oracle.py | 4a84f4555c7ba50374f6ac317bba5bad66ec3503703c892fd8847b0585afb0b2 |
| baseline-output.json | a20d1d24679e30e341e7569a1f271ba1b1a6a25323590ec8152b4759b5904ecb |
| baseline-verdict.json | 912201de64bcf457c1a1fb9027e37cd42aaed7cb8664ba292115de494e06795b |
| candidate-output.json | 2900c38a9a9179cfafbfb528acf39601277b8a6638366f164861a6eeba04a48d |
| candidate-verdict.json | d46c30ea455e9c211b23770bec8cb582c1a8639fa6204caf8956400f49551eef |
| evaluation-receipt.json | 7af122fc5bc7320d10892edbde4766f94c0c51986cb48d347bd1599577a044ee |
