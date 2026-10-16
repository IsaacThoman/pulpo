# Round 10 sealed heldout authorship

Authored independently in the isolated checkout, using only `protocol.md`,
`dev.json`, and `old-r7-exclusions.json` as task inputs. No engine, compiler,
assets, prior reports, candidate implementation, or inference was inspected or run.

`heldout.json` contains 40 cases: 32 swipe cases (16 Spanish, 8 bilingual,
8 English) and 8 literal safety cases (3 Spanish, 3 bilingual, 2 English).
IDs are consecutive `r10h001` through `r10h040`. Ordinary familiar vocabulary
was selected without reference to any proposed fix. The set includes accented
spellings and repeated letters. Each context contains a complete preceding
sentence and ends in a space; each completed clause was manually reviewed for
naturalness. No invented swipe challenge words were introduced.

Validation checked exact schema, unique IDs, language counts, NFC text, trailing
context spaces, and full-document expectations: context + target + one space for
swipes, context + literal for literal typing. The literal cases cover eight
ordinary structured-input categories. No model output or accuracy was measured.

Disjointness: PASS. All 32 swipe targets are mutually unique and disjoint from
both the 32 development swipe targets and the 72 old R7 exclusions after Unicode
NFC normalization, casefolding, and accent folding (NFD decomposition with
combining marks removed). Exact spellings and accents remain intact in the input.

Input: `heldout.json` (UTF-8 JSON, final newline).
SHA256: `ab7466440909dd944f52ae1880fb36f58f9b8c7ff11600a6b9a84e7d02b9427a`

Seal: the implementer must leave the input unread until independently freezing
the selected candidate and source hashes. Only path, digest, counts, commit, and
successful disjointness status may be returned before that freeze. This author
made no engine changes and ran no inference, push, deployment, or device actions.
