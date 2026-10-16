# R47 independent executor/evaluator/admission review v5

**BLOCK the exact frozen complete evaluator/admission bundle on two bounded script defects: the native summary discriminator does not match the actual tool output, and the XML validator does not enforce its claimed enclosing document form.** The exact v4 `testsuites errors=1/failures=1` escapes are closed. The unchanged model executor/comparator implementation is admissible for its published bounded capabilities; its exposed result independently recomputes **5,285/5,285**, 64 cases, 347 rows per variant, unavailable 0. Neither that result nor the passing mutation suites admits the complete final gate.

During this review, independent source v5 was separately ADMITTED and the parent's owned native run completed. Its raw summary reports one passed test, zero failed and zero skipped, but the frozen admission producer rejects that actual summary. This is a validator failure, not a native test failure. No native admission, fresh authorship, final seal/reveal or shipping approval follows from this report.

**Scope and cutoff.** Baseline/HEAD is `e503e5a6646208c6dc125271431bbb9d677b9bb8`. All **92 evaluator-freeze-v5** bindings and **60 source-freeze-v5** bindings match current bytes at the initial and final checks. The 60-file source snapshot has exactly its declared paths and hashes. Newly arriving source-review-v5/native-run/summary/attachment artifacts are identified separately below; they do not replace the frozen scripts or silently enlarge this review into admission of actual native behavior.

I read the original archived parent REVIEW.md, evidence.json, manifest and calculation script; the original R44 contract/protocol, rejection/evaluation accounting and source/executor/oracle/author review trail; the admitted R47 contract reviews and response; full current CONTRACT.md, PROTOCOL.md and SOURCE-CONTROLS.md; all evaluator and source reviews/responses v1–v4; both exact v5 manifests; complete current Runner/build/check/run-pair/freeze_gate/admission/schema/validator/test-check/test-admission/native-build/native-test/ordinary-test implementations; focused Swift fixtures, Support, hosted native source, selected build/run receipts, portable source/binary archives and structured evidence. I subsequently read independent source-review-v5 and the newly retained actual native summary, attachment bundle, run record, artifact map and first binding failure as factual steering. No R39 implementation or unrelated sealed data was read or imported.

Every one of the **117 dependency-manifest** entries matches archive bytes, including the `pulpo-r44-parent-review/` → `parent-review/` mapping; all **112 original internal artifact hashes** also match. All 66 archived JSON artifacts, including compressed raw arrays, were parsed. Logs were hashed as opaque bytes, never interpreted. Executable archives were hashed, never executed. These checks establish retained consistency, not historical blindness, exclusive execution or reproducible compilation.

Review execution used read-only source/Git inspection, Python retained-data calculations, explicit normal/optimized validators and automatically removed synthetic temporary fixtures. The sole additional tool-capability query was `xcrun xcresulttool get test-results summary --schema`; it runs no test or device. No Engine/model/native execution, build, device creation/driving, successful-log inspection, persistent-store access, source/data/script edit, fresh author/input/oracle/seal/reveal, delegation, commit/push/merge/deploy occurred. Only this report is persistently written. Synthetic native/review placeholders and validator mutations are never actual admissions.

**Finding 1 — BLOCK: native admission requires a key the actual summary does not emit.** `admission.py:151–152` requires `summary.get('testResult') == 'Passed'`. The live tool schema instead requires **`result`**, whose enum includes `Passed`, `Failed`, `Skipped`, `Expected Failure`, and `unknown`; `testResult` is absent from its properties. The schema query exited 0. Its exact output SHA-256 is `f34fbf46fd9142f1fd81d58e16103ced727e159154f670b6da1e8ea8277ba4e1`.

This is now corroborated by actual retained output, rather than inferred only from the schema. `native-summary-v5.json` has `result:"Passed"`, `totalTestCount:1`, `passedTests:1`, `failedTests:0`, `skippedTests:0`, no `testResult`, and identifies owned simulator `7BA07CA0-19C9-4152-AEF4-F6D140B72C03`. The parent-retained `native-binding-v5-first-failure.json` explicitly records `WHOLE_GATE_ERROR`, unavailable 1 and `structured native Passed summary`, distinguishing it from a failed XCTest.

