# Blind completion candidate sweep

## Outcome and independent freeze

Retain only an accent-preserving display-order fix, selected in `939a15f4` before revealing verification outcomes. Development improves by one useful completion and one saved keystroke. Verification improves spelling coverage by one completion, with **no gain in useful hits or saved keystrokes**. Next-word behavior does not improve. This is evidence for a small spelling-fidelity fix, not a demonstrated general typing-effort improvement. Parent review should assess that narrow benefit.

Started from PR #782 head `1dfe7134bdf5917a8a186b53e8d2d1083b740858` in a new isolated worktree, branch `sweep/completion-candidates-blind`. The independent protocol and original prompts were committed as `6680c923` **before any implementation, test, QUALITY_AUDIT, or audit-findings inspection**. No previous audit/findings files or other agents' findings were read, and no subagents or simulator were used. The supplied starting worktree was left untouched.

Frozen artifacts: [protocol](../benchmarks/completion-candidates/PROTOCOL.md), [development](../benchmarks/completion-candidates/development.json), [verification](../benchmarks/completion-candidates/verification.json), and [selection record](../benchmarks/completion-candidates/SELECTION.md). Original synthetic examples avoid corpus licensing and private-text dependencies. Each split contains 40 prompts: 24 completions, 16 next words, ten balanced diagnostic groups. Everyday coordination, food, travel, and work messages provide realistic tasks; deliberately difficult unfamiliar names, rare histories, valid complete words, and one-/two-letter prefixes prevent an easy-only score. Uppercase, decomposed accents, nonbreaking spaces, and curly apostrophes exercise normalization readiness.

The splits share task templates and some vocabulary (including accented words), so this is prompt-level verification, **not lexical holdout or independent language generalization**. Four examples per group are too few for statistical conclusions. Accepted alternatives are frozen and incomplete: plausible replies outside the set remain scored misses. The benchmark is diagnostic, not population-weighted or a production acceptance study.

## Actual slot and effort measurement

`SuggestionBarView` has three slots. The opt-in host Swift benchmark uses `KeyboardEngine.suggestions`, not an unlimited candidate list: default settings, fresh empty in-memory personal model for every prompt, supplied document context/prefix, correction/literal slots, centered display ordering, and loaded emoji index. The engine reconstructs the composition from host context, so no touch-location evidence is supplied. It does not train from the supplied context. Glyph support is not checked on a device: the host test loads the complete checked-in catalog, while iOS filters unsupported glyphs. This can differ in emoji occupancy across OS versions.

A hit is canonical-Unicode/case-insensitive equality with a frozen accepted answer; accents and punctuation are not stripped. A literal match counts for coverage but is not useful. Saved effort is `max(0, candidate graphemes - prefix graphemes - 1 acceptance tap)`, taking the best accepted visible slot, and summed over **all** prompts including misses. No trailing-space credit. Thus a next word of length two saves one tap; completing `naïv` to `naïve` saves zero. This fixed-prefix opportunity metric excludes reading, finger travel, capitalization, accent entry, spaces, and full typing trajectories; it is not measured human KSR. Slot-one coverage refers to the left visible slot; the strongest candidate is normally centered.

Baseline verification predictions were captured to disk without displaying outcomes. Development guided three rejected experiments and the selected fix. `SELECTION.md` and the selected implementation were committed before final capture and the single verification reveal. No tuning followed that reveal.

## Before and after

| Split | Stage | Visible coverage | Useful hits | Saved keystrokes |
| --- | --- | ---: | ---: | ---: |
| development | baseline | 28/40 | 22/40 | 70 |
| development | selected | 29/40 | 23/40 | 71 |
| verification | baseline | 21/40 | 14/40 | 40 |
| verification | selected | 22/40 | 14/40 | 40 |

Coverage increases by 2.5 percentage points in each split. Development useful hits increase 55% → 57.5%; verification stays 35%. Left-slot coverage is unchanged at 14/40 development and 8/40 verification. No case loses coverage, useful status, or saved effort. All 80 automatic-correction outputs are identical before/after.

