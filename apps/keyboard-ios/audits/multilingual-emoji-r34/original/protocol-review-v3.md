# R34 independent domain/protocol review v3

Decision: **REJECT the v3 normative bytes identified below.** An executed arbitrary-Unicode fixture disproves the claimed English-envelope completeness. No production changes are approved by this review. This report is exclusively about v3; the main contract was subsequently advanced to v4 by the author, and v4 is unreviewed here.

Reviewed production baseline: `e6871a164cfbc2eca4d0b3da700364a55e4e4dcb`. Audit-history HEAD observed during this review: `e5adb585fe78dc54e2f50e8863ef01c5702a5a8b`. The v3 contract was already modified at review start. The reviewer did not edit any normative or production file.

## Exact reviewed normative bytes

These hashes were captured before the concurrent v4 revision. They identify the reviewed bytes, not the current main contract.

```text
b306b8a1690e07190d1c02fa67ba66806ed7d654a463416922ba7c09a59e9ad0  contract.md (v3)
3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a  schema.json
0f8fa0472cb429e6019656a99755bc5f91f24e280d34915312c2ffca0960cfa9  api-map.md
```

## Executed blocking witness: Unicode letter classification differs before projection

The same Foundation folding and letter-only projection on both sides does not recover letters already removed by legacy English normalization. On the actual review runtime, U+105C0 has Swift scalar `generalCategory == .otherLetter`, but both Foundation `CharacterSet.alphanumerics.contains` and `CharacterSet.letters.contains` return false. This is measured behavior, not a conjecture about Unicode support.

The v3 projection retains Unicode letter scalars (Lu/Ll/Lt/Lm/Lo). Legacy English normalization first uses Foundation `CharacterSet.alphanumerics` and therefore replaces this scalar with a separator. The contract expressly puts English normalization before the reservation projection. Applying identical projection functions after that loss is insufficient.

The decoded fixture, in order, is equivalent to this escaped JSON:

```json
{"version":"fixture","categories":[{"id":"fixture","name":"Fixture","emoji":[
  {"e":"😀","n":"a\ud801\uddc0b extra","k":[],"v":1},
  {"e":"🐙","n":"unrelated","k":[],"v":1,"s":"a\ud801\uddc0b extra"}
]}]}
```

Here `\ud801\uddc0` is U+105C0; the Swift source uses the explicit scalar escape `\u{105C0}`. Both base glyphs are unique. Baseline JSON decoding ignores optional `s`, as expected.

All three queries below have exactly the same sorted unique localized tokens: `["a\u{105C0}b", "extra"]`. Neither projected token is empty or a legacy ignored word. Their reservation projections retain U+105C0. The first entry's English normalization is `a b extra`, and its full normalized-name projection is `abextra`. Its words and compact form also lack U+105C0. The second entry's English name is `unrelated`. Consequently the specified envelope is empty for all three queries, even when full normalized English terms are included.

Observed optimized baseline search results at each of limits 1, 48, and 60:

- `a\u{105C0}b extra`: `[😀]`.
- `extra a\u{105C0}b`: `[]`.
- `a\u{105C0}b extra a\u{105C0}b extra`: `[]`.

The first legacy result comes from the unchanged exact-name path. The reversed/repeated queries are not exact names and do not pass legacy `isSearchText` on this host. Their empty output is observed, not inferred from a replacement English matcher.

The Spanish alias on 🐙 equals the first query. Localized normalization retains the letter; canonicalization gives the same two tokens for its alias and every query. Every token therefore prefixes a Spanish word of that entry, with a Spanish match present. It is an eligible localized candidate for every query and lies outside the empty envelope. No n/ñ relaxation, substring eligibility, synonym, or special word exception is used.

At cap 1, v3 reserves zero slots and admits 🐙. Appending it after the first query's actual legacy `[😀]` produces `[😀,🐙]`, exceeding the cap. Truncating that list removes 🐙 only for the first query, violating localized membership invariance against the reversed/repeated queries. Evicting 😀 violates legacy subsequence preservation. Thus the required invariants and fixed merge policy cannot all hold for these exact bytes.

The witness JSON separates measured `legacyValues` from calculated `requiredAppendValues` and `requiredAppendExceedsCap`. These calculated fields demonstrate the contract consequence; they are not candidate execution or baseline Spanish passes. All nine baseline rows, empty envelopes, canonical token equality, and localized prefix eligibility are checked with executable preconditions. Caps 48 and 60 were executed too; this two-entry fixture proves overflow specifically at cap 1, not at those larger caps.

