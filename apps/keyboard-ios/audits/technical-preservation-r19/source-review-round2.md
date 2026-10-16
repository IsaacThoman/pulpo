# R19 independent second pre-reveal source review — PR782

Verdict: **reject the anchored-grammar candidate; production-source restoration is verified.** The newly frozen ordinary diagnostics establish six baseline-passing losses, so the original rejection rule applies before any sealed reveal. The runner repairs have concrete source and calibration support. One acceptance-infrastructure objection remains: the comparison gate does not enforce report provenance or run metadata. That gap does not reverse this candidate's rejection.

This is an independent round using the original brief, round-1 findings, and stated responses. I read the requested engine diff, Swift replay, contract, three exposed input sets, negative controls, Python runner/comparison/gate, and round-1 report. I also read exposed report metadata/results that appeared during this review and the pre-reveal rejection note and retained patch. I did not access sealed material, use devices, run Swift/builds, change repository files, tune grammar, or reclassify inputs. This report is the only file I wrote. The only executed calibration was Python with all artifact reads/writes intercepted in memory.

## 1. P1 candidate blocker: ordinary-intent correction losses are now measured

`review-diagnostics.json` labels `slash-prose`, `comment-dot`, and `comment-root` ordinary before execution. Their inputs are respectively `the notation /and/`, `//(./`, and `//(/tmp/`, followed by inserting `teh `.

The exposed `selected-review-diagnostics-{baseline,candidate}.json` pair contains 63 rows on each side. For all three cases in English and bilingual, baseline produces `the ` and passes; candidate preserves `teh ` and fails. These are **six distinct baseline-passing ordinary losses**, not speculative intent risks. Spanish preserves `teh ` and passes on both sides; it does not cancel the English/bilingual losses. Whole-report correctness is 53/63 baseline versus 47/63 candidate.

Both metadata files identify the same input SHA256 `425a118fb07d19625ea247ff6654966aba7713e1e6688463e8eaecbceb859dd0`, the repaired Swift runner `01333628a8ab4fc85ec8df0dc4884daf9efdd352b06d62f11c9a9459dffb583c`, exitCode 0, and sourceStableDuringRun true. Baseline engine is `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`; candidate is `bbeac835ed46d3dc8aa949d7e773e323b95a853cabd67a8939f3c0f200579937`.

Source explains the failure: the helper accepts `/and/teh`; for nested comments it takes the fragment after `(`, so the preceding `//` cannot veto the recovered `./` or `/tmp/` anchor. This matches the disclosed grammar but still violates the frozen ordinary-regression rule. No dictionary exception or reinterpretation resolves that rule.

The shared worktree changed during review. Initially I read the 43-line engine addition with the candidate hash above. By the final inspection, production `KeyboardEngine.swift` was byte-identical to the baseline hash above, and its working-tree diff was empty. `pre-reveal-rejection.md` explicitly records rejection without relabeling/tuning. `rejected-artifacts/anchored-grammar.patch` retains the inspected addition. **Restoration is the correct concrete disposition. No later characterization can turn this rejected candidate into accepted source.**

## 2. Round-1 runner findings: concrete dispositions

- **Unsupported state oracles: repaired.** Swift lines 186–204 validate raw top-level/case/operation keys, category names, mode-map keys, and arguments inappropriate to an operation. Lines 159–167 execute caret, selection length, Undo availability, policy, and private learning-delta assertions. Unsupported names produce errors; they are not silently ignored. Decode failures still fail the Swift invocation, with outer runner fallback retaining unavailable rows when no report is produced.
- **Malformed move/delete: repaired.** Lines 131–142 reject negative backspace counts, missing/out-of-bounds move offsets, and invalid selections; insert requires text. The specified reset and private defaults remain explicit semantics.
- **Post-save observations: repaired within the disclosed scope.** Lines 171–176 flush synchronously, recheck a last-operation nonlearning/delta assertion, and report finalState. Earlier checkpoints remain checkpoints at their own operation; they are not silently promoted to end-of-case assertions.
- **Private learning delta: materially improved.** The captured state compares spelling-to-count maps plus total touch weight, rather than spelling presence alone. For the supplied small, fresh-stack cases this detects repeated-word learning. The contract limits the claim to those observations; it is not a serialization comparison of every dictionary/touch-model field or a device/persistence privacy proof.
- **Swift success is not acceptance: correctly disclosed.** A report-producing Swift test may pass with incorrect rows. The outer comparison now rejects every baseline-passing correctness loss, ordinary state changes, missing/unexpected rows, and recognized infrastructure errors. It must still satisfy section 3 below.

The five negative controls finished during review. `selected-runner-negative-controls-{baseline,candidate}.json` each contains all 15 mode rows, with **0/15 passing** and exactly the intended errors: cursor, selection, unknown oracle, missing move offset, and negative delete count. Both metadata files identify the repaired runner, expected input hash, stable respective engines, and exitCode 0. This substantiates the specific repaired controls; a successful Swift process does not mistakenly turn them into accepted cases.

