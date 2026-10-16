# R47 independent preauthor evaluator and actual-native review v6

**Evaluator/admission implementation: BLOCK on one bounded remaining XML structure escape. Actual native evidence: ADMIT for the exact v5 source and the declared hosted component scope. Complete readiness for fresh sourceblind authorship: BLOCK until the XML escape is closed and independently reviewed.** The two exact v5 findings are resolved. The actual native run is functional evidence, not merely a successful compilation. Its favorable disposition does not override the remaining evaluator defect.

Baseline/HEAD: `e503e5a6646208c6dc125271431bbb9d677b9bb8`. All **60 source-freeze-v5 bindings** and **123 evaluator-freeze-v6 bindings** match at the initial and final checks. Source-v5 admission remains specific to Engine `7666863e423b124fb2191ae44076b680e5d53d005c401dda9cd4c60489185cd2`; this review changes no source decision or production bytes. R44 remains rejected and inactive.

**Scope and method.** I read the original archived parent REVIEW.md, complete evidence.json and calculation script, dependency manifest and original R44 contract/protocol/review/response/rejection accounting; current CONTRACT.md, PROTOCOL.md, SOURCE-CONTROLS.md and admitted contract reviews; all evaluator reviews/responses v1–v5 and source reviews/responses v1–v4 plus source-v5 ADMIT. I inspected the complete current evaluator, admission, freeze, validation, mutation, build/run/collection scripts and Runner; the production diff, mapping/learner/policy and Controller/resource routes; focused/Support/hosted fixtures; selected admissions, source/build/run receipts, source/binary archives, XML, model results, original native exports, summary/test tree, ownership/release and extraction-failure evidence. All 117 dependency-manifest hashes and 112 original internal artifact hashes match; all 66 archived JSON artifacts, including compressed arrays, parse. Original log members were handled as opaque hash inputs. The source-v5, ordinary-v5 and native-v5 source archives have exactly their declared 60/114/69 regular-file bindings.

Verification used retained-data calculations, read-only Git/source/archive inspection and temporary synthetic validator adversaries with bytecode writes disabled. I executed no Engine/model/native binary, Swift test, build or device operation; read no persistence stores or R39 implementation; created no fresh author/input/oracle/seal/reveal; and performed no commit/push/merge/deploy or delegation. Build/test log files were not opened for interpretation; admission log descriptors were verified by opaque hashing. Synthetic fixtures are validator tests, never native observations or review admissions. **This report is the only persistent file written.**

**Remaining finding — BLOCK: a mandatory testcase nested inside an existing skipped testcase is counted as an unskipped mandatory definition.** In `validate-source-controls.py:21–25`, root/suite/direct-testcase checks are now present, but testcase children are checked only for the tag `skipped`. A skipped element's descendants are unrestricted. Lines 37–46 then use descendant searches for suite totals, mandatory definitions and final accounting. A nested mandatory testcase has no children itself, so line 45 also accepts it.

I used the actual unchanged v5 XML and moved exactly `primitiveMustRetainIdentityAndExactScalarText(control:)` from its direct position in the 445-executed/19-skipped Core suite into the existing `<skipped/>` child of `KeyboardCoreTests.KeystrokeSavingsBenchmarkTests.measureKeystrokeSavings()`. No testcase names, count attributes, skip counts, failures, resources, sources or binary bytes were changed. The resulting structure includes:

```xml
<testcase classname="KeyboardCoreTests.KeystrokeSavingsBenchmarkTests"
          name="measureKeystrokeSavings()">
  <skipped>
    <testcase classname="KeyboardCoreTests.ExternalTextTouchR47Tests"
              name="primitiveMustRetainIdentityAndExactScalarText(control:)" ... />
  </skipped>
</testcase>
```

The mutated XML SHA-256, serialized by Python ElementTree, is `32dcaee82f24538796ad691fe509528dc225b436b54893ccc3bb96ec461416f9`. This is an unsupported-structure adversary, not an assertion that Swift Testing produced this form or that the actual mandatory test was skipped.

Reproduction from the retained XML is small:

