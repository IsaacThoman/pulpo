# R40 independent preproduction domain review, round 2 — exact v3 REJECT

Verdict: **REJECT** the exact reviewed contract bytes, SHA-256 `076a07001771c2146e4b1f1f095db60cc7a73815ef812e117d8824ed270e78ff`, baseline `00e2a0e7a283bc4a780b02f847ea9d82dfe9e5ae`. The required envelope inclusion property has a measured counterexample. Production authoring/admission cannot be approved under these bytes. This report reviews no subsequent proposal.

## Decisive executable witness

Use two unique fixture entries, E with English name `bar`, L with English name `opaque`, no keywords. Supply L's proposed Spanish speech name separately to the independent contract oracle as scalar sequence `[U+0345,U+0062,U+0061,U+0072]`. Baseline has no Spanish field, so no production localized implementation is implied.

Raw query q is `[U+0027,U+0345,U+0062,U+0061,U+0072]` (apostrophe, combining Greek ypogegrammeni, `bar`). Both the bare mark-leading alias and q have the identical v3 canonical token set T = `[U+0345bar]`. The required admitted-base-letter guard succeeds through `bar`.

Actual Foundation folds the complete q to apostrophe + `bar`. Actual unchanged EmojiSuggester deletes the apostrophe and returns `[E]` at caps 1/48/60. By contrast, Foundation folds the isolated canonical token U+0345bar to `ιbar` (Greek iota + `bar`). Hence A=R={`ιbar`}; V(E)=I(E)={`bar`}. E fails both the substring and prefix witnesses. E(T) is empty, despite actual legacy result E. The result holds with preferences too.

I(e) is precisely FINAL bounded index postings for that entry plus exactNames WINNERS, never the full vocabulary. This fixture has just the term `bar` for E, so posting truncation and exact winner ambiguity cannot explain the failure. The broader model was checked against the real private baseline index/exact dictionary using reflection for 13 synthetic fixtures and the real catalog.

At cap1, the declared merge has zero reserved slots and selects localized L, then appends it after actual legacy `[E]`, producing `[E,L]`. This is also a direct contradiction among normative requirements: x=U+0345bar is a non-ASCII canonical token, L's alias begins x, and neither English entry has an indexed/exact projection starting `ιbar`; mandatory useful capacity requires L. Mandatory legacy preservation requires E. Their combination cannot fit cap1. No production implementation or full-catalog fallback is involved.

The independently delegated challenge reproduced this with actual baseline APIs and additional whitespace, curly apostrophe, hyphen, ampersand, parenthesis and colon contexts. It also confirmed a letter-bearing exact technical-name failure (`1` + U+0345 + `bar`) and a consonant/apostrophe case in which only the conjunctive predicate fails. See `challenge/report.md`, `challenge/challenge.swift`, and `challenge/raw.json`.

## Executed denominator and classification

