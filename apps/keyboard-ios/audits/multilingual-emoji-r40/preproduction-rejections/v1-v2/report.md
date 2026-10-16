# R40 independent preproduction domain review, round 1

**Verdict: REJECT exact draft v1 and the proposed general leading-mark v2. No production implementation is approved.** Both have executable envelope-completeness counterexamples. Their combination of mandatory generic internal-only capacity, canonical localized membership, unchanged legacy prefixes, and fixed caps is impossible. The later v3 proposal is outside this review round and receives no approval here.

Reviewed baseline HEAD: `00e2a0e7a283bc4a780b02f847ea9d82dfe9e5ae`. The unchanged `EmojiCatalog.swift` is frozen as `baseline-EmojiCatalog.swift`. The reviewed v1 normative snapshot is frozen as `draft-contract-reviewed.md` (SHA-256 `d25e4387eab088efe21172cf3c09a218f4bcd6a2b7e549b80731d27b032b2132`); v2 was supplied as a textual proposal, preserved in `proposal-v2-reviewed.txt`. Hashes and runtime are in `manifest.json`. The requested v5 contract, v5 witness, and source-review report were read as historical public context; no previous candidate implementation was read. This report challenges R40, not a substituted v5 policy.

## Decisive Foundation behavior

Actual macOS Foundation on this host folds a leading U+0345 COMBINING GREEK YPOGEGRAMMENI into U+03B9 GREEK SMALL LETTER IOTA. This is not transliteration invented by the harness:

- Raw `U+0345 + bar` normalizes in unchanged legacy search to `ιbar`.
- Raw `U+0345 + ñ` normalizes to `ιn`.
- Raw `U+0345 + ' + ñ` and `U+0345 + ’ + ñ` also normalize to `ιn`, because legacy normalization deletes those apostrophes.
- Raw `U+0345 + - + ñ` and `U+0345 + SPACE + ñ` normalize to `ι n`.

These inputs satisfy legacy search-text admission. `leading.swift`/`leading.txt` and `impossible.swift`/`impossibility-results.json` retain the initial minimal reproductions. `domain-witness.swift` contains the final cap-saturated controls. They link directly to the frozen unchanged baseline and use actual Foundation.

## v1 counterexample and impossibility

Take English entry E with name `ιnbar`, and another entry L with English name `opaque` and hypothetical Spanish speech name `ñavoru`.

For raw q0=`ñ` and q1=`U+0345 + ñ`, v1 canonicalization produces exactly the same sorted unique T=`[ñ]`, hence A=R=`[n]`. Both English entries have no actual indexed or exact-name projected term beginning with `n`. E has a substring `n`, but its projected indexed/exact term begins with `ι`; L has no `n`. The exact v1 E(T) is therefore empty. Actual legacy q0 returns `[]`; actual legacy q1 returns `[E]`. Consequently `Legacy(q1)` is not a subset of E(T).

This also disproves the requirements independently of the particular envelope algorithm. At cap1, mandatory internal-only capacity requires q0 to return L. Canonical localized membership then requires q1 to include the same L. Preserving q1's legacy `[E]` at cap1 leaves no slot for L. No ordering, preference, ranking, or alternate capacity formula can satisfy those four requirements together.

The saturation fixture has 80 E entries with distinct names `ιnfixtureaa` through the deterministic generated suffixes, and 80 localized L entries. Distinct English terms avoid the baseline's 12-posting-per-term limit. No projected I term begins `n`. Raw q0 has zero legacy entries; q1 has exactly cap legacy entries at each of caps1/48/60. The mandatory tranche has cap L entries at every cap. Keeping that same tranche for q1 would produce 2×cap results. The contradiction therefore holds at all requested caps, including overfull catalogs and both preference maps.

A separate literal v1 problem is that its “arbitrary admitted non-ASCII letter x” includes `á`, while canonical `á` is ASCII `[a]` and the contract expressly requires baseline-only behavior for that token. The proposed v2 correctly narrows this capacity language to canonical non-ASCII tokens, but does not repair the mark-boundary problem below.

## v2 counterexamples

The proposed v2 preserves pending leading Mn/Mc/Me marks only if a base arrives before a separator/end. `canonicalV2` in the executable implements exactly that rule. Its sanity checks confirm that immediate `U+0345 + ñ` now differs from plain `ñ`; thus the original immediate-leading-mark v1 failure is repaired by this proposal.

However, `U+0345 + ' + ñ` and `U+0345 + ’ + ñ` discard the pending mark run at the apostrophe separator. Their v2 canonical T remains `[ñ]`. Legacy deletes the apostrophe and obtains `ιn`, returning E from the same saturated fixture. The complete cap1/48/60 impossibility survives unchanged.

