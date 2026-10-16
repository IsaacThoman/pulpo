# R16 independent source review

**Recommendation: reject candidate `1b6fc872`. P1: explicit space can delete and rewrite an inherited word after an observable caret move whose callback has not arrived.** No production repair or tuning was attempted. The failing regression is retained without an allowance.

Reviewed immutable candidate `1b6fc8720b8b66106f85884f14e91d01bbc6f873` against baseline `b3fb8f705dd45bc4594c8a94b87cd516318506ff`, with original source baseline `584fd61e39250604309d476b3ca7ad166d337472`. The only production delta is `Sources/KeyboardCore/Input/KeyboardEngine.swift`; the candidate also adds `ExplicitSpaceRegressionTests.swift`. Paths below are relative to `apps/keyboard-ios/PulpoKeyboardKit` unless stated otherwise. PR [782](https://github.com/IsaacThoman/pulpo/pull/782) was registered with this review thread.

## Blocking reproduction

Use actual English or bilingual language stacks, fresh `PersonalDictionary(url: nil)` and `TouchModel(url: nil)`, ordinary field, capitalization disabled, immediate physical writes, and stable document identity. Offsets are Swift Character counts.

1. Initial text `old tailold tehtail`, caret 4: `old |tailold tehtail`.
2. Tap `t`, `e`, `h`, acknowledging each edit. Actual text is `old tehtailold tehtail`, caret 7: `old teh|tailold tehtail`.
3. Move the actual host caret to 18, leaving text unchanged: `old tehtailold teh|tail`. The proxy already exposes this new before/after context; withhold its `documentDidChange` callback until the next action. This is neither an earlier own snapshot nor an identical host snapshot.
4. Call explicit `insertSpace()`.

Required: `old tehtailold teh |tail`, text `old tehtailold teh tail`, caret 19, selection zero, and no delete primitives.

Candidate result: `old tehtailold the |tail`, text `old tehtailold the tail`, caret 19. It issues **three deleteBackward primitives followed by insertText("the ") at the moved actual caret**. These delete the inherited `teh`, not the newly tapped `teh` at offsets 4–7. The independent oracle/adapter reports `unowned or non-space replacement before inherited suffix`. English and bilingual fail the no-delete, exact-text, and conservation assertions (six issues total); Spanish passes this particular lexical trigger.

Source cause: `reconcilePendingHostChanges` (candidate lines 1213–1220) accepts arbitrary short suffix/prefix window matches. New actual before `old tehtailold teh` ends with expected `old teh`; actual after `tail` prefixes expected `tailold tehtail`. It returns without reconciling the observable move. The new exception at lines 958–969 checks ownership against optimistic `before`/`expectedAfterContext`, while `cursorInsideWord` reads only the live suffix's first character. Thus the stale internally owned span passes at a different physical caret. Lines 974–975 delete `typed.text.count` characters there. Primitive lower bounds based on the original P/W/S are therefore insufficient unless the physical destination is established.

The old window heuristic predates R16, but the unsafe inherited-word correction is a regression: the **same unchanged focused test passes against baseline production**, in EN, ES, and bilingual. This does not claim every baseline edit path is safe. No fix is proposed or applied to the frozen candidate.

## Source proof and passing controls

At an unchanged physical destination, the new path has the intended local bounds: ownership begins only with no selection, visible before/after context, empty composition, and document start or whitespace. Each accepted character call contributes exactly one alphabetic input/output Character; continuation requires matching composition and stored prefix/suffix. Space rechecks these values, policy, literal status, and alphabetic replacement output. It deletes all W, then inserts C plus ASCII space. Every deletion locally leaves P intact; inherited S is never directly deleted at that destination. Immediate Undo removes C plus its separator and restores W with caret directly before S. This is a conditional proof, refuted as a global guarantee by the destination mismatch above.

`fromSpaceKey` defaults false and is true at only the `insertSpace` callsite. Punctuation, return and swipe retain the prior shared commit gate; swipe additionally clears typed ownership before committing the pending word. `joinSpaceSlip` still refuses an inside-word cursor. The existing literal helper and path policy are unchanged. Selection origin cannot acquire ownership after its first replacement consumes the selection. Return, external insertion/transcript, deletion/Undo, selection of suggestions, language/policy changes and accepted external derivation clear ownership.

Reviewer-owned `Tests/KeyboardCoreTests/R16SourceReviewTests.swift` exercises actual EN/ES/bilingual lexicon/model/corrector/decoder stacks, with fresh personal and touch models for every rig. It reuses exposed `teh`; these are conservation/source regressions, not fresh correction-accuracy gains. Checks include:

- Explicit space with immediate, genuinely queued, optimistic-report, and two-second earlier-own-report schedules; seven inherited suffix shapes per stack/mode, including repeated typed text, numbers, apostrophe, Spanish letters, CJK/emoji and decomposed accents.
- Every replacement and Undo primitive independently inspected for zero selection, caret lower bound, scalar-exact inherited prefix and suffix. Family emoji and decomposed accent prefixes are preserved. Queued physical replay and all queued request/application counts remain mandatory.
- Pending typed typo followed by swipe **without space**, using actual decoders in every stack and five adversarial suffixes. Candidates must exist; the swipe issues no deletes and retains the pending `teh` and inherited suffix glyphs.
- Comma, period, return, external `insertText`, inherited partial-word origin, external word insertion, real selection replacement, real prefix/suffix host mutations with and without callback, selection at commit, and default sentence capitalization.
- The additional repeated-suffix caret-move regression above, whose expectations remain red on the candidate.

The candidate's four existing regression test functions pass, including its exact swipe/Undo sequence. Their `MockDocument` does not physically replace selections or record primitive snapshots; the new source probes use the frozen full-document adapter with actual selection semantics and the independent oracle, plus separate direct primitive assertions. Existing tests were not weakened or edited.

## Protocol and independent oracle contract

Read the frozen R16 protocol, the pre-candidate oracle review, Foundation-only helper and its tests, and the frozen sweep adapter. The helper's ownership and physical trace checks support only the narrow exemption `isSpace && independentlyTrackedVerdict.permitsSpaceReplacement` for the old `partialWordReplacement@midWord` blanket. Generic actions, inherited/selected origins and actual host mutations revoke ownership. Every other guard must remain; production composition/autocorrection flags or net-delete counts cannot authorize the exception. The reproduced move is correctly rejected because actual `hostChanged` revokes ownership before the space trace.

All 27 independent oracle test functions pass, including over-deletion followed by repair, transient suffix damage, scalar-normalization changes, wrong trigger/caret/selection, queued writes, earlier-own reports and exact Undo. Passing helper tests do not prove an adapter correctly labels host mutations. Parent-owned uncommitted fuzz integration and its independent integration review were outside this worktree's review scope; no claim of their completion or of the final gate is made. The old full fuzz suite was deliberately not run expecting the proposed exception policy to be green.

**Existing limitation retained:** a real host revert/replacement that is observationally identical to an old own snapshot can be classified as lag by the preexisting reconciliation machinery. R16 does not fix that ambiguity. This review does not claim it fixed. The new rejection above uses a distinct, observable live before/after pair and therefore does not rely on that known ambiguity.

## Exact validation and costs

Final candidate command:

```text
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --scratch-path /tmp/pulpo-r16-source-review-build --filter 'R16SourceReviewTests|R16ConservationOracleTests|ExplicitSpaceRegressionTests'
```

**Exit 1: 38 test functions in three suites; 37 pass and the single new caret-move function fails in EN/bilingual with six assertion issues.** Its Spanish parameter passes. All six other new source-review functions pass across their parameters; oracle 27/27 and existing candidate regression 4/4 pass. Final incremental build 2.16 seconds; tests 1.256 seconds. Raw output, excluded from Git: `/tmp/pulpo-r16-source-review-tests.txt`.

Baseline causal check uses a temporary package copy, replacing only its engine with exact `git show b3fb8f70:.../KeyboardEngine.swift` bytes. Other production files are unchanged between baseline and candidate. Workspace production files were never replaced. Command:

```text
swift test --package-path /tmp/pulpo-r16-source-review-baseline/PulpoKeyboardKit --scratch-path /tmp/pulpo-r16-source-review-baseline-build --filter unreportedMoveIntoRepeatedInheritedSuffixCannotDeleteOldWord
```

**Exit 0: one test function, all three language parameters pass**, build 9.35 seconds, tests 0.006 seconds. Output: `/tmp/pulpo-r16-source-review-baseline-tests.txt`.

There were four candidate focused invocations and one baseline invocation. The first revealed a reviewer fixture mistake: reporting before each key merely acknowledged current state, so the lag counter stayed zero. Delivery was corrected to acknowledge the first write and report one key behind thereafter; assertions were retained, and all 37 then-existing functions passed. The first added adversarial fixture used caret 17 instead of 18 and inserted a literal space inside `teh`; it did not reproduce corruption. That setup was corrected to derive the intended caret from `"old tehtailold teh".count`; the no-delete/exact-document/conservation expectations were retained. No production, dictionary, oracle, existing-test or gate edits occurred in response to execution.

Runtime: Apple Swift 6.4, arm64 macOS SwiftPM host tests. Two scratch build directories consume approximately 336 MiB total. No provider billing/token cost telemetry is available to this reviewer. No devices, native keyboard-host execution, deployment, push, watchers, heldout/sealed access, fresh accuracy corpus or parent lexical outcomes were used. The sealed directory and future parent report were not inspected. Native UIKit proxy timing/window behavior and device performance remain unverified; deterministic physical-host reproduction suffices to reject the source candidate under the frozen contract.

## SHA-256 at review

```text
candidate Sources/KeyboardCore/Input/KeyboardEngine.swift
888da16d77069f316581eb9db11d2ea6e515d6d8907d36b75a7972a2869ff608
baseline Sources/KeyboardCore/Input/KeyboardEngine.swift
3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97
Tests/KeyboardCoreTests/ExplicitSpaceRegressionTests.swift
93505fa08619be5becdfd178b8e9c932e27d3d6fe1051dcd701b73a37cbea24f
Tests/KeyboardCoreTests/ExplicitSpaceSweepTests.swift
f8ad6535e02c7aec7afacf4572897cb838ea69123211e6108b3998f4b33b0ddc
Tests/KeyboardCoreTests/R16ConservationOracle.swift
bdbc6eb60abfa0cd781f6d5f5dbb4d4e01bf525aeaed4f55b066adb76366188a
Tests/KeyboardCoreTests/R16ConservationOracleTests.swift
4ebaf4b0deb26366bcbd2bca9ed2fa2a40b32e8d3f9c90ec4b888a49526f0de7
Tests/KeyboardCoreTests/R16SourceReviewTests.swift
23b52a03d833a9220dc8d65e6d0ad4db7b42d96077bc01415b6106c6e36f3cfc
```

This commit owns only this report and the new focused source-review test file. Candidate production remains byte-for-byte frozen. Final test-gate freeze/reveal should not proceed with this unsafe candidate.