I independently invoked the exact frozen producer against the parent's actual artifact map, with a new temporary destination in each interpreter mode:

```text
python3 -B admission.py produce native native-artifact-map-v5.json <temporary-new-output>
python3 -B -O admission.py produce native native-artifact-map-v5.json <temporary-new-output>
both: exit 1; WHOLE_GATE_ERROR; "structured native Passed summary"; no output admission created
```

No actual summary key or payload was added, renamed or fabricated. The producer fails while reading the raw summary/attachments, before native verification would read any log artifact. The actual attachment bundle has 39 original name/payload envelopes; that cardinality does not repair the wrong discriminator.

The supplied synthetic good native fixture uses the same invented `testResult` discriminator, so all 111 mutation rejections miss this producer/consumer incompatibility. Additional temporary, fully refreshed native/final-freeze fixtures demonstrate in explicit normal AND `-O` subprocesses:

- A successful summary using the actual `result` key is rejected.
- A deliberately contradictory synthetic summary retaining `testResult:"Passed"` while declaring `result:"Failed"` is accepted. Summary, run, normalized-admission and outer digests are refreshed. This is a validator adversary, never an alteration of real evidence.

Bounded remedy: validate the actual raw tool's `result` field and its unchanged integer 1/1/0/0 counts; make synthetic fixtures reflect that observable schema and reject an actual failed result. Preserve the original summary and failed binding attempt. Do not patch producer evidence with a fictional key. Freeze and independently review the corrected script/schema/tests with the actual native evidence before authorship. No production edit, new Engine/native execution, broader native matrix or prose-verdict classifier is required to fix this script defect.

**Finding 2 — BLOCK: an unsupported enclosing XML form bypasses the new fail-closed rule.** `validate-source-controls.py:19–35` rejects attributes only when an element's tag is exactly `testsuites`; it never requires that tag at the root. Unknown enclosing tags receive finite/integer attribute validation but no zero-failure or admitted-form check. `admission.xml_metrics` then finds the same descendant definitions and totals.

Minimal mutation of the actual full v5 XML, preserving every suite and testcase:

```python
tree = ET.fromstring(actual_v5_xml)
tree.tag = 'testreport'             # unsupported enclosing form
tree.set('errors', '1')            # separately: failures='1'
admission.xml_metrics(ET.tostring(tree))
# returns definitions=16, allDefinitions=467, executed=448, skipped=19
```

This is an unsupported evidence-form acceptance, not a claim that `testreport` is an actual Swift Testing producer or that the real v5 run failed. It contradicts the published claim that only the actual attribute-free `testsuites` wrapper is admitted. Changing the tag must not bypass that restriction and turn an enclosing failure-bearing artifact into admissible evidence.

For **each** error/failure variant I verified all of the following with explicit normal AND `-O` interpreters:

- Actual validator CLI: exit 0, PASS, unavailable 0.
- Copies of the actual normalized source-control and ordinary records in a temporary current-source layout: ACCEPT. All 114 real ordinary sources, resources, source archive and binary bytes remain unchanged; XML stored/decoded hashes, both run/build XML digests and descriptors are refreshed. A complete refreshed file map is supplied too.
- Fully bound synthetic final freeze using the **actual mutated v5 XML** and otherwise passing synthetic prerequisites: `freeze_gate.verify` returns normally. XML/run/build/admission/outer digests are all refreshed. Thus this is semantic/form validation missing inside a newly prepared freeze, not tampering detected merely by a stale outer digest.

Bounded remedy: explicitly require the supported root/enclosing form before searching descendants, retain its attribute prohibition and existing child-suite rules, and add the two unsupported-envelope adversaries through normalized admission and the final gate in both modes. A root-form check closes this exact escape; no general XML framework, production change, rebuild or new test execution is requested.

