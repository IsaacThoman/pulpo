# R34 independent domain/protocol review v2

Decision: **REJECT these exact normative bytes.** The revised envelope fixes the specific apostrophe/digit joining objection, but its required completeness over arbitrary Unicode inputs is false. No production changes are approved. Normative files were not edited by this reviewer.

Reviewed baseline: `e6871a164cfbc2eca4d0b3da700364a55e4e4dcb`. Current audit-history HEAD at review start: `30649270` (`docs(emoji): archive R34 initial contract review`). The three revised normative files were already modified in this checkout at review start.

## Exact normative bytes

SHA-256:

```text
f79ad27ed956ddfaf2c0cf72e6ae28be7a116fcfea48e3f1866f11e3ad08d014  contract.md
3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a  schema.json
0f8fa0472cb429e6019656a99755bc5f91f24e280d34915312c2ffca0960cfa9  api-map.md
```

## Blocking arbitrary-input witness: a retained English combining spacing mark

The contract says localized normalization canonically decomposes and “folds combining marks only after vowel bases.” U+093E DEVANAGARI VOWEL SIGN AA has Unicode general category Mc, **Spacing Combining Mark** (`Unicode.GeneralCategory.spacingMark`). In `a\u{093E}b`, it follows vowel base `a`, so that rule removes it and produces canonical token `ab`. This witness does not depend on whether decomposition treats nonspacing accents as equivalent; Mc is itself a combining-mark category. Narrowing the rule to a smaller category would change the normative bytes and require another review.

Legacy English normalization on the actual runtime retains U+093E under Foundation `.diacriticInsensitive`/`.caseInsensitive` folding, and `CharacterSet.alphanumerics` retains it as well. Therefore `legacyNormalized("a\u{093E}b")` is still `a\u{093E}b`, which does **not** contain substring `ab`.

The independently decoded fixture, in this order, is:

```json
{"version":"fixture","categories":[{"id":"fixture","name":"Fixture","emoji":[
  {"e":"😀","n":"a\u093eb","k":[],"v":1},
  {"e":"🐙","n":"unrelated","k":[],"v":1,"s":"ab"}
]}]}
```

Observed optimized baseline direct-search outputs, each at limit 1:

```text
raw query a\u{093E}b  canonical tokens [ab]  English envelope []  baseline [😀]
raw query ab          canonical tokens [ab]  English envelope []  baseline []
raw query ab ab       canonical tokens [ab]  English envelope []  baseline []
```

The baseline ignores optional `s`; these are measured legacy outputs, not claimed Spanish successes. The exact legacy name is sufficient to produce the first result. The English vocabulary for that entry is its single word/compact form `a\u{093E}b`; it contains no `ab`. `unrelated` contains no `ab` either. Removing legacy ignored words changes nothing for this witness.

Under the specified localized semantics, `🐙` is an eligible Spanish exact token-set match for all three raw queries. Its membership/ranking inputs are identical, and it is outside the empty envelope. The policy reserves zero slots, admits it at limit 1, and appends it to the first query's baseline `[😀]`, producing two outputs at limit 1. Truncating instead would suppress the localized result for only the first query, violating localized membership invariance across the identical canonical token set. Evicting `😀` would violate legacy preservation. Thus the envelope's advertised completeness is false and these requirements cannot simultaneously be implemented as written.

The distinction from round 1 matters: substring matching now handles pieces joined by an apostrophe or separated by digits, but it cannot find a canonical piece that results from **deleting a character that legacy English retains inside the term**. An executable arbitrary-control gate remains necessary; it cannot turn the false mathematical premise into a production approval. Any revision must preserve the cap, English subsequence, and localized canonical membership/order invariant together. No particular fix is approved here.

## Remaining domain and grammar assessment

The revised capacity argument is sound conditional on a complete envelope: for fixed canonical tokens, its count, excluded entries, and localized ranking are fixed. If the baseline list is a subset of that envelope and has length at most the requested cap, reserving `min(cap,envelope.count)` guarantees combined length at most the cap. That conditional premise fails above.

The revised API map explicitly resolves the prior families, stratum, reference/cycle, Boolean-versus-integer, bounded-number, action-field, and duplicate-alias ambiguities. No additional grammar blocker was identified by this read. This is a static review finding, not certification of an implemented validator or all-action runner.

The deliberately conservative reservation policy openly admits Spanish suppression and unfilled capacity. Reporting accepted useful targets/ranks grouped by independent semantic families, and keeping unavailable rows in the denominator, is an honest scope. It remains unmeasured utility, not evidence of a worthwhile product outcome. The arbitrary fixture witness is a safety control, not a utility family.

## Executed evidence and unavailable full smoke

The review compiled **only baseline** `EmojiCatalog.swift`, baseline `EmojiSearch.swift`, and the independent witness with `swiftc -O`, then executed the resulting binary successfully. Compiler: Apple Swift 6.4 (`swiftlang-6.4.0.34.1`, clang `2100.3.34.1`), target `arm64-apple-macosx27.0.0`.

Reproduce from this checkout:

```sh
mkdir -p /tmp/r34-protocol-v2
swiftc -O \
  apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiCatalog.swift \
  apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiSearch.swift \
  apps/keyboard-ios/audits/multilingual-emoji-r34/protocol-v2-unicode-witness.swift \
  -o /tmp/r34-protocol-v2/unicode-witness
/tmp/r34-protocol-v2/unicode-witness
```

The executable writes `/tmp/r34-protocol-v2/unicode-witness.json`. Exact source and observed output are retained alongside this review as `protocol-v2-unicode-witness.swift` and `protocol-v2-unicode-witness.json`.

SHA-256:

```text
c7f929ada6398c9c849e1b764e7bdacc3aca6956f3444fa74953db43cea5468e  baseline EmojiCatalog.swift
10258fab0b30f82d17be2a6358b68fe93b1d3930e0b0bd3d32c159579be781a2  baseline EmojiSearch.swift
236c05f9cd89246368869b7079be9a9e001fd1449d0bd9c32a609ae14f901715  protocol-v2-unicode-witness.swift
b6870a1ac2e478fcd00089ffff754a95443fc62049c519970e09977b745aba55  protocol-v2-unicode-witness.json
```

This is an executed domain counterexample, **not full executable protocol smoke**. `runner.swift`, `validate.py`, `smoke-runner.py`, the full arbitrary-control suite, and `compare.py` were conditional on domain approval and were not implemented. All-action/optional-parameter execution coverage, comparison behavior, candidate controls, and full baseline protocol admission remain **unavailable, not passing**. No baseline Spanish success was inferred from the ignored field.

The rejection and exact hashes were sent to the parent in flight via `t3_thread_send` before finalizing this report. No candidate source, blind payload/source/result, R31 sealed artifact, native build/device, network, push, merge, or parent-checkout edits were inspected/performed. Baseline source was read solely for normalization/API review and standalone compilation. Only audit evidence was added in this checkout; no production code or normative file was edited.

Next gate: revised exact normative bytes need a new independent domain review. Only after approval may the full runner/validator/comparator be frozen and the complete baseline all-action smoke be executed. Production remains gated on both.
