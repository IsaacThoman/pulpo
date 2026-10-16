# Parent disposition: retain rejection evidence only

Imported only the final audit commit as `d024ce45`. No candidate, restoration or
production code was imported. All six current production before-images still
match the original baseline, the inactive patch passes `git apply --check`, and
all 153 original retained artifact hashes match. The historical archive and its
failed source/smoke results remain unchanged.

The parent separately compiled the immutable baseline and candidate
EmojiCatalog.swift files with the same small public search client. On macOS
27.0.1/Swift 6.4, both compile/run exits are zero. Foundation locale lowercase
turns input UTF-8 `[65,0,66]` into `[97]`; the baseline returns `[]`, while the
candidate returns `["L"]`. Under the frozen policy the single ASCII token
requires baseline-only output. `parent-validation/` retains the exact client,
source bytes, pre-execution intent, complete raw outputs and binary hashes.
Successful build logs were not read. This is one exposed source witness, not
an iOS run, latency measurement or execution of the larger sweep.

The decisive NUL counterexample, all 307 independent tokenizer mismatches,
three public-control failures, frozen ranking-failure extracts and complete
inactive six-file implementation are portable in the original archive. Full
569-row smoke, 66,366 legacy pairs, 1,134 public controls, 212 invariant-group
bodies and 44 semantic outputs remain externally stored with hash references;
do not call the packet a self-contained replay of every larger result.

The original inactive-source helper uses Python assertions for integrity and
before-image checks. Its normal-mode verification is valid, but optimization
removes those checks. `parent-review/` preserves that original helper, the full
derived patch and a separately labelled helper with explicit checks. Parent
ran the derived helper normally and with `-O`: both verify all 153 retained
hashes, six inactive sources, exact current before-images and patch applicability
without applying it. The independent helper receipt retains fourteen rejected
corruption probes in addition to four valid-mode checks. A bytes checker does
not establish source correctness or utility, and neither helper changes any
frozen source, fixture or result.

R46 is a new correction and validation round. It must retain the R40 source
defect, invalid ranking expectations and unrun blind/native/cost gates as their
original outcomes. Neither exposed development gains nor preservation of the
English prefix admits this rejected implementation.
