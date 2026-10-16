# R25 current-context correction — rejected before production

R25 stops at the mandatory independent oracle/domain and baseline gates. **No production candidate was applied, frozen, source-reviewed or evaluated.** Production remains exactly starting `23454942`. No current-context candidate safety or accuracy gain is claimed. PR [782](https://github.com/IsaacThoman/pulpo/pull/782) is linked.

The independent executable oracle handles the R16 casing/ownership and multiword-C limitations: direct user tap labels, physically applied Unicode original/upper/lower mapping, independent character identities, exact inherited scalar prefix/suffix at every rewrite primitive, complete owned-word deletion, original queued action labels and physical action boundaries, and separator-removing Undo. It imports Foundation only and reads no production Shift/composition/ownership. It is retained as experimental test evidence, not an approved integrated gate.

The unchanged short randomized assertion rejects baseline at seed 11, operation 137, `r25Conservation@pending`. Physical minimization proves this is ordinary double-space formatting after a pending selection, with no owned W:

1. Full document `Tegucig d`, caret 8, selection 0: `Tegucig |d`.
2. One `deleteBackward` removes only the separator: `Tegucigd`, caret 7, selection 0.
3. `insertText(". ")` produces `Tegucig. d`, caret 9, selection 0: `Tegucig. |d`.

All inherited characters survive. The oracle's blanket rejects any automatic deletion before an inherited letter without a fresh-W verdict, including this conserved separator rewrite. Both independent reviewers reject its domain/generalization. This is an oracle scope mismatch, not inherited-letter corruption, nor R16's missing casing proof. The failure is retained without seed/spacing allowances, action relabeling or oracle retuning. A future independently contracted separator-ownership proof may distinguish formatting without granting a word-replacement exception; no such change belongs to this round. See [oracle-review.md](oracle-review.md), [domain-review.md](domain-review.md) and [rejection.json](rejection.json).

The domain reviewer also found that missing required `expectedCaret` was accepted as a wildcard. The fresh-case decoder is now strict and the same independent negative test passes. No synthetic case/expected output changed. Seventy-one inherited R14 document-only cases remain explicitly weaker development evidence, behind an opt-in route that verifies the exact frozen development SHA256. That route cannot decode arbitrary fresh bytes and cannot establish satisfaction of the current full-caret contract. Schema strengthening does not resolve or waive the failed scope gate.

## Independence and freezes

The development/contract commit `ca39a9f1` preceded relevant R25 production inspection. All R14/R16 exposed development and revealed evidence is DEVELOPMENT ONLY. The 92-case set retains every old invalid move and wrong Undo expectation unchanged and adds R16 P1 plus inherited-prefix/selection controls in all three languages. The implementation design was recorded without applying it; there is zero source-candidate tuning or post-reveal retuning.

The immutable contract SHA256 is `79ccef3f6d12c39cdd6b8289b3319aa1aa4b4346c17d1ba2d0d09ccab2422644`. The exact bytes the author received are preserved as [author-contract.txt](author-contract.txt), byte-identical to [contract.txt](contract.txt). The runner explicitly checks this interface identity. The independent author verified R16's seal `8f2b71322b863befb8673d486a1fe31de33ec8d0adef2bd02bfe868fdde3942b`, found its schema incompatible with the required full-caret contract, and did not reuse/adapt it. Its payload remains undisclosed to the implementer and keyboard-unexecuted.

A new target-disjoint 36-case set was independently authored and sealed at `/private/tmp/pulpo-r25-sealed/heldout.json`, SHA256 `6a497c16237d5de26e09759b08707dfa3fe54a80b3239e8c266e9e01633016a9`: 12 per language, 30 scored and six diagnostics. Author static validation checked Swift Character offset units/action bounds, default/manual Shift, full documents/carets/selections, and three separator-removing Undo paths without keyboard execution. Contract hashes match exactly; there is no unresolved author-interface mismatch. See [heldout-seal.json](heldout-seal.json) and [blind-author-validation.md](blind-author-validation.md).

**Both sealed sets remain unrevealed and keyboard-unexecuted.** New heldout opportunity is 30 scored tasks × four timings = 120 scored rows, plus 24 diagnostic rows, all unavailable because the required gate rejected before any candidate. No fresh gains/losses or paired candidate outputs exist. Do not infer successful accuracy from sealed authorship or successful report generation.

## Baseline development and protections

The actual EN/ES/bilingual lexicon/model/corrector/decoder stacks use fresh personal and touch models for each row. Four timings remain separate: immediate, genuinely queued physical application, optimistic proxy with earlier own reports, and two-second-old own reports. Queued oracle inputs are reconstructed from physical application snapshots; enqueue snapshots are only comparison assertions. Every queued requested/applied count and exact replay boundary remains mandatory.

Baseline is **47/87 scored per timing**, with six unavailable legacy cases counted as failures and zero conservation failures. Per timing: EN 33/51, ES 8/20, bilingual 6/16. Repeated timings are **188/348 scored**, plus 20/20 diagnostics: 208/368 all-case rows. The six unavailable unique cases repeat as 24 unavailable rows. The two complete baseline sweeps, including the stricter schema replay, are exactly identical. [baseline-development.json](baseline-development.json) retains every compact full-document/caret/selection result and failure denominator. Seventy-one inherited cases lack original caret oracles; that limitation is not repaired by the numeric summary.

R16 P1 passes on baseline for all three stacks × four timings, with no delete at the moved physical caret: `old tehtailold teh tail`, caret 19, selection 0. Its distinct live context is never relabeled as identical old-own ambiguity. This is a retained BASELINE safety protection, not proof that an R25 feature is safe. Additional active negative tests cover swipe without Space, punctuation/Return/external insertion, inherited fragments, selection origin/commit, host changes with/without callback, default capitalization and inherited Unicode. Independent abstract tests cover manual/default case mappings, identity barriers, transient deletion repaired later, wrong destinations/triggers, queued provenance and exact Undo. No native runtime/device result is claimed.

## Rejection, restoration and validation

Before restoration, the entire legacy `EngineFuzz.check` function was verified byte-identical to starting source after removing exactly the one proposed `!(isSpace && conservationVerdict.permitsSpaceReplacement)` conjunct. Every verdict failure entered normal violations. No private/literal/selection/partial-start/Undo/spacing/stale-suggestion or other legacy check was weakened.

The rejected adapter patch and its complete tests are preserved inactive. The independent domain test demanding acceptance of ordinary separator formatting also remains unchanged in its inactive original file; its failure is not inverted or marked known. The nine passing independent protections, including required-caret schema rejection, remain active separately. Active production and the complete original fuzzer are restored byte-for-byte. Green restored tests do not approve the rejected oracle integration or create a candidate acceptance claim.

Validation before restoration:

- Independent Foundation oracle: 37 functions pass; final oracle/actual-adapter focused set: 57 pass.
- Short randomized baseline: fails on the one retained scope issue; 12 seeds × 150 operations, with existing deterministic replays.
- Oracle author's first full release: 510 core tests / 69 suites, exit 1 with five known issues plus scope and schema failures; services 3 pass. Their final full release: 512 core / 69 suites, same seven issues, 5.665 seconds; services 3 pass.
- Domain review's initial concurrent full debug run: 509 core / 69 suites, exit 1, 11 issues including the same five known. It also observed the initial synthetic casing expectation and four performance/accuracy checks failing. These remain recorded failures; possible contention is not an allowance. Its later independent release run is 512 core / 69 suites, seven issues, 5.574 seconds; the two unaccepted failures are the same scope issue and its separator-domain control, while the strict-caret test now passes. Services 3 pass. The oracle-author run compiled the earlier schema/temporary-diagnostic snapshot; equal test totals do not make these identical artifact snapshots.
- Root baseline regression protection: six functions / 39 parameter cases pass, including P1 in all 12 language/timing combinations. Strict-schema sweep plus independent domain protections passed at the point before the reviewer added the deliberately failing separator-domain control; its baseline row output exactly matches the original sweep.

Final restored release command exits 0: **491 core tests / 68 suites pass with exactly the unchanged five known issues**, 5.196 seconds; **3 services tests / one suite pass**, 0.001 seconds; **494 total tests**. Original short fuzz passes. This is restoration/protection validation only; the rejected integrated gate remains rejected. See [restored-validation.json](restored-validation.json). Patch reconstruction proves the inactive patch reproduces exact frozen rejected fuzzer SHA256 `14e82f23c87b43a4990c826e5a7dfd02e8814ec3579c3380a0ad068e3b47074f`; full original fuzzer SHA256 is restored to `d839f66e9baac788f546badeadc4f73735af07f3e18f7ca26b818a608964ecb0`. All production Sources have zero diff against starting commit. Inactive complete reviewer/adapter tests match frozen hashes byte-for-byte. `git diff --check` passes.

The unchanged five known issues comprise two earlier-own-state ambiguity checks and three multilingual acceptance misses. No new known-issue allowances were introduced. No dictionaries, rankings, suppression, path/literal helpers or shared inserted-text spacing changed.

## Reproduction and limits

Historical development replay only (reports are not acceptance):

```sh
PULPO_R25_CASES="$PWD/apps/keyboard-ios/audits/r25-context-proof/development.json" \
PULPO_R25_RESULTS=/private/tmp/r25-baseline.json \
PULPO_R25_CONTRACT_SHA=79ccef3f6d12c39cdd6b8289b3319aa1aa4b4346c17d1ba2d0d09ccab2422644 \
PULPO_R25_LEGACY_DEVELOPMENT=1 \
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release \
  --scratch-path /private/tmp/pulpo-r25-replay-build --filter R25ExplicitSpaceSweepTests
```

Fresh inputs require the strict default decoder and no legacy-development flag. Do not execute either sealed input on this rejected round. The inactive fuzzer patch reproduces a rejected experiment, never an accepted production change. Source-review proof of a new live-context guard, candidate timing gains/losses, default/manual Shift behavior of a new feature, native UIKit UX and device performance are unavailable because no production candidate was permitted.

Costs: three delegated tasks (oracle/integration, blind author/validator, independent domain review); two root full development sweeps = 736 repeated timing rows over 92 unique tasks, plus focused regression/schema commands; independent focused, short-fuzz/minimization and full-release runs described above; one final root full release restoration check. Total reported full-suite invocations: four release and one debug. External scratch allocation measured approximately 611 MiB; no build cache is in Git. Exact provider tokens/dollars are unavailable. Raw logs/reports/build caches remain outside Git; only small synthetic inputs, compact outputs, source fixtures and audit evidence are retained. No devices/native runtime, push, deploy, external messages, parent/unrelated-checkout edits or E1C6B89D interaction occurred. Parent 17 and R21 18 Pro remain untouched.

Elapsed from development freeze through restoration evidence: approximately 16.6 minutes. The branch contains the contract freeze and final restored-source protection/audit commit; the final handoff records their exact IDs and clean status.
