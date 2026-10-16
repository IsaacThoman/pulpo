# R25 independent conservation oracle and baseline gate review

**Decision: REJECT integrated domain/generalization approval and baseline gate approval. Do not begin a production candidate or freeze/reveal it on this evidence.** The test-only source-conservation component and focused fault/positive controls work, but the required blanket integration exposes a baseline separator-rewrite scope conflict. That failure remains an ordinary failing randomized gate. No allowance, seed exception, casing/lag exemption, action relabeling, or contract change was added.

The immutable contract was read and its SHA256 verified before implementation: `79ccef3f6d12c39cdd6b8289b3319aa1aa4b4346c17d1ba2d0d09ccab2422644`. The R16 final audit and fuzz integration review were read from the explicitly designated R16 checkout; no sealed input, heldout payload, or blind-author files were read. Work was confined to the five assigned files in this checkout. Root owns commits and candidate decisions. No production edits, commits, devices/native runtime, deployment, or push occurred.

## Independent physical proof and interface

`R25ConservationOracle.swift` imports Foundation only. It does not import KeyboardCore, read engine Shift/composition/ownership, infer physical tap origin from output, consult dictionaries, or inspect correction results. Its public test interface retains R16 `Snapshot`, `Primitive`, `Step`, `Trace`, `Verdict`, `observe`, `hostChanged`, `proxyReported`, `applying`, and `sameText`. `Action.letter(Character)` takes the originating direct key label, fixed before dispatch. `modifier` represents user Shift with no physical writes; it preserves existing owned characters, creates no ownership, and ends immediate Undo eligibility. `userDeletion` distinguishes deliberate word deletion from automatic rewriting. These interface decisions were sent to root before adapter implementation.

Snapshots contain the complete physical document, Character-offset caret, and selection length. Equality compares Unicode scalars exactly. Each physical grapheme receives an identity; deletion permanently loses it, insertion creates a new identity, and host replacement resets all identities even when its scalar text is identical. Resegmented inherited graphemes cannot retain their identity and cannot qualify for ownership. Movement/selection/host edits invalidate ownership, including moves away and back and identical replacements. Report observations cannot create, extend, resurrect, or replace actual ownership.

Only a directly labeled single alphabetic tap whose insertion equals its original, Unicode uppercase, or Unicode lowercase mapping scalar-for-scalar can own its physically inserted graphemes. Unicode expansion such as `ß` to `SS` is supported. This relation intentionally permits default/manual/held Shift without a production Shift model or a freshness/pending restriction. Actual physical continuity, exact inherited prefix/suffix, identity conservation, zero selection, and a start/whitespace origin remain mandatory. Skipped taps and output from swipes/external insertion do not acquire ownership.

Explicit-Space replacement must begin at the complete physically owned W in exact `P+W|S`. Every applied primitive preserves scalar-exact P/S, their identities, caret bounds, and zero selection. Every Character of W must be deleted before nonempty C and exactly one final ASCII space are inserted. C supports multiple words, apostrophes, punctuation, digits, and emoji; lexical/policy validity remains the responsibility of the independent existing checks. Transient prefix/suffix damage fails even if final text is repaired. Immediate backspace Undo must delete C and its separator and restore exactly W, ending at `P+W|S`; retaining the separator or crossing either inherited boundary fails.

Queued adapters must retain the original action label and deliver complete traces in physical application order. Before/after action snapshots must be captured during physical replay; enqueue-time actual snapshots and optimistic proxy text cannot substitute. Final scoring must flush. Foundation tests exercise genuine queued physical replay, optimistic/earlier-own reports during primitives, old-own reports without an age grace window, missing snapshots, wrong triggers, observable unreported moves, selection/host barriers, Unicode normalization/resegmentation, transient repaired damage, and exact Undo. Root owns the actual four-timing language sweep integration; this report does not assert its acceptance.

## Fuzz adapter and exact legacy-check preservation

`FuzzHost` captures a separate `appliedSteps` list immediately around each physical mutation, **after** any reentrant callback and before report/history bookkeeping. The existing requested-write `log` remains separate. Action labels are fixed from `FuzzOp` before engine dispatch and are retained in `conservationTrace`/`conservationOp`. Host-origin events reset the oracle before any callback-generated primitive trace. Pure lag/hide/window/ack/deliver/reentrant reports preserve existing physical ownership only when there is no physical change/write. A skipped action cannot establish ownership.

Every verdict failure is appended to ordinary violations as `r25Conservation`, including pending/stale histories, with no deduplication or allowance. The wrong-trigger blanket rejects automatic deletions before an inherited letter suffix unless the complete explicit-Space proof succeeds. Intentional backspace/delete-word are separate user deletion actions.

The **entire existing `FuzzRun.check` function is byte-identical to starting HEAD after removing exactly this one inserted conjunct** from `partialWordReplacement@midWord`:

```swift
, !(isSpace && conservationVerdict.permitsSpaceReplacement)
```

A direct text comparison verified this, including the unchanged function signature. All partial-start, selection, suffix, privacy, literal, stale suggestion, Undo, corruption, spacing, learning, capitalization, and swipe checks remain unchanged. The new verdict bypasses none of them. The oracle does not grant a swipe, punctuation, return, transcript, or generic terminator exception. The adapter tests explicitly ensure the oracle detects wrong-trigger deletion even when legacy `isTerminator` excludes that action.

## Exact retained baseline scope failure

Short randomized baseline: seeds 1–12, 150 operations each, deterministic replay every fourth seed. **FAIL: exactly one `r25Conservation@pending` violation, seed 11, operation 137, `.space(dt: 0.175)`.** No additional legacy violation was reported. The message is `deletion before inherited letter suffix lacks explicit-space conservation proof`.

