# Keyboard quality audit — October 14, 2026

The user's real-use feedback exposed a gap in the earlier synthetic evaluations.
Recorded human gestures score far below generated center paths. Current evidence
supports specific improvements, not an overall real-use lead over Gboard. Gboard
on iOS, multilingual input, and physical-device latency remain unmeasured.

## Further iteration: emoji suggestions and stale choices

The suggestion bar now offers one explicitly chosen emoji alongside word choices.
It indexes supported Unicode names and CLDR 48 English keywords, with prefixes,
compact compounds such as `thumbsup`, and matching phrase suffixes such as
`red heart`. The literal and automatic correction remain available. A tap
replaces an unfinished matching phrase; after a committed space it appends the
emoji without deleting the words. Space and punctuation never apply emoji.
The picker and bar share recent choices and preferred skin tones. Private,
address, numeric, selected-text and technical-identifier contexts suppress emoji.

The picker uses three rows in compact landscape rather than squeezing five
30-point glyph rows into 22-point cells. Empty sections contribute no section
padding, and the explicitly sized grid opts out of automatic safe-area insets.
iOS 26 vertical scroll-edge effects are hidden because the fixed header and
footer already sit outside the viewport. A realized-window regression exposes
the combined empty-section and safe-area offset; category controls and Recents
also have native coverage. Initial and horizontally scrolled notched-simulator
captures did not reproduce the exact first-row blur in the user's physical-phone
screenshot; the mask configuration is explicit, but a matching physical-device
replay is not claimed. The system-owned lower keyboard bezel is preserved.

The matcher checks all 1,922 canonical names meeting its three-character minimum,
as well as an independently frozen set of aliases, prefixes, Unicode variants and
negative controls. The index is built off the typing thread. An optimized macOS
probe measured 36.8 ms initialization, 2.34 MB incremental physical footprint,
2.8 µs p95 across 10,000 lookups, and 51.3 µs maximum. These are host measurements,
not physical iPhone latency claims. The installed simulator extension used 32 MB
physical footprint with emoji suggestions active. Catalog keywords add 128,570
bytes; pinned source hashes, import steps and the Unicode license are recorded in
[LanguageData/README.md](LanguageData/README.md).

A separate blind input-state sweep froze 22 development and 16 verification cases
before consulting the implementation. It found old swipe alternatives could fall
through to generic completion handling, deleting a newly composing or externally
changed word while the bar was refreshing. Engine-generated choices now carry a
private document-state generation, invalidated by edits, field changes and policy
changes. Selection reconciles pending host edits before checking that generation;
ordinary delayed own-edit acknowledgments preserve a valid choice. Invalid swipe
alternatives no longer fall through. Frozen development improves 18/22 to 20/22;
verification improves 15/16 to 16/16. The two unchanged development failures assume
an explicit space after an already auto-spaced word is deduplicated, which is not
the current keyboard contract. This is a stale-selection fix, not a decoder gain.
Nineteen reusable freshness tests include edits arriving before host callbacks.

An independent emoji workflow sweep froze 20 development and 12 verification
scenarios before reviewing the implementation. All pass: names and related words,
multiword replacement, Unicode prefixes, tap/swipe transitions, committed append,
spacing, stale choices, field/cursor/privacy changes and delayed acknowledgments.
Tests select actual displayed engine slots instead of injecting emoji candidates.

A fresh blind stress runner combines 134 clean tap controls, 90 typo executions,
120 authored noisy ambiguity gestures and 360 salted-ID-selected recorded human
gestures in known and unknown context. Baseline is 134/134 literal preservation,
78/90 typo repair, 250/360 human contextual top-1 and 279/360 top-3; unknown-context
scores are 245/360 and 274/360. Authored noisy swipe top-1 at noise 0.22/0.38/0.50
is 32/27/23 of 40; top-3 is 39/37/30. Inputs and acceptance criteria were frozen
before results (manifest SHA-256
`57a63e97e01ea67a8c4216e70f35a43ba212419dde998a3037d61c86fbd543a4`).
The recorded subset is selected from development data and excludes previously
reported passage words; it is not a new held-out human test. Contextual candidate
seeding and expanding endpoint-key admission from eight to twelve both fail the
predeclared gain threshold: neither changes top-1 or top-3 totals. Both are
rejected, with production scoring and final human verification untouched. The
opt-in `BlindInputStressTests` runner enforces gains without new clean-literal,
typo-repair or top-three regressions; raw inputs and reports stay outside Git.

