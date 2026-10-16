# R19 anchored path grammar — rejected

The tighter grammar is rejected. Production `KeyboardEngine.swift` is byte-identical to parent `c4a354f3`; no path-preservation improvement is retained. Three ordinary-intent diagnostics lose previously working correction in EN and bilingual: **six passing-case regressions**. The same three Spanish documents stay correct but lose ordinary learning, giving nine changed ordinary states. The exact failed helper is preserved only in `rejected-artifacts/anchored-grammar.patch`. No dictionary, R16 before-existing-text policy, or R18 completion ranking changed.

PR: https://github.com/IsaacThoman/pulpo/pull/782. Protocol/development freeze: `c48fa630`. Rejected-candidate/runner freeze: `31821794`, before the single sealed reveal. Baseline engine SHA256: `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`; rejected candidate: `bbeac835ed46d3dc8aa949d7e773e323b95a853cabd67a8939f3c0f200579937`; frozen Swift runner: `01333628a8ab4fc85ec8df0dc4884daf9efdd352b06d62f11c9a9459dffb583c`. Full hashes/task IDs are in `candidate-freeze.json` and `provenance-checks.json`.

## Grammar and its failure

Before relevant engine/R15 source inspection, the original contract and 22 synthetic development templates were committed. The independent design requires a root/home/dot-relative/ASCII-drive/UNC anchor and nonempty components, with real directory evidence for Unix roots. It rejects Unix `//`, empty interior components and punctuation-bearing components; prose/shell separators terminate eligibility. Quotes/backticks veto the whitespace token. There are no word, extension, dictionary, or ranking exceptions and no blanket correction disablement.

The advance safety tradeoff deliberately sacrifices Unix double-root paths, semicolon-containing filenames, quoted paths, bare filenames/options and ambiguous punctuation to preserve useful prose correction. The contract explicitly acknowledges that filesystem intent cannot be inferred with certainty from syntax. Intermediate components can learn. Subsequent source review also established that hyphen/tilde/underscore inside a final filename can learn earlier alphabetic fragments through an existing nonseparator branch. That limitation was disclosed before reveal; complete final-component/path nonlearning is not established.

The helper fixes the exposed R15 losses `say //` + `teh ` and `/tmp/file;` + `teh ` without broad dot/slash handling. It preserves `/tmp/notes.txt` and the measured rooted/home/relative/drive/UNC final components. These are exposed development results, never fresh gain credit.

Independent review then proposed genuinely ordinary-intent ambiguity diagnostics. They were fixed as ordinary **before execution**:

- `the notation /and/` + `teh `: baseline `the notation /and/the `, candidate `the notation /and/teh `.
- `//(./` + `teh `: baseline `//(./the `, candidate `//(./teh `.
- `//(/tmp/` + `teh `: baseline `//(/tmp/the `, candidate `//(/tmp/teh `.

Each loses in EN and bilingual. These six losses remain ordinary failures even though the grammar matches their syntax. The nested comments regain an anchor after `(`; slash-delimited prose has the same shape as a path. No post-measurement relabeling or source tuning occurred. Production source was restored and rejection recorded before sealed inputs were read. Later aggregate gains cannot reverse this decision.

## Exposed development and source review

The initial 22 templates were the pre-inspection freeze. The supplemental 20 state/language templates and 21 reviewer diagnostics were added after source inspection but before the independent reveal; they are explicitly exposed development, not an expanded claim about the original freeze. Original expectations were never rewritten to observed outputs.

Official final-runner original development, 22 templates per actual language stack:

- EN: 11→18/22, seven gains, no losses.
- ES: 9→9/22, no gains/losses.
- Bilingual: 11→18/22, seven gains, no losses.

Supplemental state development, 20 templates per stack:

- EN: 18→20/20, two gains, no losses.
- ES: 14→19/20, five gains, no losses.
- Bilingual: 13→20/20, seven gains, no losses.

These two sets total **76→104/126**, 28 exposed gains, no passing-case losses. All 51 ordinary rows retain full document, operation snapshots, proposals/alternatives, learning counts and touch weights. Original foreign-language/capitalization/Undo oracle mistakes remain in the denominator. The supplemental Spanish private-transition absolute-zero oracle is wrong: prior public `teh` learning remains when entering private mode. Its row stays failed in both versions; the recorded private segment adds nothing.