| Split / mode | Stage | Coverage | Useful hits | Saved keystrokes |
| --- | --- | ---: | ---: | ---: |
| development / completion | baseline | 17/24 | 11/24 | 34 |
| development / completion | selected | 18/24 | 12/24 | 35 |
| development / next | baseline | 11/16 | 11/16 | 36 |
| development / next | selected | 11/16 | 11/16 | 36 |
| verification / completion | baseline | 14/24 | 7/24 | 16 |
| verification / completion | selected | 15/24 | 7/24 | 16 |
| verification / next | baseline | 7/16 | 7/16 | 24 |
| verification / next | selected | 7/16 | 7/16 | 24 |

Each group below has four cases. Each cell is **coverage / useful hits / saved keystrokes**.

| Group | Dev before | Dev after | Verification before | Verification after |
| --- | --- | --- | --- | --- |
| common-completion | 4 / 4 / 10 | 4 / 4 / 10 | 2 / 2 / 5 | 2 / 2 / 5 |
| short-prefix | 3 / 3 / 14 | 3 / 3 / 14 | 3 / 3 / 7 | 3 / 3 / 7 |
| ambiguous-valid | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| unfamiliar-name | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 | 0 / 0 / 0 |
| normalization | 2 / 1 / 2 | 3 / 2 / 3 | 1 / 0 / 0 | 2 / 0 / 0 |
| context-completion | 4 / 3 / 8 | 4 / 3 / 8 | 4 / 2 / 4 | 4 / 2 / 4 |
| next-common | 4 / 4 / 12 | 4 / 4 / 12 | 3 / 3 / 11 | 3 / 3 / 11 |
| next-ambiguous | 3 / 3 / 7 | 3 / 3 / 7 | 1 / 1 / 1 | 1 / 1 / 1 |
| next-rare-history | 1 / 1 / 1 | 1 / 1 / 1 | 0 / 0 / 0 | 0 / 0 / 0 |
| next-normalization | 3 / 3 / 16 | 3 / 3 / 16 | 3 / 3 / 12 | 3 / 3 / 12 |

Only four strips change:

| Case | Before: left / middle / right | After: left / middle / right | Effort result |
| --- | --- | --- | --- |
| dev-normalization-1 | cafe / café / ☕ | cafés / café / ☕ | unchanged: literal hit, zero saved |
| dev-normalization-2 | naï / nails / naive | naï / naïve / nails | miss → useful hit, +1 saved |
| ver-normalization-1 | cafe / café / ☕ | cafés / café / ☕ | unchanged: literal hit, zero saved |
| ver-normalization-2 | naïv / native / naive | naïv / naïve / native | miss → coverage hit, zero saved |

The displayed literal is preserved byte-for-byte by the engine; canonical equivalence is used only for scoring/prefix comparison. The `café` change is a useful spelling preference but earns no extra benchmark credit. The verified `naïve` coverage gain repeats vocabulary from development and therefore validates prefix handling at a different length, not unseen-language performance.

## Retrieval, ranking, and selected bounded change

The existing pipeline performs bounded weighted edit search (60,000 trie-node cap), retrieves eight completion candidates under matched prefixes (4,000 heap-expansion cap), adds matching bounded bigram/trigram continuations plus already-bounded local personal entries, scores with the existing language model, and then assembles the literal/correction/completion strip. Next-word candidates combine stored bigram/trigram successors, local personal successors, and 32 frequent fallback words before selecting the centered top three.

Lookup deliberately folds accents. Consequently a written `naï` could retrieve both `naive` and `naïve` yet rank the more frequent unaccented spelling ahead of the intended continuation. `Suggester.suggestions` now partitions **already retrieved** display candidates for a prefix containing an explicit combining mark: first those whose NFC/case-normalized spelling preserves that written prefix, then all others, preserving the model order inside both groups. No word/context exceptions, new vocabulary, or revised probability constants are added.

The partition runs **after** automatic-correction selection. Original candidate retrieval, scores, edit costs, thresholds, literal placement, rejected/blocked filtering, text replacements, and predictions are unchanged. Accent detection scans every nonempty correctable prefix. For explicitly accented input, the partition additionally adds linear work and temporary storage in the existing candidate count; it does not enlarge trie search or a successor table. All other scripts continue through the existing normalizer; this does not make the English model multilingual or promise accent-correct continuations absent from retrieval. The rule does not unify straight/curly apostrophes within an accented prefix, and broader orthographic preferences are outside this change.

No dictionary binary, dictionary training/build input, generated language artifact, language setting/UI, dictation, or Shift implementation was changed. Personal data stays local: production logging, persistence, network inference, and learning behavior are untouched. The benchmark's opt-in diagnostic outputs contain only the committed synthetic prompts.