**Exact v4 XML finding disposition: its two original escapes are CLOSED.** I ran both the preserved v4 validator and current v5 validator against the exact retained enclosing-errors/enclosing-failures XML derived from actual v5 evidence. The old validator accepts both in normal and optimized Python. V5 rejects both with exit 1, `WHOLE_GATE_ERROR`, unavailable 1 and `unsupported enclosing suite declarations`. Against unchanged original v5 XML and a temporary decoded copy of its actual test binary, v5 produces a receipt **identical to source-controls-v5-validation.json** in both modes. The actual normalized source-control/ordinary records also validate against current sources. Finding 2 concerns another unsupported enclosing form, not a failure to close the precise v4 mutations.

**Disposition of earlier evaluator findings.**

- **V1 rollback/hold origins and omitted follow-ons: closed.** Each existing row in external AND reference positive intervals must hold the latest acceptance until the next declared event. Pre-acceptance rollback, crossing events and removal of an intermediate hold reject. The old 5→0→5 plan-plus-output escape cannot pass.
- **V1 omitted zeros and coverage: closed at the executable schema level.** Zero roles enforce literal zero weight and all 52 scalar offsets on every row in both variants, even without explicit zero relations. Every resource requires first, second-word and second-occurrence witness labels. Independent oracle/coverage review must still establish meaningful vocabulary, valid premises, real prior learning, occurrence separation and correct role assignments. Labels alone do not establish these facts; this is not a new automated semantic classifier requirement.
- **V1 process/unavailable/launch failures: closed.** Typed allowed fields reject boolean/float exits, malformed flags/text and unknown fields. Failed/unavailable invocations override stale complete arrays before scoring. In addition to the supplied suite, eight independently constructed malformed/error-bearing process records each reject under explicit normal/-O CLI calls, with unavailable 1 and no partial denominator. Eleven additional row/state/type mutations reject. The supplied missing-executable wrapper check launches no Engine.
- **V1 primitive capability assignment: appropriately bounded.** Numeric JSON identity is an always-nonnil counter, not nullable-ID evidence. JSON insertion refusal's selection-changing delete is not a true collapsed-caret backspace refusal; queued deletion is excluded. The separately mandatory sixteen-definition actual-Engine Swift harness supplies nullable IDs, primitive scalar replacement, true refusal, accepted correction, pinned undo and inherited separator controls.
- **V1 live compilation assembly: closed for these retained builds.** Compilation uses copied inputs. Both selected receipts contain exactly 25 inputs, 24 Core files plus Runner; portable archives match every input. Candidate inputs equal current source; baseline substitutes only the retained parent Engine. Binary archives match receipts and the paired receipt. These are historical provenance checks, not an independent rebuild.
- **V2 independent input/required files: closed.** The exact final schema binds actual input bytes separately, complete source/test/evaluator/admission files, exact executable/resource dictionaries and hashed review-role paths. The wrapper verifies before either executable site. Development may explicitly omit final freeze; its exposed result does not become a reveal.
- **V2 child XML failures/NaN/totals/mandatory definitions: original escapes closed.** Finite nonnegative numbers, integer count attributes, child-suite failure/error declarations/elements, mandatory missing/skipped definitions and the actual executed-plus-skipped convention are checked. V3's initial total-convention validator error remains retained as a validator failure. Findings 1–2 do not erase these closures.
- **V2 vacuous refused deletion/full negative offsets: closed for those obligations.** Original invalid `musicx` remains. Independently valid owned `planes` refusal proves unchanged scalar text, Character caret, collapsed selection and ID, then callbacks and realignment to valid `plane` without recovered taps. Kept `planes` matches complete Space state at six samples. Primitive/nullable/deletion/skip negatives assert finite full zero or complete preserved prior offsets. Positive JSON relations supply the full matched Space checks; not every positive Swift weight assertion is independently a complete Space relation.
- **V3 stale fixture/resource/XML/binary linkage: closed.** Exact current focused26/ordinary114/native69 sets, exactly three resources, portable stored/decoded artifact digests, exact regular source archives, build/run before-and-after sources and underlying XML/test-binary relationships are enforced. Native bindings additionally connect host/test binaries, built resources, raw structured evidence and hash-only logs. Final freeze includes the underlying paths/digests. Outer resealing alone cannot repair stale source/archive/resource relationships. Historical v4/v5 records remain versioned; selected final aliases equal actual v5 normalized records/build receipt.
- **V4 enclosing `testsuites` attributes: exact examples closed as reproduced above; complete admitted-form enforcement remains blocked by Finding 2.** No prior failure is reclassified as a pass.