A second authored tap sweep freezes 60 development typos and 60 clean controls,
then 40 independent verification typos and 50 clean controls. Current rules repair
57/60 and 39/40, preserving all 110 clean literals. Remaining cases are `desicion`
(outside the search bound), `maintainance` (retrieved but low confidence), valid
`planing`, and ambiguous `My collegue` (both `college` and `colleague` are retrieved).
There are fewer than three safely repairable development misses, so no bounds or
confidence rules are changed. These authored scores are not real-use error rates.
The frozen typo-set SHA-256 hashes are
`c13df5b4da1bf57200411569e29004a5f45818a2d95a2d8df78f8e9d33f68806`
and `e7f1f338fd2c06fb9a68ce1e3f37a9e804a1facac367b0573f46e14d62a22e7e`.

Final verification after merging `dev` at `70a62ec7`: **188 KeyboardCore tests
in 18 suites**, plus **two PulpoServices tests**, pass in Release. The broad
**71-test iOS 26.5 native run** passes, followed by seven focused notched-phone
picker checks and **11 post-merge native checks** of the final grid, suggestions,
spacing, completion and correction undo. **Seven iOS 18.1 checks** pass for grid
geometry, safe areas, scrolling, accessibility, supported emoji and explicit
replacement/append workflows. All **20 Python tests** pass. The full standalone
keyboard **Release simulator build** succeeds with `PulpoKeyboard.icon`; both
modern layers and generated legacy rasters are verified, including the installed
iOS 18 fallback icon. The icon is referenced from the existing mobile asset and
is assigned only to the keyboard companion app.

One earlier concurrent run hit the existing 60 ms decode ceiling at 151 ms while
multiple benchmark suites and simulator builds competed for the host. Its
isolated retry passes at 3.2 ms; the full merged serialized run passes with a
5.8 ms maximum. `npm run keyboard:test` now explicitly serializes suites rather
than relaxing the ceiling. These host timings are not physical iPhone latency
measurements. No new physical iPhone build was installed in this iteration.

## Further iteration: typing confidence and native input

Blind evaluations now include clean literals as well as intended corrections.
One frozen 140-case audit improves exact correction from 78/90 to 80/90 and
literal preservation from 44/50 to 49/50. A second 80-case audit retains 29/32
corrections while improving literals from 37/48 to 46/48. A separate 218-token
clean corpus improves from 215/218 to 218/218. These are authored probes, not
measured human error rates. Unknown title-case name protection deliberately loses
some unassisted name-like typo recall; directed touch evidence can still permit
correction. Initial names such as `Tre` and `Teo` remain difficult cases.

The correction changes preserve real edit costs when a correction duplicates a
completion, require the strongest eligible alternative to justify changing a
literal, recover familiar short words with a missing interior vowel, and protect
uncertain chat tokens. Three-letter search now admits the existing first-key
adjacent substitution cost of 4.4, recovering examples such as `yhe` and `jow`.
Frozen nonword retrieval improves 64/75 to 66/75; two additional held-out sets
retain their correction scores, with no new changes across 156 literal controls.
Wider two-letter searches were rejected after changing `qa`, `ty`, `mc`, and `mi`.

The trigram reader and builder also reserve a nonzero backoff probability:
quantization previously made 72 histories assign all mass to stored successors,
collapsing omitted words to the same probability floor. Aggregate next-word
top-1/top-3 totals on 395,187 held-out conversation cases remain 84,587/137,406;
this repairs confidence ordering rather than establishing a prediction gain.

The literal vocabulary adds 5,784 pinned ESDB spellings without adding static
prediction, correction, or swipe targets. A 571-word clean audit reduces unknown
spellings from 16 to six and unwanted replacements from two to zero. Among 3,787
generated unknown errors, exact correction changes 3,324 to 3,323: the accepted
noun `wold` can also be a typo for `would`. All 21 previous dictionary section
payloads are byte-identical. Provenance, filtering, license, and this tradeoff are
recorded in [LanguageData/README.md](LanguageData/README.md).

Native routing tests exposed failures beyond decoder scoring:

- Release coordinates and coalesced samples were lost; the decoder now receives
  the final endpoint, including fast gestures delivered in the release batch.
- Out-and-back paths contained in one move batch could remain taps until release,
  allowing the alternate-key timer to take the gesture. Intermediate departures
  now establish swipe ownership immediately. Actual key centers and pitch also
  trigger geometry refreshes; resizing cancels paths spanning incompatible frames.
  Dark appearance changes preserve active gestures, as do page-key slides.
- A redundant end-of-gesture length gate discarded recognized adjacent-key swipes
  such as `we` and `as`. Looping gestures and ordinary small tap rolls have separate
  regression controls.
- Held Shift could stay active after sliding, rolling, or cancellation. Terminal
  paths now release the original modifier owner.
- Multi-step edits could read stale host snapshots. A bounded one-second cache of
  exact own-edit snapshots preserves composition and undo while distinguishing
  selection and cursor changes. An external same-document edit that exactly
  matches a recent own snapshot remains intrinsically ambiguous during that window.