```python
tree = ET.fromstring(gzip.decompress(actual_xml_gz))
case = next(c for c in tree.findall('.//testcase')
            if c.get('classname') == 'KeyboardCoreTests.ExternalTextTouchR47Tests'
            and c.get('name') == 'primitiveMustRetainIdentityAndExactScalarText(control:)')
suite = next(s for s in tree if case in list(s))
suite.remove(case)
next(c.find('skipped') for c in suite if c.find('skipped') is not None).append(case)
admission.xml_metrics(ET.tostring(tree))  # ACCEPTS: 16 / 467 / 448 / 19
```

Independent results in **explicit normal and optimized Python**:

- Direct `xml_metrics` accepts all sixteen mandatory names and returns the unchanged 467 retained / 448 declared executed / 19 skipped accounting.
- Both real source-control and ordinary normalized admissions accept in a temporary layout containing their actual 114 source files, real resources, binary and source archive. Only mutated XML, run/build XML digests, artifact descriptors and the complete file-digest map are refreshed. The admission metrics remain unchanged.
- A fully bound synthetic final freeze accepts this **actual mutated XML**, after refreshing XML/run/build/admission/outer digests. Its unrelated synthetic native/review prerequisites are explicitly synthetic. The final gate returns normally in both interpreter modes, without invoking an Engine.

Thus a newly prepared internally consistent freeze can claim mandatory unskipped coverage for a testcase absent from the direct executed-testcase set. This is semantic validation missing behind refreshed digests, rather than ordinary tampering caught by an unchanged outer hash. The actual XML remains well formed in the supported direct structure; its real mandatory coverage is not disputed.

**Bounded remedy:** require the admitted skipped evidence to be a leaf, and/or derive and validate totals/mandatory definitions exclusively from the already admitted direct suite/testcase structure while rejecting deeper testcase/suite evidence. Keep the actual nineteen opt-in skips. Add this nesting adversary through direct validation, both normalized admissions and a fully refreshed final freeze in explicit normal/-O modes. Preserve the rejected v6 bytes. No production/test-source change, rebuild, Engine/native rerun, new vocabulary/oracle, larger matrix or automated prose-verdict classifier is required.

**V5 findings are closed.** The native validator now consumes actual raw `result:"Passed"`, rejects any invented `testResult` alias, enforces nonboolean integer 1/1/0/0 counts plus expectedFailures=0 and empty testFailures. The unchanged real native producer succeeds in both interpreter modes and reproduces `native-admission-final.json` exactly into temporary destinations. The former actual failed binding remains WHOLE_GATE_ERROR/unavailable1; it is not relabeled as a failed XCTest. The retained synthetic contradictory discriminator acceptance remains an old validator failure, not a native observation.

The XML validator now requires an attribute-free `testsuites` root before descendant calculations, direct `testsuite` children and direct `testcase` children. Original enclosing errors/failures and unsupported `testreport` roots reject, including fully refreshed normalized/final-gate examples. The new finding concerns the unchecked descendants of permitted skipped evidence, not either old root mutation. Preserved `admission.py`, XML validator, schema and mutation-script v5 copies match the corresponding old freeze hashes.

**Earlier findings retain these dispositions.** V1 rollback 5→0→5, crossed hold roots and missing follow-ons reject; each existing external/reference follow-on must hold the latest acceptance. Zero roles enforce literal zero weight and all 52 offset scalars on every row even without explicit zero relations. First/second-word/second-occurrence resource declarations are enforced; meaningful vocabulary, role assignment, actual earlier learning and occurrence separation remain independent coverage-review work. Typed failed/error/unavailable process records override stale complete arrays before scoring. Eight additional independent malformed/error-bearing process records reject with WHOLE_GATE_ERROR/unavailable1 and no partial denominator in each explicit interpreter mode.

V1 primitive capability gaps remain correctly assigned to the sixteen mandatory Swift definitions: numeric JSON identity is not nullable-ID evidence, and JSON insertion-refusal deletion is not true collapsed-caret refused backspace. Nullable identity, primitive scalar transforms, true refusal, accepted correction, pinned undo and inherited/derived text are supplied by those bound fixtures. V2's known-valid planes refusal and complete negative/preserved offsets close its original vacuity/full-state objections; the invalid musicx fixture remains historical. Ordinary opt-in skips are separate from mandatory coverage.

