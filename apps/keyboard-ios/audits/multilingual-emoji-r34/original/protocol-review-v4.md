# R34 independent domain/protocol review v4

Decision: **REJECT these exact v4 normative bytes.** A standalone optimized baseline witness reproduces an incomplete capacity envelope. Domain approval and the full baseline protocol gate are withheld. No normative or production file was edited by this reviewer. The subsequently proposed intersection predicate is **not reviewed or approved** here.

Reviewed baseline: `e6871a164cfbc2eca4d0b3da700364a55e4e4dcb`. Review-start HEAD: `24a7d069`. Only `contract.md` was already modified at review start. Both baseline Swift source files used below were verified byte-unchanged against that baseline commit.

## Exact normative bytes

SHA-256:

```text
240091fb804ba6b9b2ea29f2f0df286f266f67afca665a644cf2cc117925db39  contract.md
3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a  schema.json
0f8fa0472cb429e6019656a99755bc5f91f24e280d34915312c2ffca0960cfa9  api-map.md
```

## Executed blocker: Foundation letters includes combining marks

The exact projection instruction is fixed Foundation case/diacritic folding, canonical decomposition, then retention through `Foundation CharacterSet.letters.contains`. On this runtime that set includes U+093E DEVANAGARI VOWEL SIGN AA (Mc), U+0301 COMBINING ACUTE ACCENT (Mn), and U+20DD COMBINING ENCLOSING CIRCLE (Me). All three also belong to Foundation `nonBaseCharacters` and `alphanumerics`. Consequently that predicate does not implement the contract's assertion that the projection removes all retained spacing/enclosing/nonspacing marks.

U+093E gives the concrete failure. The inherited localized rule removes a combining mark following vowel `a`, making `a\u093Eb` the token `ab`. Baseline English normalization retains U+093E, as does the specified v4 coarse projection. The projected English term `a\u093Eb` does not contain substring `ab`. This reproduces the v2 deletion problem under the revised exact predicate, without using Swift Unicode category/isLetter for either letter admission or projection.

The minimal decoded fixture contains two entries, in order:

```json
{"version":"fixture","categories":[{"id":"fixture","name":"Fixture","emoji":[
  {"e":"E0","n":"a\u093eb","k":[],"v":1},
  {"e":"🐙","n":"unrelated","k":[],"v":1,"s":"ab"}
]}]}
```

At direct limit 1, optimized baseline search actually returns `["E0"]` for `a\u093Eb`, and `[]` for both `ab` and `ab ab`. All three canonical localized token sets are `["ab"]`. The exact envelope is empty for all three. The Spanish entry `🐙` is independently eligible as an exact Spanish token-set match, outside that empty envelope, for all three.

The fixed policy reserves zero slots and selects the same one-entry localized tranche for every query. Appending to the first legacy array produces `["E0","🐙"]`, exceeding limit 1. Truncating would instead remove `🐙` only from that query, violating canonical localized membership invariance. Evicting `E0` would violate legacy preservation. Excluding an entry outside the envelope would change the specified tranche policy. These requirements cannot all hold under the supplied projection.

The witness additionally constructs 60 distinct English entries with names `a\u093Eb suffix0` through `a\u093Eb suffix59`, followed by the same Spanish entry. The raw query finds 1/48/60 English entries at caps 1/48/60; `ab` and `ab ab` find none. All have the same `["ab"]` tokens and empty envelope. Required append exceeds each cap. No candidate source or behavior is assumed: the English arrays are measured baseline output, while Spanish eligibility and the required append are separately labeled contract implications.

Execution verified **18 rows** across 1-entry/60-entry English fixtures, three equivalent queries, and caps 1/48/60. Four rows exceed their cap under required append; six rows contain legacy results outside the envelope. Baseline decoding ignores `s`; this was never counted as a Spanish success.

## Inherited objections and remaining protocol scope

