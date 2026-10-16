# Independent accuracy sweep

## Frozen protocol (before engine or prior audit inspection)

Base: `433e54adf29dc6960f2ffb5acafbf63699fb6494` (PR #782). This worktree was clean. Only repository instructions, paths, Git metadata, and the keyboard directory listing were read before this protocol. Neither engine implementation, existing test contents, nor `QUALITY_AUDIT.md` findings were inspected.

The novel benchmark models short personal/work messages with mid-word slips, ambiguous valid words, unfamiliar names, and edits after a suggestion was produced. It combines recall with preservation constraints: an apparent accuracy gain must not silently replace legitimate text. Corpus files are frozen alongside this document in the first commit. No language features or settings/UI changes are in scope.

Each split has 98 cases: 40 correction (10 words × omission, adjacent transposition, duplicated interior letter, interior replacement with `x`), 30 swipe (the same 10 words × ideal/jitter/sparse paths), 20 preservation (10 literal identifiers/names and 10 valid words), four contextual predictions, four editing scenarios. Words, names, and contexts are disjoint between development and held-out splits, except function words in prediction phrases. These are synthetic prompts authored independently of the implementation, not user data.

### Measurement contract

- Correction: record top-1 and top-3 target recall, plus automatic replacement correctness/coverage separately. A suggestion alone is not a correct automatic edit. Match target case-insensitively for recall, but preserve literals exactly for edits.
- Preservation: no automatic replacement of exact valid words, mixed-case brands, unknown names, alphanumeric IDs, email addresses, or URLs. Suggestions are allowed. Never add input to persistent storage for this benchmark.
- Prediction: record top-3 next-word recall for each exact context (sentence-start handling tested separately if necessary). Small sample is diagnostic, not a claim about general prediction quality.
- Swipe: generate geometry using the shipped QWERTY layout once its public interface is known. Ideal paths connect letter centers, including repeated letters; jitter offsets alternating points by 0.12 key widths/heights; sparse paths retain endpoints and alternating interior points. Record top-1/top-3 recall, independently by path family. No word-specific path tuning.
- Editing: stale correction must not replace changed text; a cursor move inside a token must not replace the wrong span; whitespace commit must not duplicate boundaries; a literal name must survive commit/undo. Adapt scenarios to existing public editing abstractions, recording unsupported cases rather than counting them as passing.

### Development versus held-out verification

1. Freeze both corpora and this protocol before reading code. Record the freeze commit and file hashes.
2. Inspect implementation/tests and build a thin executable adapter. Run development only to identify general failure classes and measure a baseline.
3. Implement fixes justified by development failures and code evidence. Add regression tests spanning multiple words or state transitions; avoid vocabulary-specific exceptions or benchmark-driven dictionary additions.
4. Freeze the candidate implementation, then run held-out exactly once for baseline and candidate (same harness, dictionary and environment). Do not tune after seeing held-out outcomes; if a safety failure requires a fix, disclose that held-out is spent and require independent validation.

Acceptance: existing meaningful regression suites pass; all supported preservation/editing cases pass with zero new unsafe edits; held-out correction or swipe top-3 recall improves by at least 5 percentage points in its 40/30-case category OR a reproducible editing failure class is eliminated across both splits; no other held-out correction/swipe category regresses more than one case, and no prediction regression. Report absolute numerators, denominators, timings where available, unsupported coverage, and caveats. If criteria are unmet, report that honestly and retain only independently justified fixes. Synthetic recall and tiny context coverage cannot establish real-user accuracy or latency.

## Results

Pending implementation and measurement. Frozen protocol above must remain unchanged; append results below.

### Development observations before implementation

Freeze commit: `1a31f4f4`. Corpus SHA-256: development `8772fa3bf98fa46e5ddc7305dc6b71bdf04c6bc5115fe89308be3d550b95a64c`; held-out `3b9f8ba977496674aac531ac9fe6de4555dd1cec4fb2881c4db781b170c43383`.

Development baseline: correction 39/40 top-1 and 40/40 top-3; swipe 20/30 top-1 and top-3 (ideal/jitter 10/10 each; sparse 0/10); prediction 3/4 top-1/top-3; preservation 20/20; editing 4/4. No recall/ranking changes are justified by this evidence. Sparse paths remove intended letter targets, rather than merely reducing sampling along the same trajectory; this limitation was discovered after freezing and is retained, not silently repaired. The transposition of equal letters in `tomorrow` also produces an unchanged control, not a typo. These defects reduce benchmark realism and must be accounted for when interpreting results.

Exploratory code investigation then produced two separate editing failure classes, captured in `AccuracyEditingTests` before engine changes:

1. Dictation chooses first-word capitalization using cached cursor context before `insertText` reconciles pending host changes. Three transcripts × send/clear, host paste and new-sentence replacement fail all nine output checks; a pending cursor move fails one more. This can lowercase a new sentence or uppercase a mid-sentence insertion.
2. `select` clears space-slip and deleted-swipe evidence before validating the suggestion's generation. An obsolete ordinary or emoji choice is textually ignored, but alters subsequent correction. Two slip scenarios and one obsolete emoji scenario fail; one also loses its correct undo state. The development regression run records 14 failed assertions across four test functions (seven parameterized invocations), including the ten dictation outputs and three continuation outputs. These exploratory regressions are **not** part of the original blind benchmark and cannot be used to claim its acceptance threshold was met.

Candidate scope is restricted to reconciling before dictation casing and deferring suggestion-side state changes until validity checks pass. Keep dictionary, corrector, prediction and swipe scoring unchanged. Run the original held-out corpus only after freezing this candidate; retain the frozen acceptance rules even if these fixes leave original benchmark scores unchanged.

### Candidate and final comparison

Implementation frozen at `f8bf3ac0` before held-out evaluation. Baseline measurements use `4cb577ed`, whose engine and dictionary are identical to the PR base; it adds only the frozen protocol, adapter and development regressions. Baseline held-out ran from a detached temporary worktree. Candidate held-out and baseline held-out each ran once. No implementation tuning followed held-out results.

The implementation changes only `KeyboardEngine`:

- `insertTranscript` reconciles pending host edits before deciding first-word casing. Existing spacing reconciliation remains in place. Regression controls preserve unfamiliar-name/brand capitals and known own-edit proxy lag.
- `select` validates an ordinary choice before clearing space-slip/deleted-swipe evidence. `selectEmoji` clears the same evidence only after its own full validity checks. Rejected choices now preserve subsequent correction behavior as well as immediate text.

The complete frozen corpus outcomes (including choices, costs and automatic decisions, excluding runtime measurements) are identical before/after in **all 196 cases**:

- **Development:** correction top-1 39/40, top-3 40/40; automatic edits 34/40, all 34 correct. Including the unchanged `tomorrow` control, committed-target accuracy is 35/40. Swipe top-1/top-3 20/30, with ideal 10/10, jitter 10/10, sparse 0/10. Prediction top-1/top-3 3/4. Preservation 20/20 cases, checked at both sentence start and after `ask ` (40/40 actual commits). Editing 4/4. All cases supported by the adapter.
- **Held-out:** correction top-1/top-3 40/40; automatic edits 36/40, all 36 correct. The other four remain literal; one is an unchanged equal-letter transposition control (`really`), so committed-target accuracy is 37/40. Swipe top-1/top-3 22/30, with ideal 10/10, jitter 10/10, sparse 2/10. Prediction top-1 3/4, top-3 4/4. Preservation 19/20 cases (39/40 actual commits). Editing 4/4. All cases supported.
- **Exploratory editing regressions:** the original 14 failing assertions become zero; all four original regression functions pass. The two added control functions also pass (literal capitals parameterized across three names/brands, plus own-edit lag). These are development regressions demonstrating two general state-ordering fixes, not held-out accuracy gains.

**Frozen acceptance is not met.** There is no 5-point recall gain or elimination of an editing failure within the original corpus, and one held-out preservation case fails in both versions. Retaining the two independently justified editing fixes follows the frozen protocol's fallback; do not characterize this as an overall accuracy-benchmark win.

### Residual risks and limitations

- The held-out name `Zevra` becomes `Zebra` at sentence start in both baseline and candidate; `ask Zevra` remains literal. Existing unknown-title-case protection depends on a preceding word. The corpus is now spent for diagnosing this failure. A future general name-safety fix needs an independent verification set and a measured tradeoff against automatically capitalized sentence-start typos. This change does not resolve it and introduces no new literal-name changes.
- Sparse paths deliberately skip key targets and often cannot encode the intended word. Their poor recall is not evidence that decoder thresholds should be loosened. Ideal/jitter paths are synthetic and omit human timing/curvature, and ten words per split do not measure real-world swipe accuracy.
- The correction set is mostly easy single edits, without touch locations; it misses directed multi-key slips and most contextual ambiguity. The `diner` target `dinner` is an intentional valid-word safety tradeoff: it remains literal while offering `dinner`. Replacement with `x` is a stress mutation, not a realistic frequency distribution. No vocabulary-specific exceptions, dictionary additions, language feature, settings, UI or scoring changes were made.
- Four prediction prompts per split are diagnostic only. The development `see you` prompt misses `soon` while offering plausible `in`, `tomorrow`, `later`; no general model change was justified.
- Preservation commits use already visible full tokens. They do not exhaustively test every incremental punctuation event of entering an address. Editing corpus cases cover stale nonliteral choices, cursor moves, an existing space and literal selection/backspace; they do not cover selection replacement or real UIKit callbacks. The two discovered regression classes were outside the original benchmark.
- Test stacks use `PersonalDictionary(url: nil)`; they neither load personal text nor persist benchmark input. The full suite includes private-field and touch-learning protections. No network requests or user data are involved in the measurement.
- Timing includes fresh stack construction and, for correction rows, an additional diagnostic candidate enumeration. Candidate runs overlapped unrelated host compilation. Median held-out row times before/after were correction 1.985/2.447 ms, swipe 1.053/1.166 ms, prediction 0.066/0.065 ms, preservation 2.985/3.249 ms, editing 0.858/0.974 ms. These one-shot timings are **not** a latency comparison. Full release-suite performance tests pass; no on-device performance claim is made.

### Validation and reproducibility

Environment: Apple Silicon, macOS 27.0.1 (26A434), Apple Swift 6.4 (`swiftlang-6.4.0.34.1`), release configuration, serial test execution. Bundled `en_US.pkdict` SHA-256: `168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64` (unchanged).

From `apps/keyboard-ios/PulpoKeyboardKit`:

```sh
# Full candidate regression run: 331 tests in 42 suites, 19.185 s test time.
swift test -c release --no-parallel

# Repeat for SPLIT=dev or heldout; choose OUT outside the checkout.
PK_ACCURACY_CORPUS="$PWD/../audits/accuracy-sweep-$SPLIT.json" \
PK_ACCURACY_REPORT="$OUT" \
swift test -c release --no-parallel --filter AccuracySweepTests

# Focused regression comparison: fails on 4cb577ed, passes on f8bf3ac0.
swift test -c release --no-parallel --filter AccuracyEditingTests
```

`AccuracySweepTests` writes measurements and asserts corpus support/count, **not** benchmark acceptance. Read `safe`, `top1`, `top3`, and `automatic` in the JSON; a passing adapter test is not evidence that all safety cases passed. For correction/prediction, the adapter restores best-first order from the centered suggestion strip; swipe uses the top three decoder choices. Preservation tests actual commits in two contexts. All timing is host elapsed time.

The full suite passed with its two pre-existing known issues in `hostRevertToARecentOwnStateIsAKnownAmbiguity` (`wordDeleteWrong`, seed 440; `composingDesync`, seed 227). These are not new failures or fixed by this patch.

An extra 500-seed, 200-operations-per-seed fuzz attempt starting at 3001 did **not** complete: seed 3193 traps with `Array index is out of range` in `FuzzHost.trueSelection`, `EngineFuzz.swift:251`, called by `FuzzRun.external` at line 765. Replaying seed 3193 alone on the untouched baseline reproduces the same SIGTRAP (signal 5) and stack. This is a pre-existing fuzz-harness coverage limitation, not a passed long fuzz run; no fuzzer changes are included. Reproduce with `PK_FUZZ_ITERATIONS=1 PK_FUZZ_SEED_START=3193 PK_FUZZ_OPS=200 swift test -c release --no-parallel --filter longRandomizedEditingRun`. The standard short randomized tests passed in the full suite.

Temporary raw evidence on this machine:

- `/tmp/pulpo-accuracy-{dev,heldout}-{before,after}.json` and matching `.log` files: per-case measurements. Development baseline build log is `/tmp/pulpo-accuracy-dev-build.log`.
- `/tmp/pulpo-accuracy-editing-{before,after}.log`: red/green focused regression outputs (initial four functions); full suite includes the extra controls.
- `/tmp/pulpo-accuracy-full-tests.log`: complete final release-suite output.
- `/tmp/pulpo-accuracy-fuzz-after.log`, `/tmp/pulpo-accuracy-fuzz-candidate-progress`, `/tmp/pulpo-accuracy-fuzz-baseline-3193.log`: interrupted long fuzz and baseline reproduction.

These temporary files are not durable repository artifacts; frozen inputs and the executable adapter are checked in so the parent can validate independently. `git diff --check` passes. `QUALITY_AUDIT.md` is unchanged and was never read. No simulator/device build or deployment was performed; no commits were pushed.
