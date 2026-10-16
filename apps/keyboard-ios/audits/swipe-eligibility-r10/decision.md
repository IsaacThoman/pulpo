# Pre-reveal decision

Retain production unchanged. Development exact full-document/owed-space scoring
is 128/128 (ES 64/64, bilingual 32/32, EN 32/32), with literals 8/8.
All 32 target spellings exist and are glide-eligible. No coverage or ranking miss
supports a general data/compiler candidate; the development ceiling cannot prove
a gain. No thresholds, words, frequency scales, or merge rules were changed.

All glide flags have exactly one correct endpoint bucket entry in each asset.
Bilingual merging loses zero source glide flags. Spanish has 235,998 valid entries,
182,561 eligible. Its 53,437 valid exclusions split into 52,624 under the frequency
threshold, 808 uppercase and five short/non-ASCII keys. These counts do not prove
the exclusions are defects; widening them without development evidence would
change the candidate pool speculatively. The previous R7 miss is not fresh evidence.

The pinned AOSP and both Tatoeba archives are available locally with their expected
SHA256 values. Full regeneration into /tmp reproduced Spanish, bilingual and
attribution bytes exactly. English files remain byte-identical. Suppression and
privacy flags remain unchanged. Asset cost: zero.

Release core: 438 tests, 64 suites, five existing known issues. Python data/compiler:
11 tests pass. Development warm gesture p95 2.399ms,
max 2.667ms. Cold timing has nine fresh-process samples, three per
language, and explicitly captures setup plus first gesture, separately from
construction. No candidate-relative timing or accuracy claim is made.

freeze.json records the production objects, runner, reports, protocol, development
input and sealed independent heldout hash. Freeze this decision in a commit before
importing or reading heldout inputs. Run the heldout once; report every failure.
