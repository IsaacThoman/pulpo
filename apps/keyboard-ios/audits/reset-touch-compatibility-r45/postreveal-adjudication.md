# R45 independent post-reveal source/domain adjudication

Verdict: **REJECT new-boundaries-v1 as a successful blind round. Preserve all five remaining failures and the original 652-check denominator.** A separately identified domain-author/validator round is justified. No change to source, Unicode policy, fixture, oracle, runner, or recorded result is recommended for this revealed payload, and no rerun is authorized by this adjudication.

The five failures establish an oracle/public-map domain mismatch around full case folding. They do not establish a new loss caused by the TouchModel guard removal or a defect in the conserved learning algorithm. Qualified source approval and the bounded observed 19-check repair remain distinct from blind-round admission.

## Prior findings and identities retained

The original task permits only the narrow R33 TouchModel compatibility correction: preserve valid aligned nil-URL long-word learning, enforce at most 40 actual collected finite letter samples per persistent call, and conserve the algorithm and normalizer. Preimplementation challenge and frozen source review approved final source `79398ca5d3c184849ea724f4cf2d5bf817da9ddd`, with product correction `c2442112ae37625a848b0da981e7cb61dc24fd76`. The supplied ordinary finding was “472 core, same five known issues; three services; data11 passed.” Those ordinary results are prior findings, not newly executed or independently re-audited here.

The new author was reported independent and source-blind, using only the approved public map, and supplied 24 families, 34 mode instances, and 652 planned checks. `oracle-validation-v1/report.md` granted qualified ACCEPT before freezing. Its static recomputation used Unicode casefold plus canonical decomposition, as confirmed directly in its checker. Historical blindness/read-set claims remain provenance attestations; this post-reveal inspection cannot recreate blindness.

`final-freeze.json` matches its bytes at commit `a8820168`; its SHA-256 is `310b3b5163fcde23fea6c50b3b96e1f19cc3507801b2e4184493416e373b2ef2`. The retained execution identifies exact original `a9e6ecfc895263721f14b8635dab8c3e87162839` and derived `79398ca5d3c184849ea724f4cf2d5bf817da9ddd`. Both 25-file Core manifests and runner hashes in execution.json agree with the freeze. Both records report build exit 0, productExecutions 1, and runner exit 1. This is a check of retained execution records, not independent surveillance excluding an unrecorded run. No build logs were opened.

## Independent accounting of the retained outputs

I reconstructed the check plan from the fixture fields and inspected the runner's planning/recording predicates, without executing either. Every instance's ordered actual check IDs equals that reconstructed plan. Per-instance, family, and aggregate category sums agree; all IDs are unique within their full family/instance/check identity, and both JSON aggregates have no duplicate JSON keys. There are exactly 652 checks in each version, with no extra bookkeeping checks, missing checks, pending checks, publication errors, unavailable checks, or error checks. The aggregate checks retain every failure. The separately published family JSON files were not reopened; this independent recomputation covers the complete families embedded in the requested results.json files. The previously reported independent output-ledger accountingValid finding is retained; valid accounting does not mean completePass.

- Fixed fixture: 24 unique family IDs; 34 instances, comprising 15 memory and 19 persistent instances; 68 learn steps, with 46 accepted and 22 rejected expectations. Per-instance counts match denominators.json and sum to 652.
- Original: 628 pass, 24 fail, 0 unavailable, 0 error; completePass false. Sixteen whole families and 25 instances have all their checks passing.
- Derived: 647 pass, 5 fail, 0 unavailable, 0 error; completePass false. Twenty whole families and 29 instances have all their checks passing.
- Paired status transitions across the identical 652 IDs: 628 pass→pass, 19 fail→pass, 5 fail→fail, 0 pass→fail. The derived failed-ID set is an exact subset of the original failed-ID set. There is no newly failed check ID in this one retained comparison.

Neither mode instances nor individual checks increase the count of independent families. The five surviving failed instances belong to four families.

## Exact five shared failed checks

Each item below is status fail in both actual outputs. The runner tests TextNormalizer.key(payload.text) against the fixture's literal normalizedText before learning. The check's human-readable expected field is “fixed independent normalized text”; the concrete expected string comes from fixtures.json.