- Different fields could match those snapshots and inherit word undo or spacing.
  A hidden field containing `secret` could lose five characters on one Backspace.
  Document identity changes now reset that state. Native verification additionally
  caught UIKit returning a nil document ID during startup despite its nonoptional
  Swift signature; the adapter reads it optionally to avoid a UUID bridge trap.
- Context loss with an unchanged document ID could likewise retain destructive
  word undo. Explicit privacy changes and distinguishable visibility transitions
  now invalidate it. Bounded raw optional snapshots preserve ordinary nil-at-empty
  cursor edges, first-word tap evidence, swipe alternatives and reentrant own edits.
  Loss of context that exactly matches a recent natural-nil snapshot without any
  identity or privacy change remains indistinguishable from host lag. The code
  preserves lag behavior in that case; universal context-loss detection is not claimed.

A context-only real-word transposition proposal was rejected even after passing
686,089 clean-token controls: it changed legitimate `too sacred` into `too scared`.
That counterexample shows why a large clean corpus alone cannot establish semantic
safety. The branch retains the requirement for directed touch evidence before
automatically changing ordinary valid words.

Accepted-code verification for this iteration: **128 optimized Swift tests in
13 suites**, **61 iOS 26.5 simulator tests**, and **17 Python tests** pass. The
native pass includes the installed extension, the five reported target words,
rolling and coalesced touches, Shift, page slides, geometry changes, and typing.
One earlier UI runner was terminated with SIGTERM during popup capture; its
isolated retry and the complete final 61-test run both passed. No raw evidence,
downloaded corpora, recordings, result bundles, or device artifacts are committed.
The standalone native keyboard's Release simulator build also succeeds. This
iteration has not installed a new build on the physical iPhone.

An additional isolated app-hosted native callback suite passes five test methods:
816/816 cases match direct-engine entered text and displayed top-three candidates
with identical delivered coordinates. These comprise 432 authored swipes and 384
recorded-path deliveries (372 swipes and 12 correctly recognized tiny taps).
All 804 recognized swipe paths retain exact sample counts and coordinates within
1e-6 point across individual moves, coalesced batches, batched release, and batched
move/release delivery. Another
1,248 tiny tap-roll controls and 48 word insertions across consecutive sequences
pass, including ignored concurrent contacts and terminated stray cancellations.
Initial alternative-only differences on `as`/`we` came from sub-ULP coordinate
roundtrips near a hard length threshold; exact delivered-coordinate comparison
resolves them. No epsilon or production source change was made. These are synthetic
UIKit callback tests, not physical OS timing/coalescing or the user's finger traces.

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

The new `recordedSwipes` harness mode preserves all 7,736 raw samples and their
timestamps for these same 100 cases, with absolute replay deadlines and explicit
submission-lateness diagnostics. Raw-path Pulpo scores **76/100** before and after;
the observed live Gboard result is also **76/100**. However, **37/100 gestures fail
the preregistered timing tolerance** (per-gesture p95 lateness at most 8 ms and
maximum at most 32 ms). Across events, p95 lateness is 11 ms and maximum 219 ms.
Android injection IPC sometimes stalls. No cases were removed: compliant gestures
score 48/63 and noncompliant gestures 28/37. This run is retained as a diagnostic,
and cannot establish strict original-time parity. Original requested duration is
152.775 seconds overall, with median .9655 seconds per gesture. The preparation
tests ensure that timestamps remain paired with the correct spatial samples,
including revisits to the same coordinate; the existing uniform replay geometry
is unchanged.

### Follow-up from the user's swiped passage

The reported substitutions were `well → will`, `types → asphalt`, `best → breezy`,
`friend → friends`, and `the → Tré`. The user confirmed mostly swiping. Actual
touch paths and device personalization state were unavailable. A fresh investigator
froze 680 word/context/path cases before reading scoring code. All five words
decode correctly with centered and mild noisy inputs in the intended contexts.
A centered `types` path cannot admit `asphalt`: their initial keys are about 3.64
pitches apart. Thus these results do not establish the cause of every reported
failure. An installed-extension test now checks the five words with visible key
geometry and their immediate sentence contexts.

The investigation exposed endpoint candidate loss under drift or shortened lifts.
The intended key could fall outside the nearest four even when the entire path
fit it well. Endpoints now admit the nearest eight within 1.75 pitches, retaining
the 6,000-candidate budget. An admissible endpoint-error bound skips hopeless
candidates before interior alignment; ordered results and scores are checked
against unrestricted scoring. Full integration caught nearly stationary touches
being admitted as short words. The existing minimum path/template length ratio
of .5 now applies to short templates too, with tiny-wobble checks at every key
and explicit short adjacent-word controls.