Using only the existing fuzzer shrink/report controls reduced it to seven operations, retained in active test `baselinePendingSeparatorRewriteRetainsItsScopeFailure`. A pending host selection revokes ownership. The first Space consumes that selection. The next Space performs the baseline double-space-period behavior. Its full physical boundary states are:

- Before: text `Tegucig d`, caret 8, selection 0 (`Tegucig |d`).
- After `deleteBackward`: text `Tegucigd`, caret 7, selection 0 (`Tegucig|d`).
- After `insert(". ")`: text `Tegucig. d`, caret 9, selection 0 (`Tegucig. |d`).

Only the previously inserted separator is deleted; inherited `Tegucig` and `d` survive. There is no fresh owned W, so the blanket denies permission. **This is a demonstrated baseline scope mismatch, not evidence of inherited-letter corruption or a casing/lag ownership proof gap.** Broadening the oracle to exempt separator rewrites, narrowing the deletion blanket, suppressing this verdict, or changing the action label would change the evaluated domain. None was done. The required integrated domain/generalization approval is therefore withheld. The retained positive negative-control test expects the oracle to reject this trace; it does not waive the unchanged short gate, which still fails.

The ordinary opt-in `longRandomizedEditingRun` exits successfully even when its JSON report contains violations; that existing behavior does not constitute gate approval. Its seed-11 diagnostic report records the same one violation and its seven-action shrink. No diagnostic process exit code was substituted for the short randomized assertion.

## Baseline verification

All commands used release mode and scratch `/private/tmp/pulpo-r25-oracle-build`:

```text
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release --scratch-path /private/tmp/pulpo-r25-oracle-build --filter 'R25ConservationOracleTests|R25FuzzOracleIntegrationTests'
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release --scratch-path /private/tmp/pulpo-r25-oracle-build --filter shortRandomizedEditingSequences
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release --scratch-path /private/tmp/pulpo-r25-oracle-build
```

- Foundation oracle first execution: **37 tests pass**.
- Final focused oracle/adapter execution: **57 tests in two suites pass** (37 oracle, 20 adapter functions; parameterized tests exercise additional cases).
- Short randomized baseline: **exit 1**, one unaccepted scope failure as recorded above.
- First full release baseline: **510 core tests / 69 suites**, exit 1 with seven issues, including the unchanged five known issues; **3 services tests / one suite pass**. Besides the fuzz scope failure, independently added `R25DomainReviewTests.frozenSchemaRequiresAnExpectedCaret` fails because the sweep decoder accepts missing required `expectedCaret`. Runner/schema changes belong to root; this review did not modify those files. This observed failure is retained, not silently excluded.
- Final full release execution: **512 core tests / 69 suites**, exit 1 with the same seven issues (the same five known issues plus the same two unaccepted failures), 5.665 seconds; **3 services tests / one suite pass**. The focused final 57-test artifacts were included. Other root/reviewer-owned tests were being added to the shared checkout, accounting for the total-count difference from the first full run; neither run had production changes.
- `git diff --check` passes for the owned changes; exact legacy-check byte comparison passes. Production KeyboardEngine bytes retain the starting hash below.

The five known issues were reported separately and unchanged: two earlier-own-state ambiguity checks (`composingDesync`, `wordDeleteWrong`) and three multilingual acceptance misses (`hel → hello` in EN/bilingual and `hol → hola` in bilingual). No `withKnownIssue` or other allowance was introduced. The full gate must not be described as having only these five while the additional baseline failures remain.

During focused test authoring, one positive adapter assertion initially expected lowercase `d` after hidden/lagged callbacks; the actual default policy emits uppercase `D`. Its exact expected physical word was corrected to `abcD`. Both mappings were already allowed by the immutable tap relation. No oracle rule, source behavior, or lexical expectation was retuned. The final diagnostic adapter test added only a reproducible expected rejection for the baseline scope mismatch.

Raw build/test/diagnostic output and JSON remain outside Git: `/private/tmp/r25-oracle-adapter-baseline-final.txt`, `/private/tmp/r25-fuzz-short-baseline.txt`, `/private/tmp/r25-full-release-baseline.txt`, `/private/tmp/r25-full-release-baseline-final.txt`, `/private/tmp/r25-seed11-baseline.json`, and `/private/tmp/r25-seed11-diagnostic.txt`. No raw corpus, log, or build cache was added to the repository.

## Executable oracle freeze before any production candidate

The executable oracle and adapter are frozen at these SHA256 values while production is still baseline (review completed 2026-10-16 UTC). This records the independent test artifacts; **it is not candidate-freeze approval or permission to reveal heldout input**. No production candidate was evaluated by this reviewer.

```text
contract.txt
79ccef3f6d12c39cdd6b8289b3319aa1aa4b4346c17d1ba2d0d09ccab2422644
R25ConservationOracle.swift
26842d1981730207912a8a2bcee33593c1e691304ca0b1c6e09caeb41da23ce3
R25ConservationOracleTests.swift
45a94a57f7097da0c8278f1aad34912bfc25d8ac71aeca62fd0be277701244b5
R25FuzzOracleIntegrationTests.swift
abef6a9aaf11fbaf900de775fbefa5fefc425a5349eb14e977909e567b69ef66
EngineFuzz.swift
14e82f23c87b43a4990c826e5a7dfd02e8814ec3579c3380a0ad068e3b47074f
KeyboardEngine.swift (unchanged baseline observation)
3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97
```

No complete EN/ES/bilingual × four-timing domain/generalization approval is claimed; actual sweep validation and independent source review remain separate gates owned by root. The executable component addresses the known R16 Unicode-casing and multiword-C domain limitations without reading production authorization state, but the complete integration is **rejected before candidate production** on the exact baseline scope failure above. No fresh generalization or heldout gain is claimed.
