# R25 independent domain/generalization review

**Decision: REJECT the required integrated domain/generalization gate. Do not begin a production candidate, freeze a candidate, or reveal heldout input on this evidence.** The baseline separator scope failure is real under the frozen executable oracle and remains unaccepted. The direct-tap casing relation, physical ownership proof, and multiword replacement domain pass the independent challenges below, but they do not make the complete gate approvable.

Reviewed shared checkout `/Users/isaacthoman/.t3/worktrees/pulpo/t3-b7cf686f`, starting/current HEAD `ca39a9f1b56bfe4aaf2ae9c725c39fd3bbd040f8`. PR [782](https://github.com/IsaacThoman/pulpo/pull/782) is linked to this review thread. This reviewer owns only this report and `Tests/KeyboardCoreTests/R25DomainReviewTests.swift` relative to PulpoKeyboardKit. No source repair or oracle/adapter edits were made by this reviewer. No production changes, devices/native execution, commits, push, deployment, or unrelated checkout changes occurred.

The contract SHA-256 was verified before review and again at completion: `79ccef3f6d12c39cdd6b8289b3319aa1aa4b4346c17d1ba2d0d09ccab2422644`. No sealed payload, heldout input, development input/result artifact, or blind-author payload was opened. The permitted old R16 oracle/source/fuzz review documents and the completed R25 oracle-author report were read for conservation/provenance evidence. No lexical scoring outcomes informed this review.

## Blocking finding: ordinary separator formatting fails the universal gate

The mandatory baseline short-fuzz gate fails at seed 11, operation 137: `r25Conservation@pending`, explicit Space, `deletion before inherited letter suffix lacks explicit-space conservation proof`. A provenance-only diagnostic confirmed operation 136 inserts one separator after a five-letter physically owned word; operation 137 is the next explicit Space and applies two primitives. This is the unchanged double-space-to-period path, not a source-word replacement. No lexical payload was printed or used by the diagnostic.

An independent minimal trace reproduces the mismatch without any lexicon or engine:

1. Start `p |tail`; directly tap `q`, then `z`.
2. First Space physically inserts `" "`, giving `p qz |tail`.
3. Second Space physically deletes only that fresh ASCII separator and inserts `". "`, giving `p qz. |tail`.

Every inherited prefix/suffix identity survives every primitive. No letter or inherited character is deleted. The current oracle nevertheless fails because `automaticRewrite` classifies **any** non-user deletion with a letter suffix as an unproved word rewrite. The preceding Space correctly cleared letter-span ownership; complete-W correction proof cannot apply to this formatting action. Reviewer-owned `ordinaryDoubleSpacePeriodIsNotAFreshWordReplacement` retains the failing assertion with exact document, caret, and inherited-ID checks. The oracle author's separately retained baseline reproduction independently confirms the same scope mismatch.

This is a **domain/generalization rejection**, not permission to allow seed 11. The immutable contract preserves existing shared inserted-text spacing behavior and independent policy/lexical gates. A universal gate that rejects ordinary physically conserved separator formatting cannot certify that contract. The failure remains in the unchanged mandatory randomized assertion; retaining an expected-rejection control in the author's suite does not waive it.

Proposed general scope resolution for the parent: distinguish ordinary separator formatting from complete-W correction using independent physical primitive/identity evidence. A separate proof could establish that the immediately preceding explicit-Space action created the consumed ASCII separator, the destination is unchanged, selection is zero, only that separator is deleted, the formatting insertion is exact, and every inherited ID survives at every primitive. It must grant no `explicitSpaceReplacement` permission and bypass no legacy check. Controls must reject inherited separators, host replacement/moves, wrong triggers, transient over-deletion even when repaired, and partial-word replacements. This is a general action-domain distinction, never a seed, word, timing, field, or pending-state allowance. Do not silently modify the frozen domain to obtain a green result: resolve its compatibility with the immutable contract and obtain fresh independent review; if that cannot be done, reject this R25 evaluation. This reviewer did not implement a resolution or weaken a gate.

## Resolved during review: absent required caret

The initial runner made `expectedCaret` optional and treated absence as a scoring wildcard. Reviewer-owned `frozenSchemaRequiresAnExpectedCaret` failed against the actual decoder, confirming violation of `expectedCaret:integer REQUIRED`. The runner owner added a strict `Case` decoder rejecting absence; the identical independent test now passes. Fresh-input scoring also throws on an absent caret. This reviewer did not edit the runner.

The runner now exposes a historical DEVELOPMENT path restricted by SHA-256 to one previously frozen development input. Its weaker historical document-only expectations cannot decode arbitrary fresh/heldout bytes and supply no exact full-caret acceptance evidence. That output must never satisfy the current contract's gate. This reviewer inspected the branching/hash restriction, not that input or its output.

## Independent proof assessment

The helper imports Foundation only. A direct key label is fixed before dispatch in both reviewed adapters. Ownership then requires exactly one physically applied alphabetic insertion matching that label's original, Unicode uppercase, or Unicode lowercase mapping **scalar-exactly**. This establishes physical provenance without a production Shift/composition model or a freshness/pending predicate. It does not assert that the casing is linguistically intended; the independent unchanged casing/policy checks remain responsible for that. Arbitrary output, canonical-equivalence-only matches, skipped taps, reports, swipe output, and external insertion cannot supply the missing provenance. Unicode expansions such as `ß` to `SS` own only the freshly inserted graphemes. Default/manual/held Shift and lag histories therefore no longer create R16's independent-casing coverage gap. No-write modifiers preserve existing physical ownership without creating it and end immediate Undo eligibility.

There is an actual physical identity ledger: every inserted grapheme gets a new ID; deletions lose IDs permanently; host changes reset IDs even for identical text. Identity states are collected after each primitive. Explicit-Space proof compares inherited prefix/suffix IDs at every boundary, in addition to scalar-exact snapshot conservation. Tap continuation checks the prior owned IDs in the actual contiguous word. Resegmentation of an inherited boundary cannot qualify. A repaired final string cannot recover deleted inherited identities. Undo advances the same ledger and checks every physical snapshot's exact prefix/suffix, caret lower bound, selection, deletion count/order, and restored document; it is not merely a final-document comparison.

Ownership starts only at document start/whitespace, with no selection, and extends only at the exact unchanged `P+W|S`. Selection origin, host replacement, cursor moves, and silent observable destination changes revoke or invalidate proof. Reports, including nil, unrelated earlier reports, old-own reports and reports delivered during writes, neither create nor replace physical ownership. The repeated-text move challenge fails on actual-document discontinuity rather than an output-window heuristic.

C is intentionally a general nonempty replacement, including multiword/apostrophe/punctuation output. The correction must still delete all of W before inserting C plus exactly one final ASCII separator. Every prefix/suffix and primitive bound remains protected. Exact immediate Undo removes C and its separator, restores W, and leaves no separator. Non-Space triggers never receive the fresh-span exception. This general C domain addresses R16's multiword scope objection without changing the existing lexical gates.

The queued sweep adapter retains originating action labels and reconstructs action boundaries and primitive snapshots during actual flush. Requested/optimistic snapshots are mandatory comparison assertions, not the oracle's physical inputs. It processes no-write barriers and flushes before host mutations and final scoring. Immediate, queued, optimistic/earlier-own, and two-second-old-own schedules are present. Actual EN/ES/bilingual stacks use fresh personal/touch models per row. These are adapter/source observations and synthetic conservation evidence, not a claim of candidate or heldout performance.

## Every legacy check byte preserved

The complete `EngineFuzz.check` body was extracted from `ca39a9f1` and the reviewed file. Removing exactly **one** occurrence of

```swift
, !(isSpace && conservationVerdict.permitsSpaceReplacement)
```

produces byte-identical content, including the signature. This is solely the permitted conjunct on `partialWordReplacement@midWord`; `isSpace` is fixed from `.space`, and the verdict comes from the independently tracked actual trace. No partial-start, selection, suffix, private/literal, stale-suggestion, Undo, corruption, spacing, learning, capitalization, swipe, or other check changed. Every oracle failure enters ordinary `r25Conservation` violations, including stale/pending histories, without allowances.

Extracted baseline check SHA-256: `9758c516a25d7051aa57f6736cb4d87e4946711e9dfc6d67cbd5ff65f15c6315`.
Extracted reviewed check SHA-256: `77d73f76d6129700d3e5d06fdd193572fcaec9e55bfe4195f8ef7fef254f47b7`.

Production `Sources` has zero diff against `ca39a9f1` at review completion. This is pre-candidate domain review, not production source approval.

## Executed evidence and retained failures

All reviewer builds used `/private/tmp/pulpo-r25-domain-build`. Raw output remains outside Git.

```text
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --scratch-path /private/tmp/pulpo-r25-domain-build --filter R25DomainReviewTests
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --scratch-path /private/tmp/pulpo-r25-domain-build
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --scratch-path /private/tmp/pulpo-r25-domain-build --filter 'baselineSeed11ProvenanceDiagnostic|R25ConservationOracleTests|R25FuzzOracleIntegrationTests'
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release --scratch-path /private/tmp/pulpo-r25-domain-build
```

- Initial independent domain controls: eight functions pass. They challenge Unicode casing/report/modifier histories, unrelated output, wrong triggers, identical host replacement/selection identity reset, unreported repeated-text moves, transient inherited deletion and scalar-exact repair, exact multiword Undo versus retained separator, and inherited grapheme resegmentation. The driver applies its own physical host semantics rather than calling the oracle's `applying` helper.
- Schema control initially fails; it passes after the runner owner's strict decoder change. Final focused domain run: **10 functions, nine pass, one separator-scope failure**, exit 1, 0.008 seconds. No allowance was added.
- Oracle/adapter plus temporary nonlexical diagnostic: **58 functions in three suites pass**, exit 0, 1.459 seconds. The diagnostic was removed after capturing only operation kinds, counts, ownership lengths and failure counts outside Git. It made no pass/fail allowance. The author subsequently added its separately retained baseline reproduction.
- First full **debug** baseline: **509 core tests / 69 suites**, exit 1, 11 issues including five known issues, 155.337 seconds; three services tests pass. Additional issues: the then-current synthetic casing expectation, mandatory short-fuzz scope failure, and four timing/accuracy tests (`suggestionsStayResponsiveWithAFullPersonalDictionary`, `suggestionsAreFastEnoughForEveryKeystroke`, `accuracyOnNoisySwipes`, `timedNoisySwipesStayAccurateAndFast`). The test owner corrected the synthetic casing expectation from lowercase to uppercase; the frozen tap relation already allowed both. All observed failures remain reported here.
- Final independent full **release** baseline on final reviewed bytes: **512 core tests / 69 suites**, exit 1, **seven issues including the same five known issues**, 5.574 seconds; **three services tests / one suite pass**. The two unaccepted failures are `shortRandomizedEditingSequencesKeepInvariants` (exactly the seed-11/op-137 scope failure above) and the independent separator control. The debug timing/accuracy failures do not recur in release. The oracle author's final release report independently records the same counts and seven issues. This gate does **not** have only the five accepted known issues.
- `git diff --check` passes for reviewer-owned changes. Contract/source/oracle/adapter hashes and the complete legacy-check byte comparison were rechecked after execution.

Raw reviewer artifacts: `/private/tmp/pulpo-r25-domain-tests.log`, `/private/tmp/pulpo-r25-domain-tests-final.log`, `/private/tmp/pulpo-r25-domain-baseline.log`, `/private/tmp/pulpo-r25-domain-integration.log`, `/private/tmp/pulpo-r25-domain-release-baseline.log`. No raw log or lexical corpus/result was committed.

## Immutable final reviewed hashes

These are the final reviewed artifact bytes after author completion and final release verification. The oracle/adapter values match the executable freeze published by the independent oracle author. They record evidence, **not** candidate-freeze or reveal approval. Any change invalidates this review for the changed bytes and requires a new independent review.

```text
contract.txt
79ccef3f6d12c39cdd6b8289b3319aa1aa4b4346c17d1ba2d0d09ccab2422644
R25ConservationOracle.swift
26842d1981730207912a8a2bcee33593c1e691304ca0b1c6e09caeb41da23ce3
R25ConservationOracleTests.swift
45a94a57f7097da0c8278f1aad34912bfc25d8ac71aeca62fd0be277701244b5
EngineFuzz.swift
14e82f23c87b43a4990c826e5a7dfd02e8814ec3579c3380a0ad068e3b47074f
R25FuzzOracleIntegrationTests.swift
abef6a9aaf11fbaf900de775fbefa5fefc425a5349eb14e977909e567b69ef66
R25ExplicitSpaceSweepTests.swift
c4d2337391a60be1eca3b1b95911fb00d15ce1d914f5d5ecbb6d21d45efe3be9
R25ConservationRegressionTests.swift
2c08d3cb90474194dd60673f94af1a82ca0e44e7c407d3323a88c56c3988be8d
R25DomainReviewTests.swift (reviewer-owned)
ab887b085694d8dd7fb257940b6a412473e07d6039d68f19e5d175d08db4767a
KeyboardEngine.swift (unchanged baseline observation)
3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97
```
