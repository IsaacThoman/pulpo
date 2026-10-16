# R40 independent source-domain review, round4 — exact v5 REJECT

**REJECT exact v5. Its finite source-observable envelope is not unconditionally complete.** The exact-name implication `foldedName(q)==foldedName(e.name) ⇒ N(e)==W(q)` is false on actual host Foundation/Swift. Adding W to the identity differentiates the prior projection blockers but does not differentiate the new exact-name witness. The proposed tighter all-words envelope inherits this same failure. No production authoring, admission, successor normative bytes, or full protocol smoke is approved here.

Reviewed immutable contract SHA-256: `4f56b779b256182cfd12e087e59fcfa52ec2e797324d0cfbe5c69ebef9d87819` (`contract-v5.md`). Reviewed schema SHA-256: `3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a`; API map: `b21b136a7a7e2725853822f326939a6bd695a8f69a6e4ce545eedd97626b413f`. Baseline HEAD is `00e2a0e7a283bc4a780b02f847ea9d82dfe9e5ae`. `inputs.json` records source/resource/corpus hashes and runtime. Successor bytes were not read or approved.

## Small executable counterexample

Use two unique entries, E with English name `"\u{093E}ñ"`, L with English name `opaque`. Give L the hypothetical Spanish speech name `ñ` separately in the domain oracle. U+093E is DEVANAGARI VOWEL SIGN AA, an orphan Mc in these raw strings. No custom production Spanish implementation is used.

Compare q0=`ñ` with q1=`"\t\u{093E}ñ"`, just three Unicode scalars `[9,2366,241]`. Both have exactly the same v5 identity:

- T=`[ñ]`, because the orphan Spanish mark is discarded.
- W=`[n]`, from unchanged actual legacy normalization.

For E, N(E)=`["\u{093E}n"]`, and B(E) is empty because its normalized name is below the three-Character index minimum. L has N(L)=`[opaque]` and only opaque postings. Thus **both broad and tight envelopes are empty** for both queries.

Actual unchanged `EmojiSuggester.search` returns `[]` for q0 and `[E]` for q1, at caps1/48/60 and with both tested preference maps. q1 wins the actual exact-name dictionary: both folded names equal `"\u{093E}n"`. E's N is nevertheless different from W. The non-ASCII one-letter query ñ is expressly allowed to add localized results, so the ASCII guard does not exempt this case.

At cap1, useful internal-only capacity requires localized L because neither entry has either declared reservation witness. Legacy preservation requires E for q1. The declared fixed merge then yields `[E,L]`, exceeding cap1. Since q0 and q1 have the same C, simply omitting L for q1 also violates the fixed localized tranche and mandatory capacity. This is a source-domain contradiction, not an implementation bug.

`minimal.swift`/`minimal.json` retain 60 separate baseline rows for ñ, β, ø, ł, and ASCII multi-letter ab, two raw forms, three caps, and two preference maps. Thirty rows return an entry outside both envelopes; ten calculate a cap1 overflow. These are control variants of one mechanism, not useful semantic families. `blocker.swift`/`blocker.json` retain the longer independently reduced `"\u{093E}bar"` example, including tab/newline/carriage-return/space controls and 36 rows. These follow-up confirmations are separate from the main denominator and are not independent utility evidence.

## Why the exact-name lemma fails

`foldedName` and `normalized` do the same Foundation fold, but apply their next transformations in different orders.

For q1, actual Foundation retains the raw tab followed by the Mc. Swift grapheme segmentation treats the tab as a standalone whitespace Character and the following mark as a separate Character. `foldedName` splits the tab away and retains the mark, producing the exact dictionary key `"\u{093E}n"`.

`normalized` first maps Unicode scalars: the tab becomes ASCII space and the Mc survives `CharacterSet.alphanumerics`. The new sequence `SPACE + Mc` is now one whitespace Character. Its subsequent `split(whereSeparator: .isWhitespace)` discards both, leaving `n`.

