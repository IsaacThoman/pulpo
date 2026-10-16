# R16 explicit-space correction: REJECTED

Parent independent review retains this experiment as evidence only. **P1: the candidate can delete and rewrite an inherited word after an observable live caret move.** Production and the complete original fuzzer were restored in `9c78d3bc`; final archival HEAD is `81d0091c`. No candidate code, registered tests or fuzzer changes are imported by this package. All 36 fresh heldout cases remain UNEXECUTED. The sealed input was neither opened nor copied during curation, and no fresh accuracy gain is claimed.

## Concrete blocker

Start at `old |tailold tehtail`, type `teh`, and acknowledge each key. The document becomes `old teh|tailold tehtail`. Move the physical caret to `old tehtailold teh|tail` (Character offset 18), leave the document unchanged, and withhold the callback. The live before/after pair already exposes the move. Explicit space must produce `old tehtailold teh |tail`, with zero delete primitives. Candidate English/bilingual instead issue three deletes followed by `insertText("the ")`, producing `old tehtailold the |tail`. They rewrite the inherited second `teh` rather than the newly typed first one. Spanish preserves this particular trigger. The unchanged test passes on baseline in all three stacks.

[Independent source review](source-review.md) records the historical executed candidate failure (37/38 functions pass; six assertion issues in the one failing EN/bilingual function), baseline causal pass, physical primitive oracle and fixture corrections. Its full rejected fixture is archived as [inactive text](rejected-artifacts/R16SourceReviewTests.swift.txt); the restored protection-only variant is also [inactive text here](restored-snapshots/R16SourceReviewTests.swift.txt). Neither is registered by this import.

Curation independently inspected the immutable test, adapter and source delta. The preexisting reconciliation window heuristic accepts live before `old tehtailold teh` because it ends with expected `old teh`, and live after `tail` because it prefixes expected `tailold tehtail`. The new guard checks owned text against optimistic internal before/after values, then deletes at the different physical caret. The new explicit-space call provenance is real, but does not establish the physical destination of the owned span. This is distinct from the existing ambiguous case where a host replacement exactly matches an earlier own snapshot: this live context pair is different and observable. The historical baseline test and source trace establish an introduced destructive correction; the preexisting heuristic is not independently claimed fixed.

## Evidence and denominators

The frozen [protocol](protocol.md), [83 development inputs](development.json), exclusions, historical oracle reviews and [rejection record](rejection.json) are retained unchanged. All R14 revealed cases are development material; inherited category names such as `fresh` confer no freshness. Four timings repeat the same cases: immediate, physically queued/replayed, optimistic reports and two-second old-own reports.

| Development evidence | Per timing | Four timing executions |
| --- | --- | --- |
| Scored exact output, baseline → candidate | 38/78 → 58/78 | 152/312 → 232/312 |
| Scored gains / regressions | 20 / 0 | 80 / 0 |
| Unavailable scored tasks, retained as failures | 6 | 24 |
| Diagnostic exact output, baseline → candidate | 5/5 → 3/5 | 20/20 → 12/20 |
| Diagnostic regressions | 2 | 8 |
| All cases, baseline → candidate | 43/83 → 61/83 | 172/332 → 244/332 |

These are 78 unique scored cases and five diagnostics, not 312 independent scored tasks. Six invalid inherited relative moves and three incorrect retained-separator Undo expectations remain failures. The two ambiguous literal/fragment diagnostic losses remain visible. There were no conservation failures in these development rows; the later adversarial source-review case demonstrates that their coverage was insufficient. Forty restricted/private timing executions had zero personal learning in each version. The compact original [paired report](development-report.json.gz) preserves output/caret/selection and counters, not full primitive traces. No raw traces, build logs, large external corpora or heldout input are packaged.