| Same frozen inputs | Prior integrated top-1 / top-3 | Wider endpoints with safety guard |
| --- | ---: | ---: |
| Human development, 3,000 | 1,988 / 2,202 | 2,004 / 2,238 |
| Human verification, 3,000 | 1,928 / 2,152 | 1,953 / 2,192 |
| Dictionary-known verification, 2,774 | 1,921 / 2,142 | 1,946 / 2,182 |
| Fresh authored cases, 680 | 587 / 622 | 609 / 654 |

Verification has 32 first-choice gains and seven losses, including `morning →
Niebuhr`, `you → thou`, and `unique → unguarded`. No outputs were excluded.
Additional legitimate-competitor and pinned-`Tré` controls improve 140/176 to
144/176 with no added first-choice losses. Two severely shortened `types` probes
remain wrong. One development `we` trace moving only about .10 pitch is now
declined by the safety rule; it would not meet native swipe activation either.

The standard rounded 500-case probe loses one top-three result (482 to 481),
while a separate 3,000-path rounded audit gains four first and four top-three
results. A paired alternating-order Mac benchmark measures median .696 to
1.183 ms and p95 1.952 to 2.200 ms. Physical iPhone timing remains unmeasured.
Relative to `19937ca3`, frozen human verification improves from 1,894/2,119 to
1,953/2,192 first/top-three choices. The final 65.10% first-choice result still
leaves a substantial accuracy gap; it is not evidence of world-class performance.

Sentence-start contractions remain a separate model weakness. The bounded initial
history retains only 48 successors and about .65 of its quantized observed mass.
Frequent omitted words can receive a severely discounted prior: an ideal `she's`
path can lose to `she`. Apostrophe tokenization and dictionary lookup were checked;
the training data contains the contraction. Three broad probability-redistribution
experiments were rejected after reducing held-out validation prediction quality.

A 256-successor initial-history proposal improved frozen contraction probes from
936/1,440 to 1,143/1,440 and improved recorded sentence-start verification. With
the new endpoint decoder, verification heads improved 485/537 to 494/543
first/top-three choices across 718 gestures from 206 participants. Development
had already missed its original strict top-three criterion by two cases before
the endpoint combination; that tradeoff was disclosed.

The proposal was nevertheless **rejected** after another independent clean-path
check. Across 780 unique recorded sentence-head target spellings, centered first
choices declined from 625 to 609 (17 losses and one gain), including `dose → does`,
`seven → even`, `note → nope`, and `leg → let`. The new capacity merely moved the
probability cliff to other words. Sentence-start Mac median/p95 decoding also
rose from 1.411/2.606 to 1.835/3.202 ms. The candidate builder, extra test and
dictionary activation were reverted; the shipped sentence-start table remains
unchanged. Positive average human results and a corrected demonstration passage
were insufficient grounds to accept these new clean-input failures.

### Additional bounded calibration experiment

A further isolated fit kept the accepted search and rejection rules fixed and
calibrated positive shape, path-length, and language multipliers. Development
participants were split before results into 2,279 training gestures from 625
people and 721 validation gestures from 209 different people. A bounded search
and regularized fit used training only; one selected candidate reached validation.
It improved training first choices by 32 but improved actual production validation
only 472 to 474, below its preregistered minimum gain of eight. Top-three validation
improved 525 to 532. The candidate was rejected; final verification was untouched.

An initial offline comparison incorrectly used lowercase surface forms instead
of the benchmark's accent/apostrophe-normalized keys. The corrected baseline
reproduces the accepted 2,004/2,238 development first/top-three totals exactly.
All 3,000 direct-decoder top-five arrays and scores match at limits five and 100;
feature sums reproduce scores within 1e-6. The unchanged candidate's direct and
offline validation first/top-three outputs agree on all 721 cases after correction.
No scoring defaults, training artifact, or runtime dependency from this experiment
entered the branch.

A separate blind investigator froze 3,230 additional controls spanning 1,242
words before inspecting decoder results. With case and accents folded but
apostrophes retained, baseline first/top-three results are 1,562/1,657 of 1,696
clean paths, 922/978 of 999 offset paths, 187/251 of 413 rounded stress paths,
and 106/121 of 122 loop paths. These independently generated rounded paths expose
substantial remaining weakness; their severity differs from earlier synthetic
profiles, so the rates are not interchangeable. All 60 absent targets and eight
known one-point/no-motion cases remain in overall totals of 2,777/3,007 of 3,230.
Production lookup-key matching would count 2,791 first choices because it also
removes apostrophes; that conflates words such as `well` and `we'll`, so the
stricter 2,777 total is retained here. No calibration candidate reached this
blind control gate. Frozen corpus SHA-256:
`4aa29667f9bccef06d4c622d5a94d9c8a7140d873bc6668a859061e5898c5d82`.

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
