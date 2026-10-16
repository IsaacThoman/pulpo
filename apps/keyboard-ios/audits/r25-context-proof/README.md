# REJECT before production — R25 context proof

Retain R25 as negative oracle/domain evidence. **No production candidate was applied, frozen or evaluated. No fresh workload was revealed or executed. No accuracy gain is established.** The original implementation [agent-audit.md](agent-audit.md), contract, reviews, metadata and fixtures remain byte-exact historical evidence.

The proposed conservation gate rejects an ordinary, conserved double-space rewrite at seed 11, operation 137. It starts at `Tegucig |d`, deletes the separator to produce `Tegucig|d`, then inserts `. ` to finish `Tegucig. |d`. Every inherited letter survives. There is no fresh owned word W; the oracle's blanket prohibition on automatic deletion before an inherited letter therefore rejects legitimate separator formatting. This is a domain mismatch, not inherited-letter corruption or a missing Shift/casing proof. The independent domain objection and failed required short-fuzz gate stand. The inactive original domain test demands that conserved formatting be accepted; it was not inverted, weakened, skipped or relabeled known. Do not tune or accept this rejected gate from its revealed counterexample.

The oracle's direct-tap casing relation, scalar-exact identities, physical application boundaries and exact Undo model are useful experimental work. Passing tests of that model do not approve it as a production gate. In particular, selected origins, opening delimiters, host replacement and ownership barriers describe the proposed conservative authorization rules, not universal requirements that all future keyboard behavior must follow. All five formerly active R25 source/test files are retained as `.swift.txt` under `fixtures/`; complete rejected adapter/domain tests and fuzzer patch remain under `rejected-artifacts/`. Nothing is added to active Swift/native test discovery or the original fuzzer.

The required-caret decoder fix is meaningful benchmark protection: fresh cases must include an integer `expectedCaret`. The inherited development file contains **71/92 document-only cases**. Its explicit legacy decoder accepts only its exact frozen SHA-256, retaining those weaker expectations; it cannot authorize arbitrary fresh inputs without caret oracles. This schema protection neither resolves nor waives the failed oracle-domain gate.

Original baseline accounting, independently recomputed without keyboard execution:

| Scope | Exact passes | Denominator/limits |
| --- | ---: | --- |
| Each of four timings | 47/87 scored | Six unavailable legacy cases remain failures; five separate diagnostics pass |
| English, each timing | 33/51 | Actual English stack |
| Spanish, each timing | 8/20 | Actual Spanish stack |
| Bilingual, each timing | 6/16 | Actual bilingual stack |
| Repeated scored rows | 188/348 | Four timings of the same exposed development tasks |
| Diagnostic rows | 20/20 | Five unique diagnostics, four timings |
| All rows | 208/368 | 92 tasks × four timings; 24 unavailable observations |

The R16 P1 protection passes on baseline in all 12 language/timing combinations: exact `old tehtailold teh tail`, caret 19, selection zero. It is existing safety evidence, not a new fix. The proposed fresh opportunity remains **zero executed rows**: the R25 author reported 36 sealed cases (30 scored, six diagnostic; 12 per language), and incompatible R16 sealed data was not reused. Only contract/seal metadata is retained here. Neither seal's payload was opened or copied during review/retention. A seal hash and static author validation do not establish actual keyboard behavior or gains.

The child's final release **491 core + 3 service** result uses its **438-core baseline plus 53 new `@Test` functions**: 37 oracle-model tests, nine domain/schema protections, six actual-engine regression methods, one opt-in sweep. It is not a same-base 52-function increment over the parent's later 439-core tree. All 53 are inactive here; the parent's existing P1 guard remains its own regression. The restored green child run proves restoration/protections only. Earlier failing debug/release runs, casing-fixture correction, missing-caret rejection and original negative domain control remain in the historical records; no new known-issue allowance is introduced.

