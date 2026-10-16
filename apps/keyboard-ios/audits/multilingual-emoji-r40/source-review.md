# R40 independent SOURCE / ADMISSION review, round 1

**SOURCE VERDICT: REJECT. ADMISSION VERDICT: REJECT.**

Reviewed baseline `00e2a0e7a283bc4a780b02f847ea9d82dfe9e5ae` and exact frozen candidate `8369f266cb9ad58e9ca9b76a9f50dd0cfca3c7b0`. The source has an independently reproduced ASCII-tokenizer nonconformance. Separately, the mandatory actual-candidate smoke remains failed, 566/569 strict rows passing. The three smoke ranking failures are an incompatible frozen oracle, not a demonstrated ranking implementation defect. Neither fact changes the other gate. No fixes, oracle changes, waivers or fresh author work were performed.

All reviewer writes are under `/tmp/pulpo-r40-source-review`. Production was restored by the main agent in `52bf72e4`; an independent Git comparison confirms no net changes from baseline in the six owned files at that restoration commit. Review executables use immutable `git show` snapshots, not restored working files. No prior candidate implementation, private author material, seals, devices, native build logs, cost experiments, push, merge or deploy was accessed/performed. PR metadata was not worked on.

## Exact authority

Read and copied the entire normative bundle; each SHA-256 matches the requested frozen bytes:

- contract.md: `b2d87ff12173e5d43288becaa84dbdabf997373b94fedd8982228ff547351324`
- api-map.md: `273a68136943c8fd4635e23c3d97d9634c8bb6353abb4ffc5bb38c21233819ca`
- schema.json: `3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a`

Read the approved v7 domain report/verdict, including the 406,901-assertion source-entry argument and Character-prefix / literal exact-name split proof. This review uses C=(T,W,X), never the rejected same-T identity or normalized-name substitution for F. Earlier rejected v1-v6 policies remain rejected; their implementations were not imported. Protocol interface freeze hash `c7102f83057856687453572d383aa0da6bc7abf375b182ed0609a6c819682135` and smoke script hash `e3c3a43ec85369e6f4abfe0f2359b5df0a9db17be241b17b3dfbeca06097a7c2` were independently verified. Snapshot/evidence hashes are retained.

## Required source finding: ASCII fast path differs from normative Foundation tokenizer

**P2, frozen EmojiCatalog.swift lines 344-358 (`localizedWords` ASCII branch).** Its all-bytes-below-128 condition includes U+0000. The byte loop processes letters following NUL. The normative operation first calls `lowercased(with: Locale(identifier: "en_US_POSIX"))`, then NFD. On this host, Foundation locale lowercase truncates an embedded NUL: raw scalar values `[65,0,66]` become `[97]`; subsequent NFD is also `[97]`. Therefore the required tokenizer maps `"A\u0000B"` to `["a"]`, whereas the candidate ASCII path yields `["a","b"]`. This is an observed Foundation behavior, not an assumed ideal ASCII lowercase rule. The query is admitted by the public direct API and frozen JSON schema; neither forbids U+0000.

Minimal public counterexample:

```json
{"entries":[{"e":"L","n":"opaque","v":1,"k":[],"s":"a b"}],"query":"A\u0000B","limit":1}
```

Actual baseline: `[]`. Normative T: `["a"]`; W: `["a","b"]`; X: `["a\u0000b"]`; E: `[]`. The one-ASCII-letter canonical guard requires exactly baseline `[]`. Actual immutable candidate returns `["L"]`. No reservation, ranking or capacity ambiguity is needed. Raw input and independent baseline/candidate observations are in `minimal-nul.json`, `minimal-nul-{baseline,candidate}.jsonl`, and `nul-detail.json`.

A tokenizer challenge compared the exact candidate function against an independent scalar reference with no ASCII optimization: **71,805 checks, 307 mismatches**, all containing NUL. It includes every two-byte ASCII combination both alone and inside letter context, every Mn/Mc/Me scalar in five contexts, all 8,770 scalars where Foundation letters and Swift base-letter categories disagree, and targeted Unicode sequences. It examines 2,543 mark scalars. The candidate snapshot was preserved unchanged; `instrumented-EmojiCatalog.swift` only appends an accessor to the private method for this probe. Public fixtures reproduce the defect without that accessor: 3/1,134 control rows fail, one for each preference map, plus the separate minimal cap1 reproducer. Source rejection does not depend on the exposed smoke typo.

Host evidence: Apple Swift 6.4, arm64-apple-macosx27.0.0; macOS 27.0.1 build 26A434. No extrapolation to iOS behavior is made. An exact normative operation must be honored on this admitted review host.