Reviewer diagnostics, 21 templates per stack: EN 18→15/21, ES 17→17/21, bilingual 18→15/21. Total **53→47/63**, six ordinary regressions. Nine learning-calibration rows fail on both engines; Spanish private-delta has unchanged text-oracle failure (`hello`→`bello`) without a learning-delta error. All 189 exposed development/review rows per engine are retained: **129→151/189**, 28 gains and six losses. The positive net score does not satisfy the gate.

Round 1 identified ignored state assertions, malformed no-ops, missing post-save learning observations, incomplete filename nonlearning and the need for an outer rejection gate. Before reveal the runner gained strict unknown-key/mode/category/argument validation, explicit cursor/selection/Undo/policy checks, spelling counts, private learning deltas and a final post-save snapshot. The existing learning-source limit was disclosed, not fixed or hidden. Five deliberately impossible/unsupported/malformed controls run in every mode: **0/15 pass on each engine**, with all intended errors recorded. Supplemental selection/caret/marker-deletion/suffix/Undo/reset/private cases and reviewer explicit-state diagnostics provide concrete engine evidence, not native UX acceptance.

Round 2 independently confirms the six losses, repaired controls and source restoration. It retains a future-acceptance blocker: frozen comparison scripts do not enforce run metadata/provenance themselves. `provenance-checks.json` records explicit manual verification for all ten official report files: matching frozen input/runner/engine hashes, stable source, successful process, complete unique id/mode rows, final states and unchanged expected documents. This discharges integrity for these particular rejected measurements only. The frozen scripts were not edited after reveal and must not be treated as a sufficient standalone future acceptance pipeline. Both complete review reports are versioned.

## Independent sealed characterization

One independent author received the contract, input schema and prior input exclusions, not candidate source or outcomes. Its 35 templates use two fresh typo/target pairs and 28 fresh directory labels. Authorship documents zero target/directory collisions across ten prior input sets. It used public APIs of a pristine baseline for oracle calibration without reading implementation. This limits linguistic breadth: many templates reuse the same two targets. All R11/R15 data, the parent fixture, and prior diagnostic words remain exposed development only.

After `31821794`, exactly one input reveal and one baseline/candidate run occurred. Both announced hashes match: cases `422ec66018c9abf6da45dcea36591a1d83cac7503088b4b9319e4b689eefdb08`, authorship `2a0d6d89c2a8f628b41079d68def1ec3a425439f3b9d6603b4339aebfbeaca29`. Frozen source, runner, comparison definitions and input bytes are unchanged after reveal. There was no retuning, rescued oracle, excluded row or repeated sealed run.

Primary result, including all authored checkpoints/errors: **47→71/105**, 24 gains, zero newly failing previously passing rows in this set. EN **17→24/35** (seven gains), ES **20→25/35** (five gains), bilingual **10→22/35** (12 gains). Twenty-two gains are literal rows and two are control `c02` in EN/bilingual. All 36 literal rows meet their final-document oracle on the candidate. All **24/24 ordinary rows** pass on both versions with identical recorded states. This fresh subset does not contain the pre-reveal ordinary ambiguities that rejected the source.

There are material authored protocol errors, preserved without adapting the frozen runner:

- The author calibrated with `InputTraits.capitalization = .none`; the required actual run retains normal capitalization. Uppercase/start-of-document control mismatches remain failures.
- Author reset means recreate the engine on the same document; frozen reset replaces the document and identity. Three templates (nine mode rows) disagree on reset semantics. Author Undo means conditional reversal/no-op; frozen Undo means actual keyboard Backspace. One template (three mode rows) disagrees. These lists overlap other failures and cannot be added as independent unavailable rows.
- Seven operation assertions use an undeclared nested `expectState` extension. The runner rejects them explicitly: **21 schema-error occurrences per engine affecting all 12 safety rows**. Their asserted state operations are unavailable under the frozen schema; none is silently counted as passed. Total checkpoint/schema errors are **26 baseline, 24 candidate**. Primary safety correctness is **0/12** on each engine, not a privacy pass.
- All **105 rows per engine execute**, with no missing dictionary/replay rows. Ignoring errors only for a separately disclosed document observation yields 51→77/105 exact documents; this is not the primary score or a repaired acceptance result.

