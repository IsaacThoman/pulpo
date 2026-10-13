# Keyboard quality audit — October 13, 2026

Pulpo is substantially safer and more contextual than the starting branch. It is
competitive with Gboard on this small controlled swipe replay, while Gboard still
leads on the single-word prediction set. These tests do **not** establish that either
keyboard is the best overall. Fast human typing, Gboard on iOS, multilingual input,
and physical-device latency remain unmeasured.

## Measured results

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
