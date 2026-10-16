# REJECT R19; production remains unchanged

Reject the tighter anchored-path grammar. Three ordinary-intent diagnostics lose
previously working correction in EN and bilingual: **six passing-case losses**.
Spanish retains those documents but loses ordinary learning, producing **nine
changed ordinary states** across all three modes. The candidate was rejected and
production restored before the sealed reveal. No later aggregate gain can reverse
that decision; no post-reveal policy tuning or relabeling is accepted.

The reviewed final worktree's complete production Sources and LanguageData trees
match both baseline `c4a354f3` and the parent tree at curation. Its engine SHA-256
is `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`.
No runtime source, registered tests or assets are imported here. The rejected
patch is text only; the replay runner is archived as `.swift.txt` outside discovery.

## Preserve favorable and failed evidence together

The exposed original/state development sets remain **76→104/126**, 28 gains.
Reviewer diagnostics remain **53→47/63**, six losses: `/and/` prose and anchors
regained inside `//(./` and `//(/tmp/` comments preserve `teh` instead of correcting
to `the`. All **189 exposed rows per engine** remain **129→151**, with 28 gains
and six losses. The positive net score does not satisfy the ordinary/safety gate.

The sealed set remains **47→71/105**, 24 gains with no new passing-row losses in
that set: EN **17→24/35**, ES **20→25/35**, bilingual **10→22/35**. This is
characterization of an already rejected grammar, not evidence of acceptance.
All **24 ordinary rows** pass on both engines. The author reused only two fresh
typo/target pairs, so 35 templates crossed with three stacks do not represent
105 independent linguistic tasks.

All **12 sealed safety rows are unaccepted on both engines**. Seven unsupported
nested `expectState` assertions generate **21 schema-error occurrences per engine**.
The runner still executes all 105 rows, but successful report generation and
observed private-state snapshots do not establish supported sealed privacy
acceptance. Total checkpoint/schema errors are **26 baseline / 24 candidate**.
The separately reported document-only **51→77/105** ignores those errors and must
not replace primary correctness. Reset and Undo disagreements overlap safety
failures; their 9 and 3 mode-row counts cannot be added as unique missing rows.
Every failed/unsupported row and original oracle is retained.

## Protocol and provenance qualifications

Author calibration used baseline public APIs with capitalization disabled, engine
recreation for reset and conditional Backspace Undo. The selected runner uses
normal capitalization, document/identity replacement for reset and unconditional
keyboard Backspace. Frozen original expectations were not repaired after reveal.

An additional parent review finding remains unresolved: authorship declares
contract hash `36f6df723912a2e160626015141e155e7ea5f5cb5ac8ea0f48c8350d688efa94`.
The committed initial contract (`initial-committed-contract.md`) hashes to
`54892ce7abcbf2feb65f8fa04f7f86df80dcca56f0e5570b3560c5b88cfbb7c2`, and
the expanded selected contract hashes to
`c60f613b8c301ab6f435afc1e9674f7c78653939275ceefd47b22be8e7538949`.
Neither is the exact contract the author reports reading. Both actual committed
versions are preserved with honest labels; the missing declared version is not
invented or treated as verified. Independent authorship/one-reveal claims remain
attestations subject to these interface and calibration limits.

Private-transition absolute-zero expectations can fail because prior public
learning remains; delta observations are separate. Intermediate components and
alphabetic filename subfragments can still learn through existing branches.
There is no path-wide/final-component nonlearning claim or native candidate
acceptance. Final restored package **439 core + 3 service**, five known issues,
and **11 data checks** are preserved reported results, not rerun during curation.

## Artifact verification

```sh
python3 apps/keyboard-ios/audits/technical-preservation-r19/verify.py
python3 -O apps/keyboard-ios/audits/technical-preservation-r19/verify.py
```

The bounded read-only verifier checks retained and declared frozen hashes,
metadata/input/runner/engine consistency for the ten official report files,
complete ID×mode sets, unchanged categories/expected documents, final-state
documents and primary correctness (`document equality AND no oracle errors`).
It recomputes official counts/losses/ordinary-state changes and checks paired rows
and recorded summaries. It preserves unsupported errors rather than repairing
their schema. Provisional runs remain byte-preserved history, not final-runner
evidence. Report state/metadata consistency cannot independently prove engine
execution, all checkpoint semantics, privacy behavior or author noninspection.

`manifest.json` records exact stored/decompressed hashes. All original files,
including the verbatim [agent audit](agent-audit.md), are preserved; large row
arrays/paired JSONL use deterministic gzip. No raw logs, caches, binaries,
xcresults or downloaded corpora are included. Historical `run.py`, `summarize.py`
and `gate.py` are report/reproduction artifacts, **not a sufficient future
acceptance pipeline**: they do not independently enforce frozen provenance and
the summary/gate trusts recorded correctness/errors. Reproduction requires an
isolated checkout with the archived runner installed; never apply the rejected
patch to the working production tree. No build, inference or device use occurred
during this curation. The production path-corruption issue remains unresolved.