Both supplied `test-check.py` runs pass their synthetic good packet and reject **31 mutations**. Both supplied `test-admission.py` runs pass their synthetic fixtures and reject **111 mutations**, including the eight new XML/normalized/final-gate labels. The latter explicitly invokes both normal and optimized subprocesses inside either outer mode. These counts measure adversarial validator checks, not independent production observations. The new findings are additional to their successful rejection results; validation uses explicit exceptions, not bare Python assertions removed by `-O`.

**Retained development and relational plan independently verified.** Complete normal and optimized recomputation equals development-source-v5/report.json, including every allChecks entry: **5,285 passed / 5,285**, 64 cases, 347 ordered rows per variant, unavailable 0. Roles are 24 positive, 38 zero and 2 preserve; there are 21 parity relations, 128 holds and 96 explicit zero points. Cases comprise 46 en_US, 10 es and 8 en_es. All thirteen public actions occur; the all-actions coverage record accounts for their declared optional arguments.

For all 21 positive acceptances, candidate external full touch state BEFORE and AFTER matches BOTH baseline Space and candidate Space with exact same history through acceptance. Reference and external increments equal declared mapped samples and are positive; baseline external lacks the contribution. Second words use accumulated prior ordinary learning; separately typed second occurrences add their exact new contribution. Individual follow-ons preserve their latest accepted state. Relevant positive pre-states report spelling valid in all 21 relations; maximum positive weight is 10, below the 300-per-key forgetting cap. Increments are five in 11 relations, four in 4, two in 2 and three in 4. Aligned sparse canoe supplies two; nil alternate accents supply three. This verifies existing exposed controls, not a fresh vocabulary choice or universal net-weight/sample rule under saturation.

The denominator is **3,475 non-touch preservation checks; 390 authored checks per variant; 198 touch-preservation; 42 parity-before; 42 parity-after; 42 reference increments; 21 external increments; 21 baseline missing contributions; 256 holds; 192 explicit full-zero; 216 all-row role-zero**. Whole maps, arrays and states count as single correlated comparisons where implemented. Eighty-five changed row pairs differ only in weight/offsets. Every exact scalar text, Character caret/selection, total word events, watched counts, ordered pairs, policy, validity, ID and primitive count is preserved; five extra probe fields are compared on the probe row. These are not 5,285 independent samples or measured typing accuracy.

The paired receipt's input/executable/resource hashes and process records agree with actual retained bytes; both exits are 0 with empty stderr/stdout. The three historical unavailable endpoint/initial-range/host-range attempts retain nonzero process status, raw errors and WHOLE_GATE_ERROR/unavailable 1, with no scored subset. They remain older executor-guard evidence, not new current-source executions.

**Current source controls and artifact provenance.** Both actual normalized admissions pass binding verification against current focused26/fullordinary114 source sets and all three real dictionaries. They share the full serial compiling source-test-run-v5 invocation as build and run. Its 114 before/after maps equal current bytes and its exact source archive; XML and decoded test binary hashes match. XML retains 464 Core plus 3 service definitions: **467 retained, 448 declared executed, 19 separate opt-in skips**; all sixteen mandatory definitions are unskipped, with no error/failure elements and valid child totals. Parameter arguments are correlated within definitions. The supplied same-five-known-issues accounting is retained, not reconstructed from successful logs.

Model archives contain every receipt-selected input; command input sets contain the same 25 Swift paths. Both builds record exit 0, `swiftc -O -parse-as-library`, XcodeDefault swiftc, Apple Swift 6.4 (`swiftlang-6.4.0.34.1 clang-2100.3.34.1`), arm64-apple-macosx27.0.0. The archived baseline Engine independently equals the immutable e503e5a6 Git object. Only Engine differs among the 41 pre-edit production bindings. No TouchModel/storage/dictionary/normalization/correction-policy/tuning/Controller/transcript-lifetime changes or R33/R45 imports are introduced by the inspected production diff; this evaluator report does not supply a new production-source decision.