Production `Sources` have zero diff between original base `23454942` and final `912ddb1a`. Engine SHA-256 remains `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`; the **entire** original `EngineFuzz.swift` is restored to `d839f66e9baac788f546badeadc4f73735af07f3e18f7ca26b818a608964ecb0`. The inactive patch reconstructs rejected fuzzer `14e82f23c87b43a4990c826e5a7dfd02e8814ec3579c3380a0ad068e3b47074f`. These were independently checked against committed source; no current production policy is changed by retention. No dictionaries, model data, raw logs, build caches or device artifacts are included.

The three larger synthetic files (`development`, `baseline-development`, `exclusions`) use deterministic gzip with exact decompressed hashes in `retained-manifest.json`. Links in the verbatim agent audit keep historical `.json` names; use their `.json.gz` counterparts or extract them. The baseline is compact: it records exact outputs/carets/selection, queue counts and conservation verdicts, not complete primitive snapshots. The verifier recomputes its scores and counts; it does not recreate missing traces, infer successful conservation outside the rejected model, or execute the keyboard. Historical `manifest.json`, including its restoration claims, remains unchanged; the retention manifest separately anchors all preserved original bytes.

```sh
python3 apps/keyboard-ios/audits/r25-context-proof/verify.py
python3 -O apps/keyboard-ios/audits/r25-context-proof/verify.py
python3 apps/keyboard-ios/audits/r25-context-proof/verify.py --extract /tmp/r25-exposed-data
# Optional immutable source comparison, when original child history is available:
python3 apps/keyboard-ios/audits/r25-context-proof/verify.py --history "$PWD"
```

The verifier reads only fixed retained artifacts (never filesystem paths recorded in seal metadata). Its strict schema validator rejects the historical 71 missing carets by default; the legacy path is limited by the exact development byte hash. It checks JSON types, case identity, complete unique language/timing coverage, scalar-exact documents, caret/selection score flags, unavailable denominators, queue accounting and historical hash consistency. It does not validate fresh action bounds, Swift grapheme execution or either sealed payload. No inference/build/device operation occurs.

For an explicitly authorized future **exposed development replay**, use temporary checkouts only. The portable package base `f17109e7` is byte-identical to the R25 base throughout `PulpoKeyboardKit`; the R21 changes between those bases concern the native app. This avoids depending on unpublished child history. Extract the three gzip files with the command above, then:

```sh
AUDIT="$PWD/apps/keyboard-ios/audits/r25-context-proof"
git worktree add --detach /tmp/r25-restored f17109e7033eb849c9a2b98180e8c0f9d6174c3c
for file in "$AUDIT"/fixtures/*.swift.txt; do
  cp "$file" "/tmp/r25-restored/apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/$(basename "$file" .txt)"
done
PULPO_R25_CASES=/tmp/r25-exposed-data/development.json \
PULPO_R25_RESULTS=/tmp/r25-exposed-replay.json \
PULPO_R25_CONTRACT_SHA=79ccef3f6d12c39cdd6b8289b3319aa1aa4b4346c17d1ba2d0d09ccab2422644 \
PULPO_R25_LEGACY_DEVELOPMENT=1 \
swift test --package-path /tmp/r25-restored/apps/keyboard-ios/PulpoKeyboardKit \
  -c release --scratch-path /tmp/r25-exposed-build --filter R25ExplicitSpaceSweepTests
```

Report generation is not acceptance. To reconstruct the rejected integration separately, use another temporary checkout of the same package base: copy the four fixtures excluding `R25DomainProtectionTests.swift.txt`, add the two original `.swift.txt` tests under `rejected-artifacts/`, and apply `rejected-artifacts/EngineFuzz.patch` there. The unchanged short randomized gate and independent separator-domain control are expected to fail. Never apply that patch or activate these fixtures in current production as part of artifact validation. Do not reveal or execute either sealed set for this rejected round; any successor requires a separately authorized contract and independent validation.

Retention performed original/decompression/hash, schema/count and static Python checks only, plus inactive patch reconstruction in temporary scratch. No Swift build, model inference, simulator/device use, deployment or push was performed.