- 534 synthetic query/cap/preference rows across 13 fixtures, using actual baseline search and Foundation; 28 additional token controls. Caps are 1/48/60; preferences include alternating signed extremes. Coverage includes apostrophes/digits/ignored words/exact technical names, final posting saturation, order/repetition, uppercase/NFD, Mn/Mc/Me after vowels/consonants and leading/standalone marks.
- 36 substantive letter-bearing envelope-inclusion failure rows in the new v3 context family; 12 also overflow cap1 under the contract oracle. There were zero localized-tranche order/preference-invariance failures. Raw synthetic nominal failure count is 42: the other six are numeric exact `123` queries with empty T, actual legacy E4, and empty envelope. Those six take the no-localized-additions path and are not counted as the decisive localized impossibility.
- 270 non-ASCII internal-occurrence capacity rows (nine canonical token controls, five query forms, three caps, two preference maps), all filling 1/48/60 respectively with 96 eligible aliases. Tokens include ñ, consonant Mn/Mc/Me, ø, ł, σ, ǹ and ç. English internal-occurrence entries consume zero reservation in these controls. These passes do not override the contextual blocker.
- Real shipped catalog: 1,923 entries, 8,671 unique generated development queries, 26,013 actual search calls across caps1/48/60, 60677 returned-result checks; zero envelope-inclusion failures. Queries include every name/keyword, normalized words/compacts, first-letter/first-three prefixes and exact raw technical names. This is a newly generated corpus, not a claim to reproduce an unidentified exact 7,374-row corpus. Real-catalog preferences were not varied. Full raw rows are preserved in `real-catalog.json`.
- Full Unicode scalar enumeration: 1,112,064 valid scalars, 851,928 admitted letter/mark contextual rows. The necessary-condition scan recorded 42 candidates involving 14 prepend letters (including U+0D4E) and Swift String prefix/substring boundaries; these scan candidates were NOT promoted to confirmed legacy API failures. U+0345 was the sole scanned mark with a nonempty standalone letter projection. The scan did not enumerate all scalar sequences, raw predecessor contexts, or string lengths and proves no universal theorem. The decisive predecessor-context failure was found independently and separately executed.
- Independent challenge raw groups: eight prefix controls (each carrying cap/preference results), two consonant controls, one exact technical control, and 27 two-entry merge rows. These are separate evidence and are not added to the 534-row denominator.

## Prior blockers and formal obligations

v3 does distinguish the earlier witnesses: bare U+0345bar retains a leading mark rather than reducing to `bar`; U+0345 apostrophe ñ emits both the mark-only and ñ tokens; purely mark-only queries fail the localized admitted-base guard. `controls.json` records v1/v2/v3 token differences using independent models, not old production sources. Thus the rejection is a new v3 contextual failure, not reuse of a v1/v2 canonicalization assumption.

A necessary condition for this envelope proof is context-safe transfer from raw legacy folding to separately canonicalized/projected token witnesses. This transfer is false in v3: Foundation folding U+0345 depends on the preceding raw scalar, and local tokenization erases that predecessor. Preserving the mark in T alone does not preserve its projected letter behavior.

A general completeness proof would have to account for all three actual result sources: full-query prefix collection, fallback word candidates with per-entry word verification, and exact-name winners. Each returned entry must satisfy every conjunctive witness and an actual final-index/exact prefix witness, across the entire declared canonical equivalence class. Final posting bounds and exact winner semantics are part of that obligation. Any use of Swift String substring/prefix must also justify its Unicode boundary semantics rather than assuming scalar-sequence prefix behavior. These are necessary proof obligations, not approval of a replacement rule. No proposed fix was evaluated in this round.

## Reproduction, boundaries and integrity

All files created are under `/tmp/pulpo-r40-domain-v3`; no repository edits, candidate/old implementation access, sealed/private author access, utility evaluation, native/device work, costs, push, merge or deploy occurred. Existing prior witness files were read only. Baseline source is copied byte-for-byte and compiled with actual host Foundation. The repository contract and API-map paths changed during finalization (current path hash `105c5763e5b59dbe4dd1845ec45fba53b4cea12530694648d81d48b8a099fee7`); the live input hashes are recorded in summary.json and those replacement bytes were not reviewed. This verdict binds only the preserved `contract-v3.md` hash above. Swift version and input hashes are in `summary.json`; source/output/binary hashes are in `hashes.json`.

Reproduce from this directory:

```sh
swiftc -O EmojiCatalog.swift Policy.swift blocker.swift -o blocker
./blocker
swiftc -O EmojiCatalog.swift Policy.swift controls.swift -o controls
./controls /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/LanguageData/emoji.json
swiftc -O EmojiCatalog.swift Policy.swift scan.swift -o scalar-scan
./scalar-scan
cd challenge
swiftc -O challenge.swift -o challenge
./challenge > raw.json
```

The oracle exercises domain rules; it is not a production implementation. No schema runner, wrapper/history execution, contextual-suggestion compatibility or all-action production smoke was completed or passed in this round. Those gates remain unapproved. Scope stopped on the user's request after the already-running controls completed. A replacement contract requires a fresh task/review round.
