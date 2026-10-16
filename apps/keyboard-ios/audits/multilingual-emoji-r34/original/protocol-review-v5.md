# R34 independent DOMAIN review v5

Decision: **APPROVE the domain policy in the exact normative bytes below.** No further domain blocker was found. This is a priori policy approval, not implementation/source approval or production admission. Full executable all-action protocol smoke remains required before any production change.

Reviewed baseline: `e6871a164cfbc2eca4d0b3da700364a55e4e4dcb`. Both Swift baseline files linked by the witness were verified byte-unchanged against that commit. Read the current contract, complete schema/API map, reviews v1–v4, and v4 witness source. No normative or production files were edited.

## Approved exact bytes (SHA-256)

```text
bebb6034c35bfb576e39f033013ac560a24d15f5128fc2490199b08cb66d5d01  contract.md
3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a  schema.json
0f8fa0472cb429e6019656a99755bc5f91f24e280d34915312c2ffca0960cfa9  api-map.md
```

## Completeness and capacity assessment

V5 specifies the intersection of Foundation letters and the five Swift base-letter categories for BOTH localized base admission and coarse projection. Its explicit Mn/Mc/Me handling precedes base admission. Thus Foundation's inclusion of marks cannot retain Mc inside a projected English term, and Swift's recognition of a new letter cannot admit a letter that legacy Foundation normalization discards. The same projection is applied to canonical tokens and to normalized full English terms, words and compact forms. These are substantive repairs to v2–v4, not renamed predicates.

The conservative substring envelope also covers the v1 split/join discrepancy: each canonical punctuation/digit-separated piece can occur inside a projected English term. Including full normalized terms and compact forms covers legacy whole-phrase, exact-name and compact paths as well as individual words. Removing marks and non-base characters from BOTH projection inputs bridges the specified localized vowel deletion and retained consonant marks. Empty projected tokens and all-ignored requirements reserve the whole catalog. Reservation uses canonical tokens only, and never supplies actual substring eligibility. Spanish ñ remains distinct in matching.

For fixed canonical tokens, let E be that envelope, L the actual legacy list, and c the effective positive cap. The required inclusion L ⊆ E gives |L| ≤ min(c, |E|). The localized tranche excludes all E and has length at most c − min(c, |E|), so append cannot overflow or duplicate L. E, tranche eligibility and all ranking inputs are canonical; the selected localized membership/order therefore stays fixed across token reordering/repetition and fixed preferences, even when L changes. The baseline list remains its exact prefix. Empty/nonpositive/overlong inputs and the ASCII single-token guard add no localized results. This preserves the stated invariant without changing legacy ordering or truncating the appended tranche per raw query.

Unused reservations can suppress a Spanish exact match while actual English output is empty. That is still an acknowledged product limitation requiring useful-family measurement; this approval does not count conservative reservation, synthetic controls or added arrays as utility.

## Executed independent evidence

`protocol-v5-domain-witness.swift` links only unchanged baseline catalog/search sources. Independent policy functions calculate canonical tokens, projection, envelope, prefix eligibility, canonical ranking and fixed merge. The JSON labels measured baseline arrays separately from calculated localized/merge controls; baseline decoding ignores `s`, and no baseline Spanish success is claimed.

An optimized standalone run passed **3,432 capacity rows and 180 fresh Unicode fixtures**, plus orthography, conjunction and ranking assertions. Every capacity row checks measured legacy inclusion in the envelope, cap/deduplication, exact legacy prefix, and invariant calculated tranche at caps 1/48/60 under two preference maps. Sampling is bounded and disclosed, not an exhaustive Unicode proof or a candidate test. The fresh fixtures use 29 selected scalar values plus 32 deterministic samples (one surrogate is skipped), in vowel, consonant and Greek contexts, with canonical reversal/repetition. Scalar classifications are retained in JSON.

Inherited findings are accounted for explicitly:

- V1: straight/curly apostrophe joining, digit separation and punctuation exact-name controls now reserve the measured legacy result.
- V2/v4: U+093E after `a` becomes localized `ab`; the English term projects to `ab` too. The 60-entry fixture reserves all 60 entries, including at caps 1/48/60, instead of overflowing. Mn and Me vowel removal/consonant retention are also asserted.
- V3: U+105C0 is excluded from base admission and projection on this runtime; the measured exact English result is inside the repaired envelope.
- R31: calculated `cara sonriente`/reverse/repeat ranking has no whole-string bonus; cap 1 keeps catalog-first L0. The 49-entry `corazón rojo` fixture gives identical canonical tranches of 1/48/49 at caps 1/48/60. These are policy controls, not results from a candidate or the old R31 material.
- R27: measured baseline search retains ASCII/case/NFD compatibility for vicuña/são/piña. The contract still requires unchanged English/contextual/resource behavior and its construction/query/memory budgets. No cost or candidate regression result is certified here; previous rejected rounds remain rejected.
- Conjunctive English/Spanish matching stays within one entry; a substring-only English suffix does not qualify. Pina/piña remain distinct in Spanish, non-ASCII ñ can qualify, vowel case/NFD controls agree, and the ASCII one-letter guard adds nothing.

Compiler: Apple Swift 6.4 (`swiftlang-6.4.0.34.1`, clang `2100.3.34.1`), `arm64-apple-macosx27.0.0`. Reproduce from this checkout:

```sh
mkdir -p /tmp/r34-protocol-v5
swiftc -O \
  apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiCatalog.swift \
  apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiSearch.swift \
  apps/keyboard-ios/audits/multilingual-emoji-r34/protocol-v5-domain-witness.swift \
  -o /tmp/r34-protocol-v5/domain-witness
/tmp/r34-protocol-v5/domain-witness /tmp/r34-protocol-v5/domain-witness.json
```

The retained JSON is `protocol-v5-domain-witness.json`; `protocol-v5-hashes.sha256` binds normative files, baseline sources, witness source/output and this report. Executables remain outside the repository under `/tmp/r34-protocol-v5`.

## Remaining gates and scope

Static schema/API review found no new grammar blocker. The map resolves field types, integer/Boolean distinctions and bounds, aliases, families, action-specific fields, equivalent references/cycles, query echoes and base values. This does not certify the independent protocol engineer's runner, strict validator, all-action smoke, comparator or exclusion checker; none was read, run or edited in this task. Their full executable gate is **required and not passing evidence from this review**.

No hidden/candidate/old-candidate material, R31 sealed file, blind rows or targets were read or run. No production/normative/parent edits, Xcode/device/native run, network, push, merge, or repository binaries occurred. No useful-family, privacy, native/contextual safety, cost, blind admission or implementation correctness claim is made. Source review belongs to a new task after production changes. Exact-byte domain approval plus complete executable smoke are prerequisites, not substitutes for later admission gates.
