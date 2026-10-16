# R31 independent pre-reveal protocol validation

Verdict: **PASS**, limited to immutable benchmark protocol and static semantic independence. This is not a candidate correctness, performance, cost-gate, device, or release verdict.

Payload: `/tmp/pulpo-r31-sealed-v1.json`

Payload SHA256: `a7067871f9f61e2b8d4d6378c259e8fbd7c9e1ac5fcbaa4db5a50c5b4ac891de`

## Integrity and access boundary

The current payload hash matches the requested hash, the initial author seal, and the unchanged-byte final seal. All four immutable packet hashes match both metadata records. All ten exclusion-manifest file hashes match their listed originals. No payload, oracle, expectation, original metadata, or repository file was changed. This review is the only file written by this validation.

The original author attests to authoring from the immutable packet plus opaque validation, without exposed inputs or implementation/results access. This validator subsequently inspected the authorized sealed payload and exposed input identifiers independently. The author's earlier semantic-inspection limitation is therefore addressed by this separate review; this review does not claim the author had inspected exclusions.

Access was restricted to the authorized packet, payload, metadata, exclusion manifest, and listed originals. Exposed report material was processed only to extract quoted scalar identifiers for exclusion purposes, without candidate performance or surrounding source-review reasoning. No candidate implementation, application source, normal tests, benchmark outputs, development results, device, network, or Git operations were used. No hidden suite was executed, and no hidden query was sent to any candidate or baseline.

## Exact counts and static checks

The supplied static validator was run directly and returned exit 0 and `staticValidation: PASS` for the matching hash.

- 46 rows: 24 useful and 22 controls.
- 10 declared families: 8 useful semantic families and 2 control groups. All 8 useful families have exactly one English, one Spanish, and one mixed row: 8 rows per stratum.
- Actions: 24 search, 5 wrapper, 17 fixture rows.
- All 46 rows have an explicit, nonempty, singleton acceptable emoji set. There are 11 unique acceptable glyphs overall, including 8 across useful rows. Every useful row has maxRank 8; every control has maxRank 1.
- All 5 wrapper rows explicitly supply recents and limit. Four use limit 1 and one uses limit 2. Nonempty search, whitespace browse, and punctuation browse are represented. Rank bounds fit the supplied positive limits.
- All 17 fixture rows explicitly supply entries and Spanish aliases. They share exactly one identical two-entry fixture, with distinct glyphs, complete alias-to-entry references, and the other glyph explicitly forbidden on every row. Acceptable and forbidden sets never intersect.
- All 12 optional equivalence references resolve. Each linked pair has identical action, family, fixture data or wrapper parameters, acceptable set, rank constraint, and forbidden set. No equivalence crosses different fixtures or wrapper limits/recents. The query transformations are supported by the contract.
- No unsupported action, parameter, or row field was found. All queries fit the documented public query buffers.

## Exclusion and semantic independence review

The original JSON input corpus comprises 27 R27 development rows, 45 R27 fresh rows, 16 parent diagnostics, 21 extra review-input rows, 64 review-input rows, and 48 R31 frozen input strings (15 English, 13 Spanish, 4 mixed, 16 boundary). Extraction traversed both arrays and dictionary values, including query references and acceptable arrays. Every original input/reference/acceptable scalar was accounted for in the manifest's normalized exclusion strings. Quoted report references and the manifest's exposed-family list were also considered. Source-catalog contents and result/output arrays were not promoted to semantic target sets.

All 46 sealed queries and acceptable sets pass the manifest's NFC/casefold exact exclusions, and no declared family duplicates an excluded family label. The 24 useful rows were additionally inspected for their underlying referents, query meaning, acceptable visual targets, and cross-language equivalence against the exposed query/reference/target material. All 8 useful referents are mutually distinct and have no synonymous or same-visual-family counterpart in that material. Shared component words or broad categories were assessed in the meaning of the complete intent; they did not identify the same referent. No useful semantic-independence failure was found. Language variants do not increase the count of independent useful families.

Structural and orthographic controls intentionally exercise previously exposed kinds of behavior; they are not counted as new useful semantic families. Within-suite reuse by a control is likewise not additional independent utility evidence.

## Expectations and generic fixture inspection

The useful acceptable sets identify concrete, meaningful visual intents with explicit ranks; none is a nonempty-only assertion. English, Spanish, and mixed queries within each useful group identify the same referent. No expectation was found to require an undocumented language/context/history API, fuzzy syntax, or unsupported action.

The synthetic n/ñ contrast uses fresh arbitrary names carried by the supplied alias data, distinct opaque English entry names, both contrast queries, canonical decomposition, case, and explicit opposing-glyph prohibitions. Legacy English accent/consonant folding is exercised through entry keywords independently of the Spanish contrast. Mixed vocabulary, all-token matching, permutations, separators, repetition, and surrounding punctuation have contract-supported expectations. The fixture data do not depend on the exposed pairs or on the glyphs' ordinary catalog meanings. This static finding concerns the payload's construction; it cannot prove that an unread runner or implementation is free of hardcoding.

## Seal sequence and limitations

The initial author seal preceded dynamic runner capability smoke validation. The supplemental metadata records a successful opaque smoke and static rerun followed by the final seal at `2026-10-16T07:24:28.827303+00:00`, with the original bytes unchanged. This is an honest sequence deviation; dynamic validation did not precede the initial seal. The final pre-reveal record addresses capability validation without retroactively correcting that chronology.

This validator did not rerun or read the smoke script. Its coverage of all three actions and two exposed arbitrary pairs is taken from the supplied request and final metadata, not independently re-established. No smoke results or hidden performance evidence were accessed.

The positive-rank/nonempty-set schema cannot express empty-output expectations for zero/negative limits; those cases are not covered. One sealed contrast pair and static inspection cannot establish universal genericity. Shipped catalog/alias availability, actual ranking/output equivalence, runner enforcement, production behavior, and every product/cost/device gate remain untested here. Unavailable targets or rows must remain in the evaluation denominator and cannot pass. Semantic review is a human-style judgment over the authorized exposure corpus, not a guarantee about undisclosed material. The exposure inventory's completeness outside the listed artifacts cannot be established under this access boundary.

No offending row IDs or unsupported expectations were found. No new authoring, retuning, expectation edits, or reveal was performed or authorized by this validation.
