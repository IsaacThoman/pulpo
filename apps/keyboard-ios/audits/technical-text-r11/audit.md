# REJECT R11: retain the production baseline

Reject candidate `858225da`. Its broad dot/slash predicate causes four previously
passing ordinary-document regressions in the exposed post-review diagnostic,
and intended automatic spelling correction falls from **48/48 to 36/48**. No
runtime source, asset, compiled test target or normal regression test is imported
here. The patch and candidate-dependent tests are historical, uncompiled artifacts.

The original experiment remains useful evidence: development **48→63/68** and
independent heldout **27→30/40**, with 15 and three gains and no regressions in
those frozen sets. The candidate protects actual filenames, path segments and
options using general syntax rather than word/extension exceptions. The rejected
rule treats every dot/slash-containing whitespace token as literal, however,
removing useful ordinary correction and alternatives in ambiguous prose too.

The post-review set was frozen before either diagnostic execution. Its **56
exact full-document outcomes are 37→44**, comprising 11 gains and four losses:
`a/teh ` becomes `a/the ` on baseline but remains `a/teh ` on candidate in English
and bilingual modes; `útil/inportante ` similarly loses `importante` in Spanish
and bilingual modes. These are two language examples repeated across two modes,
not four independent population samples.

Eight ASCII-ellipsis/unspaced-sentence cases incorrectly expected capitalization
that neither version supplies. **Their original oracles remain unchanged, and
all eight remain exact failures.** Baseline nevertheless corrects their spelling;
candidate loses that correction as well. The separately labelled 48→36 spelling
diagnostic compares final automatic correction with the frozen intended word
case-insensitively, without folding accents; it does not replace exact scoring.
Unicode ellipses, spaced sentence dots, 12 marker deletions, eight caret moves and
four selection transitions retain correction. Four literal file and four option
cases gain; three further gains preserve a path before subsequent ordinary prose.
Every original output and per-key suggestion snapshot is retained.

## Scope and provenance

All **108 original benchmark cases use `en_es.pkdict`**. Their EN/ES labels
describe content, not separate dictionary modes. The original argument-driven
policy tests exercise all three modes separately; they do not establish universal
benchmark gains. Heldout ordinary safety is weak: seven of eight ordinary-category
cases insert immediately before a following word, encountering existing correction
suppression. Its 1/8 exact rate and 3/11 ordinary-intent rate remain counted.
Development dedicated ordinary controls remain 14/16; the broader ordinary
category is 16/19, while ordinary intention is 14/17 because two code-switch
preservation cases carry literal intention. Private learning checks remain counted.

The original full protocol/input/report hashes match the captured bytes. The
heldout draft→final change consists solely of 11 `intention` enum mappings;
targets and oracles are identical. Separate author tasks and their noninspection
attestations support independence, but timestamps/hashes alone cannot prove
noninspection or a single execution. Raw-adapter checks are 68/68 development and
39/40 heldout; secure-field capitalization failure h38 is retained. The known R10
path replay is separate regression evidence, excluded from fresh denominators.

Original native controller tests compiled but were not executed in that sweep.
Single-run mixed cold/warm key timings establish no performance acceptance.
The [original agent audit](agent-audit.md) is preserved verbatim as historical
evidence; its retention decision is superseded by this rejection.

## Reproduction and preservation

Published production baseline `e1865f3f` and original baseline `e9f5d6bb` have the
same KeyboardCore Git tree, `9461e76ced19b360c20449e42536a64ae0c8d4c4`.
[reproduce.py](reproduce.py) exports temporary copies of that published source,
applies the rejected patch only to the temporary candidate, installs the identical
captured opt-in runner there, and can replay the original sets and diagnostic:

```sh
python3 apps/keyboard-ios/audits/technical-text-r11/validate.py
python3 apps/keyboard-ios/audits/technical-text-r11/reproduce.py --output /tmp/pulpo-r11-reproduction
```

Reproduction requires Python 3.12+, macOS, Xcode/Swift compatible with this package,
and the published baseline commit locally. It writes builds/results only under the
requested external output directory. It was syntax-checked, **not rerun during
curation**. The diagnostic's captured commands describe the original cache-linked
execution; the new script avoids dependence on those disposable caches.

[manifest.json](manifest.json) records exact stored and decompressed SHA-256
values. Gzip uses a zero timestamp; original JSON/protocol/audit/source bytes were
copied without rewriting. No libraries, executable clients, downloaded corpora,
build caches, logs, screenshots or xcresults are versioned. Captured diagnostic
hash metadata refers to external libraries/binaries only to identify that run.

This diagnostic is exposed post-review evidence, **not blind or fresh heldout**.
Any narrower experiment must be separate, use these cases only as development
controls and obtain a fresh independent heldout. No tuning of frozen R11 occurred.