## Three frozen ranking failures: oracle incompatibility, not a source ranking failure

Independently replayed the unchanged inputs for `r40-ranking-0`, `-1`, `-2` through newly compiled immutable source executables and a separate normative oracle. All three return the four eligible values in the required order:

`[r40-rank-002, r40-rank-003, r40-rank-000, r40-rank-001]`.

Their common T is `[mavela, romulo]`. Entry `r40-rank-004` has Spanish name `mavelar romular` and English name `velvet lantern itemae`, with no keywords. `mavelar.hasPrefix("mavela")` is true; **`romular.hasPrefix("romulo")` is false**. No English word covers `romulo`. Thus this entry fails the all-query-tokens eligibility condition, independently of preferences. The eligible ordering is also correct: -002/-003 have Spanish token-set equality, -000 has zero completions, and -001 requires one completion. The preference on ineligible -004 cannot add it.

The frozen exact-suffix oracle demands all five values, including -004. It conflicts with v7 for these inputs. `independent-ranking-adjudication.json` retains all three actual arrays and independently derived E/T/W/X/suffixes; `smoke-failed-rows.json` retains the original failed strict observations. No oracle was edited or reinterpreted to pass admission.

Full mandatory smoke denominators remain separate:

- Strict candidate required rows: **569 available, 569 checked, 566 pass, 3 fail**.
- Exact localized suffix assertions: 511; same-C invariant groups: 119, zero group failures.
- General acceptable-any schema/target oracle: **569/569 pass**. This is weaker than the required exact-suffix gate and does not replace it.
- Arbitrary suite: **7/7 candidate controls pass**, all available; no legacy-prefix failures.
- Invalid schemas rejected: 131. Required failures for absent catalog, invalid catalog and absent input: 3/3 observed.
- Protocol interface selfcheck passes; actual candidate aggregate `protocolSmokePassed` is false.

This is rejection with failed rows retained, not admission salvaged from a passing subset. Original baseline and candidate smoke arrays are preserved. The main agent's fail-to-fail classification for strict admission remains; the separate acceptable-any improvement does not make the strict gate pass. I did not launch a duplicate full candidate smoke.

## Independent source and executable checks

`conservation.json` verifies byte-identical function bodies for the renamed private `englishSearch`, suggestions, lookup, normalizer, foldedName, searchWords and collect; EmojiHistory is unchanged. EmojiSearch.swift is byte-identical at SHA-256 `b31bb9dfd4f0eaca8e7c71e5d5779d43a2e60649067b9a78ac6b0b12bc5b7d47`. Only the six stated production/test/doc files differ at the candidate; existing tests, including query-cap tests, are untouched.

The complete final English index, exact-name winners and value/tone lookup maps extracted reflectively from both immutable executables are identical: **7,287 keys, 12,712 retained postings**. A separate reconstruction checks every generated key, minimum3/maximum80 admission, ignored-term exclusion, minimum rank, ordinal tie order and per-key12 bound. `metadata-controls.json` has zero index/rank/bound errors. All **1,923 entries**, including entries without Spanish names, participate in exact F-set construction; all **1,910 F-set keys and associated ID arrays** match independently computed literal folded-name whole-word sets. Every stored reservation V and English eligibility document matches the independent calculation; all shipped Spanish document token sets also match the normative tokenizer.

Source inspection confirms B is taken from the final retained postings; V unions unchanged searchWords with B keys and their literal-space words; envelope membership uses exact F==X or the actual collected posting anchor plus every nonignored W-prefix witness. Full E is excluded from localized candidates and min(cap,|E|) is reserved. The unchanged collect supplies the existential anchor, including ignored W words; no scalar/grapheme projection is substituted. The three-source legacy membership proof in the approved domain report applies to the unchanged English body. Empty W/raw>80 and nonpositive limits add nothing. Reservation does not use preference-adjusted occupancy.

Localized candidates require a Spanish prefix witness and per-token English-or-Spanish coverage of the same entry. Ranking is Spanish token-set equality, number of completion-requiring canonical tokens, distinct Spanish-word count, then catalog ordinal. Preferences affect only the inherited English result. There is no ñ-specific branch, scalar exception, adaptive cache, per-query index construction, blanket reservation or alias-disable switch. These observations do not erase the ASCII source finding.

