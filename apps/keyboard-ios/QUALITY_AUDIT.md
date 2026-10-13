# Keyboard quality audit — October 13, 2026

The user's real-use feedback exposed a gap in the earlier synthetic evaluations.
Recorded human gestures score far below generated center paths. Current evidence
supports specific improvements, not an overall real-use lead over Gboard. Gboard
on iOS, multilingual input, and physical-device latency remain unmeasured.

## Further iteration: recorded human swipe paths

Baseline is `19937ca3`. Fresh agents froze their cases before consulting earlier
benchmarks. An independently authored 953-case conversational swipe suite found
failures with rounded corners, sparse samples, thumb offsets and missing release
points. This led to a separate evaluation using the
[How-We-Swipe research dataset](https://osf.io/sj67f/), rather than further relying
on generated paths. The public dataset is MIT licensed by Leiva, Kim, Cui, Bi and
Oulasvirta. Archive SHA-256:
`c7e6398d630906d664654d8f5a7ba2b1531882636fd110d8d6c05a723ca00874`.

`scripts/prepare_human_swipes.py` reconstructs the collection keyboard's geometry
(10 columns, four rows, one-pixel cap margin), keeps original start and release
positions, removes practice sentences and stationary contacts, and separates
publisher-accepted attempts from failed attempts. A stable hash splits participants
80/20; a second hash selects 3,000 gestures per stratum without consulting outputs.
The main metric uses accepted, nonstationary traces, including out-of-vocabulary
words and short words the core cannot decode. It is an offline decoder metric;
it does not measure the UIKit recognizer, actual user intent, or host integration.
Failed attempts are retained in separate files and are not included in this table.

| Recorded gestures | Before top-1 | After top-1 | Before top-3 | After top-3 |
| --- | ---: | ---: | ---: | ---: |
| Development, 3,000 gestures, 834 participants | 1,940 (64.67%) | 1,988 (66.27%) | 2,160 (72.00%) | 2,202 (73.40%) |
| Frozen verification, 3,000 gestures, 241 different participants | 1,894 (63.13%) | 1,928 (64.27%) | 2,119 (70.63%) | 2,152 (71.73%) |
| Verification dictionary-known subset, 2,774 gestures | 1,887 (68.02%) | 1,921 (69.25%) | 2,109 (76.03%) | 2,142 (77.22%) |

Verification first-choice changes comprise 50 gains and 16 losses. Development
and verification case-file SHA-256 respectively:
`7be99646d9d0f06e6f55b3bf65145293cffc99273c53f654305fc481c5768988`
and `92d23ec82684e56389c8c3c730f41cb9aceb8532d8b24bd38663d39a02fdc2a1`.

The accepted decoder keeps the original ordered center and path matching. It
relaxes interior passage radius from 1.1 to 1.25 pitches and the extra-travel
standard deviation from .15 to .25. Ordinary human overtravel was being penalized
too strongly. Exact score bounds skip expensive shape calculations when a
candidate cannot reach the current top results. Tests compare both rankings and
floating scores against an unpruned search, including ties and personal entries.
Verification on the Mac measured approximately .73 ms median and 2.00 ms p95;
these are desktop timings, not iPhone latency.

A more permissive inward-curve approximation raised the independent authored
suite's first-choice accuracy from 90.24% to 94.86%, but reduced human development
accuracy from 1,940 to 1,828. It was rejected. The selected decoder instead scores
92.34% on that authored suite. A measured tradeoff remains: 3,000 additional
rounded synthetic paths decline from 2,514 to 2,502 top-1 and 2,874 to 2,872 top-3.
The original fixed 500-case rounded top-3 guard moves from .965 to .96, with a
new six-seed aggregate regression guard. Other profile thresholds remain intact.
This is an explicit small synthetic regression accepted for the independently
verified human improvement.

A live Gboard replay uses the first 100 eligible multi-letter, dictionary-known
verification gestures, spanning 73 participants. Both decoders receive identical
prepared spatial paths. Pulpo scores **75/100** first choices both before and
after this change; Gboard scores **74/100**. This small sample does not demonstrate
a lead or a gain. Gboard version is `15.1.08.726012951-preload-arm64-v8a` on Android
API 36, not Gboard iOS. Replay simplifies paths with .04-pitch tolerance and caps
segments at .6 pitches; Android samples are injected 20 ms apart. Median replay
duration is 1.291 s, maximum 5.230 s. Original recorded timing is retained in the
prepared audit data but is not replayed. No natural-speed or physical-device
comparison is claimed.

## Follow-up: prediction coverage and swipe search

Baseline for this round: `911020d5`. Improvements: `41ce1692` (prediction data and
candidate retrieval), `3b12ff79` (swipe search and alignment), and `c6b7a240`
(valid-word safeguards). The earlier engine
was rebuilt separately; both versions received identical inputs and empty personal
dictionaries. The source dataset and sampling tools are recorded in
`LanguageData/README.md` and `scripts/prepare_prediction_holdout.py`.

### Predictions on unseen text

Topical-Chat supplies 183,511 deduplicated human conversation turns from its
published training split. Validation and test conversations are excluded from
training; evaluation also removes exact training-turn duplicates after case and
whitespace normalization. General-English, topical-conversation and SMS n-grams
are interpolated as separate distributions, preventing the much larger topical
corpus from overwhelming supported short-message phrases.
[Amazon's dataset and published partitions](https://github.com/alexa/Topical-Chat).

| Evaluation | Before top-1 | After top-1 | Before top-3 | After top-3 |
| --- | ---: | ---: | ---: | ---: |
| Conversation test, frequent topics, 198,391 known targets | 29,754 (15.00%) | **44,999 (22.68%)** | 50,104 (25.25%) | **72,102 (36.34%)** |
| Conversation test, rare topics, 196,796 known targets | 28,690 (14.58%) | **39,588 (20.12%)** | 49,740 (25.28%) | **65,304 (33.18%)** |
| Reserved SMS cases, 9,167 known targets | 1,115 (12.16%) | **1,165 (12.71%)** | 2,064 (22.52%) | **2,092 (22.82%)** |

The live comparison systematically samples 50 eligible next-word cases from each
conversation test split, with at least three words of prefix. Eligibility requires
an ASCII alphabetic target in Pulpo's safe dictionary; no model output is consulted
when selecting cases. Gboard receives the **full** prefix in its native text field;
Pulpo uses its last two words. The expected word was visible in Pulpo's three slots
on **39/100** cases (previously 27/100), versus **29/100** for live Gboard. Pulpo
alone hit 15 cases; Gboard alone hit five. Gboard sometimes uses a strip slot for an
emoji; the metric counts the word's actual visibility, not an expanded candidate list.

This sample favors conversation about the dataset's topics. Pulpo was trained on
its training partition; Gboard's training distribution is unknown. Crowdworker
conversation is not representative of every chat. These results do not establish
an overall real-use lead, and Gboard iOS remains unmeasured.

The original small utility probes are slightly worse: one-word-context visibility
is **27/40** (previously 28/40, Gboard 31/40), and two-word-context visibility is
**21/24** (previously 22/24, Gboard 20/24). Examples include “can you help” giving
way to “can you imagine/believe/pls”, and “I am going” giving way to “I am in”.
Those alternatives can be valid, but the original intended-continuation gap remains.
The broader improvement is supported by the independent test partitions rather
than adjustments to force these fixed examples.

Candidate retrieval also now examines the complete bounded bigram list. Previously,
trigram candidates could fill the result-dependent budget before backed-off bigram
candidates were examined. A regression checks that reducing the visible strip does
not silently change which static candidates rank highest.

### Swipe accuracy and cost

The decoder merges endpoint buckets with the existing heap implementation,
prioritizing endpoint likelihood and unigram frequency within the same **6,000
lexicon-candidate cap**. It previously exhausted the nearest bucket first, starving
other plausible start/end letters. Letter-alignment costs now compensate partly
for the number of distinct targets, reducing a bias against longer words.

| Identical 3,000-path profile | Before top-1 | After top-1 | Before top-3 | After top-3 |
| --- | ---: | ---: | ---: | ---: |
| Moderate noise | 2,881 (96.03%) | **2,897 (96.57%)** | 2,992 | **2,997** |
| Higher noise | 2,562 (85.40%) | **2,614 (87.13%)** | 2,847 (94.90%) | **2,876 (95.87%)** |

Calibration used different gesture seeds from verification. The expanded independent
verification includes rounded corners, sparse samples, systematic offset and drifting
endpoints. Across 5,000 paths, top-1 rose from **4,522 to 4,584**, and top-3 from
**4,868 to 4,919**. Drifting endpoints alone improved from 445/500 to 460/500 top-1
and 478/500 to 492/500 top-3. Rounded corners improved from 415/500 to 428/500 top-1.
Four gesture-style regressions now run in the normal suite.

Swiping expected words from unseen conversation contexts, using 3,776 systematically
sampled synthetic paths with sigma 0.30 target noise, improved from **3,439/3,776
(91.08%) to 3,518/3,776 (93.17%)** top-1. Top-3 rose from 3,702 to 3,723. This
combines the prediction and decoder changes; it does not isolate either contribution.

A fresh live replay of the same 100 prepared spatial paths scored **Pulpo 88/100
top-1, 100/100 top-3**, and **Gboard 89/100 top-1**. Gboard scored 87/100 in the
initial run. This small difference and run-to-run variation do not demonstrate a
swipe lead. The repeated live gestures remained deliberately slow: median 1.54 s,
maximum 8.40 s. Natural-speed human gestures are still required.

Sequential release audit runs on the Mac measured approximately **1.44 ms median,
3.58 ms p95** for moderate-noise decoding, versus 1.05 ms and 3.41 ms before. These
are indicative desktop measurements with the Android emulator running, not physical
iPhone measurements or a comparison of Gboard decoder latency. Dictionary size rose
from **12.49 MB to 12.91 MB**, retaining memory mapping and the 40,000-history cap.

### Keep prediction strength from damaging intentional typing

The sentence-context audit caught failures that the isolated literal probes missed:
`nfl → ngl`, `espn → esp`, `brady → brandy`, `play → pay`, `too → to`, and `I'm → In`.
Some were already present before the new model. Case-insensitive names and acronyms
now count as valid spellings. A valid word stays literal when touches are centered
or absent; a substitution needs directed displacement toward each changed letter.
Missing/extra letters in valid words are offered as alternatives instead of silently
applied. Explicit apostrophes and accents remain protected. Known spelling shortcuts,
mixed-case brand spelling (`iphone → iPhone`), and evidence-supported mistaps remain
under regression coverage.

On 4,810 systematically sampled known words from the frequent-topic conversation
test, automatic changes fell from **33 to four**, including a reduction from **20 to
zero changes to the letters themselves** (ignoring case, accents and apostrophes).
The four remaining changes were `whats → what's`, `cant → can't`, `i'm → I'm`, and
`wont → won't`. With sigma 0.25 touch jitter conditioned on still registering the
intended letter in the geometry model, changes fell from **31 to four** and letter
changes from **18 to zero**. An additional 4,800 known-word cases from the rare-topic
test had four formatting/shortcut changes and zero letter changes. This is a clean
input surrogate, not a measured human unwanted-correction rate; unknown names and
genuine mistypes require separate evaluation.

### Follow-up verification

- Release core suite: **71 declared tests**, including parameterized cases and opt-in
  benchmarks, plus **two service tests**. Full audit, calibration, independent
  verification, contextual swipe, external prediction and replay runs completed.
- **Four Python importer/evaluation tests pass.** The live sample reproduces exactly
  from the committed tool; rebuilding the dictionary reproduces identical bytes.
- iPhone SE, iOS 26.5: **all 40 typing, touch, setup and installed-extension tests pass**,
  including swipe entry and alternatives. No UIKit layout changes were required.
- Spelling remains **60/60** and exact literal preservation **50/50**.

To reproduce the external prediction and live comparison samples, download the pinned
Topical-Chat files identified in `LanguageData/README.md`, then run from `apps/keyboard-ios`:

```bash
python3 scripts/prepare_prediction_holdout.py --input test_freq.json --exclude train.json --output /tmp/test-next.json
PK_PREDICTION_HOLDOUT=/tmp/test-next.json swift test -c release --package-path PulpoKeyboardKit --filter evaluateExternalPredictionHoldout
python3 scripts/prepare_prediction_holdout.py --input test_freq.json --input test_rare.json --exclude train.json --sample-per-file 50 --dictionary LanguageData/en_US.pkdict --output /tmp/live-next.json --gboard-output /tmp/gboard-corpus/comparison-cases.json
# Copy the audit's comparison-paths.json into /tmp/gboard-corpus as well.
bash scripts/gboard_benchmark/run.sh emulator-5556 /tmp/gboard-corpus /tmp/gboard-live contextualPredictions
```

For the expanded gesture experiment, use `PK_GLIDE_CALIBRATE` with an earlier audit
JSON, `PK_GLIDE_VERIFY=1` for the independent seeds, and `PK_GLIDE_RESULTS` for an
explicit external result path. `PK_CONTEXT_SWIPE_HOLDOUT` evaluates contextual swipes
using the exported prediction corpus. `PK_TYPING_HOLDOUT` evaluates known-word
preservation, and `PK_TYPING_NOISE=0.25` adds deterministic within-key touch jitter.
`PK_HOLDOUT_REPORT` exports the changed words for inspection. Keep all result JSON and raw UI evidence
outside the checkout.

## Initial measured results

Baseline: `baf26581`, the branch head before this audit. The baseline was rebuilt
separately and evaluated with the same corpus, vocabulary order, and gesture seeds.
Pulpo starts with an empty personal dictionary. Gboard uses English (US) and a native
text field with `IME_FLAG_NO_PERSONALIZED_LEARNING` (its incognito indicator was visible).

| Test | Pulpo before | Pulpo after | Live Gboard |
| --- | ---: | ---: | ---: |
| Spelling cases, including three valid-word controls | 54/60 | **60/60** | 55/60 |
| Exact preservation of names, contractions, accents, code and slang | 35/50 | **50/50** | Separate comparable subset below |
| Comparable ASCII literal subset, case/apostrophe normalized | — | **43/43** | 38/43 |
| Desired next word visible, one preceding word | 20/40 | **28/40** | **31/40** |
| Desired next word visible, two preceding words | 13/24 | **22/24** | 20/24 |
| Top-1 word, identical 100 synthetic spatial paths | 87/100 | 87/100 | 87/100 |

The spelling set intentionally includes `ill`, `lets`, and `were` as literal controls.
Gboard changed those to contractions and left `occured` and `begining` unchanged.
Pulpo now retains the controls and corrects the misspellings. Gboard's comparable
literal failures included `its`, `were`, `ill`, `lets`, and `myVariable`; the last
became two words. Digits, accents and typed apostrophes were excluded from the live
tap subset because that harness does not synthesize their alternate keyboard pages.
Gboard casing and curly apostrophes were normalized for comparison.

Prediction scores count a chosen continuation in the visible suggestion strip.
Other suggestions can be perfectly reasonable: after “see you”, Gboard offered
“then” and “soon”, while the test expected “tomorrow”. This is a fixed utility probe,
not a comprehensive natural-language accuracy metric.

### Broader swipe tests

All rows below use the same 3,000-word vocabulary and identical paths before/after.
Gaussian target noise is measured in key pitches; corners are smoothed. Decoding
uses unknown context so geometry and the word prior can be assessed independently.

| Synthetic profile | Before top-1 | After top-1 | Before top-3 | After top-3 |
| --- | ---: | ---: | ---: | ---: |
| Moderate noise, sigma 0.20 | 2,861/3,000 (95.37%) | **2,881/3,000 (96.03%)** | 2,994/3,000 | 2,992/3,000 |
| Higher noise, sigma 0.35 | 2,436/3,000 (81.20%) | **2,562/3,000 (85.40%)** | 2,730/3,000 (91.00%) | **2,847/3,000 (94.90%)** |

Parameter selection used different seeds from these reporting paths. A further
independent regression set of 1,200 higher-noise gestures scored 1,055/1,200 top-1
(87.92%) and 1,147/1,200 top-3 (95.58%). The wider endpoint search and passage radius
trade two moderate-noise top-3 recoveries for much better tolerance of larger misses.

The 100-word live replay includes short ambiguous shapes, ordinary conversation,
longer words, repeated letters, and technical words. Both keyboards often preferred
shorter forms such as `to` over `too`, `for` over `four`, and `the` over `three`.
Several shapes are intrinsically ambiguous without timing or sentence context.

### Prediction generalization and speed

The added messaging data was deduplicated, spam was excluded, and a stable 20%
message partition was reserved. On 9,167 held-out next-word cases whose target was
in the dictionary, conversational interpolation improved top-1 from 1,032 to 1,115
(11.26% to 12.16%) and top-3 from 1,885 to 2,064 (20.56% to 22.52%). This confirms
some generalization beyond the 40 conversational probes. The corpus is small and
dated, with a substantial student/Singapore component; its distribution is not
representative of every user's writing. [UCI dataset description](https://archive.ics.uci.edu/dataset/228/sms+spam+collection).

Release-mode measurements on the development Mac:

- Ordinary suggestion passes: slowest best-of-five workload about **1.6 ms**.
- 5,000 learned words sharing a prefix: about **23 ms before caching**, **4.3 ms after**.
- Expanded swipe decoder: approximately **2.2 ms p95** on the moderate-noise audit;
  the observed maximum in that run was about 11.4 ms under simulator load.
- Compiled dictionary: **10.76 MB to 12.49 MB**, memory-mapped. This is file size,
  not a measured physical-device extension memory footprint.

Gboard's decoder latency cannot be extracted from this UI harness, so no speed
comparison is claimed. Mac timings are not iPhone timings.

## Changes made

1. **Preserve intentional text.** Keep apostrophes, diacritics, internal capitals,
   learned spellings, and low-confidence names. Avoid rare abbreviation defaults.
   Ordinary chat fields also protect email/URL fragments, handles, hashtags and
   identifiers. Protocol names are protected before the colon is typed.
2. **Repair dictionary interpretation.** AOSP `not_a_word` entries were incorrectly
   considered valid spellings. Their flags and spelling shortcuts are now preserved.
   Safe shortcuts win over unrelated frequent words (`youre` → `you're`, rather
   than `your`). Valid ambiguous literals remain literal.
3. **Use more context.** A bounded memory-mapped trigram table considers two preceding
   words. Conversational bigrams supplement the larger general-English corpus with
   a support-dependent weight capped at 45%. Predictions fall back to safe frequent
   words for unknown histories; contextual and personal words also feed completions.
4. **Respect swipe direction.** Segment matching is monotonic instead of choosing
   independent nearest segments. Backtracking loops can no longer be explained by
   jumping around the candidate template. This also fixed the observed in-app
   `hello` → `hero` failure. Endpoint/passage tolerance was tuned on independent seeds.
5. **Learn accepted choices.** Undoing an autocorrection or replacing/deleting a
   swipe no longer teaches the discarded result. Swipe alternatives keep the
   original preceding-word context, rather than learning a pair from the wrong word.
6. **Keep learned vocabulary fast.** Cache normalized personal forms and prepare
   touch edit costs once per suggestion pass. Forgetting a sentence-capitalized
   suggestion hides its other forms and removes their learned pair counts.
7. **Make punctuation deliberate.** Double-space periods require two taps within
   0.8 seconds. A paused second space stays a space. The engine itself enforces the
   swipe-disabled policy.

The existing UIKit key grid, native typography, layout, colors and suggestion bar
are retained. Surrounding key routing, rolling multi-touch, shift, cursor movement,
delete repeat, accents, emoji and field layouts were exercised by the UI suites.

## Verification

- Release Swift suite green: 64 declared core test functions (including parameterized
  cases and opt-in benchmark functions), plus the two service tests. Explicit audit,
  tuning, replay and external holdout runs were also completed.
- Three importer tests pass: spelling-error flags, spam/deduplication/holdout rules,
  and sentence boundaries.
- iOS 18: 36 preview/touch/appearance checks pass; installed-extension checks pass.
  The multi-point extension gesture test is intentionally skipped on iOS 18 because
  XCTest cannot deliver that private synthesized path there; a public straight-drag
  extension test passes.
- iPhone SE, iOS 26.5: 39 preview, touch, setup and installed-extension checks pass,
  including multi-point swipes through the installed extension.
- iOS 27: all 33 typing/touch checks pass. Both local-stub dictation checks pass after
  fixing the test URL to explicit IPv4 loopback. `localhost` had reached a different
  IPv6 service on the same port. This tests the recording/upload/transcript workflow,
  not speech-recognition quality.

No raw screenshots, recordings, result bundles, downloaded corpora, APKs or benchmark
result JSON are committed. The corpus definitions, harness source, dictionary and
this summary are versioned.

## Comparison method and limits

Gboard version: `15.1.08.726012951-preload-arm64-v8a`, version code `163542534`, on
an Android API 36 Google Play emulator, 1080×2400, density 420, default QWERTY height.
Pulpo is an iOS keyboard. This comparison therefore covers different platforms and
an explicitly recorded Gboard build, rather than current Gboard on the same iPhone.

The native Android harness injects real touch events into Gboard, resets the field
between cases, records actual entered text, and reads the visible candidate strip.
Spelling is tested after `and`; predictions receive the stated prefix and trailing
space. The harness marks the field as non-personalized.

Swipe paths are simplified with a maximum 0.04-pitch deviation, then sampled with
segments no longer than 0.6 pitches. **Both decoders receive those same spatial
paths.** Injection is synchronous and waits for a ready keyboard; failed injections
abort the harness instead of silently producing a score. Window animations are
temporarily disabled and restored by the script. Recorded gestures were deliberately
slow (median about 1.54 seconds in the quieter 100-word run), with scheduler outliers
up to 7.53 seconds. Earlier replay attempts under heavier simulator load produced
dropped corners/long presses and were rejected as quality evidence.

The 87/100 parity is a narrow synthetic result with limited statistical power.
It cannot establish parity for fast human swipes. Gboard also has trained spatial
and neural language models, longer context, and production personalization. These
are material architectural advantages over a geometric decoder plus n-grams.
[Google's decoder overview](https://research.google/blog/the-machine-intelligence-behind-gboard/),
[Google's on-device language-model work](https://research.google/blog/advances-in-private-training-for-production-on-device-language-models/).

## Reproduce

From `apps/keyboard-ios/PulpoKeyboardKit`:

```bash
mkdir -p /tmp/keyboard-audit
PK_QUALITY_REPORT=/tmp/keyboard-audit/report.json swift test -c release --filter auditQuality
# To preserve an earlier vocabulary and seed order:
PK_QUALITY_BASELINE=/tmp/keyboard-audit/baseline.json PK_QUALITY_REPORT=/tmp/keyboard-audit/report.json swift test -c release --filter auditQuality
PK_GLIDE_TUNE=/tmp/keyboard-audit/baseline.json swift test -c release --filter GlideTuningTests
```

The audit exports `comparison-paths.json` and `comparison-cases.json`. With Android
SDK/platform/build-tools 36, JDK 17+, `adb`, and Gboard active in the calibrated emulator:

```bash
bash ../scripts/gboard_benchmark/run.sh emulator-5556 /tmp/keyboard-audit /tmp/gboard-audit swipes
bash ../scripts/gboard_benchmark/run.sh emulator-5556 /tmp/keyboard-audit /tmp/gboard-context contextualPredictions
PK_BENCH_PATHS=/tmp/gboard-audit/replay-paths.json swift test -c release --filter SwipeBenchmark
```

Other modes: `typos`, `literals`, `predictions`, `probe`. The native harness uses the
measured key geometry in `AuditRunner.java`; recalibrate for another resolution,
keyboard height, layout or Gboard build. If a hardware-keyboard toolbar appears,
choose its “Show on-screen keyboard” option first. Outputs must stay outside the
checkout. Source checksums and corpus attribution are in `LanguageData/README.md`.

## Work still required for a world-class claim

The largest remaining gaps are broader next-word quality, sentence-level semantics,
multi-language support, and accuracy at natural gesture speeds. The next useful
benchmark is blinded human typing on the same physical iPhone against Gboard iOS:
character error rate, unwanted-correction rate, corrected/uncorrected words per minute,
swipe top-1 and recovery effort, p50/p95 key-to-text latency, cold starts, and extension
memory under a full personal vocabulary.

For the engine, prioritize a more diverse licensed conversational corpus and a
compact on-device contextual model; retain the conservative literal controls.
Swipe work should capture timed real gestures, including fast corner cutting,
endpoint drift, repeated letters and mixed tap/swipe editing. Several collinear
words cannot be distinguished by geometry alone. Expand vocabulary, languages and
layouts with independent evaluation sets, rather than fitting this fixed probe.
