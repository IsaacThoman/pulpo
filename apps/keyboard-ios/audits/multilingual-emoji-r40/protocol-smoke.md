Final v7 pre-production protocol freeze **PASS**: 569 generated controls + 7 arbitrary rows; every declared action/field executed, 131 invalid parser/schema inputs and 3 mandatory resource failures rejected. All 569 complete baseline rows are frozen by SHA256 `5d8050ee3065d4d09ddb7ea74b2caa932578d2c7bf62b5e00fe1c2ade74941b4`. No candidate implementation was evaluated.

Candidate assertions are fixed for every row, both ordered legacy prefixes, all 511 exact localized suffix assertions (including empty suffixes), and 119 SAME-(T,W,X) groups. The unchanged baseline supplied as candidate correctly exited **1**: 569/569 rows executed and checked; all 437 expected future localized failures retained, including the three inherited ñ failures. All 7 arbitrary rows were checked, with 1 expected localized failure. These are rejection-path results, never an implementation pass.

Evaluator-only replay accepted all 569 combined declared oracles; simultaneous corruption rejected 569/569, and separate one-row-at-a-time mutations also rejected 569/569. Independent arbitrary-suite replay accepted 7/7 and isolated mutation rejected 7/7. Abstract gate selftests reject mismatched contract/API/schema hashes, failed assertions, and runner failures. Passing replay is evaluator evidence only.

The independent baseline Mirror witness observed the actual FINAL bounded index for every row; all 569 legacy rows belong to E(W,X), 263 explicit envelope-count controls pass, and all 119 invariant groups have exactly the same C triple. Six raw orphan-Mc exact-name counterexamples preserve the rejected v6 implication failure. This finite check is separate from formal domain proof. Main reports independent v7 exact-bundle domain approval; this protocol run does not substitute for that report.

All 417 prior inputs, including the 147 inherited fixture arguments, remain. The original inherited fingerprint is checked before policy replacement. Exactly **90 localized suffix expectations** replace obsolete policy oracles. The compact replacement inventory also records 275 rows with changed oracle fields, including explicit false defaults; every exact before/after value is archived outside Git with its hash. Old v1/pre-v4/v4 assertions and failures remain archived and are never credited as v7 passes. 89 old/new control groups split by differing C are retained as independent per-row controls; the exact partition inventory is authoritative. No claim of invariance across different W/X remains.

The 152 added controls cover genuine mixed English red heart / Spanish corazón at cap1, EN/ES/mixed overfull catalogs at caps1/48/60, generic ñ and other non-ASCII alphabets/mark categories, preference/order/repetition/saturation, English ιnbar versus ñ/U+0345ñ, t'he joins, orphan Mc fallback, FF9E context, exact/compact/full-phrase names and final 12-posting bounds. Controls contribute zero useful semantic families.

Normative bundle (no contract edits):

- contract.md v7: `b2d87ff12173e5d43288becaa84dbdabf997373b94fedd8982228ff547351324`
- api-map.md, including the requested normative scalar tokenizer clarification: `273a68136943c8fd4635e23c3d97d9634c8bb6353abb4ffc5bb38c21233819ca`
- schema.json (unchanged): `3d764e105588c0f8da40f82313b6b3885e1a05cbad175fae9915deba1e74397a`

Runner, parser, validator, comparator and closed grammar are unchanged. API map/hash was sent to main and domain round6 before approval/source/author. Fixture policy gate binds the three exact normative hashes and rejects mismatches. Assertions may not be retuned after actual candidate evaluation or reveal.

Raw baseline, rejection, per-row checks, evaluator mutations, witness inputs and exact replacement arrays live under `/tmp/pulpo-r40-protocol-v6`. Old round1 artifacts remain under `/tmp/pulpo-r40-protocol`. The final exposure index is `protocol-exposure-index.json`; all listed material is exposed and must enter the parent's machine-only exclusions. No sealed/author-private payload or old implementation was read. Only unchanged baseline source was used, with hash verification of all seven owned production/test/resource files.

Exact executed commands (the fourth intentionally exits 1):

```sh
swiftc -O /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiCatalog.swift /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiSearch.swift /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/runner.swift -o /tmp/pulpo-r40-protocol-v6/baseline-runner
python3 /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/validate.py /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/protocol-arbitrary-suite.json
python3 /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/smoke-runner.py /tmp/pulpo-r40-protocol-v6/baseline-runner /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/LanguageData/emoji.json /tmp/pulpo-r40-protocol-v6/final-baseline --suite /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/protocol-arbitrary-suite.json --summary /tmp/pulpo-r40-protocol-v6/final-baseline-summary.json
python3 /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/smoke-runner.py /tmp/pulpo-r40-protocol-v6/baseline-runner /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/LanguageData/emoji.json /tmp/pulpo-r40-protocol-v6/final-candidate-rejection --candidate-runner /tmp/pulpo-r40-protocol-v6/baseline-runner --suite /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/protocol-arbitrary-suite.json --summary /tmp/pulpo-r40-protocol-v6/final-candidate-rejection-summary.json
cp /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/baseline-policy-witness.swift.txt /tmp/pulpo-r40-protocol-v6/baseline-policy-witness.swift
swiftc -O /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Emoji/EmojiCatalog.swift /tmp/pulpo-r40-protocol-v6/baseline-policy-witness.swift -o /tmp/pulpo-r40-protocol-v6/baseline-witness
python3 /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/verify-policy-witness.py /tmp/pulpo-r40-protocol-v6/baseline-witness /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/LanguageData/emoji.json /tmp/pulpo-r40-protocol-v6/final-baseline/protocol-exposed-smoke.json /tmp/pulpo-r40-protocol-v6/final-baseline/baseline-output.json /tmp/pulpo-r40-protocol-v6/final-baseline/protocol-exposed-oracles.json /tmp/pulpo-r40-protocol-v6/final-witness
```

Actual candidate command, reserved and **not run**:

```sh
python3 /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/smoke-runner.py /tmp/pulpo-r40-protocol-v6/baseline-runner /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/LanguageData/emoji.json /tmp/pulpo-r40-protocol-v6/candidate --candidate-runner /tmp/pulpo-r40-protocol-v6/candidate-runner --suite /Users/isaacthoman/.t3/worktrees/pulpo/t3-8973a5dc/apps/keyboard-ios/audits/multilingual-emoji-r40/protocol-arbitrary-suite.json --summary /tmp/pulpo-r40-protocol-v6/candidate-summary.json
```

`protocol-interface-freeze.json` records every frozen source/input hash. This completes the pre-production protocol gate. Main owns source implementation after its separate domain gate; actual candidate smoke, all7374 compatibility rows, ordinary tests, independent source approval, native safety and costs remain outstanding. Fresh source-blind author remains unauthorized until the specified exposed candidate/compatibility/ordinary/source gates pass. No production edits, native/device actions, cost claims, blind author/seal/reveal, push, merge or deploy occurred.