V2 independent input and mandatory-file freeze gaps and V3 stale fixture/resource/XML/binary/source-archive cross-binding gaps remain closed. Exact focused26/ordinary114/native69 sets, three resources, stored/decoded artifacts, source archives and build/run before/after relationships are enforced. The final gate explicitly requires the existing ordinary/native build/run/collection scripts alongside the model/executor/evaluator files. Final aliases select the actual v5 source-control/ordinary records and candidate build receipt byte-for-byte. Final review/author/oracle paths are hashes requiring independent interpretation, not an automatic semantic approval mechanism. No real final input/freeze is expected before the later authoring phase.

Both supplied comparator suites pass their synthetic good fixture and reject **31 mutations**. Both supplied admission suites pass synthetic good fixtures and reject **127 mutations**; each outer run explicitly invokes normal AND optimized subprocess validators. The new nesting escape is additional to those successful rejections. Ten independent mutations of the actual native payload bundle—duplicate identity, wrong language/name, boolean count/weight, short/nonfinite offsets, first pair, second self-pair and second text—also reject in both modes. Validation uses explicit exceptions rather than acceptance assertions removed by `-O`.

**Retained model evidence independently recomputes PASS 5,285/5,285, unavailable 0.** There are 64 cases, 347 ordered rows per variant, 24 positive/38 zero/2 preserve roles, and 46 EN/10 ES/8 BI cases. All thirteen published operations occur. Exact IDs/languages/operations/order/cardinality, complete watch/pair fields and all 26 finite offsets plus weight validate. Every non-touch field is preserved; 85 changed row pairs differ only in touch state. The five extra probe fields are included in preservation.

All 21 positive external acceptances compare full BEFORE and AFTER state against **both same-history baseline Space and candidate Space**. Exact positive increments, second words with prior learning, independently typed second occurrences, all 128 holds and every zero-role row pass. Relevant positive pre-states report spelling valid; positive weight never exceeds 10. Aligned canoe supplies two points and sparse accent witnesses three; inherited short/shifted taps remain excluded. These are exposed observations with bounded unsaturated histories, not a universal net-weight/sample law or fresh expected outputs.

The denominator is **3,475 preservation checks, 390 authored checks per variant, 198 touch-preservation, 42 parity-before, 42 parity-after, 42 reference increments, 21 external increments, 21 missing baseline contributions, 256 holds, 192 explicit full-zero and 216 role-full-zero checks**. Whole maps/arrays/states count as one comparison where implemented. These correlated checks are not independent accuracy samples.

Both model receipts bind 25 copied inputs (24 Core plus Runner), the actual archived source bytes, compiler command/toolchain and retained binary hashes. Candidate inputs match current source; baseline substitutes only the archived Engine, independently equal to the immutable baseline Git object. Shared production bindings are unchanged. Both builds record swiftc -O -parse-as-library, Swift 6.4 and arm64-apple-macosx27.0.0. Paired input/resource/binary hashes and exit0/empty stderr/stdout agree. This corroborates retained provenance without rebuilding. Historical whole-run endpoint/range failures remain failures, without subset scores. The unchanged historical adaptation evidence remains 672 rows, nine lower synthetic costs and six newly intended offers out of nine; the three unchanged offers remain included. Offers are neither committed corrections nor blind/human accuracy.

**Actual native evidence — ADMIT for this exact current composition and bounded scope.** All three real selected normalized admissions validate under explicit normal/-O. The native record additionally has independently corroborated originals and functional execution:

