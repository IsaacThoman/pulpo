# R34 independent domain/protocol review

Decision: **REJECT these exact normative bytes.** The fixed-envelope idea addresses varying legacy occupancy only if the envelope is complete and invariant for the same canonical localized token set. The present definition does not establish both properties across the two specified tokenizers. No production edits are approved by this review. No normative file was edited.

Reviewed baseline: `e6871a164cfbc2eca4d0b3da700364a55e4e4dcb`.

## Exact normative bytes

SHA-256:

```text
0185dcba26a78fc439665992f80e2d1286a3cbea669fab4b74fca74813703343  contract.md
3a0dbd2a3580d5d7d7b42cbd09df9edd8ef2d2b028c9eb2745cb5e16e8d818f0  schema.json
0d3fa174bc8eb61f94d3b83afdd9367f7f8ef2d44933df8b2f6c2464aeb74e30  api-map.md
```

## Blocking domain witness: English apostrophe joining

The contract says all punctuation separates Spanish words, and query tokens are canonicalized before matching/ranking/caps. Legacy English normalization instead removes straight and curly apostrophes without inserting a space. This distinction applies to arbitrary fixture names, not only shipped names.

Use this decoded fixture, in this order:

```json
{"version":"fixture","categories":[{"id":"fixture","name":"Fixture","emoji":[
  {"e":"😀","n":"foo'bar","k":[],"v":1},
  {"e":"🐙","n":"unrelated","k":[],"v":1,"s":"foo bar"}
]}]}
```

At direct limit 1, the baseline executable returns:

```json
[
  {"query":"foo'bar","values":["😀"]},
  {"query":"bar foo","values":[]},
  {"query":"foo bar","values":[]},
  {"query":"foo'bar foo'bar","values":["😀"]}
]
```

Every query has the same sorted unique Spanish token set `["bar", "foo"]`. The reverse-order query uses the canonical words after punctuation separation. `🐙` is an eligible localized candidate for all four queries, with identical ranking inputs.

Two possible readings of the current envelope both cause a problem:

1. Build it from the canonical punctuation-separated tokens. The English vocabulary of `😀` contains `foobar`, not a word beginning `bar`. The envelope omits an actual baseline result for `foo'bar`. It reserves zero slots and admits `🐙`, producing two results at limit 1 if the specified append policy is followed. A final truncation would instead change localized membership across equivalent token sets.
2. Build it separately from legacy-normalized raw-query words. The envelope contains `😀` for `foo'bar` and its repetition, but is empty for `bar foo` and `foo bar`. The first queries reserve their only slot, while the latter queries admit `🐙`. Localized membership therefore depends on the spelling/order of the same canonical token set.

The exact definition must make the envelope both a conservative superset of legacy results and a function of the canonical token set. This requires explicitly accounting for legacy apostrophe joining (and independently checking other tokenizer differences, including digits), rather than weakening the canonical membership/order invariant or changing legacy English behavior. This review does not prescribe or approve an implementation.

## Protocol objections requiring normative clarification

The schema is a capability descriptor rather than a complete typed input grammar. An independent runner cannot claim exact static validation without inventing rules for at least:

- The shape and allowed fields/types of `families`, including how cases reference declarations.
- The accepted `stratum` values/type, and the reference semantics/type of `equivalentTo`.
- The numeric bounds for the described “bounded integer preferences”; the legacy 0...2 *effect clamp* is not an input bound. The signed range/type for `limit` also needs to be explicit.
- Conflicting repeated aliases for a present fixture glyph: reject, first wins, or last wins. The API map specifies glyph injection but gives no collision rule.

These must be specified before a runner author freezes strict acceptance/rejection behavior. Unknown-field rejection alone does not resolve them. The reviewer has left `contract.md`, `schema.json`, and `api-map.md` untouched.

## UX assessment

If a complete invariant envelope is supplied, reserving its capacity and intentionally leaving some slots unused is mathematically coherent. It can hide a Spanish exact match even when the actual English list is short or empty. The contract acknowledges this limitation, prioritizes English order, excludes controls from useful-family counts, and requires reporting useful accepted alternatives. Those are honest reporting requirements; the policy itself is not evidence of useful Spanish coverage. Actual family-level target/rank results remain required.

## Executed checks and limits

Compiled only the baseline `EmojiCatalog.swift` plus an independent minimal `@main` witness with terminal `swiftc -O`; ran it successfully. Executable/source/output are under `/tmp/r34-protocol/envelope-witness{,.swift,.json}`. The witness decodes the JSON above with `JSONDecoder`, constructs `EmojiSuggester(catalog:)`, and calls `search(_:limit: 1)` for the four literal queries. All four baseline outputs above were observed, including ignored optional `s` on the baseline. This is a domain counterexample smoke, **not** full API/schema admission.

Full all-action smoke, `runner.swift`, `smoke-runner.py`, and `compare.py` were not implemented: the task makes that work conditional on domain approval, which these bytes did not receive. Full coverage and admission remain unavailable, not passing. No baseline core/service test totals were independently rerun or certified here. No future blind suite or payload was authored, opened, or executed. No R31 sealed artifact or R31 source was read. No production edits, Xcode builds, devices, push, or merge occurred.

Next gate: resolve the normative objections, provide the revised exact bytes for a new independent domain review, and only after approval freeze the runner/schema validation and execute the complete baseline protocol smoke before production changes.