The [seal metadata](heldout-seal.json) reports 36 fresh authored cases (30 scored, six diagnostics, 12 per language), hash `8f2b71322b863befb8673d486a1fe31de33ec8d0adef2bd02bfe868fdde3942b`. This is an author-reported seal, not a curation-time verification of the unopened file. All 36 are unavailable because the pre-reveal gate failed, with **zero executions**, rather than attempted failures. No final candidate freeze/reveal was approved.

## Oracle and historical gate limits

The independent [oracle review](oracle-review.md) preceded candidate implementation. The unchanged helper requires independently labeled alphabetic taps, exact owned P/W/S and actual primitive conservation, including every intermediate state and exact Undo separator removal. It cannot prove that every adapter correctly identifies physical host changes or casing. Its 27 helper tests and 16 adapter tests passed historically, while the short randomized gate stayed red.

The [fuzz integration review](fuzz-integration-review.md) preserves the objections: seeds 2/9/11 lack independent manual/pending/lag casing provenance; seeds 7/10 reject existing multiword corrections outside the narrow proposed alphabetic replacement scope. Those are unresolved proof/scope failures, not independently established text corruption. No seed allowances, outcome-derived ownership or hidden verdict failures were accepted. The separate P1 reproduction above supplies actual corruption evidence.

Curation compared the complete original and experimental `check` bodies: after removing only the explicit-space conservation exception, their tokens are identical modulo whitespace. The experimental signature additionally receives the verdict; the historical report's byte-identity wording should not be read as byte identity of the whole function or file. Full original and experimental fuzzer snapshots remain inactive `.swift.txt` files for inspection. The original fuzzer was restored in full, not merely its old failing conjunct.

Historical candidate full-suite execution failed: 485 core plus three service tests, five known issues plus the unexpected randomized failure. Historical final restored validation passed 475 core plus three service tests (478 total), with the same five known core issues. These numbers describe prior R16 runs, not a new native or SwiftPM validation performed during this artifact import. Native UIKit timing/windowing, device performance and candidate overhead remain unverified. No zero-error or accepted-candidate claim is made.

## Restoration and package verification

[Restoration proof](restoration-proof.json) records independent immutable-Git comparisons of baseline `584fd61e`, restoration `9c78d3bc` and final `81d0091c`:

- Engine SHA-256: `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`.
- Complete original `EngineFuzz.swift` SHA-256: `d839f66e9baac788f546badeadc4f73735af07f3e18f7ca26b818a608964ecb0`.
- Net diff of all production `Sources` plus the original fuzzer is empty between baseline and final.

The full original [agent audit](agent-audit.md) and [agent manifest](agent-manifest.json) are verbatim historical documents; their source links, external paths and active-test descriptions refer to the original branch. [Artifact provenance](artifact-provenance.json) maps retained bytes to immutable Git blobs. Test/helper/runner snapshots use `.swift.txt` outside test discovery; production candidate source is retained only as a [small rejected patch](rejected-artifacts/explicit-space-candidate.patch). The original combined candidate/fuzzer patch and larger compact report use deterministic gzip (mtime zero). No source or rejected test should be copied into discovery as part of this import.

Run `python3 apps/keyboard-ios/audits/r16-explicit-space/verify.py` for retained-file hashes, decompressed historical hashes, all paired counts, untouched seal metadata and fuzzer guard comparison. Add `--git` to verify the archival source hashes/restoration and zero production/fuzzer net diff from Git objects. Default verification is portable with the audit directory alone. Neither mode builds, executes Swift tests, accesses the sealed input, replays correction behavior or reconstructs absent primitive traces. The report's original raw-result hashes remain historical metadata; raw result arrays are not retained. The checksum manifest detects changes against recorded bytes, not independent authorship or execution authenticity.

A useful later change would retain just the P1 negative regression against production as a separately reviewed minimal core test. A future candidate must establish its physical destination independently of the permissive window heuristic, preserve genuinely delayed own reports, avoid generic swipe/punctuation/return correction, preserve midword/selection/inherited fragments and exact Undo, and pass a separately frozen independent holdout. This package implements none of that follow-up and does not duplicate R16 retuning.