- V1 apostrophe joining: the v4 substring reservation includes the measured English result for `foo'bar` under canonical tokens `["bar","foo"]`. A `foo9bar` exact-name/digit-separation control likewise reserves its measured English result. These specific inherited witnesses no longer block v4.
- V2 Mc deletion: still blocking, as executed above. Mn/Me membership is recorded to establish the predicate mismatch; those two particular accented contexts fold away in English and are not claimed as additional failing witnesses.
- V3 U+105C0: Foundation rejects this newly assigned letter from both letter admission and English normalization. `a\u{105C0}b extra` becomes canonical `["a","b","extra"]`; the v4 envelope includes its measured English exact match. This specific inherited Unicode-version mismatch is addressed. The v1/v2 reports and v2/v3 witness sources were read initially. `protocol-review-v3.md` appeared during concurrent archival and was also read before completing this report; its rejection and exact witness agree with this inherited assessment.
- R27: the contract still explicitly preserves English diacritic compatibility, including the stated vicuna/sao/pina losses, and freezes the construction/query costs that previously failed. Those production/resource/cost checks were not rerun and are not passing evidence here.
- R31: canonical name-set ranking excludes a whole-string bonus, so reverse/repeat variants have identical specified localized ranking inputs. Fixed reservation would handle overfull membership/order only if the English envelope were complete. The present counterexample disproves that premise at caps 1/48/60. The stated `cara sonriente` and 49-entry `corazon rojo` obligations remain required future checks, not certified candidate outcomes.
- Spanish n/ñ distinctions, conjunctive prefixes, preferences applying only to legacy ordering, the ASCII one-letter guard, and the distinction between canonical controls and useful families remain stated obligations. No Spanish utility coverage was measured by this witness.

The conditional capacity argument remains sound: if every actual legacy result lies inside an invariant envelope E, reserving min(cap, |E|), excluding all E from localized candidates, and appending a fixed tranche cannot exceed the cap or change localized membership/order across the same canonical token set. V4 fails the required inclusion premise. Its claim of removing all mark categories also conflicts with its executable Foundation-only predicate; interpreting an additional mark exclusion would require clarified exact normative bytes, not reviewer invention.

Static API/schema review found no new grammar blocker beyond the domain rejection. The map still specifies typed fields, signed integer bounds, bool/float rejection, unique families/ids/bases/aliases, action-specific fields, reference/cycle rules, and fail-on-missing/unsupported inputs. That is a static finding only. Complete `runner.swift`, strict `validate.py`, all-action arbitrary-control smoke, `smoke-runner.py`, and honest `compare.py` were conditional on domain approval and were not implemented/executed in this rejected round. Optional-parameter coverage, candidate invariants, comparator rank/oracle/forbidden/equivalence/unavailable/fail-to-fail/accepted-alternative behavior, and full baseline protocol admission remain **unavailable, not passing**. No family usefulness or production admission is established.

## Reproduction and retained evidence

Compiler: Apple Swift 6.4 (`swiftlang-6.4.0.34.1`, clang `2100.3.34.1`), target `arm64-apple-macosx27.0.0`. Only baseline `EmojiCatalog.swift`, baseline `EmojiSearch.swift`, and the independent witness were compiled with `swiftc -O`.

```sh
mkdir -p /tmp/r34-protocol-v4
swiftc -O \
  apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiCatalog.swift \
  apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiSearch.swift \
  apps/keyboard-ios/audits/multilingual-emoji-r34/protocol-v4-unicode-witness.swift \
  -o /tmp/r34-protocol-v4/unicode-witness
/tmp/r34-protocol-v4/unicode-witness /tmp/r34-protocol-v4/unicode-witness.json
```

Observed stdout: `verified 18 rows; 4 violate cap under required append` (exit 0). Every expected English output, canonical token set, empty failing envelope, and repaired inherited envelope is enforced by executable preconditions. Only the small witness source, approximately 12 KiB JSON evidence, this report, and a hash manifest are retained under the audit. The compiled executable and transient output remain outside the repository at `/tmp/r34-protocol-v4`. Source/output/normative/baseline hashes are recorded in `protocol-v4-hashes.sha256`.

No normative changes, production changes, broad follow-up probe, blind/author/candidate/old-candidate source or payload reads, R31 sealed-artifact access, Xcode/device/native run, network, push, merge, or parent-checkout edits occurred. The proposed next predicate was acknowledged only as an unapproved future revision. Production remains gated on a fresh exact-byte independent domain approval followed by the complete baseline protocol smoke.
