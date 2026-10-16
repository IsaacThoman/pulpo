# R55 prefix-completion experiment: rejected

Parent: `ababd98ff5998f7a257f7e4d279a91512eac70e7`. PR: https://github.com/IsaacThoman/pulpo/pull/782 (linked; no publication from this checkout).

The separately bounded exact-prefix retrieval lane produced **zero visible utility gain**. Production source was restored byte-for-byte to baseline. Only this audit is retained. No blind fixtures were commissioned or executed, and no old sealed payload was opened.

## Result

The frozen public development cohort contains 108 rows: 54 completion-selection opportunities, 39 literal-selection controls, and 15 space actions across English, Spanish and bilingual modes. Baseline and candidate each provide 36 useful completion choices and 90 saved characters. All 36 counted choices actually fired and passed exact full-text/caret checks. Eighteen requested completions remain unavailable in both variants. Three whole-token `api_v2` literal selections remain unavailable because the actual composing literal is `v2`; these are retained unfired, not scored as successful controls.

The candidate changes 28 recorded candidate lists, but no visible strip, target top-eight membership, automatic decision, action-firing result, resulting text or caret in this cohort. No losses or gains were observed in those recorded outcomes. This is a public development rejection, not a blind accuracy result or population estimate.

`comparison.json` lists the identical unavailable cases and exact raw bindings. `verification.json` independently asserts that every counted useful choice fired and passed its text/caret oracle. `baseline/raw.json.gz` and `candidate/raw.json.gz` preserve exact compressed raw JSON bytes; their decoded SHA-256 values are respectively:

- `62493963fed79f31cb14ce2287d55a499bff0441794e8fd32a10426b83df6fa6`
- `64643a20bdf7cf216ebdfb995cbd3b4337fbb6b62d57bcbc5f61a584951e8600`

## Diagnosis and candidate

Exact prefixes already participate in the existing search. A shared eight-result unigram/edit-cost completion query can omit lower-frequency exact continuations, but adding them does not necessarily improve the three visible choices. Here, most intended misses were already retrieved or were below even a separate exact-eight budget.

For the exposed greeting diagnostics, the ordinary dictionaries place `hello` at frequency rank 13 among English exact `hel` continuations and 18 in bilingual; `hola` ranks 15 among bilingual exact `hol` continuations. Spanish `mañana` ranks first for folded `maña`. These ranks use a lexical tie break for diagnostics, not the heap's unspecified tie ordering. See `diagnose.py` and `exposed-greeting-diagnosis.json`. They explain why a separate exact-eight lane does not address the known greeting misses without changing ranking or budget. These known fixtures are not new blind targets. Actual Engine sentence-start context can already surface English `hello`, unlike the known context-free candidate criterion.

The archived `candidate.patch` added an exact-node query, capped at eight results and 128 processed heap entries, with existing scores and correction-preferred deduplication. It excluded neverSuggest/notAWord in the added lane and retained blocked/rejected filtering. The original default 4,000-entry completion cap stayed unchanged. Eight additional language-model evaluations are the upper bound; 128 heap entries is not a total-operation bound because each node can push its children and terminals. No timing or performance admission claim was made.

## Freeze, reviews and limitations

`PUBLIC-CONTRACT.md`, `DESIGN.md`, `development.json`, `main.swift`, and `run.py` were hashed before candidate production edits in `preimplementation-bindings.json`. Independent preimplementation challenge is retained in `design-review.json`. Independent source/runner/evaluator review is retained in `source-runner-review.json`; it checked source restoration, patch-to-candidate source hashes, frozen files and compressed raw evidence, and agreed that rejection is justified.

Review found two evaluator limitations. The original summary awards savings from visibility without requiring action success; post-review `verify.py` checks every counted choice actually fired and passed, without rerunning either variant or altering raw outputs. This leaves the reported 36/90 unchanged. Space actions have no independent final-text/caret oracle; there are no nonempty trailing-text selections, blocked/rejected fixtures, touch evidence, ordinary autocorrection-on-space cases, or completion selections testing capitalized/canonical accent equivalence. Literal composed/decomposed accent controls and uppercase literal controls do exist. This cohort is sufficient to reject a candidate with zero development gain, but cannot certify the full public contract for promotion. No blanket preservation claim is made. Evaluator hashes were not part of per-run manifests, so these artifacts must not be treated as a sealed blind protocol.

The initial baseline runner and compilation succeeded; only its Python reporting step raised `KeyError: 'fullTextPass'` because Swift Codable omits nil optional fields. The reporting accessor was fixed to `.get` before candidate execution. Baseline raw was not rerun or altered. `execution.json` files retain structured compile/run receipts, binary hashes and this reporting failure. Successful compiler logs were never read and were removed with executables and duplicate uncompressed raw output.

## Validation and reproduction

Both variants compiled every KeyboardCore Swift source with `swiftc -O`, then ran the same frozen 108-row driver against the three production dictionaries and in-memory personal stores. Every run has source/resource hashes in `bindings.json`. `main.swift` uses real `KeyboardEngine.documentDidChange`, `suggestions`, `select`, and `insertSpace` APIs; unavailable choices are retained unfired. The driver uses a cursor-bearing `TextDocument` without physical devices or real accounts.

Production, services, assets, Engine and UI match the parent. Broad core/service tests, generic iOS build, simulator verification and performance sweeps were not run: the candidate failed the earlier development gate and was discarded. No push, merge, physical deploy, global preferences, unknown stores or parent edits occurred.

To inspect existing evidence without a keyboard rerun:

```sh
python3 apps/keyboard-ios/audits/prefix-completion-r55/compare.py
python3 apps/keyboard-ios/audits/prefix-completion-r55/verify.py
```

`run.py baseline` compiles current sources and executes only public development fixtures. To reproduce the archived candidate, first apply `candidate.patch` in an isolated checkout at the parent, run `run.py candidate`, and restore those two production files afterward. Use a copy of the audit to avoid overwriting original evidence. No existing sealed data is used by these scripts. Reproduction is not a fresh blind execution.