This issue is distinct from the v1 apostrophe and v2 Mc witnesses: the loss now happens in legacy English normalization before the shared projection, rather than in the reservation projection itself. Replacing Unicode letter categories with another predicate would require explicitly specifying and independently reviewing that predicate and its interaction with legacy normalization. This review does not approve any proposed repair.

## Prior findings and remaining assessment

Read `protocol-review-v1.md`, `protocol-review-v2.md`, and the retained v2 executable source/raw JSON. V3's shared coarse projection addresses the documented apostrophe/digit joining and retained Mc deletion witnesses. It also keeps reservation separate from actual localized prefix eligibility, which is necessary to preserve Spanish n/ñ. Those repairs do not establish arbitrary-Unicode completeness, as the new executable witness shows.

The capacity argument remains sound conditional on completeness: an invariant envelope containing every possible legacy result lets a fixed localized tranche preserve caps and canonical membership/order. The premise fails here. Unused reserved capacity remains an honest product limitation; neither reservation correctness nor mechanically added arrays establish useful Spanish coverage. Independent useful semantic families, accepted alternatives, unique targets, and rank constraints still need measurement. Synthetic fixtures and normalization/order variants are controls, not utility families.

The schema/API map statically resolves the prior families, stratum, bounded integer/Boolean distinction, action-specific field, alias collision, and equivalence-reference/cycle ambiguities. No further grammar blocker was identified in this read. Static review does not certify an implemented validator, comparator, or complete API execution.

The inherited R27 construction/legacy-loss rejection and R31 whole-name/cap/order findings remain rejected historical findings. No candidate source was read or rerun to reassess them. This review does not weaken legacy subsequence preservation, canonical localized order/repetition invariance, or the 1/48/60 caps to accommodate this witness.

## Executed evidence and hashes

Compiled only baseline `EmojiCatalog.swift`, baseline `EmojiSearch.swift`, and independent audit Swift sources using standalone `swiftc -O`. Compiler was Apple Swift 6.4 (`swiftlang-6.4.0.34.1`, clang `2100.3.34.1`), target `arm64-apple-macosx27.0.0`. The final focused witness compiled and exited successfully, verifying nine rows. An exploratory scalar probe stopped after finding 20 counterexamples in 194,900 tested strings; it was not an exhaustive Unicode proof or a utility test.

SHA-256 of retained evidence:

```text
c7f929ada6398c9c849e1b764e7bdacc3aca6956f3444fa74953db43cea5468e  baseline EmojiCatalog.swift
10258fab0b30f82d17be2a6358b68fe93b1d3930e0b0bd3d32c159579be781a2  baseline EmojiSearch.swift
8d9a32666993644394aa5c2a45d470dd4e59b54e29dc40c55ddc88293b6f8339  protocol-v3-unicode-witness.swift
52e0d09c5271778a20bd6be33b21048cb85bcfa223da0a32ca479f2433658538  protocol-v3-unicode-witness.json
bab4946a83aecafcd8bc2eb26b7e487ff3a1926c944c867aca469aeb051511d5  review-v3-artifacts/projection-probe.swift
c5fb6a6398f3a524b09a656047789182148de2e3f676a20bc8220c7d72cbc3a7  review-v3-artifacts/projection-probe.json
```

Sources and raw JSON remain in the audit. During concurrent archival, the author moved accidentally archived executables to `/tmp/r34-review-v3-binaries` and committed their deletions. No further build or artifact was created after that instruction; only this report was completed.

The rejection, contract hash, witness location, and measured counterexample were sent to the parent through `t3_thread_send` before completing this report. The parent acknowledged and requested this exact-v3 report while advancing the main contract to v4 for a new independent task.

## Admission status and scope

Domain approval failed. Accordingly, the condition for implementing `runner.swift`, `strictvalidate.py`, `smoke-runner.py`, arbitrary-input controls, and `compare.py` was not met. Full baseline all-action/optional-field execution smoke and strict invalid-field rejection remain **unavailable, not passing**. No comparator rank/forbidden/equivalence/unavailable, fail-to-fail raw-row, or utility accounting behavior is certified here. This focused domain witness is not full protocol admission and does not authorize production edits.

No production/normative edits, parent-checkout edits, candidate/hidden/blind payload/source/result reads, R31 sealed-artifact reads, network, Xcode builds, devices, push, or merge were performed by this reviewer. Baseline source was read solely for normalization/API review and standalone compilation. No native, cost, privacy, contextual-regression, or useful-family outcome is claimed. V4 requires its own independent exact-byte review; no other work remains in this v3 task.