1. `f05_expansion_duplication/memory/step.0.normalization`: expected `ssab`; actual `ßab`.
2. `f05_expansion_duplication/persistent/step.0.normalization`: expected `ssab`; actual `ßab`.
3. `f06_expansion_corrected_spelling/memory/step.0.normalization`: expected `ssux`; actual `ßux` (its distinct intended spelling is `ssun`).
4. `f22_expansion_exact_forty/persistent/step.0.normalization`: expected 38 ASCII `s` characters followed by `ab`; actual 19 `ß` characters followed by `ab`.
5. `f23_expansion_oversize_rejection/persistent/step.1.normalization`: expected 42 ASCII `s` characters; actual 21 `ß` characters.

No failure is excused, relabeled pass, removed from the denominator, or converted into a 647/647 success. Derived remains 647/652 with five failed assertions.

## Normalization domain and the byte-alignment coincidence

Actual source is decisive for the conserved policy. `Dictionary/Lexicon.swift:391–422` documents a lowercased, diacritic-free, apostrophe-free lookup key. Its Unicode path uses word.lowercased().decomposedStringWithCompatibilityMapping, drops straight/curly apostrophes and nonspacing marks, and retains the other scalars. It does not use full case folding. Lowercasing and compatibility decomposition leave `ß` as `ß`.

By contrast, `oracle-validation-v1/static-checker.py:15–16` defines normalization as NFD(s.casefold()) followed by removing characters with a nonzero combining class. Full case folding changes `ß` to `ss`. Independent static Python Unicode arithmetic confirmed `ßab` versus `ssab` and `ßux` versus `ssux` for these respective operations; this did not execute Swift or product code. The actual outputs independently record the retained `ß`. Canonical decomposition and compatibility decomposition are also different operations, and the checker is not generally equivalent on apostrophes or all mark categories. The specific five observed failures are explained by the casefold/lowercase distinction, without needing a broader Unicode finding.

The approved public map says normalization *may* expand a source character and describes duplication/alignment, but never specifies full case folding or promises `ß`→`ss`. The qualifications and original contract explicitly conserve existing normalization and normalized UTF-8 byte-count alignment, rather than spelling equality. Frozen source review also explicitly records lowercase/compatibility decomposition. Thus the author's concrete full-casefold expectation was not established by the approved map; validator agreement with that same assumed normalization did not establish correspondence with the conserved product contract. Its declaration-only API typecheck and synthetic predicate checks cannot prove behavioral Unicode semantics. The pre-freeze qualified ACCEPT is part of the history, but cannot erase this revealed domain defect.

The learning assertions in these families still pass for a precise reason. `TypedWord.keyed` (`Correction/SpellCorrector.swift:27–37`) emits each normalized Character's UTF-8 bytes and duplicates its tap for **every byte**. Retained `ß` encodes as two bytes, C3 9F. An intended ASCII `ss` also occupies two bytes. `TouchModel.learn:106–124` tests equal byte counts, then selects samples using the intended bytes and keyed taps; it does not require byte/spelling equality. A `ß` tap can therefore supply the two intended `s` samples even though TextNormalizer.key never returns `ss`.

Both outputs record accepted weight 4 for the f05/f06 primary/control learns, accepted weight 40 for f22, and f23's seeded rejection false/invalid with weight remaining 3. This agrees with byte-indexed learning and does not satisfy the failed normalized-string assertions. In derived f23 the aligned 42-sample collection reaches persistent validation and is rejected; in original f23 the target-length guard already rejects before collecting samples. That original pass alone cannot establish which bound rejected the call. `expectedActualSamples` in events is copied fixture metadata, not runtime instrumentation of sample count. Source tracing, rather than that annotation, explains the collection.

Consequently these cases do not prove a genuine normalizer expansion of `ß`. They do exercise the current byte-aligned tap behavior for the supplied ASCII targets. The distinction must be explicit in any new domain round.

## Guard scope, measured repair, and limits

Independent Git byte comparison found Dictionary/Lexicon.swift and Correction/SpellCorrector.swift identical between exact a9e and 79398ca5; current worktree copies match the derived frozen blobs. The complete derived TouchModel.swift equals the original file with exactly one occurrence of `, target.count <= 40` removed. There is no other change in that file, including learnLocally. This corroborates the frozen review's conservation finding. The entire paired Core trees are not one-line identical: the frozen review already qualifies inherited EmojiSearch/InputTraits differences. No new source inspection here expands the task to those components.

Removing the guard admits aligned long targets to the existing sample collector. Nil-URL learning then reaches the unchanged local algorithm; persistent learning must still pass the unchanged actual-sample admission path. The frozen source review traces 1...40 finite-sample validation before teaching/adopting state and before coordinator writes, with the accepted busy, settled-baseline, diagnostic-status, ignored-tap and later-save qualifications. This report preserves those qualifications; it does not turn endpoint filesystem observations into a zero-read or transient-syscall proof.

