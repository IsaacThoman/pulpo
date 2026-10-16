# Independent successor design note — R31 remains rejected

All R27/R31 counterexamples are exposed development evidence. A successor needs its own frozen implementation, independent review/authoring and unchanged legacy/invariance/cost gates. This note is a sufficient-design argument and identifies implementation proof obligations; it is not a measured candidate or permission to change any R31 verdict/oracle. It does not use the unread R31 payload.

## Canonical selection must precede truncation

Normalize the Spanish interpretation once, preserving ñ and folding vowel accents/canonical composition, then deduplicate/sort its tokens. Match conjunctively against each entry's explicit English-plus-Spanish vocabulary, with at least one Spanish witness, using bounded immutable indexes. Select localized identities using a score determined by that canonical token set and stable catalog identity. A canonical alias-token-set match can rank ahead of other prefix matches; raw whole-name string equality cannot choose which identities survive the cap. Repetition/order/punctuation variants must select the same localized set. Phrase-specific presentation can reorder an already selected set if the contract permits it, but cannot promote an outside identity into the capped set.

This resolves the demonstrated empty-English examples without disabling Spanish aliases, excluding particular words or changing thresholds. It is **not a complete proof** with the legacy tier present.

## Legacy membership and spare-budget interaction

For fixed action, limit and history, let `L(q)` be the original baseline list. Equivalent localized queries can have different legacy English membership/counts because that interpretation intentionally retains its old phrase syntax. Consequently `limit - len(L(q))` can differ. Even a perfectly canonical alias ranking produces different additions when truncated to those different spare budgets. A localized identity can also be a legacy result in one variant but not another. Merely fixing exact-alias promotion does not prove the full invariant.

A sufficient conservative construction is:

1. Let `T` be the canonical localized token set and `G(T)` all admitted query forms equivalent under that localized interpretation, keeping action/limit/history fixed.
2. Independently derive an envelope `E(T)` containing the union of **all** baseline `L(q)` for `q in G(T)`. It may be a conservative superset, but must have a proof that no relevant legacy result is omitted.
3. Reserve `min(limit, len(E(T)))` slots. Select the canonical localized set `A(T)` outside `E(T)`, with size at most `max(0, limit - len(E(T)))`.
4. Merge exactly the unchanged legacy `L(q)` subsequence with this fixed `A(T)`; any permitted exact/prefix presentation must preserve that legacy subsequence and the selected identities.

Then additions are the same `A(T)` for every equivalent query, duplicates cannot arise against `L(q)`, and the result remains within the existing cap. If one variant fills the cap with legacy entries, no equivalent variant can safely receive extra localized results under all these requirements. That is a real interaction between the frozen guarantees, not a reason to overflow caps, evict English results or weaken invariance.

Do **not** enumerate token permutations/repetitions/punctuation variants: that conflicts with bounded query costs. A practical implementation must derive a safe envelope from indexed English vocabulary and normalization semantics, accounting for ignored words, phrase/compact-name matching, apostrophe removal, punctuation and ñ's different English folding. Computing only `L(canonicalQuery)` is insufficient. An envelope can be conservative and leave fewer additions while still supporting Spanish/mixed queries with spare proven capacity; it must not be the entire catalog for every query, which would disable the feature. Utility and cost gates determine whether a useful implementation exists. If no efficient useful envelope can be proved, report that limitation for independent adjudication rather than claiming a simpler merge already meets the contract.

## Independent development challenges before another reveal

Exercise zero/one/many spare slots, limits 1/2/48/60, >cap synthetic catalogs, order/repetition/case/NFD/punctuation equivalents, fixed recents/tone variants, and localized identities already present in only one variant's legacy list. Include equivalent variants with different legacy counts, not only examples where both legacy lists are empty. Preserve literal ASCII one-character lists, generic fresh n/ñ pairs and absent-glyph controls. Check set membership separately from top-rank usefulness and legacy-subsequence preservation. No nonempty-only usefulness proxy.

Reuse immutable normalized vocabulary/postings instead of rebuilding English indexes or retaining per-query caches. Keep resource and retained/peak budgets unchanged. Run a newly scheduled quiet paired optimized batch with all samples retained; unavailable host conditions cannot pass. Numeric core thresholds do not establish native initialization/first-search latency. Native work follows source/core admission and remains separate. These are requirements for the new experiment, not post-reveal repairs to R31.