The 34 remaining candidate misses are fully listed by mode in `heldout.summary.json`: intentional filesystem misses (quotes/backticks, double-root, semicolon filenames, options), controls `c03`–`c06` with capitalization/reset/Undo protocol disagreement, and safety `s01`–`s04` with unsupported state assertions. Intentional misses remain **7/15 exact** on both versions. No supported sealed privacy acceptance is claimed. The pre-reveal exposed secure-field and private-delta evidence remains separately available.

## Checks, native limits and costs

Every replay constructs a fresh actual `en_US.pkdict`, `es.pkdict` or `en_es.pkdict` LanguageStack with normal settings. The baseline scratch engine is independently materialized from parent source and verified exact. Baseline/current package sources differed only in the rejected engine during evaluation; both used the identical runner and immutable resource hashes.

Full release package checks pass on baseline, rejected candidate and final restored workspace: **439 core tests (including one opt-in report entry point) + 3 service tests**, with the same **five known issues**: multilingual offered-target expectations (three) and host-revert ambiguity seeds 227/440 (two). The final restored run takes 41.20 seconds to build and 7.496 seconds for core tests. Language-data regression discovery passes **11 tests**. No dictionary bytes changed.

These package checks do not compile or run UIKit controller integration. Parent native fixture `d50d2a4e`, archived by `c4a354f3` at `technical-preservation-r15-parent/AnchoredPathControllerTests.swift.txt`, remains outside discovery. The user-supplied parent native result is 3 passing / 2 failing methods, 54 assertions across 36 scenarios, with path corruption in settled and queued/optimistic hosts. No candidate native run is accepted or asserted. No device was listed/opened/touched, including reserved 17, 18 Pro R17 or unrelated E1C6B89D. No deploy, push, parent checkout edit, raw log, xcresult or corpus is included.

`costs.json` accounts for **999 implementation-side engine replays**, including provisional development, reruns after runner repairs, 30 negative controls and the single 210-replay sealed pair. Of those, 618 use the final frozen runner; official development/review contributes 378, negative calibrations 30 and the sealed pair 210. Five full package invocations and one 11-test data check ran. Author baseline/probe/public-symbol-build work is separately disclosed with incomplete total cost; provider token/billing costs are unavailable. One early compile failure used an unsupported Swift suffix overload; a pre-freeze slicing fix changed no grammar. Early baseline/source-build timing ambiguity and a provisional review run are retained and excluded from official evidence; verified final metadata has stable sources.

Sealed key insertion plus suggestion refresh: 762 keys per engine; baseline median/p95/max **0.104/1.015/1.364 ms**, rejected candidate **0.046/0.731/1.987 ms**. These single local runs mix cold/warm state and machine load and establish no statistical speed, memory, extension or device claim. Token scans scale with current token length. Device minutes: zero. No production benefit is retained because the candidate failed its safety rule.

## Reproduction

`prepare-baseline.py <nonexistent-directory>` reconstructs the parent package plus frozen runner with shared immutable fixture links. Create a second scratch package and apply `rejected-artifacts/anchored-grammar.patch` at its repository root to reproduce the candidate; verify the recorded engine hashes. The live workspace intentionally has the restored baseline engine.

Run `run.py --package <package> --input <input.json> --report <new-report.json>` for each version. Reports are never overwritten. Pair using `summarize.py <baseline.json> <candidate.json> <output-prefix> --input <input.json>`. `gate.py <summary.json> ...` returns **1** for the recorded review losses and unsupported sealed oracles. Apply the explicit provenance requirements from round 2 before relying on any future gate. Reusing now-exposed held-out inputs is reproduction/development, never a fresh blind evaluation.

The final deliverable is a rejected experiment, reproducible synthetic evidence and a hardened report runner. The parent path-corruption problem remains unresolved in production.
