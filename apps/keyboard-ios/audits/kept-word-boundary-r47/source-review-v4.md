**R47 independent frozen SOURCE DOMAIN review v4 — BLOCK source admission on one bounded polling-continuity counterexample.** The v3 primitive-callback defect is resolved. The remaining finding below concerns Engine provenance, independently of the unfinished evaluator gate or native execution. Do not start the owned native test on this source admission.

Reviewed parent/HEAD: `e503e5a6646208c6dc125271431bbb9d677b9bb8`. All 57 entries of `source-freeze-v4.json` match current bytes at initial and final checks; its archive contains exactly those 57 files with matching hashes. Of the 41 pre-edit production bindings, only Engine differs. The production diff is Engine-only, +125/−1; its v3→v4 change is the helper's `ownEditDepth > 0` guard and explanatory comment. No TouchModel, storage, dictionary, normalization, correction/policy/tuning, Controller, transcript/lifetime or R33/R45 change is introduced.

I read the complete original archived parent REVIEW/evidence, relevant original R44 contract/protocol/source/executor/oracle reviews and responses/rejection accounting, full current CONTRACT/PROTOCOL/SOURCE-CONTROLS, both contract reviews and response, all three source reviews/responses, all three evaluator reviews and available responses v1/v2, complete current Engine and R47 core/hosted test/Support source, and relevant unchanged mapping, validity and policy paths. No evaluator-response-v3.md exists at this cutoff; its audit-only remediation is separately pending as stated in the brief. All 117 dependency-manifest hashes match archive bytes, including the parent-review path mapping.

Only this report was written. Verification used read-only source/Git inspection and Python calculations over retained JSON/XML/archive bytes. No source edit, build, test/model/executor/device execution, successful-log read, persistence data, unrelated/sealed data, fresh authorship/input/seal/reveal, delegation, commit, push, merge or deployment occurred. Executions described below are retained evidence, not review executions.

**Blocking witness: a noncanonical host replacement observed by explicit polling can recover the old occurrence.**

Locations in `KeyboardEngine.swift`: helper lines 580–601; polling lines 1278–1298, especially 1290–1296; external capture/acceptance lines 497–532.

The helper invalidates missing contexts/selection and canonical-only matches. When a complete observed snapshot is neither an exact own snapshot nor canonically equal to one, it leaves invalidation to ordinary reconciliation. Polling can then return through its broader prefix/suffix `consistent` predicate without invoking `documentDidChange`. That path never invalidates this extra occurrence or its revision.

Minimal source-derived sequence using the existing fresh English fixture, stable ID A, complete visible contexts, collapsed selection, learning on, autocorrect/capitalization off:

```swift
engine.type("music")                         // five owned, aligned measured slots
doc.text = "xmusic"; doc.cursor = doc.text.endIndex
engine.reconcileHostChanges()                // actually reads the changed short word
doc.text = "music"; doc.cursor = doc.text.endIndex
engine.documentDidChange()
engine.insertText("🎉")
```

At the explicit poll, expected before-context is `music`, observed before-context is `xmusic`, and both tails are empty. `xmusic` is neither canonically equal to `music` nor any earlier own state (`""`, `m`, `mu`, `mus`, `musi`). The helper therefore reaches its end without invalidation. Polling nevertheless calls the snapshot unchanged because `"xmusic".hasSuffix("music")`; selection and tail also match. Its guard returns at line 1296. Composition, occurrence token and revision remain those of the original tapped `music`.

Restoring `music` and delivering the callback matches the exact expectation, so it does not invalidate either. External acceptance now sees a valid spelling, five aligned slots, exact live contexts, captured ID A, a real emoji boundary and unchanged revision. It consumes composing, inserts normally and reaches `learnTouch` with the old five points. Source predicts **candidate weight 5 versus baseline 0**, although the admitted contract requires zero extra learning after observed host replacement/restoration. Final text is exactly `music🎉`, Character caret 6, collapsed selection and one `music` word event. The retained exposed pre-acceptance English rows independently report `music` valid at weight/word total zero; no new vocabulary or self-validation premise is needed.

This is an unexecuted source deduction. It uses an actual full six-Character replacement and public polling, not a fabricated getter, ambiguous Unicode endpoint, hidden context or unobserved same-ID edit. It is not an exact own echo. Ordinary callback reconciliation would invalidate the same short replacement; its separate window-shift threshold is 24 Characters. The broad polling window rule must not silently certify continuity for this additional channel merely because the original text later returns.