## Rejected experiments

Experiments were evaluated only on development. Full visible outputs and timings are retained beside baseline/selected outputs under [results](../benchmarks/completion-candidates/results/). Retrieval diagnostics are recorded for development only and never scored as visible choices.

| Experiment | Development coverage / useful / saved | Rejection |
| --- | --- | --- |
| Missing-letter candidates compete in strip at exact-completion cost, while preserving original correction evidence | 28 / 22 / 70 | No gain in primary metrics. Changed water→waters, light→lights, bear→bears, and plan→plans alternatives; also promoted nail/emoji over naïve. No basis to retain the extra ranking rule. |
| Increase completion retrieval from 8 to 32 | 28 / 22 / 70 | No visible strip changes on any development prompt; more retrieval work without measured value. |
| Increase next-word frequent fallback from 32 to 128, on top of the selected accent fix | 29 / 23 / 71 | No visible strip changes, including rare histories. First-use fallback work increases without benefit. |

Selected accent preservation alone gives 29 / 23 / 71 development. No rejected experiment survives in source. No next-word improvement is claimed.

## Misses retained

Invented unfamiliar names remain 0/4 on each split. With no prior personal evidence or dictionary entry, there is no responsible way for this English model to invent the intended name; their literal prefixes remain selectable. Rare next-word histories remain 1/4 development and 0/4 verification. Common held-out misses remain real: `charg` offers charge and an emoji rather than charger; `read` offers reading/reading emoji rather than ready; `br` has an automatic correction to be, occupying a useful slot; `TH` offers THAT/THE/THIS rather than THANK. Accented résumé completions still miss; the display fix cannot rank a word that bounded retrieval did not return. More semantically plausible next words require better model evidence, not benchmark-specific exceptions.

Existing automatic correction can be surprising on a completion prefix: development `sched`→ached, `sandw`→sands, `rés`→red, and held-out `weath`→wealth. These behaviors existed before the change and are retained in the artifacts. The automatic correction of accented `rés` is an existing literal-input limitation; this patch does **not** claim to fix it. It changes explicit candidate display only and does not loosen conservative automatic correction. All valid-word ambiguity cases retain their literal and have no automatic correction.

Every final miss is listed below; every prompt's actual slots, automatic choice, score outcome, and timing samples are retained in machine-readable baseline and selected JSON, including zero-effort hits.

### Development final misses

| Case | Actual left / middle / right | Automatic correction |
| --- | --- | --- |
| dev-short-prefix-4 | really / re / read | — |
| dev-unfamiliar-name-1 | Zelm / Zelman / Zelma | — |
| dev-unfamiliar-name-2 | Qor / QPR / WOR | — |
| dev-unfamiliar-name-3 | Navi / Navigation / 🧭 | — |
| dev-unfamiliar-name-4 | Elysian / Ely / Elysium | — |
| dev-normalization-4 | rés / red / result | red |
| dev-next-ambiguous-1 | the / a / not | — |
| dev-next-rare-history-1 | to / for / in | — |
| dev-next-rare-history-2 | a / to / of | — |
| dev-next-rare-history-3 | through / of / with | — |
| dev-next-normalization-4 | the / a / not | — |

### Verification final misses

| Case | Actual left / middle / right | Automatic correction |
| --- | --- | --- |
| ver-common-completion-2 | charg / charge / 🈂️ | charge |
| ver-common-completion-3 | reading / read / 📖 | — |
| ver-short-prefix-3 | br / be / brother | be |
| ver-unfamiliar-name-1 | Vey / Very / Vet | — |
| ver-unfamiliar-name-2 | Torv / Torch / Torches | — |
| ver-unfamiliar-name-3 | Ambr / Ambrose / Amber | — |
| ver-unfamiliar-name-4 | Kes / Keys / Kessler | — |
| ver-normalization-3 | THAT / THE / THIS | — |
| ver-normalization-4 | résu / result / results | — |
| ver-next-common-4 | in / able / the | — |
| ver-next-ambiguous-1 | held / going / a | — |
| ver-next-ambiguous-2 | get / do / have | — |
| ver-next-ambiguous-4 | really / like / very | — |
| ver-next-rare-history-1 | in / on / at | — |
| ver-next-rare-history-2 | a / to / of | — |
| ver-next-rare-history-3 | in / is / 🥮 | — |
| ver-next-rare-history-4 | have / be / not | — |
| ver-next-normalization-4 | the / a / not | — |