There is also a separator example independent of apostrophe joining. Let E's English name be exactly `ι n`, and L have English `opaque` / Spanish `ñavoru`. The final actual English index contains E's full term `ι n` (three Characters), but its individual `ι` and `n` terms and compact `ιn` do not meet minimum length3. Its exact folded name is `ι n`. Every projected I term for E is therefore `ιn`, and none begins `n`. Proposed v2 discards the isolated leading mark run before a hyphen or space, so raw `U+0345 + - + ñ` and `U+0345 + SPACE + ñ` again canonicalize to `[ñ]`. Both actually return E; the hyphen form demonstrates a phrase posting hit, while the space form can also use exact-name lookup. Both are outside the proposed E(T). The cap1 contradiction follows immediately.

No scalar-specific, per-word, or ñ-specific exception was introduced in these controls. ñ is simply a disclosed convenient canonical non-ASCII token; the cause is loss of a mark fragment whose actual Foundation fold is an English letter.

## Additional blind independent subreview findings

The user explicitly requested blind multi-agent review. A nested reviewer received only the permitted public sources and a narrow challenge brief, without this reviewer's artifacts. Its completed report and executable are retained under `child/`. It independently found two additional v1/v2 failures before receiving the U+0345 finding:

- **Joined ignored words break the conjunctive substring predicate.** English `north bear`; raw `t'he north bear` and `t he north bear` both canonicalize to `{bear,he,north,t}` under v1 and v2. The apostrophe form normalizes to `the north bear`; legacy ignores `the` in fallback and returns E through `north`/`bear`. The separated form returns `[]`. No English vocabulary term contains `he`, so predicate (1) excludes the actual returned E. The indexed-prefix predicate passes and cannot rescue it. Curly apostrophe, `a'nd`, and `wi'th` controls reproduce this mechanism. This also shows that the inherited v5 substring rule was not universally sufficient.
- **Discarded orphan Mc can seed fallback without a projected token anchor.** English name `U+093E + zzz + SPACE + β`; raw `U+093E + SPACE + β` and plain `β` both canonicalize to `[β]` in v1/v2. The former returns E, the latter `[]`. The orphan Mc survives legacy normalization and supplies a posting prefix; the other required word β is verified in the entry's English words, but β itself has no posting because it is below minimum3. The actual indexed/exact projections begin `zzz`, never β. The same fixture mechanism works with ñ. Adding otherwise eligible localized alias β gives the same cap1 impossibility without any iota-producing fold.

The child reports a separately read live v1 snapshot hash `076a07001771c2146e4b1f1f095db60cc7a73815ef812e117d8824ed270e78ff`, differing from this review's frozen v1 bytes. Its findings concern the same stated substring/prefix predicates; no claim of exact snapshot parity or immutable cross-agent contract bytes is made. Both verdicts are rejection.

The child's `challenge.jsonl` contains all 25 disclosed observation rows plus a summary of **36 additional baseline search assertions**, at caps1/48/60 and three preference maps, with no assertion failure. Boolean envelope fields describe v1; v2 canonical values are separate, and its report proves the same rejection for v2. These denominators remain separate from the root 474-row diagnostic. The root subsequently reran the child executable; `child-independent-rerun.jsonl` is byte-identical to its retained output. That corroborating repeat is not counted as additional independent rows. The child's negative U+20DD/U+034F controls are retained, and it read no v3 draft.

## Source-observable proof boundary

Building I(e) from the **final actual bounded postings** and exact-name dictionary **winners** is a sound way to identify the source of possible legacy candidates. In fact, this harness reads precisely those private diagnostic fields with Swift `Mirror`, rather than recreating or approximating the initializer. Adding all exact folded names instead of only winners is conservative; it does not fix these counterexamples.

The unchanged source permits three ways for a returned entry to enter its rank map:

1. It wins the exact folded-name lookup.
2. An actual indexed term has a **raw normalized** prefix equal to the raw normalized whole query.
3. In fallback, the entry occurs in `found` from at least one **raw normalized nonignored query word** prefix of an actual indexed term, and every nonignored query word prefixes a word in that entry's normalized English name/keywords.

Thus an actual raw indexed-prefix witness is necessary for postings-derived results; the exact winner is necessary for the separate exact path. This does **not** establish that some projected canonical token prefixes the projected term. Transporting that witness through the localized canonicalizer is the unproved step, and the examples above disprove it for v1 and v2. Ignored tokens must indeed be available for phrase anchors, and exact names must indeed be represented, but those changes are insufficient.

For a mathematically sufficient reference envelope, let F(T) be the union of actual legacy memberships over every admitted raw query q with C(q)=T, every supported cap, and every permitted preference map. Then Legacy(q) is a subset of F(T) by construction. Reserving min(cap,|F(T)|), excluding F(T) from a canonical localized ranking, and appending the resulting fixed tranche proves prefix preservation, disjointness, fixed localized membership/order, and the cap bound: |Legacy(q)| ≤ min(cap,|F(T)|). This is a semantic canonical-fiber specification, not a blanket full-catalog fallback or a per-word exception. It does not supply an approved finite implementation or a universal Unicode transducer proof. For the counterexample F([ñ]) necessarily includes E, so even the exact reference envelope cannot satisfy the present internal-only-capacity mandate. A revised equivalence domain or revised capacity premise is required before an executable production design can be approved.

