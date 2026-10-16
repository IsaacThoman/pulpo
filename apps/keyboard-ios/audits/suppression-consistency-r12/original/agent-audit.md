# R12 bilingual suppression consistency

Retain the single compiler candidate frozen in `candidate-freeze.json` before
one independent held-out reveal. No post-reveal production changes. The issue
is established by returned decoder results, committed full documents and engine
slots, not dictionary membership alone. Source/runtime inspection began only
after the protocol and development inputs were frozen in commit `7e4e7a56`.

The prior R10 finding was structural, with no emitted conflict demonstrated.
This round deliberately selects compiled flag conflicts and shared neutral
spellings. It is contract-targeted, not wholly implementation-blind. R10 and R7
targets are excluded; no R10 commits were imported. The independent author read
only protocol, exclusions and compiled metadata, never development outcomes or
the candidate. Its 144 cases remained sealed until the candidate freeze.

## Contract and correction

`build_language_data.py:268–279` marks offensive entries neverSuggest and excludes
them from glide. `build_multilingual_data.py:129–136` already preserves genuine
offensive suppression across exact shared spellings while allowing a valid
Spanish spelling to override an English typo-only flag. The union accidentally
retained the other source's glide bit. The correction clears glide inside that
existing genuine-suppression predicate. It changes no classification policy and
adds no per-word exceptions or runtime filter.

The selected rule operates on exact display spelling, not every entry sharing a
normalized path. Exact typed literals remain protected by Suggester.isValid;
personally learned entries are scored independently of bundled glide flags by
GlideDecoder. No runtime, learning, persistence, privacy or UI source changed.
English and Spanish dictionary bytes are unchanged.

Source suppression can include neutral senses of homographs (the development
conflicts include Spanish `lo`, for example). These spellings now lose bundled
glide eligibility in bilingual mode under the existing suppression contract;
monolingual availability, literal typing and explicit learning remain intact.
There is no contextual sense classifier. The neutral-control result below does
not establish that this tradeoff has no real-world vocabulary cost.

## Evidence and acceptance

Each split has 144 authored cases and 360 replay rows: 108 unlearned conflict,
108 learned-conflict, 54 neutral, 36 literal, 18 novel personal, 18 learning-off,
and 18 secure cases. Twelve conflicts per split repeat across three languages
as matched controls, not independent vocabulary samples. Each gesture uses three
frozen, distinct normalized paths; no width diversity is claimed. Development
and held-out targets are disjoint. Every raw result and miss remains available.

Bilingual unlearned conflict outcomes, each out of 36:

- Development returned target: 23 → 0; exact committed document: 20 → 0;
  target in engine slots: 23 → 0.
- Held-out returned target: 32 → 0; exact committed document: 29 → 0;
  target in engine slots: 32 → 0.
- No other suppressed entries were returned or slotted in those candidate rows.
- EN and ES unlearned outputs remain identical. These are bilingual conflicts,
  not necessarily suppressed entries in both source languages.

Preservation results, identical baseline/candidate:

- Literals: 36/36 exact documents on each split (69 normalized ASCII literals
  and three accented display literals across both splits).
- Learned conflicts: development 108/108 returned and committed; held-out
  105/108 returned and committed. The three existing misses are retained.
- Novel learned personal words: 18/18 returned and committed on each split.
- Neutral target returned: 54/54 on each split. Exact documents are 42/54
  development (EN 12/18, ES 18/18, bilingual 12/18), and 46/54 held-out
  (EN 17/18, ES 15/18, bilingual 14/18). No language/path subgroup regresses.
- Learning off: 18/18 returned and committed per split, with all personal counts
  unchanged. Secure: decoder returns all 18 personal targets per split, while
  engine glide is policy-disabled in all 18; no engine target/slots or learning.

There are no frozen acceptance-gate failures and no preservation regressions.
Some surviving alternative candidate lists change after suppressed entries are
removed: 26 development rows and 35 held-out rows change at any recorded output
field, including three learned-conflict rows in each split. Target preservation
gates still pass. Complete before/after alternatives are in the comparison files.
Overall target-document accuracy is not an appropriate aggregate objective here:
the intended correction deliberately stops committing unlearned suppressed targets.

## Every miss and unavailable category

`all-failures-and-unavailable.json` preserves full rows, expected/actual documents,
returned scores, engine results and slots; `per-case.csv` includes all 1,440
baseline/candidate rows, not just failures. All target-document misses, including
the intended suppression outcomes, remain in the raw reports:

- Development baseline: 60 conflict, 12 neutral and 18 secure misses.
  Candidate: 80 conflict, 12 neutral and 18 secure misses.
- Held-out baseline: 51 conflict, three learned-conflict, eight neutral and
  18 secure misses. Candidate: 80 conflict, three learned-conflict, eight neutral
  and 18 secure misses.