- The v5 build is serial standard simulator Release, own DerivedData, ENABLE_TESTABILITY=YES, ONLY_ACTIVE_ARCH=YES and diagnostics never. Its exact 69-source before/after maps equal current bytes and its source archive. The original run is test-without-building on owned iPhone16/iOS27.0 UUID `7BA07CA0-19C9-4152-AEF4-F6D140B72C03`, exit0, with matching before/after sources AND binaries, the exact build-receipt digest and xctestrun digest.
- Raw summary says result Passed, one total/one passed, zero failed/skipped/expected failures, empty runtimeWarnings/testFailures. The structured tree identifies exactly `ExternalTextTouchR47Tests/testActualPickerAndSearchKeepTappedWords()` as Passed on that arm64 iOS27.0 simulator. One XCTest contains the correlated route/language checks; it is not 39 independent tests.
- All **39 original name/payload envelopes** equal the JSON bodies in the original export archive, in the recorded manifest order. The manifest binds the exact test, same owned UUID, nonfailure association and timestamps inside the run. There are exactly 21 first and 18 second names, covering all three resources and seven first routes; second URL is intentionally absent. I checked schemas, identities, languages/routes, integer counts, finite complete offsets, exact text, weights and all Space relations, not cardinality alone.
- Ordinary EN first/second weights are 9→14; ordinary ES/BI 10→15. Alternate EN is 7→10; alternate ES/BI 8→11. First word/previous/pair counts are 1, second word count2/previous1/pair1/selfPair1. Ordinary and alternate picker/search offsets match their corresponding first AND second Space states in full. Every URL payload has literal zero weight/counts/all offsets and the exact `.com` text.
- The hosted test obtains dictionaries through actual `KeyboardResources.url`. Its source searches the main bundle and embedded extension bundle, with a test override only when explicitly set; none is set by this bound test. The actual same-build local host/test binaries hash to the archived/run digests. All three built extension dictionaries independently hash to the current LanguageData and receipt digests. Resource use is established from these exact source/build/run/bundle relationships, not inferred from another build.
- Frozen hosted source fires the offered search-entry UIButton action, types party through query routing, asserts document/query/full-state isolation and fires an actually offered result control. Picker uses the offered collection item; `.com` comes from the real layout. Alternate é uses KeysView begin/timer/popup/move/end and Controller's nil-tap alternate route. First/second text, caret/selection, full offsets, word/pair state, callbacks/follow-ons and a fresh same-spelling occurrence are asserted in the exact passed test. Query/caret/callback assertions are supplied by that source/test-binary/passed-summary combination, not invented as additional attachment snapshots.

The collector's complete run equals every field of the original run and binds original-run hash, build, summary, test tree, attachment manifest/bundle, raw export/complete xcresult archives, collector hash and opaque log hashes. The export archive has the manifest plus 39 originals; the complete xcresult archive is retained and hashes correctly. Initial two exit64 database-initialization extraction errors remain retained; serial extraction recovered the same bundle without a test rerun. They are extraction failures, distinct from the passed XCTest and the old failed binding.

Device-list exit127 and both exact-UUID open errors remain recorded. The retained ownership/boot/release trail supports the authorized exact-UUID fallback. Shutdown/delete exit0 and verified absence are recorded; preferencesChanged=false. This reviewer drove no device. No protected-device use, performance quiet-window or physical deployment is claimed.

Hosted controlled geometry with synthetic UITouch is **not finger hit-testing, installed-extension/remote-host delivery, VoiceOver or human accuracy**. The native ADMIT is evidence acceptance within that scope, not reproducible-compilation or historical-blindness attestation, nor permission to skip the evaluator blocker.

**Source and historical boundaries.** Independent source-v5 ADMIT remains unchanged. Its helper invalidates nonexact/non-own observed snapshots while preserving exact expected/own echoes and in-flight edit-depth observation; ordinary reconciliation remains unchanged. The immutable polling witness retains baseline5/0/0, v4=5/5/5 and v5=5/5/0, complete offsets and prevalidity/text/caret6/selection0/count1. Earlier canonical and primitive failures remain historical. The current ordinary run binds all114 source before/after/archive entries and XML/test binary: 467 retained definitions, 448 declared executed, 19 opt-in skips, all16 mandatory definitions directly present and unskipped. The supplied same-five-known-issues accounting is retained without reconstructing it from logs. Parameter cases are correlated within definitions.

R44 independently remains baseline777/777 versus candidate776/777, 70 cases/211 rows, zero JSON gains and the same case64 frozen-zero failure. Its aligned five slots contain two real c/a points, not fabricated shifted evidence; inherited mu+tapped sic is different. All1,477 old base preservation fields agree and all19 later descriptive Space relations match, without repairing the absent original preseal evaluator. The pre-edit A→B oldcandidate5/baseline0 witness remains exposed failure evidence. R47's new contract cannot relabel any old failure.

**Exact principal SHA-256 bindings** follow; the two checked freezes retain the full tables.