A concrete sufficient **modified-domain** alternative is also available from the independent subreview: preserve both localized canonical T and the sorted unique set W of whole words from the unchanged legacy normalizer, including ignored words. Let B(e) be actual final posting keys for e and D(e) be the normalized English-name word set. For nonempty W, define

`E_W(W) = { e : D(e) == W OR exists w in W, k in B(e), k.hasPrefix(w) }`.

For empty W use the empty envelope, since baseline's empty-key guard returns no results. An exact-name hit implies D(e)=W; a whole-key posting hit implies a posting key begins with its first word in W; a fallback hit must occur in some word's actual collect result. All later bounds, preferences, and ranks only remove or reorder candidates. Therefore this is a source-observable, arbitrary-Unicode membership proof that avoids projection-commutation assumptions. It is nonblanket: W={β} excludes English `zβz` with only an internal β. This alternative explicitly narrows equivalence to fixed (T,W), so it is **not a repair or approval of the same-T v1/v2 contract**, and requires a separate agreed normative review if chosen. No implementation of this alternative was authorized or written.

## Executed controls and complete denominators

`domain-results.json` retains **all 474 query/cap/preference rows**, including both passing and failing adversarial variants. It reports 48 incomplete-envelope rows and 40 calculated cap violations. No candidate implementation was run: “calculated merge” and “calculated localized tranche” are explicitly policy controls; measured legacy arrays come from the actual baseline.

- v1 saturation: 36 rows; 18 incomplete-envelope and 18 calculated cap violations.
- v2 apostrophe saturation: 36 rows; 18 incomplete-envelope and 18 calculated cap violations.
- v2 short-word separator: 18 rows; 12 incomplete-envelope and 4 calculated cap violations.
- Remaining 384 positive control rows all pass their envelope-subset, cap, and deduplication assertions.

All groups use caps1/48/60 and two preference maps. Positive controls include the 80-entry ordinary `copper lantern` / `beacon` / `ñavoru` fixture, where the proposed prefix rule does recover the intended 1/48/60 localized capacity; ASCII/curly apostrophe joins; ignored-word phrase anchors and reordering/repetition; technical `keycap: #` exact names; vowel and consonant Mc U+093E and Me U+20DD; consonant Mn U+034F; and the Foundation/Swift classification mismatch U+105C0. These passing controls do not cancel any rejected row or establish utility.

`scalar-scan.swift`/`scalar-scan.json` compare projected canonical scalar output against projected legacy-normalized scalar output for **all 1,112,064 valid Unicode scalar values**, with 139,445 admitted base scalars under this runtime's intersected predicate. Exactly one single-scalar discrepancy appears: U+0345. Its canonical v1 output is empty while its projected legacy output is `ι`. This is an exhaustive scalar-level observation on this host, **not** a proof about arbitrary scalar sequences, all contexts, future runtimes, or iOS. Repeated-leading-mark, uppercase, NFD, and apostrophe controls are separately preserved in the executables/results.

`real-catalog.swift`/`real-catalog-results.json` use all **1,923** entries of the unchanged real English catalog. They mechanically generate **6,941** disclosed development queries from English names, reversed/repeated canonical name tokens, deterministic keyword/prefix samples, case/NFD forms, and selected mark contexts. Across caps1/48/60 and two preference maps there are **41,646 measured query/cap/preference rows** and **83,292 v1/v2 envelope-subset assertions**, with zero failed real-catalog rows. All rows are retained. These results show that the synthetic arbitrary-control blocker is not observed in this bounded English resource sample; they do not weaken the universal contract failure or provide Spanish semantic or utility evidence.

`impossibility-results.json` preserves 24 preliminary minimal query/cap rows. They overlap the final findings and are reported separately, not added to the final 474-row denominator. `probe.swift`/`probe.txt` and `leading.swift`/`leading.txt` preserve the exploratory normalization controls without claiming additional independent semantic families.

## Custody and next-round boundary

All authored files and compiled executables are under `/tmp/pulpo-r40-domain-review`. The repository, production, tests, normative source, and resources were read only. No sealed payload, private author material, previous candidate implementation, heldout queries/oracles, network, native device, build/deploy, cost, latency, memory, or utility evidence was accessed or created. No push, merge, or commit was performed. No new heldout query set was authored; every generated query here is an exposed development control.

The user accepted the v1/v2 blockers and requested that v3 receive a distinct independent formal review. That future proposal is unproven here. This report does not approve its exact bytes, API/schema, all-action smoke, implementation, or admission.
