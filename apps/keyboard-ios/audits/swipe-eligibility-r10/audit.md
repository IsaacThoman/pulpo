# Spanish/bilingual swipe eligibility round 10

Retain production unchanged. This round establishes **no accuracy gain**. It adds
new frozen synthetic controls and an independently authored heldout, with exact
full-document scoring and explicit engine separator state. Development is 128/128
swipe observations and 8/8 literals; heldout is 124/128 and 7/8. No candidate was
selected, and no production compiler, data, decoder or privacy behavior changed.

## Freeze and independent authorship

Base: `c0b3ca3b`. Isolated branch `t3/spanish-swipe-accuracy`; no push, deployment,
mobile/device actions or shared source edits.

1. `3db4cef5` froze 32 development swipe scenarios, eight literals, full-document
   expectations and protocol before compiler/decoder inspection or reading the
   prior R7 method-failure audit. Prior targets were read only as exclusions.
2. Independent author task `pr782-r10-independent-heldout-author` used a separate
   checkout based on `3db4cef5`, without parent history/candidate findings. It
   returned only artifact identity and counts, never targets or outcomes. Author
   commit `61c2758f16d399891bd2a651fd5cb85455981f4e` remained unread until freeze.
3. `7430e59f` froze the production-engine runner and clarified API mechanics
   before baseline: core exposes `insertGlide`, not gesture begin/append/end;
   a trailing separator is initially owed via `phantomSpace`. Primary success
   requires raw document == context + target, owed space == true, and exact full
   document after normal `engine.insertSpace()` == expectedDocument. The scorer
   does not append/trim spaces. A separate `hello` smoke test verified mechanics.
4. `124cb289` froze no production candidate, all source/runner/input/report hashes,
   coverage evidence and baseline timing before any heldout import/read/inference.
5. `e78d41bd` imported the independently authored heldout. Heldout ran **once**,
   filtered to `SwipeEligibilityRound10Tests.frozenSweep`, producing all 128 swipe
   rows and eight literal rows. Nothing was tuned or rerun against heldout.

Input SHA256:

- Development: `0641ee7d069b8e82c2f862eb32316bc2cddfc0510ac248bb0c89f95ab3a3c547`.
- Heldout: `ab7466440909dd944f52ae1880fb36f58f9b8c7ff11600a6b9a84e7d02b9427a`.

Both splits have 16 Spanish, eight bilingual and eight English swipe targets.
Case/accent-folded dev/heldout, dev/old-R7 and heldout/old-R7 intersections are all
zero. Each split has eight literal safety cases, separately scored. These are
independent agent-authored tasks, not independently recruited human samples or an
exhaustive exclusion against all existing tests. Author noninspection is attested.
`protocol-provenance.json` records the original author protocol and pre-baseline
runtime clarification; input expectations did not change.

## Exact accuracy, coverage and every failure

Development: Spanish 64/64, bilingual 32/32, English 32/32; total **128/128**.
All 32 targets have exact dictionary membership and valid glide eligibility.
Exact target is in the engine's returned four candidates and visible three in
128/128 observations. All eight literal cases pass: ES 3/3, bilingual 3/3, EN 2/2.

Heldout: Spanish 60/64, bilingual 32/32, English 32/32; total **124/128**.
All 32 targets are exact members and valid glide-eligible, and appear in returned
four and visible three in **128/128** observations. There are **zero OOV** and
**zero case/accent-only variant failures** in either split. All remain in the
primary denominators; nothing was dropped or reclassified as success.

All four failed swipe observations are `r10h013`, target `silla`, in all four
profiles. Expected raw document ends `Hace falta una silla`; actual ends
`Hace falta una sola`. Returned candidates are `sola`, `silla`, `sillas`, `aula`.
The target has frequency 131, flags 2; it is present and eligible, not a compiler
coverage miss. The explicit engine delimiter materializes the wrong word's space.

Heldout literal safety is **7/8**: ES 3/3, bilingual 3/3, EN 1/2. The sole miss,
`r10h037`, typed `/tmp/notes.txt ` after `The export is ready. Save it to `;
actual full document is `The export is ready. Save it to /tmp/notes.text `.
This is a real literal preservation failure, retained without post-reveal tuning.

Per profile: development 32/32, heldout 31/32. However, independent review found
that pixel width scales out of the normalized generator: the ideal width pair
and jitter width pair are equivalent apart from floating-point rounding. Thus
there are only **two path families**, not four independent geometry conditions.
The frozen 128-execution denominators remain; unique targets score 32/32 dev and
31/32 heldout. Counting each target/path family once gives 64/64 and 62/64.
No width, human-swipe or live controller robustness claim is supported.

`baseline-dev.json` and `baseline-heldout.json` preserve every case/profile's
actual raw/final document, owed space, lookup variants/flags/frequencies, engine
candidates, visible slots and timing. `summary.json` aggregates all failures.
`summarize.py` reproduces summaries from stored output without inference.