Whole English eligibility includes normalized name/keyword words, full normalized terms and their compact forms. V for reservation is narrower and explicitly uses retained B. The phrase “legacy compact forms” does not explicitly state that localized eligibility compacts must survive posting truncation; I interpret it as the generated forms, matching the implementation, not the B-restricted reservation vocabulary. Full spaced terms add no otherwise missing ordinary single-token prefix witness. This wording boundary is disclosed rather than silently claiming an unambiguous retention restriction; it has no role in either rejection or the ranking adjudication.

Independent pairing executed **all 7,374 queries at caps1/48/60 and three preference maps: 66,366 paired rows, zero legacy-prefix/contextual/exact-contextual/cap/dedupe failures**. Preferences were empty, catalog ordinal modulo3, and alternating Int.max/Int.min. There were 4,707 changed arrays and 24,948 added occurrences across these nine configurations, solely mechanical counts with no utility labels. Every paired row and every changed row is retained locally.

Independent fixtures: **1,134 rows, 1,131 match the normative full array, 3 ASCII-NUL failures**. Both final indexes and exact-name winner maps match for every fixture. Controls include 96-entry overfull capacity across arbitrary non-ASCII bases and Mn/Mc/Me/vowel/consonant contexts, NFD/case/repetition, apostrophes/ignored words, genuine red-corazón / green-árbol mixed cap1 intent, retained-posting saturation, nonempty E, and Mc/musical/U0345/FF9E exact-name cases. There are 468 empty-envelope overfull rows and 18 genuine mixed cap1 rows. All mixed cap1 controls pass. **212 same-triple/raw-form/preference groups have zero localized suffix differences**, including caps1/48/60; raw variants that change any C component are not conflated. Independent oracle calculations read actual baseline B and compute F/X by literal Character-space splitting; they never renormalize folded keys. These fixtures are safety controls, not blind semantic families.

## Resource, builder and ordinary evidence

Independently verified both local CLDR XML hashes:

- base: `fe8384e9cd2ee0998eb00ddf5549272eb5b56739e539ef33fedcd727fce5026a`
- derived: `ea9b3abc0a2c73a815faec1034764b6a503d14638ad4fb9556d8a7341838672c`

Fresh independent XML parsing/regeneration exactly reproduces candidate emoji.json: **1,914 Spanish speech names, 9 absent, +44,744 bytes**, final resource SHA-256 `d201157dd725d8e8af6ef91ed56aee867bf52dc0d3cb314e649a8614b3876edd`. Removing only `s` and compactly serializing exactly reproduces the baseline English bytes and order. No entry is added. The frozen candidate helper also reproduces the same result; five invalid source-pair combinations are rejected. CLI wiring verifies both pinned hashes before Spanish enrichment. Generic helper fixtures cover speech-only import, VS16-insensitive joins, absent glyphs, English conservation, conflicts, wrong language and unpinned inputs. Independently rerun Python tests: baseline3/3, candidate5/5 pass.

The supplied ordinary verification summary reports candidate Release449 tests/66 suites +3 services, same5 known issues, zero new issues; baseline Release442 with the same5 known issues +3 services. I verified the supplied candidate core-log hash against that summary without reading native build logs, and did not rerun the full ordinary Swift suite. Initial baseline Debug's four timing issues remain part of the supplied history and are not relabeled as candidate passes or silently discarded. Development intent evidence is exposed: baseline12/36, candidate36/36, negatives8/8, 12 declared families; it is not blind evidence. Independent fixture/compatibility results above do not relabel these counts or establish utility.

## Disposition and artifacts

The exact frozen source remains rejected for the observed arbitrary-input tokenizer discrepancy. The frozen mandatory smoke remains rejected for its three incompatible expected suffixes. Fresh blind author admission is closed. No native, quiet-host, cost, blind utility, accessibility or Gboard claim is made. Main-agent restoration was observed via immutable Git comparison; reviewer did not restore or alter production.

Sources: `main.swift`, `oracle.swift`, `make-controls.py`, `metadata-harness/main.swift`, `token-harness/main.swift`, `nul-detail.swift`, `resource-review.py`, comparison scripts and immutable baseline/candidate snapshots. Raw evidence: both `*-compat.jsonl`, `*-controls.jsonl`, `independent-controls-raw.json`, `token-controls.json`, minimal-NUL rows, ranking adjudication and copied original smoke rows. Compact results: `verdict.json`, `summary.json`, `compat-summary.json`, `independent-controls-summary.json`, `metadata-controls.json`, `resource-review.json`, `smoke-adjudication.json`. `hashes.sha256` binds these artifacts, reviewed source snapshots, executables and this report; the hash manifest itself is excluded from its own entries.
