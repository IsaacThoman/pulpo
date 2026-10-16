# R15 parent decision: REJECT

The narrow path policy has useful literal-preservation gains. Publication is
rejected under the experiment's unchanged strict ordinary-regression gate:
post-review inputs produce **four previously passing ordinary-document losses**,
two each in English/bilingual; Spanish is unchanged. The rejected production
predicate and its candidate-dependent tests are archived, never imported into
runtime source or compiled test discovery.

The original frozen experiment remains **EN 21→31/44, ES 31→31/44,
bilingual 27→37/44**, with zero passing-case losses in that workload. The exposed
four-template diagnostic is **EN 4→2/4, ES 0→0/4, bilingual 4→2/4**. In EN/BI,
`say //` + `teh ` loses `the`, and `/tmp/file;` + `teh ` also loses `the`.
Space/newline after a path restores correction unchanged. All twelve observations,
expected documents and original suggestion/learning records are preserved in
`post-review-diagnostic/` without logs. Its hashes identify preserved result
bytes, not an independent pre-inference freeze or fresh heldout.

The independent reviewer initially leaned toward retaining these as documented
anchored-syntax ambiguities: `//` can introduce a root path and semicolon is legal
in a Unix filename. The parent instead applies the predeclared zero-ordinary-loss
gate strictly. These are actual failures against the supplied ordinary oracles;
neither interpretation changes their scores. No post-reveal tuning occurred.

## Read-only validation

```sh
python3 apps/keyboard-ios/audits/technical-preservation-r15-parent/validate.py
python3 -O apps/keyboard-ios/audits/technical-preservation-r15-parent/validate.py
```

`--audit-dir PATH` selects a different original/curated R15 audit directory.
Optional complete new candidate reports can be compared without timing:

```sh
python3 apps/keyboard-ios/audits/technical-preservation-r15-parent/validate.py \
  --candidate-report development=/tmp/new-development.json \
  --candidate-report heldout=/tmp/new-heldout.json
```

The validator rejects duplicate JSON keys, nonfinite numbers, missing/duplicate/
unknown ID×mode pairs, unsupported modes/fields, wrong static metadata, stale or
non-Boolean pass flags, malformed suggestions/learning/calibration/timing, and
private-field learning/calibration. Every split must contain precisely its input
IDs crossed with `en_US`, `es`, `en_es`. It derives the original summary afresh and
checks recorded hashes. Optional replay comparison checks automatic output,
alternatives, proposal, learned list and touch weight; timing is ignored.
The program writes no files, including on failure, and uses explicit checks rather
than Python assertions.

Curation verification ran 46 temporary-file checks: 44 malformed-report rejections
and two successful reordered/timing-varied/static-metadata comparisons, covering
both normal Python and `python -O`. Cases included missing/duplicate/unknown IDs,
wrong modes/static metadata/oracles, stale/non-Boolean flags, unavailable fields,
private learning/calibration, malformed alternatives, nonfinite/overflowing
numbers, changed raw references and duplicate JSON keys. Audit and temporary-file
hash snapshots confirmed the validator wrote no files. Python/archived Swift
syntax, frozen patch applicability and scoped Git whitespace checks also passed.

All input metadata is schema-checked and bound through declared input hashes.
Fields actually present in a report are compared to those inputs; an optional
complete `input` object is checked exactly. The original report schema does not
embed before/selected/after/typed and other editing metadata, so output alone
cannot independently prove execution used those inputs. `rawExpected` remains a
**recorded reference**: flags are recomputed by exact equality and references must
match between paired/optional reports. This is not a general independent raw
capitalization or smart-punctuation oracle. All disclosed original oracle defects
remain failures.

Original `audit.md` hashes resolve to the verbatim `agent-audit.md`; source-test
hashes resolve to archived `.swift.txt` files. Candidate engine bytes are
reconstructed in memory from the published-ancestor frozen base and exact patch,
checking context and hunk counts. Dictionary hashes use that base's immutable Git
blobs. No unpublished `ce44c06b` object is needed for these checks. External raw
`/tmp` report hashes are checked when present; missing references are listed
explicitly and never claimed verified. Hashes establish preserved bytes, not
author noninspection, execution count or provenance truth.

## Portable opt-in replay

`reproduce.py` exports the frozen base into two external temporary source trees,
applies the patch only to one, and installs only the identical opt-in replay
runner. It can replay development, revealed heldout and exposed diagnostic:

```sh
python3 apps/keyboard-ios/audits/technical-preservation-r15-parent/reproduce.py \
  --output /tmp/pulpo-r15-reproduction
```

Requires Python 3.12+, macOS and compatible Xcode/Swift. Source exports, package
builds, logs and reports remain beneath the new external output directory. This
script is syntax-checked, not executed during curation. Replays are exposed
historical checks, never new blind evidence. Candidate-dependent focused tests
are retained as uncompiled source history; native execution was unavailable in
the original experiment and is not established by compilation or this replay.