Bounded remedy: invalidate only the extra occurrence/revision when polling observes such a nonexact, non-own snapshot before a window-consistency return can preserve it. Keep existing text reconciliation and exact own-echo behavior. Add this replacement/poll/restoration negative with full-zero touch and unchanged text/caret/selection/word assertions, alongside the unchanged/exact-own-echo positive. No global reconciler, learner, normalization, storage or lifetime redesign is required. The current host-created-same-spelling test uses a callback; current poll arguments cover canonical replacements and hidden contexts, so neither covers this escape.

**Disposition of prior findings and bounded counterexample checks.**

- **Source v1 latest canonical round trip and v2 earlier-own canonical callback/poll bypass:** resolved for their exact witnesses. Exact expected/history comparisons precede canonical-only matching; canonical discrepancies invalidate revision, while the exact earlier-own echo remains eligible. Restoration and confirmed suffix deletion cannot restore an invalidated token. The new finding is the separate noncanonical window-return branch.
- **Source v3 in-flight canonical callback round trip:** resolved. During the primitive, `ownEditDepth` is positive even after composing is consumed. The helper now invalidates the captured revision before canonical lag handling returns. The immutable witness retains v3 weights 3/3/3 and v4 weights 3/3/0 for Space/ordinary external/observed round trip. Both positives match complete touch state; the v4 negative has finite literal zero across all 26 offsets, with unchanged scalar destination/caret/selection/word count. Core lines 162–213 add the exact callback-echo Space-parity positive and full-zero round-trip negative.
- **Identity, policy, selection and availability during callbacks:** captured live ID comparisons remain before/after the primitive; observed A→B→A callbacks increment revision even if A returns. Nullable nil transitions are distinguished from nil→nil. Trait/settings invalidations and final policy-gated `learnTouch` retain their roles. In-flight noncollapsed/missing-context callbacks now reach the helper despite consumed composing. Exact own callbacks do not cancel the supported positive. No additional concrete failure was found on these paths; entirely unobserved transitions retain their declared limits.
- **Deletion, restoration and ownership:** exact pre/post live scalar/ID/alignment/revision checks preserve a confirmed nonempty suffix deletion and remove its corresponding optional slot. Declined-known `planes`, nullable-ID changes, separator-derived text and pinned correction undo remain excluded; the kept-planes positive and full negative/preserved offsets remain present. Empty, whole-word and restoration/derived paths cannot acquire the old occurrence. This is not a blanket deletion rejection.
- **Eligibility, sparse evidence, boundaries and behavior:** validity is captured before this action's word learning. Aligned own `ca` plus nil `noe` retains five slots and may teach two points; inherited `mu` plus tapped `sic` remains short/unowned. Nil is never fabricated. Existing normalization/forgetting and unsaturated positive premises remain intact. Effective boundary/tail/scalar-prefix checks retain the published bounded semantics. Existing pending-correction acceptance, text/spacing/caret/selection/word/pair ordering and ordinary Space routes remain unchanged by the provenance additions. Consumed uncertain external insertions have no deferred recovery or spelling-global suppression.
- **Native test-source objections:** remain resolved in the reviewed unchanged hosted file: offered search UIButton action, query isolation, offered result action, picker item, actual `.com`, full offsets and first/second occurrence word/pair/caret checks, and real KeysView timer/popup/move/end alternate routing with a nil slot. The 21 resource/route combinations are hosted controlled geometry with synthetic UITouch, not finger hit-testing, installed-extension delivery, VoiceOver or human accuracy. Native execution remains unperformed. Its v4 build receipt is compile-only evidence.

**Retained evidence and separate gates.** The v4 XML has 464 Core plus 3 services retained definitions: 448 declared executed and 19 separate opt-in skips, zero error/failure elements, finite nonnegative numeric attributes and consistent totals. All sixteen mandatory definitions are present without skips/errors/failures. The run records exit 0; the supplied five-known-issue accounting is not reconstructed from logs. All 114 package-source hashes match before/after, current bytes and the ordinary source archive. The mandatory receipt's 26 source bindings, XML/test-binary hash and three resources agree with the retained artifacts. Parameter subcases remain correlated within definitions. These passing controls do not include the new polling witness.

The unchanged exposed development-v3 packet retains 64 cases/347 ordered rows per variant and reports 5,285/5,285 correlated checks, zero unavailable. Independent raw inspection finds 85 changed rows, all touch-only; all other emitted fields match. All 694 states contain finite full 26-offset arrays. Independent calculations find no failure in the 21 before/after relations against both Space variants and exact increments, 128 holds, 96 explicit zeros, or zero-role states. Both processes report exit 0/empty stderr. Both model build archives match all 25 receipt inputs and current selected source (baseline substitutes only archived Engine); decompressed executable hashes match receipts. The ordinary/native source archives also match their before/after receipts. These are retained consistency checks, not an independent rebuild, blindness attestation or human-accuracy result.