```text
source-freeze-v5.json                    57a08d38e6873cf5cda74ec22b57bde6b6a06c5c23acbba0e656ab5b9c182c33
evaluator-freeze-v6.json                 9739291518b81800272905521892e2fb4a831a0fc5a9d30b36dc9c8a79017578
validate-source-controls.py             dbd7a9f039d5b8dcfa16af06108ba0cf5e16ac08df51de30d86971c5d5103b6a
admission.py                            00e4656a0acc8eb10543b205a71604e7fd8ec838ed0feb73b6a9754352945192
freeze_gate.py                          b03a81463354513cc63263d73489f3de4f302254363080206401bd30cf30fcab
test-admission.py                       969ea6df6691c34958e268abad6dada62ea66770bd6fba2694c8655b6799e582
collect-native.py                       925ee595d21ff244a7c8de41a02ddc53eeed4f8d50606fc9726ab8871c5f0a79
source-review-v5.md                     18c0db45c8f20b852e8681d2134dd8387d3bfce4df1e0db33af2745a48ca748b
source-controls-admission-final.json    70e2a8e933dda569fc00046f725b6f2b4fdf4d7d30e4decbd7c83eb4ecce431d
ordinary-admission-final.json           5f06b42f524b1bffac7b8b39a3e4d1e79e0aa40e165a4d3ca665a6f33fd16c12
native-admission-final.json             d32034c85d2f43c63d95f40b24aad41f8541e0355b0ccf4bca851d581557534b
native-build-v5-receipt.json             b0e056494b2f83247220c00c754a332096c6224c3cc875030927d62a686005e0
native-run-v5.json                      411656a1c4343d970ca8afda22647393add68fb83c4e9d4a29c1fdd79a09fdd6
native-complete-run-v5.json             eba0d46df711a696025bb229b3caa00116bb9ecb8212b8fad6929c23f5f66207
native-summary-v5.json                  c22078caeb490d1b66c0105882007e80d156567cfe0c2a41be78b666264af6ac
native-tests-v5.json                    cc44dc232f75f43fb4f22e6f313a0e5ced25b76d64b81c4f2e69d6dc4501bb27
native-attachments-v5.json              d4fdccc02e5bba5525dcd38d7e01d7c92f32bc33164390e4b45eed952e73aa29
native-attachment-manifest-v5.json      fcae4c851959524e15e04b639d6713b67b714ad4fb08f3d846803617ad30f9bd
native-attachments-export-v5.tar.gz     999341810e4bc84bd6bd2f7bdf769ab1a0d5dc3bca47e9da32f9c2ccb5435879
snapshots/native-xcresult-v5.tar.gz      5db05956028dbe09e840ef1eb7014260a023a718172f1a56d101f7a309465807
native-v5 host binary, decoded          4e59c2d586cf47991700e7bcd19cbbc075cc1be94c4992540b8b065d50665b69
native-v5 test binary, decoded          5b0e871dd9db51f01b3994100e0542d56a2ed8672626e7cd65b52705a3b5c7ae
ordinary-v5 XML, decoded                64d880e01fb1e8378b732ce4e3358ff423ee6d485fc7f05a9f59db18e88a2fc2
ordinary-v5 test binary, decoded        8259c1c1029ca29db5f796f745f14152d823e294bbd5b053a26270a752365d0c
LanguageData/en_US.pkdict                168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64
LanguageData/es.pkdict                   66a256a487f451812ec53920b2a5f2dea9aafb77fbf8e50240a0b87d2729e7fb
LanguageData/en_es.pkdict                93d2d22d58e7e753771dd0e29b19036d74a5ec7aeafba703724c24a93e581237
dependencies/manifest.json              28a2753070f3e4e1791d261d30f6cc98db8b07a837bf9fef7e3ee047bee9d8e0
dependencies/r44-verbatim.tar.gz         22e7b2e70846d7f50179bbbb75a1a6c960289c5b72a2634eab2985c96fa11d38
archived parent REVIEW.md               c1af1e2407e55d1c1b36e07a0f06b8abbe7f9d7a26c0998aee5635c38a7864a1
archived parent evidence.json           77f24e8db29d9349a2949d21aa85b90b930862114b577e9e2667527eb6b43b3d
```

**Final disposition:** one XML implementation blocker; no unresolved actual-native evidence objection within the declared scope. Fresh sourceblind authorship remains blocked by the dependent evaluator gate. After a bounded script fix and independent new-hash re-review, the parent may proceed under the original sequence: NEW sourceblind author with public CONTRACT/PROTOCOL only, independent oracle/coverage-plan review, complete source/executor/evaluator/oracle/resources/binaries/admissions/input freeze, then ONE paired reveal. No fresh author/input/seal/reveal exists here. Failure remains inactive with the parent's own production restoration and no after-reveal tuning. Future R39 composition and publication remain separate parent responsibilities.
