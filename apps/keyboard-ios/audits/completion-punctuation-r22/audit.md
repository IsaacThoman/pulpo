# R22: REJECT; retain evidence only

The parent rejects the frozen R22 suggestion-separator candidate. The original frozen experiments show real improvements with zero passing-row losses in their selected inputs. Subsequent independent, explicitly exposed review found four separator regressions repeated across all three language stacks. The contract says to reject any required ordinary/safety regression. Neither the candidate nor its compiled tests are imported; the production baseline remains in place. No post-reveal policy tuning or native validation was performed for this archive.

The original author’s historical retain decision is preserved verbatim in `agent-audit.md`. This parent decision supersedes it. Baseline `967e5c4b`, rejected candidate `e5c29269`, development freeze `31299362`, decision/evaluator freeze `cb0e0fb3`, final report `8b1bd5f6`. Root checkpoint was `5e515366` when curation began. Changes are confined to this directory.

## Original frozen evidence

| Split | Contexts × stacks × host modes | Baseline exact/full | Candidate exact/full | Gains | Passing losses | Unavailable target rows |
| --- | --- | --- | --- | --- | --- | --- |
| Development | 37 × 3 × 5 = 555 | 80 | 200 | 120 | 0 | 355 |
| Final exposed controls | 23 × 3 × 5 = 345 | 70 | 170 | 100 | 0 | 160 |
| Independent sealed heldout | 12 × 3 × 5 = 180 | 40 | 90 | 50 | 0 | 90 |

These results were independently recomputed from the retained exact UTF-8 documents, grapheme caret/empty selection, frozen follow-on oracles and recorded deletion-Undo result. Targets must come from actual captured suggestion slots. Unavailable targets remain failures in the complete denominators. The five synthetic host modes are correlated repetitions, not independent prompts or native trials. The heldout gain is five distinct contexts/ten stack-task cases repeated across five host modes. All 90 available heldout targets are correction slots, each extending the typed prefix by one character. There is **no fresh useful-completion, ranking, candidate-availability or keystroke-saving gain**.

The reviewer also inspected already-failing raw rows rather than relying on passing-loss flags. Their only changed states were literal selections: 165 development, 50 final controls and 40 heldout rows, all false→true literal exactness. Selected target states and follow-on outcomes did not worsen in those failed→failed pairs. Strips, automatic proposals, unselected Space/Backspace, private documents and selected personal counts remained unchanged in the final paired reports. Original comma-plus-closing-quote misses remain failures.

## Exposed post-review diagnostic and rejection

Before running inference, the reviewer froze eleven contexts, the protocol and one standalone public-API client. Each context used fresh real EN/ES/BI language stacks, typed the prefix through the production engine and selected only an actually captured literal slot. No suggestion was fabricated. The immutable baseline/candidate prebuilt core libraries were linked separately to the identical client; no package/core build or root source mutation occurred. All 33 literal paths were available, suffix bytes were preserved, caret remained at the suffix boundary and selection was empty.

Exact full-document results: **baseline 21/33 → candidate 18/33; nine gains, twelve passing-case losses**. The losses are four distinct contexts repeated across three stacks:

| Intended baseline document | Candidate document | Meaning of suffix |
| --- | --- | --- |
| `mv archive .. ` | `mv archive.. ` | Separate parent-directory operand |
| `mv archive .` | `mv archive.` | Separate current-directory operand |
| `say hello ):` | `say hello):` | Separate reverse emoticon token |
| `write range ... 5` | `write range... 5` | Separate range/operator token |

The predicate treats every bounded run beginning with `. ! ? … ) ] }` as closing punctuation. Whitespace/end after a punctuation run does not establish that it is closing punctuation rather than a separate operand/token. These are meaningful separator regressions even though the suffix itself is untouched. Opposing ordinary comma, period-plus-quote and two-dot prose controls improve; existing whitespace, `:)` and smart-spacing-disabled controls stay unchanged. The known comma-plus-quote miss remains a miss.

All eleven contexts, 33 baseline/candidate observations, actual suggestion slots, original oracles, nine gains and twelve losses are retained under `post-review/`. These cases are **exposed diagnostic/development controls**, not blind or fresh heldout evidence. No reported gain from them is a new blind gain. No narrower policy was tuned after this review.

## Preserved bytes, verification and limits

Run `python3 apps/keyboard-ios/audits/completion-punctuation-r22/verify.py` (also works under `python3 -O`). It writes no reports and performs no inference/build. It checks all 46 retained artifact hashes, deterministic gzip/decompressed hashes, all twelve original declared freeze hashes, the heldout seal, the post-review input/client/output hashes, exact input-ID × three-stack × five-mode Cartesian sets and recorded summaries. The candidate source is reconstructed from the archived baseline plus the exact rejected patch in an isolated temporary directory, so verification does not require unpublished candidate Git refs or applying the patch to production. All diagnostic rows and their full-document flags/counts are recomputed. Twenty malformed-data checks (normal and optimized Python) reject missing/duplicate/unknown rows, invalid modes, stale flags/oracles/counts, private learning, nonfinite timings and changed artifact bytes; `verification-checks.json` records their explicit errors. `manifest.json` maps original paths to archived paths; compressed files preserve exact decompressed bytes. Original source hashes can be checked without a build.

The bounded verifier is specific to these retained inputs, not a general replay framework. Its character counting handles these simple NFC characters and the explicit U+0301 NFD control; it is not a general Unicode grapheme oracle. Final development/controls/heldout rows receive oracle-bound checks. The earlier erroneous-caret pair and preliminary source-review outputs are preserved and hash/JSON checked, not silently rescored against corrected gold. The historical NFD false regressions, Undo runner repair, optional-field handling and other pre-freeze amendments remain documented in the unchanged original files.

Deletion-Undo, stale-tap and private-policy flags are retained observations whose underlying operations were inspected in the archived runner. Stored rows do not independently reconstruct every intermediate Undo/stale/private event or complete engine/learning/touch-calibration state. Secure controls test suppression and zero personal count, not successful private selection. Actual UIKit scheduling, aged own-edit lag, arbitrary truncated proxy contexts, full grapheme/UTF-16 selection semantics and native extension behavior are outside these synthetic trials. Original 441-core/three-service passing command summaries (with five known issues) are historical evidence, not rerun by this archive. No native tests were performed or claimed.

Authorship/exclusion records support the original bounded independent-author protocol, not universal novelty. The original heldout remains byte-identical and its unavailable paths remain visible. All revealed inputs are development-only for future experiments.

`historical/compare.py.txt` is a historical **report-only** scorer: it trusts flags, does not bind input Cartesian identities, omits failed→failed raw-state comparisons, and its `assert` checks disappear under `python -O`. `historical/evaluate.py.txt` and `run.py.txt` are inactive historical launchers; the former swaps source files and neither should be run in this shared checkout. The runner `CompletionPunctuationR22Tests.swift.txt`, diagnostic `Client.swift.txt` and `rejected-policy.patch.gz` (exact decompressed text) are uncompiled/inactive evidence outside test discovery. Historical absolute `/tmp` paths and prebuilt libraries are unavailable execution dependencies, not portable replay promises. Portable **verification** of retained bytes/results is supported; new inference requires a separate temporary checkout/build and is an exposed replay.

No binaries, static libraries, logs, caches, xcresults or downloaded corpora are included. No production source, assets, registered tests, main audit, device, deployment or push changes accompany this archive.
