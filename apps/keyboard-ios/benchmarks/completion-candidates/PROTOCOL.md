# Blind completion candidate sweep: frozen protocol

Authored 2026-10-16 at PR #782 baseline 1dfe7134bdf5917a8a186b53e8d2d1083b740858, before reading implementation, tests, or prior audits. Original synthetic text; no corpus, outside licensing dependency, private messages, or network inference. This commit freezes the benchmark independently of measured behavior.

## Split and realism

Development and verification each contain 40 independent prompts in ten equally weighted groups. They model short everyday messages: plans, food, travel, coordination, work, and polite replies. Each split has 24 completion prompts and 16 next-word prompts. The development prompts may guide experiments; do not view verification outcomes until choosing the final implementation. Capture baseline verification output without displaying it, then compare it once at the end. Do not change accepted answers after seeing outputs. Report every case, including misses, and per-group results; do not pool away difficult groups.

Short prefixes deliberately compete with many plausible candidates. Ambiguous valid words include complete words, where extending a word is often unwanted. Invented unfamiliar names test honest lack of coverage; there is no supplied personal history, and inventing/hardcoding names is prohibited. Rare histories use novel combinations of familiar words, testing graceful fallback when phrase evidence is absent. Normalization cases include uppercase, decomposed accents, nonbreaking spaces, and curly apostrophes. These test readiness for multilingual text, not fluency in unsupported languages. No requirement to fabricate accented vocabulary missing from the default English dictionary.

These are deliberately small, balanced diagnostic sets, not representative language-model corpora, independent users, or estimates of production acceptance rates. Some contexts allow more valid replies than the frozen answer set. Phrase templates recur across splits, so verification is held out for selection but not a proof of out-of-domain generalization. Names differ completely. Preserve this limitation in reporting.

## Measurement contract

Score actual visible suggestion slots in display order, at most three, after running the same assembly path as the keyboard UI. Three is a preregistered cap, not permission to skip occupied literal/correction slots. Inspect the UI after freezing and adapt the harness to its actual slot count/assembly; document any discrepancy. Never score an unlimited retrieval list or refill slots after removing undesired candidates. Use default English model with no user learning or private state, real supplied context, and automatic correction kept separate from explicit suggestion acceptance.

A slot hit requires Unicode canonical composition and case-insensitive equality to a frozen accepted answer. Do not strip diacritics, apostrophes, or punctuation for scoring. Include exact literal words as coverage hits, but only positive-effort hits count as useful. For each matching visible candidate, saved keystrokes = max(0, grapheme_count(candidate) - grapheme_count(prefix) - 1). The subtraction is the suggestion acceptance tap; give no credit for a trailing space. Next-word prefix length is zero. Record the maximum saved effort among accepted visible candidates; report useful-hit count, literal/zero-effort hits, and total saved effort over ALL cases, alongside coverage. This idealized metric ignores finger travel, reading effort, capitalization actions, accents entry cost, and next-word spaces.

Report slot-one coverage as a secondary diagnostic. Retain ranked visible outputs and misses as artifacts. Never treat plausible alternative outputs as failures to fix by word-specific exceptions. Keep inference bounded, with no hardcoded benchmark vocabulary/context, generated dictionary edits, training input edits, personal-data logging, or remote service.

## Selection and safety

Prefer small generally useful improvements supported by development results and code-level reasoning. Reject changes that only move candidates outside visible slots, regress aggregate development useful hits or saved effort, increase automatic correction aggressiveness, destroy literal valid input, or require unbounded work. Separate automatic-correction behavior from suggestion ranking. Freeze the chosen implementation before revealing verification results; if verification fails, report/revert the experiment rather than tune on verification. Verification must not become a second development set.

Measure warm and cold inference cost on this machine with fixed prompts and repeat counts; report sample size and timing caveats. Run existing relevant regressions and add targeted meaningful coverage for any retained behavioral fix. No simulator, language settings/UI/dictation/Shift work, dictionary generation, pushes, or subagents.

## Frozen SHA-256

- development.json: 058b2efd84bf3f3b5549df79d3d35c168ca19fe7e5e835beeff94ff8e39b1bdd
- verification.json: 84bb7aeb181814f8240038cebdf0dd271300d5021c547293ede5b0f0f4400cea