## Compiler and data evidence

All compiled glide IDs match the flags exactly and occupy the correct endpoint
bucket, with no duplicate/missing IDs. Bilingual merge loses **zero** source glide
flags. Spanish has 235,998 valid entries and 182,561 valid glide entries. Its
53,437 valid exclusions comprise 52,624 below the frequency threshold, 808
uppercase and five short/non-ASCII keys. These exclusions alone do not establish
compiler defects; no development miss justified widening eligibility or changing
frequency, case or merge rules. Prior R7 targets were excluded, not hardcoded.

Full regeneration from the existing pinned AOSP Spanish archive and both pinned
Tatoeba exports into `/tmp/pulpo-r10-reproduced` reproduced `es.pkdict`,
`en_es.pkdict` and contributor attribution **byte-for-byte**. Corpus text stayed
outside the checkout. `resource-identity.json` contains sizes/hashes. English
`en_US.pkdict` SHA256 remains
`168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64`;
`en_US.validwords.txt` remains
`271ef667373f216e12a3eea5a992f52499c90190de21cafd98b5b4c6175d27bb`.

A post-freeze structural diagnostic and independent review also found **57
bilingual entries carrying both neverSuggest and glide**; monolingual overlaps
are zero. Merge unions both flags; bucket generation indexes glide entries;
the decoder's endpoint loop checks personal blocking but not neverSuggest.
This establishes a pre-existing scoring path, not an observed suppressed output.
Existing flag identity and bucket integrity therefore do not establish runtime
suppression safety. No frozen workload exercises that overlap. The small
`post-freeze-suppression-diagnostic.json` records the finding without inference,
word lists or a proposed fix. A new independent safety workload is needed before
claiming a suppression improvement; this heldout is now revealed.

## Timing and acceptance limits

Release arm64 macOS host, ContinuousClock, bundled dictionaries, no devices.
Learning is disabled for these controls and personal state is checked empty.
Warm observations reuse the same explicitly warmed language stack; each gets a
fresh engine/document. Setup/context work and actual `insertGlide` are timed
separately. Target-specific work remains in the measured call. The final space
delimiter, membership reporting, serialization and UI/proxy latency are excluded.

Warm gesture median / nearest-rank p95 / max, milliseconds:

- Development: 1.587 / 2.399 / 2.668, n=128.
- Heldout: 1.446 / 2.062 / 2.480, n=128.

Frozen cold measurements use three separate process launches per language and
report construction separately from engine setup + **first inference**, including
lazy model work. They are process-cold, with potentially warm OS file caches.
Construction median; setup + first gesture median / max, milliseconds:

- Spanish: 0.266; 1.990 / 2.114, n=3.
- Bilingual: 1.201; 3.001 / 3.013, n=3.
- English: 1.146; 1.275 / 1.392, n=3.

Review identified missing PID/output provenance in the frozen cold report. It is
retained unchanged. A supplementary **development-only**, post-reveal run using
`run_cold.py` records nine separate invocation PIDs and exact one-test output,
excluding the smoke test. `post-reveal-cold-provenance.json` labels these additional
observations explicitly; they do not replace baseline or rerun heldout.

Baseline absolute warm/cold ceilings are met under those host boundaries. There
is no candidate-relative latency measurement, no device latency/memory result,
and no claim that constructor time alone measures readiness. Acceptance fails:
no development gain/candidate, no paired heldout gain, and the heldout literal
gate fails. EN gesture results are 32/32 in both sets, but these are unpaired
baseline sets, not evidence of a candidate's EN nonregression. Unchanged source
establishes zero production changes, not measured improvement.

## Validation and cost

- `swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release
  --filter SwipeEligibilityRound10Tests.boundarySmoke`: pass before baseline.
- Full release package, `swift test --package-path
  apps/keyboard-ios/PulpoKeyboardKit -c release --skip-build`: **438 tests in 64
  suites pass**, five existing known issues: three multilingual completion
  assertions and two host-reversion ambiguity reproductions.
- `python3 -m unittest discover -s scripts -p 'test*data*.py'`: **11 pass**,
  including pinned assets, reproducible merge, ID/trie ranges and language data.
- Full pinned Spanish+bilingual regeneration: identical to bundled outputs.
- Post-reveal identity verification: all frozen source objects and runner,
  protocol, development/report hashes unchanged; heldout hash matches seal.

The opt-in benchmark test asserts completeness and empty personal state, not
quality acceptance; its test-pass status does not hide the reported failures.
All new files are test/audit artifacts, roughly 180 KB total. Runtime asset size
cost is **zero bytes**; no generated binary or raw corpus is committed. No
production candidate or compiler change should be cherry-picked from this round.
The independent review response is recorded in `review-response.md`.
