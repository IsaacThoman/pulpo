# R43 historical ordinary denominator attribution

Resolved: the historical445→448/66→68 headline is a COMBINED Core+Services Swift Testing run. It is not445→448 Core definitions. There are no extra development or copied R38 privacy tests in the inspected event streams. This qualifies ambiguous Core-only readings of the stable review/worker metadata without changing any original record, source, oracle, packet or acceptance recommendation.

| Historical run | Core definitions | Core started/ended | Core skipped | Core suites | Services definitions/started/ended | Services suites | Combined runEnded |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Baseline b5451e42 | 442 | 423/423 | 19 | 65 | 3/3/3 | 1 | 445 tests /66 suites |
| Candidate6781665e | 445 | 426/426 | 19 | 67 | 3/3/3 | 1 | 448 tests /68 suites |

Both event streams have ONE runStarted and ONE runEnded. Discovered payload.kind=function records identify the modules directly. Suite testStarted/testEnded events are counted separately: the raw492/497 started totals include65/67 Core suites and1 Services suite, so they must not be quoted as executed function counts. All19 skipped Core function IDs are identical. No test function was removed. Five issueRecorded records are known/non-failing and exactly match the archived ordinary-validation.json records.

The three candidate-only definitions are exactly the scoped R43 additions:

- NumericLocaleLayoutTests/decimalEntryKeepsLocaleSeparatorAndRequiredSwitcherTogether(), NumericLocaleLayoutTests.swift:12.
- NumericLocaleLayoutTests/missingOrMalformedSeparatorFallsBackWithoutChangingOtherPads(), NumericLocaleLayoutTests.swift:32.
- RequiredNumericControlsTests/decimalFieldKeepsRegionEntryAndRequiredKeyboardSwitchVisible(), RequiredNumericControlsTests.swift:6.

The common three Services definitions are actual PulpoClientTests/normalizesInstanceAddresses(), readsPulpoErrorEnvelopes(), explainsNetworkFailuresByCause(), at PulpoClientTests.swift:6/15/23. No NativeContentTypePrivacy test ID appears in either historical stream. This exactly reconciles the expected b545 Core442 and678 Core445 counts; the extra3 in each runEnded are Services, not R38 or mislabeled candidate code.

## Binding and command/source limits

Read only /tmp/pulpo-r43-v1/core-baseline.events.jsonl and core-candidate.events.jsonl, structured build descriptions, and archived ordinary metadata. The current complete-stream hashes and all function IDs are recorded in attribution.json; counts-and-bindings.json is the compact result. Each stream's exact runEnded payload and all five issue payloads equal the hash-bound accepted-v3/ordinary-validation.json corresponding records. Thus the structured aggregate attribution is directly linked to the archived summary, rather than inferred from names.

Build descriptions at core-baseline-native/arm64-apple-macosx/release/description.json and core-candidate/arm64-apple-macosx/release/description.json name the corresponding source test modules. Their complete test-source file inventories match the respective b5451e42 and6781665e Git trees. Both compiler metadata and event source paths point into the R43 worker workspace, not the immutable native blind benchmark snapshots. The full event-stream/build-description hashes are observations at this review, not contemporaneously sealed execution receipts. No historical ordinary CLI launch-argument receipt or complete source-body/binary execution attestation is manufactured from source filenames. Retained audit documents describe the serial SwiftPM command; no successful log was read to strengthen that claim. The prior independently checked110/112 frozen package bindings and native benchmark source/build/launch provenance remain distinct evidence.

## Publication wording

Historical ordinary evidence can be reported as442 Core+3 Services→445 Core+3 Services, with423+3→426+3 started/ended functions and19 identical existing Core skips, five same known issues. The historical combined headline445→448 must not be called Core-only. This is a denominator clarification, not a changed test result or product failure.

The parent's separately supplied CURRENT integrated discovery is448 Core/68 Core suites,429 Core started/ended,19 skips PLUS3 Services/1suite; those later Core counts include the3 R38 privacy definitions absent from R43's historical streams. Current parent headline448 Core happens to equal historical combined448: the denominators differ. Use the parent's current448+3 result as current integration evidence, not a claimed historical baseline gate. This reviewer did not execute that current run.

The stable /tmp/pulpo-r43-parent-packet remains byte-unchanged: manifest SHA2564777f20bbc372e1de84fea2823571f6163c210fd730b8c199f5f03312ca8d8a8. The frozen8/12→12/12 hosted result, actual baseline-focused missing-globe RED, caret observation reproduction and no-source-blocker recommendation are unaffected. No builds, devices, source/gold/repository or stable-packet writes were performed.