Evaluator v3's stale fixture/resource/XML/binary cross-binding objection remains a separate gate; its mutable admission scripts/normalized receipts are intentionally outside this 57-file source snapshot. Their unfinished work and absent native execution are **not** reasons for this source BLOCK. The concrete Engine witness above is. Preserve v1/v2/v3 rejected freezes and all failures. R44 stays rejected/inactive: 70 cases/211 rows, baseline 777/777 versus candidate 776/777; aligned canoe's two-point update still violates its immutable old zero and cannot be relabeled by R47's new contract. Fresh sourceblind authorship/oracle review, evaluator admission, native evidence, final complete freeze and one paired reveal remain later gates.

**SHA-256 decision bindings.** Full source tables remain in the independently checked 57-file manifest. Paths below are audit-relative except the three source names.

```text
source-freeze-v4.json                  e1c1d59e156a1ad8d4975d35ca5ec7fd57028b4f43b48dfa15a63e60038c5d4f
snapshots/source-freeze-v4.tar.gz      11815c2ff5bc4f577863b09b18e17240e7e537e453fab678a05bf378e926fd2d
KeyboardCore/Input/KeyboardEngine.swift 2c1caf1b306fb503e68281b2faf5004a9f75e698969e6ee6a61582320efe2b02
CoreTests/ExternalTextTouchR47Tests.swift deb4a09b293efac64a839fc58e2c27a63fbe5739da6b73b1c78a3c8e1069a16f
CoreTests/Support.swift                419f343bf1ac39cad59d6dfa86f108aa5496e9f09b02ac77ab51cde2fcdc68e1
AppTests/ExternalTextTouchR47Tests.swift 48d80c3193b63068596ff87bf32d70dde85a9c8ae85a0978b79df4c7497c0971
CONTRACT.md                           f871c65add14a98a80edd3ef347224b16d95981b8fe0f6d5857ebfc7cc9d07c0
PROTOCOL.md                           95d7ff891055517fb9996ffc44ad396a15be959fca5ca1a71458d0e00ea56a1c
SOURCE-CONTROLS.md                    c16d689e2e8dc04ee6d666014f9f57bca62bbecd9b78798bd992133c096b5eb9
source-test-run-v4.json               8a41148b0503921c6af23751d7db5a096a889756a771179dd25f0aec45e31b36
source-controls-v4-validation.json    43b8c5eb44697e73035e656663977102bc12d9e6adfe8b6e4440ef814dc39e04
ordinary-v4 XML (decompressed)        c2be372461fa58d53cafe870c445cafe7a860edb3ebcb568e84a8eff842fab09
v4 test binary (decompressed)         840c5096ad7374879fdf6291bbe5d0547430beef944988c65826d4e54bb30eb1
PrimitiveCanonicalCallbackWitness.swift.txt 591cdd25ff06e8d7f9ac8c6a24af2dd090ce5d262caf1f73172de7e3d3d6f6b7
primitive-callback-candidate-v4.json   537168393cde5b720fd20f661f2c5a4e2eb5dd33bf723be32c4d405b1fe09e82
primitive-callback-candidate-v4-process.json 4ccad504bc858b775bdb127d2676f2be3236eba34306327e5c6412bb3ca3448b
candidate-v4-build-receipt.json        ee35e64bc0ef346d957b64432292163bac8f5420275e7db1f3598dd6e9040349
candidate-v4 model binary (decompressed) 220f67457b4193a2aa1368843593d1f1dfbf7440c037dab5ff4b547e3724d850
development-v3.json                   13a3d8048a1c07e2c8fe6a5f3cf86deb8686b3450618baf2eac989530bb92b7a
development-source-v4/report.json     365670f61b4608597277df6c4693c97d9d85b1d8bb861ac7f1308f830ebe8382
development-source-v4/receipt.json    b9ceb8a22350cbde51c89fbb572995587f7972d600d6f5b3950bd126950c0382
dependencies/manifest.json           28a2753070f3e4e1791d261d30f6cc98db8b07a837bf9fef7e3ee047bee9d8e0
dependencies/r44-verbatim.tar.gz      22e7b2e70846d7f50179bbbb75a1a6c960289c5b72a2634eab2985c96fa11d38
```