## Cost and practical limits

Host: Apple M5 Pro, macOS 27.0.1 (26A434), Apple Swift 6.4, arm64 release build. Each split measures 40 first suggestions on fresh model/engine instances and 20 subsequent forced refreshes per prompt (800 warm samples). Units below are microseconds. "First" is model-cold inference with a shared already-mapped lexicon and prepared emoji index; it excludes lexicon mapping, catalog/index construction, engine/context initialization, process launch, rendering, and device touch handling. Shared lexicon omission caches can already be warm. This is **not** a true cold-device launch measurement.

| Split / stage | First median / p95 / max (n=40) | Warm median / p95 / max (n=800) |
| --- | ---: | ---: |
| development / baseline | 102.73 / 811.21 / 1221.88 | 56.69 / 666.12 / 1039.38 |
| development / selected | 83.54 / 739.50 / 826.96 | 55.52 / 606.83 / 750.25 |
| verification / baseline | 80.75 / 594.25 / 904.58 | 55.62 / 526.04 / 1734.92 |
| verification / selected | 68.75 / 532.62 / 599.38 | 54.58 / 522.17 / 567.71 |

These are single ordered baseline/final runs with short sub-millisecond operations, cache and scheduling noise, no randomized A/B interleaving, and no confidence intervals. Lower final timings are not evidence of a speedup. No obvious latency regression appears in this sample. Peak resident memory, iOS rendering latency, power use, long personal dictionaries, and actual user acceptance were not measured. Added temporary memory is O(existing candidate count); no model asset size changes. Focused clean-ish release compilation took 33.84s, and 182 regression test functions ran in 0.482s; opt-in final benchmark ran in 0.227s. No network inference/API cost, device build, or simulator cost.

## Validation and reproduction

The focused host-only release regression command passes **182 tests across 15 suites**, including the new composed/decomposed/lowercase/uppercase synthetic accented-name cases, unchanged unaccented frequency preference, forgetting a candidate, and selecting a real accented completion through `KeyboardEngine`. Existing suites cover correction confidence, literal protection, sparse histories, backoff normalization, private/context loss, document changes, slot freshness, editing, and emoji displacement. No broader performance/corpus audit was read or used to select the patch.

```sh
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release --no-parallel --filter 'AccentCompletionTests|SuggesterTests|SpellCorrectorTests|LiteralValidationTests|ContextVisibilityTests|SuggestionStripTests|SuggestionFreshnessTests|BackoffNormalizationTests|LanguageModelConfidenceTests|FastPathEquivalenceTests|KeyboardEngineTests|AccuracyEditingTests|EditingRegressionTests|EmojiSuggesterTests|EmojiSelectionTests'
COMPLETION_SWEEP_OUTPUT=/tmp/pulpo-completion-replay swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release --no-parallel --filter CompletionCandidatesBenchmarkTests
python3 apps/keyboard-ios/benchmarks/completion-candidates/summarize.py /tmp/pulpo-completion-replay
python3 apps/keyboard-ios/benchmarks/completion-candidates/summarize.py /tmp/pulpo-completion-replay --split verification --details
```

For development-only experiments set `COMPLETION_SWEEP_SPLIT=development`. To reproduce the baseline, apply only the frozen benchmark and capture harness to `1dfe7134` in another checkout; do not include the accent-preserving inference diff. `git diff --check` passes. Existing compile warnings are a non-Sendable closure conversion in TouchModel and an unused WordDeletion expression; no new warnings were introduced.

Frozen prompt SHA-256 remains unchanged:

- development: `058b2efd84bf3f3b5549df79d3d35c168ca19fe7e5e835beeff94ff8e39b1bdd`
- verification: `84bb7aeb181814f8240038cebdf0dd271300d5021c547293ede5b0f0f4400cea`

Language-data SHA-256 is identical before/after:

- en_US.pkdict: `168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64`
- en_US.validwords.txt: `271ef667373f216e12a3eea5a992f52499c90190de21cafd98b5b4c6175d27bb`
- emoji.json: `2085015d3bd75b7046aecd244b1961230b37fd25ac8aca475c7bc4afabba8117`

Commits use Conventional Commits and remain local; no push or PR update was performed. Parent review remains independent. Held-out results were not used for further implementation changes.