Therefore Character whitespace splitting cannot be commuted past legacy scalar filtering/replacement. This is precisely an exact-path failure; neither Foundation-to-Spanish projection nor String prefix transitivity is needed to trigger it. Space alone provides a negative control: `" \u{093E}bar"` does not preserve the exact mark, whereas tab/newline/carriage return do. The diagnostic rows retain folded strings, Character whitespace classifications, scalar sequences, actual exact winners and final posting keys.

The main adversarial suite also finds an exact-name failure using U+0D4E MALAYALAM LETTER DOT REPH and CR/LF-style separator replacement: `"red\t\n\u{0D4E}\t\nheart"`. Broad E happens to include that result through a posting prefix, but the tight all-words conjunction excludes it. The exact N=W claim fails independently of whether another reservation witness accidentally masks the failure.

## Valid source facts and the tighter nonnormative suggestion

The final actual bounded postings are an appropriate finite source for indexed candidates. This harness observes the unchanged private `index`, `exactNames` and `emoji` fields with Swift Mirror rather than reimplementing index admission, ranks, winner selection or the 12-per-key bound.

For the two indexed sources, the proposed source argument remains valid:

1. A whole-query `collect` result has a retained key k with `k.hasPrefix(normalized(q))`. For nonempty normalized q, splitting that same Swift Character prefix at the same ASCII-space Character delimiter gives a first word in W that prefixes k. Each query word is also a whole word or final prefix of a space word in k. This reasons about the already normalized literal strings; it performs no additional Foundation or Spanish projection. If a separator is embedded in a grapheme, both sides use the same Character delimiter behavior. No assumption that arbitrary scalar prefixes are Character prefixes is needed.
2. A fallback result necessarily belongs to some per-word collect set for a nonignored w in W. The unchanged fallback then explicitly checks that every nonignored query word prefixes a member of `searchWords(of:)`. Subsequent preference leads, candidate bounds, ranking, requested caps and early decisions only remove/reorder candidates; they cannot invent an untraced entry.

Accordingly the proposed tighter indexed branch — actual posting-prefix witness AND every nonignored W word prefixes some V+ member — is supported for these indexed sources. V+ is actual legacy searchWords plus retained keys and their ASCII-space words; whole keys retain compact-query witnesses. The main executable whole-query/all-word assertions found no failure in those indexed implications. That support **does not prove the entire envelope**, because exact winners enter independently and bypass those indexed sources. The exact `N==W` branch is refuted above. Adding the tighter conjunction cannot repair an exact winner excluded by the exact branch. The provisional assessment in `provisional.md` is prominently superseded; its earlier exact-path assessment is withdrawn.

This review does not formally evaluate the subsequent proposed X component or any replacement exact-name predicate. A future round must bind its own exact bytes and check its own full source proof.

## Separate broad-envelope mixed-intent admission failure

One entry E has English `red heart` and hypothetical Spanish `corazón`. Query `red corazón` is genuinely mixed: English supplies red and Spanish supplies corazon. Actual baseline English search yields `[]`.

Broad E nevertheless includes E because retained `red heart` starts W word red. At cap1 this reserves the only slot and excludes E from localized candidates, producing no target. The tighter indexed conjunction correctly excludes E because no legacy word or retained-key word starts corazon, leaving one localized slot. `mixed.swift`/`mixed.json` preserve the actual cap1 baseline result and both calculated capacities.

The main overfull controls extend this to 96 eligible aliases, caps1/48/60, three preference maps, and fixed-C uppercase/NFD/order/repetition variants. All 135 fixed-C mixed rows across red corazón, green árbol and copper faro have zero broad localized capacity and full calculated tight capacity of 1/48/60. These are synthetic policy controls, not candidate outputs or useful semantic-family counts. Broad-v5 admits conservative suppression by its own narrowed capacity premise, but that premise fails the user's required useful mixed-intent admission. It is a separate design limitation from the decisive completeness rejection.

## Executed denominators and caveats

The completed `controls.jsonl` contains **134,925 raw rows** and `summary.json` records **406,122 assertions**:

- All **7,374 supplied exposed queries**, without filtering, times caps1/48/60 and three preference maps: **66,366** actual baseline search rows. Zero broad/tight completeness failures in this group.
- All **1,923 real entries**, with actual names, uppercase/NFD and reversed/repeated normalized-name words: **7,179 unique generated queries**, **64,611** actual search rows. Zero broad/tight completeness failures. This supplementary deduplication is explicit and does not alter the full supplied 7,374-row corpus.
- Unicode/context/exact controls: **364 unique queries**, **3,276** actual search rows. Three exact-N=W assertion failures; **18 broad** and **27 tight** returned-membership failures. The broad failures are two queries times nine cap/preference combinations; tight also fails the prepend exact query. All 48 failed checks remain in the denominator.
- Final bounded-posting saturation: **81** actual rows over 100 entries, including exact names, compact keys, phrases and fallback. Zero completeness failures.
- Overfull localized capacity: **585** policy-oracle rows over 13 synthetic controls, with actual baseline arrays. **576** preserve the original C; the other nine apostrophe-versus-space normalization rows have a different W and are explicitly reported as non-equivalent. All fixed-C capacity/order assertions pass for the tight policy in these selected fixtures; ordinary internal-only pure-Spanish controls also have empty broad envelopes. No passing fixture cancels the exact-path counterexample.
- Six prior-identity diagnostics: disclosed v1–v4 mechanisms have changed W in these pairs and are correctly distinct C identities. Old same-T contracts and all their reported denominators remain rejected.

The main run checks tight⊆broad, both legacy inclusion properties, exact winners' N=W, whole-key/all-word witnesses, policy cap/disjointness and capacity/invariance. Preferences are empty, alternating signed extremes, and uniform lead2. All actual result arrays are from the unchanged host implementation. Localized arrays and merged arrays are explicitly domain-oracle calculations; no candidate exists or ran.

An initial slow diagnostic was stopped and replaced with a run that precomputes invariant observation data and avoids repeatedly normalizing q inside each key test. Its **67,599 incomplete rows** are preserved in `controls-incomplete-slow-pass.jsonl`, excluded from all final completed-run counts. No rows were selected to obtain a pass. The full optimized run completed and retained its failures.

`api-controls.swift`/`api-controls.json` separately retain **342 baseline API rows**, with zero API-control assertion failures: direct/default search, negative/zero/ceiling/large caps, preferred extremes, default and exact contextual suggestions with both prefixes settings, wrapper buffers/recents/tones/empty/punctuation behavior, lookup, empty catalog, and history nonmutation. Wrapper history uses an in-memory UserDefaults subclass; no persistent preferences are written. These observations do not establish candidate contextual compatibility or full schema-runner smoke. The normative schema/API map was read; the actual strict arbitrary-suite runner and future s-decoding implementation were not exercised or approved.

## Reproduction, integrity and custody

Run `/tmp/pulpo-r40-domain-v5/run.sh`. All controls link the frozen unchanged EmojiCatalog.swift and actual Foundation; wrapper controls also link frozen EmojiSearch.swift. Host: Apple Swift 6.4, arm64-apple-macosx27.0.0; macOS 27.0.1 build26A434. These are host observations, not iOS measurements or a theorem over future runtimes. No exhaustive scalar scan was run. The source-trace counterexample establishes rejection without one.

`inputs.json` freezes normative and baseline inputs, `analysis-summary.json` preserves denominator breakdowns, and `hashes.json` freezes authored sources, binaries, raw outputs and this report. Production source copies still matched the live source at input finalization. All authored artifacts are under `/tmp/pulpo-r40-domain-v5`; repository files were read only. No candidate/old implementation, sealed payload or validator strings, private author material, native/device, cost/performance gate, push, merge, deploy or fresh author was accessed or performed. No delegated reviewer was spawned. The substantive change from same-T to C=(T,W) is acknowledged but remains insufficient for this exact draft. No successor exact approval is claimed.
