# Independent accuracy sweep

## Frozen protocol (before engine or prior audit inspection)

Base: `433e54adf29dc6960f2ffb5acafbf63699fb6494` (PR #782). This worktree was clean. Only repository instructions, paths, Git metadata, and the keyboard directory listing were read before this protocol. Neither engine implementation, existing test contents, nor `QUALITY_AUDIT.md` findings were inspected.

The novel benchmark models short personal/work messages with mid-word slips, ambiguous valid words, unfamiliar names, and edits after a suggestion was produced. It combines recall with preservation constraints: an apparent accuracy gain must not silently replace legitimate text. Corpus files are frozen alongside this document in the first commit. No language features or settings/UI changes are in scope.

Each split has 98 cases: 40 correction (10 words × omission, adjacent transposition, duplicated interior letter, interior replacement with `x`), 30 swipe (the same 10 words × ideal/jitter/sparse paths), 20 preservation (10 literal identifiers/names and 10 valid words), four contextual predictions, four editing scenarios. Words, names, and contexts are disjoint between development and held-out splits, except function words in prediction phrases. These are synthetic prompts authored independently of the implementation, not user data.

### Measurement contract

- Correction: record top-1 and top-3 target recall, plus automatic replacement correctness/coverage separately. A suggestion alone is not a correct automatic edit. Match target case-insensitively for recall, but preserve literals exactly for edits.
- Preservation: no automatic replacement of exact valid words, mixed-case brands, unknown names, alphanumeric IDs, email addresses, or URLs. Suggestions are allowed. Never add input to persistent storage for this benchmark.
- Prediction: record top-3 next-word recall for each exact context (sentence-start handling tested separately if necessary). Small sample is diagnostic, not a claim about general prediction quality.
- Swipe: generate geometry using the shipped QWERTY layout once its public interface is known. Ideal paths connect letter centers, including repeated letters; jitter offsets alternating points by 0.12 key widths/heights; sparse paths retain endpoints and alternating interior points. Record top-1/top-3 recall, independently by path family. No word-specific path tuning.
- Editing: stale correction must not replace changed text; a cursor move inside a token must not replace the wrong span; whitespace commit must not duplicate boundaries; a literal name must survive commit/undo. Adapt scenarios to existing public editing abstractions, recording unsupported cases rather than counting them as passing.

### Development versus held-out verification

1. Freeze both corpora and this protocol before reading code. Record the freeze commit and file hashes.
2. Inspect implementation/tests and build a thin executable adapter. Run development only to identify general failure classes and measure a baseline.
3. Implement fixes justified by development failures and code evidence. Add regression tests spanning multiple words or state transitions; avoid vocabulary-specific exceptions or benchmark-driven dictionary additions.
4. Freeze the candidate implementation, then run held-out exactly once for baseline and candidate (same harness, dictionary and environment). Do not tune after seeing held-out outcomes; if a safety failure requires a fix, disclose that held-out is spent and require independent validation.

Acceptance: existing meaningful regression suites pass; all supported preservation/editing cases pass with zero new unsafe edits; held-out correction or swipe top-3 recall improves by at least 5 percentage points in its 40/30-case category OR a reproducible editing failure class is eliminated across both splits; no other held-out correction/swipe category regresses more than one case, and no prediction regression. Report absolute numerators, denominators, timings where available, unsupported coverage, and caveats. If criteria are unmet, report that honestly and retain only independently justified fixes. Synthetic recall and tiny context coverage cannot establish real-user accuracy or latency.

## Results

Pending implementation and measurement. Frozen protocol above must remain unchanged; append results below.
