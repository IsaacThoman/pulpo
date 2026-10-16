# Selection frozen before verification reveal

The verification outputs have not been opened. Select only the written-accent preserving display partition in Suggester.suggestions, after automatic-correction selection, with original retrieval limits (8 completion candidates and 32 frequent fallback words).

Development baseline: 28/40 coverage, 22/40 useful, 70 saved keystrokes. Selected: 29/40 coverage, 23/40 useful, 71 saved. No development case loses coverage, usefulness, or saved effort. Only two development strips change: café's literal keeps an accented continuation instead of unaccented cafe; naï gains naïve. Selection rationale is the general invariant that explicitly entered accents are useful spelling evidence, supported by synthetic in-memory name tests, not a new model prior.

Reject completion/edit score separation (28/22/70, no primary metric gain), completion retrieval 8 -> 32 (28/22/70, no strip change), and frequent next-word fallback 32 -> 128 atop selected (29/23/71, no strip change). No rejected heuristic survives.

Focused host Swift release regression run: 182 tests in 15 suites pass, including six new accent completion tests (four parameterizations plus blocking and end-to-end selection). Existing compiler warnings concern TouchModel Sendable conversion and an unused WordDeletion expression.

Now capture final output and reveal baseline/final verification once. Do not tune from verification outcomes. Final inference source blob at selection: see this commit's Suggester.swift. Later commits may only add evidence/reporting unless verification forces reverting the change.