The independent source chain separately rejected latest canonical restoration (v1), earlier-own canonical restoration (v2), primitive callbacks after composing consumption (v3), and noncanonical polling/restoration (v4). Those failures remain preserved. The exact polling witness retains baseline **5/0/0**, candidate-v4 **5/5/5**, candidate-v5 **5/5/0** for Space/external/observed replacement, with complete offsets, prevalidity, exact text, caret 6, selection 0 and count 1. V5 mandatory source adds noncanonical prefix/suffix polling negatives and unchanged/exact-own-echo positives. Independent source-review-v5 now ADMITs its exact source freeze; that later independent decision is acknowledged, not inferred from exposed counts or supplied by this report.

**Native capability and phase boundary.** The frozen hosted source defines 21 first and 18 second resource/route attachment payloads, omitting second URL. Its offered search UIButton and result-control actions, query document/full-state isolation, picker item, actual `.com` layout action, real KeysView timer/popup/move/end alternate path with nil é slot, first/second complete Space offsets and word/pair/text/caret assertions, callbacks and follow-ons match the published intended capabilities. The expected weights/counts/text and URL literal-zero offsets in native_metrics otherwise track that source. Query/caret/callback/follow-on assertions live inside the bound XCTest; the attachments alone do not enumerate every such step. Finding 1 blocks consumption of its real summary.

The frozen generic Release build receipt has matching native69 before/after/current/archive sources, host/test binary archives and three built-resource digests. It is build provenance. Later native-run-v5 records exit 0 on the parent's owned iPhone 16 simulator and matching before/after sources/binaries/resources; its raw summary reports one passing test. These later facts supersede the initial brief's statement that no device/run existed. They are outside the frozen 92-file evidence set and do **not** constitute a completed independent actual-native/current-composition admission here. The first binding failure is retained. `native-admission-final.json` is still absent at this review's final check: a prospective synthetic real-source file map correctly fails the final gate's mandatory-file check, with precisely that required file missing. Missing admission is a phase prerequisite, distinct from the two script findings.

After preserving this rejected v5 script freeze, resolve Findings 1–2 in new exact bytes and obtain a NEW independent evaluator/admission review with the actual native evidence and current composition. Source v5's independent admission remains specific to its unchanged source hashes. Only after the source/executor/evaluator/native prerequisites are admitted may a new sourceblind author receive the exact public semantics, followed by independent oracle/coverage-plan review, complete source/executor/evaluator/resources/binaries/admission/input freeze and ONE paired reveal. No author/input/seal/reveal exists or is authorized by this report. A failed required round stays inactive and the parent restores its own production change without tuning. Parent composition with future R39 work remains separate; no import/read or larger redesign is requested. Hosted controlled geometry establishes no finger, installed-extension, remote-delivery, VO or human-accuracy claim.

**R44 remains rejected and inactive.** Independent retained-data scoring again gives baseline **777/777**, candidate **776/777**, 70 cases/211 rows per variant, zero JSON gains and the immutable aligned `ca` + nil `noe` frozen-zero loss. All 30 changed old rows are touch-only; all 1,477 base preservation fields agree. The five positional slots carry two legitimate measurements, not fabricated shifted points; inherited `mu` plus tapped `sic` is a different excluded history. R47's independently revised sparse contract, later parity calculations and current passing development cannot repair that old oracle or the missing original preseal relational evaluator. The original primitive A→B baseline0/oldcandidate5 witness also remains exposed failure evidence.

**Exact SHA-256 bindings.** Audit-relative unless a production/resource name is stated. The two freeze digests bind the complete independently checked tables; these principal hashes identify the rejected scripts and evidence precisely.

