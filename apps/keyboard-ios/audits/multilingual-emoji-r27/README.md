# R27 multilingual emoji search — rejected evidence only

Parent independent review rejects candidate `0d46d60b`. This package imports **audit artifacts only**. Production, resources, builders and normal tests were restored exactly in `0721ed2b` to `5e515366`; the candidate standalone commit must not be imported. The meaningful Spanish gains do not overcome the frozen control failures, additional English retrieval losses or unbounded-by-contract construction cost. No source repair or acceptance retuning occurred in R27 after reveal. R31 is a separate successor; its data and implementation are outside this package.

[Original report](report.md), [original independent source review](source-review.md), contract, schema, seal metadata, candidate source hashes and verification account are preserved verbatim. Larger inputs/results/summaries are deterministic gzip; their decompressed bytes remain exact. Historical links and command paths refer to the original branch; `measure.swift` is intentionally archived as [measure.swift.txt](measure.swift.txt) outside test discovery.

## What the results establish

| Frozen evidence | Baseline → candidate |
| --- | --- |
| Development useful top8 / top3 | 8 → 15 of 15 |
| Revealed fresh useful top8 / top3 | 8 → 18 of 18 |
| Fresh English / Spanish / mixed useful rows | 6→6 / 1→6 / 1→6, six each |
| Fresh target families with gains | Five of six |
| Fresh family access through any query | 6→6 of six |
| Fresh unique accepted emoji in top8 | 23→23 |
| Fresh accepted top8 alternatives across correlated rows | 30→62 |

The fresh count is the **historical single R27 reveal**, not a new fresh gain from parent review or curation. The API has no language argument; EN/ES/mixed describe query content, not three keyboard mode stacks. Variants and English/Spanish/mixed queries within a family are correlated. No native rendering, supported-glyph filtering, keystroke savings, Gboard comparison, native readiness or device-performance result was demonstrated.

All 11 changed development sequences and 21 changed fresh sequences are retained in the raw paired arrays. No useful-row regression appears in those frozen rows. The original source review's 85 diagnostic executions contain 78 unique strings and overlap the historical fresh query `dog`; they are not another blinded usefulness sample. Parent's additional 16 queries are explicitly **informed diagnostics after reveal**, never pooled with accuracy scores.

The pre-reveal `q` and `z` counterexamples append literal Spanish matches while preserving the complete original sequence: 29→31 and 40→46 respectively. Fresh `mu` similarly grows 38→48 without losing its original prefix. These violate the frozen full-sequence compatibility gate, but do not independently demonstrate semantic harm. Frozen token-order checks also fail on inherited phrase-priority ranking; this is an unmet contract rather than newly introduced damage.

Parent's separate informed diagnostic establishes stronger legacy retrieval losses:

| Query | Baseline | Candidate |
| --- | --- | --- |
| `vicuna` | 🦙 | empty |
| `sao` | 🇸🇹 | empty |
| `pina` | 🍍 🥥 🪅 | 🍍 🪅 |

These outputs are retained under `parent-diacritic-diagnostic/`. `vicuna` and `sao` lose their only result; `pina` loses a previously available coconut alternative. They are source-informed regression evidence, not independently frozen relevance labels. `pinata`, `piñata` and its NFD form still find 🪅 because English annotations explicitly include `pinata`. `jalapeno` and `jalapeño` are empty in both versions; no loss is claimed there. Marked and canonically decomposed `vicuña`/`São` still work. The changed normalization preserves ñ and ã in the new picker, replacing historical English accent folding; that explains the unmarked-query losses.

## Control and implementation limits

The fresh report flags four controls: inherited ordered-token invariance, one-character `ñ`, exact-baseline `mu`, and `caña/cana` discrimination. **The last is unavailable as a product measurement.** The frozen runner routes every `distinct` row into the hard-coded ano/año fixture. Neither caña nor cana is indexed there, so both return empty. That raw failure remains unchanged, not converted to a product failure or pass. Twenty-three controls pass, three other frozen failures are observed, and one is unavailable. No post-reveal fixture repair/re-run occurred.

The broad one-character baseline-retention promise conflicts with unrestricted ñ/n discrimination: baseline `ñ` folds to n and returns 48 hits; candidate returns zero. This tension does not excuse q/z violations. A successor must predeclare coherent compatibility/normalization semantics and use genuine indexed ñ minimal pairs; it cannot retroactively claim that every original R27 gate was satisfied. Keep R27's original assertions, unavailable outcome and rejection history intact.

Candidate data adds only 1,914 Spanish CLDR speech names to existing catalog entries, **48,572 bytes** (242,085→290,657; +20.1%). Parent independently verified pinned official XML SHA-256 values and reproduced the candidate resource exactly in memory from the immutable importer. Removing only `s` restores the entire baseline JSON structure. The [Unicode License v3](UNICODE-LICENSE.txt) is retained; candidate README provenance and pinned input URLs are included in the inactive patch. No hand-picked target additions or new licensing defect was found. No downloaded XML corpus is imported.

The picker duplicates the English index and adds literal postings and per-entry word sets. Its loops imply **48,837 picker fold calls before queries**, in addition to the retained contextual index: English names are folded four times each, 11,801 English keywords three times each, and 1,914 Spanish names three times each. Per-Character string construction and selective vowel folding add work; these are source-derived causes, not profiler attribution. Historical optimized construction is approximately **26→238 ms**. The timer starts after catalog decoding; actual loading, memory and query-tail costs were not quantified. Controller construction runs once per process in detached utility work, so this is not a measured main-thread stall. The 12-posting and 800-candidate caps also bound retrieval completeness rather than proving exhaustive matching.

A separate successor can investigate reusing English work with a compact Spanish supplement, retaining established English aliases and short-query sequences, and freezing resource/construction/query budgets before implementation. R27 queries, families and these diagnostics are now exposed development material. This archive implements no successor changes and accesses no new sealed data.

## Archive and verification

[Provenance](provenance.json) records immutable Git origins or exact external-file SHA-256 values plus uncompressed byte counts/hashes. Raw paired development/fresh arrays, original reviewer queries/results and the parent's 16 query/results are retained losslessly as `.json.gz`. [rejected-candidate.patch.gz](rejected-candidate.patch.gz) is the exact production/resource/builder/test delta from baseline to candidate; it is inactive and includes the resource evidence. No candidate Swift file is compiled or registered. Binaries, build logs, caches and unrelated corpora are excluded.

[Restoration proof](restoration-proof.json) records baseline/candidate/restored hashes, including absence of candidate-only files after restoration. The resource's restored SHA-256 is `2085015d3bd75b7046aecd244b1961230b37fd25ac8aca475c7bc4afabba8117`. Net diff across LanguageData, the full keyboard package and scripts is empty between baseline and restored commit. Historical test claims remain attributed to the original investigator; curation performed no build or native run.

Run `python3 apps/keyboard-ios/audits/multilingual-emoji-r27/verify.py` for portable retained-byte hashes, raw score/control/changed-row recomputation, diagnostic losses, seal metadata and exact resource preservation. Add `--git` to verify immutable source manifests, exact rejected patch and restoration; archival Git objects are optional, not a portable dependency. Add `--external` only to compare the explicitly listed original diagnostic files while available. Verification builds nothing, runs no Swift, accesses no sealed input, and infers no new relevance, performance or acceptance outcome. Hash consistency does not independently prove execution authenticity.