- Development neutral misses: EN `altos` becomes `Altos` on all paths; `pope`
  becomes `Pope` on paths 0/1 and `pure` on path 2. Bilingual `lady` becomes
  `lay`, and `piragua` becomes `pausa`, on all paths.
- Held-out neutral misses: EN `continua` → `continues` on path 2; ES `mores`
  → `motes` on all paths; bilingual `ficus` → `focus` on path 1 and `compute`
  → `computer` on all paths.
- Held-out learned conflict `mes` misses on path 1 in each language, becoming
  `Munger’s`, `mujeres`, and `muggers` respectively. All are unchanged.
- Each raw report has 54 dictionary-OOV rows, all deliberately synthetic personal
  words repeated across personal/privacy/secure paths. No unexpected missing
  exact-display conflict or neutral entries. OOVs were never removed.
- Secure engine rejection is an intentional API policy, recorded as unavailable
  for glide-document accuracy, with all rows kept. Rendered UI pixels, native
  devices and four installed AX checks were not observed. Slot results measure
  engine suggestion state, not actual onscreen rendering. Native tests were not
  rerun; the supplied parent baseline was 70 native passes.

## Costs and validation

The pinned monolingual input hashes are recorded in `development-freeze.json`.
Two independent candidate regenerations took 3.690 and 3.702 seconds and produced
identical SHA256 `62d70c17513c7d84403942815c391a93bbf0dac004992bd98f0f2b4d31d7f210`.
The independent reviewer also reproduced this output. Only WFLG, GLOF and GLID
payloads differ: 57 glide bits clear, exactly 57 IDs disappear, no IDs are added.
All spelling/ID/frequency/trie/ngram/shortcut/literal/metadata payloads are identical.
The 228-byte index-payload reduction yields a 224-byte aligned file reduction:
27,391,648 → 27,391,424 bytes. Asset growth gate passes. Reproduction from pinned
bundled inputs is documented in LanguageData/MULTILINGUAL.md.

Release harness compilation took 17.695 seconds. Observed decode warm p95:
development 17.298 → 15.109 ms; held-out 15.354 → 15.825 ms. The held-out increase
of 0.471 ms (3.1%) is retained and within the frozen bound. Combined-split p95 by
language: EN 17.604 → 16.266 ms; ES 14.722 → 11.110 ms; bilingual 12.953 → 11.212 ms.
Engine insertion p95 is recorded separately in summary.json. Three fresh-process
samples per language separate construction from first decode including lazy
initialization. Maximum first decode is EN 16.865 → 16.842 ms, ES 11.998 → 12.468 ms,
bilingual 12.132 → 12.154 ms. Candidate construction spans 0.261–1.235 ms for
ES/bilingual and 1.091–1.147 ms for EN. All timing gates pass.

These are host release timings with warm filesystem caches, not physical-device
latency or extension memory measurements. Fresh process does not mean cold disk.
Regression builds/checks overlapped portions of replay, so small timing differences
should not be attributed to the compiler change. Paths are authored synthetic
traces without human touch timing; correlated path replays do not multiply the
number of independent target samples. Neutral controls are metadata-selected
shared spellings, not a representative natural-language corpus.

Baseline and candidate: 436 core and three service tests pass with the same five
known issues (three multilingual prefix/correction cases and two external-host
revert ambiguities). Candidate: all 28 Python checks pass; baseline's 11 core/data
compiler checks pass. The six multilingual checks include full byte reproduction,
synthetic suppression/typo/accent separation, bounds, probabilities and hashes.
No device, deployment, push or parent-checkout edits were performed.

Independent source review approved retention conditional on these frozen gates.
It confirmed exact literal and learned paths and every binary payload invariant.
One nonblocking coverage gap remains: the synthetic accent fixture does not pair
a genuinely suppressed display with an unsuppressed accented sibling sharing its
normalized key. Exact-display grouping implements the correct separation; no new
candidate was introduced to address that test gap after freeze.

## Reproduction artifacts

The complete corpus, frozen path generator, Swift harness, build command, binaries,
baseline/candidate dictionaries, full results, cold samples, comparisons and logs
are outside Git at `/tmp/pulpo-r12-53439f72`. `artifact-manifest.json` records their
hashes and sizes, excluding the scratch Swift build cache. A persistent archive
is at `/Users/isaacthoman/.t3/artifacts/pulpo-r12-53439f72.tar.gz`.

`protocol.md`, `development-freeze.json`, `harness-freeze.json`,
`candidate-freeze.json` and `heldout-reveal.json` give the ordering and exact
protocol/input/source hashes. Held-out input SHA256 is
`65a4381ab8db65207e5008f6d0292017f976b8d4854e2bd7e217f89e1c569b04`;
authorship receipt SHA256 is
`e69b961b8f6137a1e6fabb410e00771acf6b5182ddff2cd1797f95c3c1daa521`.