```text
evaluator-freeze-v5.json                 2686116150c72f6a5ba8fe1820156ea74a2d23cf6dffc88f18158a6d11b66e14
source-freeze-v5.json                    57a08d38e6873cf5cda74ec22b57bde6b6a06c5c23acbba0e656ab5b9c182c33
admission.py                            6ee3391d3c3f72cf3761426ff3196c37da91abdaac6fbbb32f47cfe83def7dfb
admission-schema.md                     892f93b44f32efd899998b8c74aba68886fe166362ac59f87984744be2dbed23
validate-source-controls.py              c725e80ba241748f0a850eb6a6b14b2c535c3c1dc1cecea614939271a465b29f
freeze_gate.py                          aae941d54feaf1c1eee0d01e65c8fa1eb63a041ed70696de43559bf0871d4f88
test-admission.py                        0571f41701f97dd1d2511d7eb9703f30aaf9f2e0424d0b62f91ca46519e79b2c
check.py                                 0c4d05b9a2a05c38bb0d9b45067ac59b957e47a5d6da9ced24b91e14649f01d2
run-pair.py                              8300bba61cca862e09bd451d83629cae70fbe7b1a99b57fe382bda0ca815e9f6
test-check.py                            ccf8a4536b7dc6e8bba69b98573e9fe823713809e1960dd2e6e94ca82278b4a9
build.py                                 f5c71ca8e6a52246903395604c799968765151795109169f989c38c1b4646c9d
Runner.swift.txt                         ce912556ddec4bc33e16fc2ae4d0967bc5c096fb4ed9efc4d017738ae9adfa14
native-build.py                          99c5a3bde49bf6d360a1481241f4c5d474bd03568887c71c1d337fa958fcdcda
native-test.py                           0b4f12e49a7066f948b222e5fbaf0d3001ca503f8476efd9181728334b9de516
ordinary-test.py                         19c367ad8eb6425965f28bc347d5755652c3a9bf62538c0a41e5a64dfe40a9d8
CONTRACT.md                              f871c65add14a98a80edd3ef347224b16d95981b8fe0f6d5857ebfc7cc9d07c0
PROTOCOL.md                              95d7ff891055517fb9996ffc44ad396a15be959fca5ca1a71458d0e00ea56a1c
SOURCE-CONTROLS.md                       c16d689e2e8dc04ee6d666014f9f57bca62bbecd9b78798bd992133c096b5eb9
KeyboardCore/Input/KeyboardEngine.swift  7666863e423b124fb2191ae44076b680e5d53d005c401dda9cd4c60489185cd2
CoreTests/ExternalTextTouchR47Tests.swift 6dd22e7a7e3ced22549c390e033364492d684ea4e1644c017a2f55e51d0c3f66
CoreTests/Support.swift                  419f343bf1ac39cad59d6dfa86f108aa5496e9f09b02ac77ab51cde2fcdc68e1
AppTests/ExternalTextTouchR47Tests.swift  48d80c3193b63068596ff87bf32d70dde85a9c8ae85a0978b79df4c7497c0971
source-review-v5.md                      18c0db45c8f20b852e8681d2134dd8387d3bfce4df1e0db33af2745a48ca748b
source-controls-admission-final.json     70e2a8e933dda569fc00046f725b6f2b4fdf4d7d30e4decbd7c83eb4ecce431d
ordinary-admission-final.json            5f06b42f524b1bffac7b8b39a3e4d1e79e0aa40e165a4d3ca665a6f33fd16c12
source-test-run-v5.json                  b72948216ba9ba5ef61b460cfbf93979b4f292c9168de4fdc34eedc578fd75ab
native-build-v5-receipt.json              b0e056494b2f83247220c00c754a332096c6224c3cc875030927d62a686005e0
baseline-final-build-receipt.json         88eb7ca73f2e04007160ad5c5d9d75e7a3b5f25112d685fb44bad72d6434d72c
candidate-v5-build-receipt.json           34f2a49c81579547f086bab7e24de3a34c641be31b1aacae77d91b6fc8715f95
development-v3.json                      13a3d8048a1c07e2c8fe6a5f3cf86deb8686b3450618baf2eac989530bb92b7a
development-source-v5/baseline.json       8990580c00354f90ad751257b1ed34f1bd874720abb0d85bcc91b53930061d13
development-source-v5/candidate.json      3057eb25606ae63d54254a543a955906300c0923fc588f9c7d54116f2d7c4b9b
development-source-v5/process.json        db80454d7fd986c0cbcace7009ec88330a59819ab3cf73a1e238dd54ee292d10
development-source-v5/receipt.json        3c7905d711b0808bfacd15d610643bccf4256b5b481f22f023d58b18baba7558
development-source-v5/report.json         365670f61b4608597277df6c4693c97d9d85b1d8bb861ac7f1308f830ebe8382
admission-mutations-v5-normal/optimized   6cd6f6ddd4ff8c9fdcd7c35df18ec9cca9e57a3e89d5baa4c93d641fed0c01bb
binaries/baseline-v2-source.tar.gz        9652fd0719ec494615f8e42fc4a1a505a748ad4196f185ee46be386a7d0e8846
binaries/candidate-v5-source.tar.gz       254cf52df1193993bfbaeb290e8042f31ffa2e4dc1001df178d2d0cde02daacc
snapshots/ordinary-v5-sources.tar.gz      a15ae7218a64b98b3f12a417c3c6094989169a855e3d4f737722b09f5c5374ac
snapshots/native-v5-sources.tar.gz        67b557719f7d4c3c429e395547726f9717d7a3ad1266e1886cf39fb19c35e769
ordinary-v5 XML, decoded                 64d880e01fb1e8378b732ce4e3358ff423ee6d485fc7f05a9f59db18e88a2fc2
source-controls-v5 test binary, decoded   8259c1c1029ca29db5f796f745f14152d823e294bbd5b053a26270a752365d0c
baseline-v2 model binary, decoded         9439efbce99bfe76efab889af00fb6301e0f54ca0de32fa486dc20160f422ae1
candidate-v5 model binary, decoded        a0041b21153d69f125d9c4f64edc8b1436875bd6e6b2a629ef850f832068b710
native-v5 host binary, decoded            4e59c2d586cf47991700e7bcd19cbbc075cc1be94c4992540b8b065d50665b69
native-v5 test binary, decoded            5b0e871dd9db51f01b3994100e0542d56a2ed8672626e7cd65b52705a3b5c7ae
LanguageData/en_US.pkdict                 168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64
LanguageData/es.pkdict                    66a256a487f451812ec53920b2a5f2dea9aafb77fbf8e50240a0b87d2729e7fb
LanguageData/en_es.pkdict                 93d2d22d58e7e753771dd0e29b19036d74a5ec7aeafba703724c24a93e581237
native-summary-v5.json (later evidence)   c22078caeb490d1b66c0105882007e80d156567cfe0c2a41be78b666264af6ac
native-attachments-v5.json (later)        d4fdccc02e5bba5525dcd38d7e01d7c92f32bc33164390e4b45eed952e73aa29
native-artifact-map-v5.json (later)       71c9637a0c466bc4b76ce115464ed771206a2e23cb7fc860ff8934f0aaee7b52
native-run-v5.json (later)                411656a1c4343d970ca8afda22647393add68fb83c4e9d4a29c1fdd79a09fdd6
native-binding-v5-first-failure.json      5ec021ef5475aa9996fea51c64a26c31e4296ca292178b8d520f040f76f9d2b6
dependencies/manifest.json                28a2753070f3e4e1791d261d30f6cc98db8b07a837bf9fef7e3ee047bee9d8e0
dependencies/r44-verbatim.tar.gz          22e7b2e70846d7f50179bbbb75a1a6c960289c5b72a2634eab2985c96fa11d38
archived parent REVIEW.md                c1af1e2407e55d1c1b36e07a0f06b8abbe7f9d7a26c0998aee5635c38a7864a1
archived parent evidence.json            77f24e8db29d9349a2949d21aa85b90b930862114b577e9e2667527eb6b43b3d
baseline Engine                          3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97
```

**Final exact-script disposition: BLOCK admission.py/validate-source-controls.py and the dependent complete final-gate bundle on Findings 1–2.** The model executor/comparator and the prior binding closures have the bounded favorable dispositions above. Source admission is separately recorded; actual native admission and a newly reviewed corrected evaluator remain prerequisites. Preserve all v5 scripts, real summary, failed binding attempt and synthetic-adversary description before any replacement freeze. No new production requirement or outcome-informed oracle repair is proposed.