Exactly four independent families account for all 19 repaired checks:

- `f02_long_dense_memory/memory`: 117-byte target, 117 annotated samples; three repaired IDs: `step.0.acceptance`, `step.0.weight`, `step.0.control.acceptance`.
- `f03_long_sparse_memory/memory`: 103-byte target, six annotated samples; four repaired IDs: `step.0.acceptance`, `step.0.weight`, `step.0.weight.control`, `step.0.offsets.control`.
- `f18_long_sparse_exact_forty/persistent`: 167-byte target, 40 annotated samples; six repaired IDs: `step.0.acceptance`, `step.0.weight`, `step.0.weight.control`, `step.0.offsets.control`, `roundtrip.reopen.control.weight`, `roundtrip.reopen.control.offsets`.
- `f19_long_sparse_one/persistent`: 191-byte target, one annotated sample; the same six check suffixes as f18 repaired.

These are 19 correlated assertions arising from four family instances, including dependent weight/control/reopen assertions. They are not 19 independent repairs, accuracy wins, or population observations. In original f02 both long primary and long control reject, so some control-equality passes there are vacuous; the explicit acceptance and increased-weight checks preserve the defect and pass in derived. The source difference directly explains the observed long-target repair, but complete-Core comparison is not a whole-tree single-variable experiment. The observed no-new-failed-ID result is bounded to these 652 frozen checks in this one paired execution.

The five remaining failures are shared normalizer assertions outside the changed guard and occur identically in unchanged normalization source. No new guard-induced loss or learning-algorithm defect is established by them. This conclusion does not prove the absence of defects elsewhere or override the failed blind-round gate.

## Disposition and scope of this review

Keep this round rejected and immutable. A new, separately identified source-blind author/validator round is justified to resolve the public-map normalization ambiguity while retaining the existing product policy. Establish the permitted normalization domain before new authorship and freezing; preserve the rejection and all five findings in its brief. Fresh independently authored coverage should distinguish actual character expansion from byte-width alignment. This is a recommendation for separate work, not permission to patch/reclassify/rerun this payload or change Unicode policy/source.

The report makes no overall candidate admission, native/UI/reset admission, performance or population-accuracy claim. Prior old-R33 results are not transferred as derived blind credit. Qualified source conservation, supplied ordinary mechanics, the observed repair, and rejection of this new blind round remain separate findings.

This review performed read-only source/Git/document/JSON inspection and standalone static arithmetic/hashing. It did not execute the product, fixture runner, frozen checker, accounting script, tests, builds, devices, network, push, or subagents. It edited no source, input, oracle, runner, recorded output, repository/protected path, or policy. The only file written is this requested report.

## Evidence hashes

Audit paths below are relative to `apps/keyboard-ios/audits/reset-touch-compatibility-r45/`. The inspected contract, qualification, frozen-review, fixture, runner, denominator, schema, validator report and checker hashes match their declarations in final-freeze.json.

```text
188a0221590ff03b10de42b371949bbb2c0ba32def167da1690a5e9bdfcbbd41  public-api.md
831d0e771e55c811d6603f0d33c1e8e255c31b92a515bd83d8c58245f55f8244  contract-qualifications.md
c02b0d2c155ee965df069870cbb19e3e58b3dd1d87de4239cac258baa3874b52  frozen-source-review.md
1d48e1bf2f65d45113b917106dfc10a48a32cc3e068be23535a7ada6694d5fe4  new-boundaries-v1/fixtures.json
8a2dd587cfe9f1a04306e216581cce3eb378fbc340e171aacb127f6635bf0243  new-boundaries-v1/runner.swift
44960f2fcbdb0b184a2dfcf6ed7f9b7d3042013092976e0e1a1de3597dd5b2a9  oracle-validation-v1/static-checker.py
886a86b9b8dbe5a10502d3f3ee3d3be7e966cb960f4435ee60bfacb2f1398da4  oracle-validation-v1/report.md
c1ef3c0cb38faef1e3f1e2c57b9a817d2cfd3e5a688a253a378dc237f68f310b  /tmp/pulpo-r45-paired-once-v1/original-a9e/case-output/results.json
4520c3a31975ff30e1afaf798028005987998f98af4070c6c2562c70accba8dd  /tmp/pulpo-r45-paired-once-v1/derived/case-output/results.json
c0562f40488e620571a81c9a13400942494051799f5a1299e4876dc142a7ae30  /tmp/pulpo-r45-paired-once-v1/execution.json
```