The exposed explicit-state diagnostic passes all three modes on both engines. Private-delta has no delta-oracle error on either engine; its Spanish row fails the final text expectation on both because public `hello` becomes `bello`. Keep that row failed. Likewise, the original supplemental Spanish private-transition absolute-zero oracle remains mistaken after prior public learning; do not rewrite it into a pass.

## 3. P1 for future acceptance: provenance/exit/stability are recorded but not enforced by the gate

`run.py:35–47` records input/engine/runner hashes, source stability, and process exit status; it returns the Swift process status when a report exists. However, `summarize.py:4–18` consumes only input IDs plus report JSON. It never reads these metadata files or checks that a report actually came from the current input/oracles and frozen runner. `gate.py:6–13` consumes summary fields and likewise never checks metadata. A complete report from an unsuccessful process or an unstable-source run is not automatically an infrastructure error in that comparison pipeline. A caller may enforce these conditions separately, but no such enforcement exists in the reviewed three scripts.

Executed in-memory negative control against the reviewed scripts:

1. Current input: one control case, empty document, `sync` with `expectCursor: 999`, expected empty text; three mode rows are required.
2. Supply historical-style baseline and candidate rows for the same IDs/modes, with correct=true, no oracleErrors, and no finalState, as an old oracle-ignoring runner could produce.
3. Run the actual summarizer with `--input`, then its actual gate, intercepting pathlib writes in memory.
4. Result: `observedEngineGatePass: true`, exit 0, despite the current impossible assertion and absent current-run evidence.

This is stale-report acceptance, not a failure of the repaired Swift assertion. ID pairing alone does not bind execution to input content. The initial supplemental metadata I inspected used old runner hash `d3d6f590...`; later `selected-development*` and selected review/negative reports do identify the repaired runner and stable sources. Manual inspection supports those particular pairs. It does not make the automated pipeline fail closed.

Required before using this pipeline to accept any source: enforce matching frozen input and runner hashes, expected baseline/candidate engine hashes, successful process exits and stable sources, complete expected rows, and the required final-state schema. Reject missing metadata. Preserve failed runs. A manual or outer-wrapper verification can discharge this dependency if it is explicit and reviewable. No implementation edits are requested from this read-only reviewer.

During this review the summarizer/gate gained required `--input` pairing and unexpected-row rejection. I reviewed and calibrated that later version. It closes the both-sides-omit-a-row denominator hole; it does not close the provenance gap above.

## 4. Learning, coverage, and check limits

The hyphen/tilde/underscore learning defect remains in source. The new exposed diagnostics each fail nonlearning in all three modes on the candidate, including the final save recheck. Their baseline failures are retained; these are not fresh baseline-passing correctness losses. Contract line 15 now expressly disclaims complete final-component/path nonlearning and narrows the claim to the terminal-delimiter branch. That is an honest pre-reveal limitation, not a fix. Secure-field nonlearning remains a separate requirement.

The original 22 templates, supplemental 20 templates, and new 21 review templates are separate exposed sets (66, 60, and 63 mode rows). The supplemental set now exercises marker selection/deletion, caret movement, suffix replacement, Undo, reset, and secure fields; the new set adds explicit state and repeated-word private delta assertions. This is substantially better coverage than round 1. It still does not establish native host callbacks, unavailable proxy context, every right-hand suffix, private-to-public restoration, or full persistence behavior. The contract correctly avoids complete/right-hand-token and device claims. Unsupported assertions must remain errors rather than be inferred from snapshots.

The exposed core/services baseline and candidate records both report exit 0, three service tests, 439 core tests, and the same five known issues: two fuzz reproductions and three multilingual benchmark issues. I corroborated those records, not independently reran them. They cannot override the six ordinary losses.

## Review fingerprints

Baseline/restored engine: `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`.
Rejected candidate engine: `bbeac835ed46d3dc8aa949d7e773e323b95a853cabd67a8939f3c0f200579937`.
Swift replay: `01333628a8ab4fc85ec8df0dc4884daf9efdd352b06d62f11c9a9459dffb583c`.
Contract: `c60f613b8c301ab6f435afc1e9674f7c78653939275ceefd47b22be8e7538949`.
Original development: `4e2261314c02a14ab75c14a763bea28317b2fb4dd507c6cbae9e34bcac502da0`.
Supplemental state: `37cce519aeab84c21387e24b940cb4c58dd751ed8b7b60f54457ea41d1a7e7af`.
Review diagnostics: `425a118fb07d19625ea247ff6654966aba7713e1e6688463e8eaecbceb859dd0`.
Runner negative controls: `c2da238bdf302a67258697c198239f56576962f867967affb6a768d085f825df`.
run.py: `4d0b4be90c427ff3826cb14b447fbd1ba73ce47f81b3dfac6ca7d480ab0a61c1`.
summarize.py: `ad2def1f6cb8933120f077050a9dac1098b9a13c6939096d51db3769b592df81`.
gate.py: `1c6a9b5673b7cda2e14c24e6df62853d0e3b6ab97c56fa180eb7f2511950564a`.

Final disposition: **candidate rejected; restoration verified; specific runner repairs verified; automated provenance enforcement remains unresolved for future acceptance.** No sealed result or aggregate gain can waive the six frozen ordinary losses.
