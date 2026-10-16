# R43 V3 independent final proof review

Decision: **accept V3 as bounded hosted workflow evidence for the narrow R43 repair.** The unchanged mandatory oracle independently reproduces baseline **8/12 (66.67%)** and candidate **12/12 (100%)**, with exit 1 and exit 0 respectively. Four workflows newly pass, eight retain passing status, zero retain failing status, and zero newly fail. Candidate `passed=true` and the runner's no-new-failure gate are satisfied. This is 12-row hosted workflow completion, not model accuracy or installed keyboard usability.

Both variants retain all 12 workflows and all 160 requested action observations. The unchanged-gold count is zero; eight workflows have identical final text/advance/list responses between variants and remain in the denominator. No favorable subset replaces the complete result. No production source, tests, driver, oracle, input/gold, reference, result or prior-round original was edited by this review. Only this report and its digest were written. Successful build/test logs were not read.

## Full paired disposition

| Workflow ID | Baseline | Candidate | Disposition |
| --- | --- | --- | --- |
| us_invoice_cent_repair | Fail | Pass | Required decimal globe touch/AX restored; literal 704.26 retained |
| es_balance_append_then_numeric | Fail | Pass | Region comma produces 18,02 instead of 1802 |
| mx_price_ascii_suffix_reversal | Fail | Pass | Required decimal AX globe restored; literal MXN 56.80 retained |
| eg_meter_decimal_fraction_repair | Fail | Pass | Region U+066B and globe produce 9٫30 instead of 930 |
| us_inventory_number_ascii_handoff | Pass | Pass | Retained control |
| es_landscape_ascii_serial_repair | Pass | Pass | Retained control |
| mx_secure_fraction_number_roundtrip | Pass | Pass | Retained secure numeric control |
| eg_secure_numeric_token | Pass | Pass | Retained secure numeric control |
| us_literal_bilingual_note | Pass | Pass | Retained ordinary prose control |
| es_literal_email_alias | Pass | Pass | Retained address control |
| mx_landscape_literal_query_url | Pass | Pass | Retained URL/page control |
| eg_secure_literal_punctuation_repair | Pass | Pass | Retained nonnumeric secure control |

There are no retained V3 workflow failures. Baseline's first four rows correctly preserve their explicit missing-key/action errors. Two already produce their expected final text but still fail the missing required switch callbacks; exact text alone is not workflow completion.

## Integrity, independence and execution provenance

All 110 baseline and 112 candidate manifest entries match the retained source snapshots. Baseline entries also match parent b5451e4211f0aa735233d5de8b98b5708c0e8a0d Git blobs; candidate entries match current worktree bytes. Only two production Sources files differ: KeyboardLayout.swift and KeyboardController.swift. The candidate includes two added core test files; the focused native test source is identical in both copied native projects and the worktree. `git diff --check` passes.

Master/copied executors, App.swift, localized Info.plist, project.yml and generated projects match all digests recorded by the pre-author source-runner review. Build SwiftFileLists independently point KeyboardCore/KeyboardUI at each intended snapshot and R43Tests at the corresponding copied native driver. Built baseline/candidate apps have distinct V3 bundle identifiers and en/es/ar localizations. Both structured build statuses are exit zero. Each of eight retained launch plists matches its receipt SHA and contains exact AppleLocale/AppleLanguages arguments for the intended Foundation locale. Their TestHost paths resolve to the corresponding variant build products. Each native summary reports one test passed, none failed or skipped, and each transport exit is zero. This provides source/build/launch provenance; transport exit is separate from semantic acceptance.

All six evaluation-freeze hashes still match source manifest, driver, orchestrator, fresh input, references and oracle. Author contract/protocol/input hashes match their files. The inventory correction, 430-check independent oracle admission, 64-action preflight and final source-runner review precede fresh authoring in the retained records. The author records exclusive access to contract.md and public-protocol.md, without implementation, tests, resources, earlier cases, driver, scorer or results. The new 12-task input is independently authored, rather than revealed V1/V2 gold rescored. No post-reveal source/gold/scorer retuning was observed. The earlier pre-inventory oracle remains present at its recorded hash.

All eight raw hashes match evaluation-receipt.json. Each raw locale group contains exactly its three requested IDs in exact order, without omissions, duplicates, reordering or extra rows. Merged outputs equal the corresponding raw rows, retain exact input order, and contain every requested action object/index in order. Independent unchanged-oracle executions reproduce both saved verdict JSON objects exactly. The runner requires candidate oracle exit zero plus passed=true and rejects any baseline-pass/candidate-fail transition; those conditions are met.

## Causality and complete native observations

Source changes resolve Foundation autoupdating region separators independently of EN/ES/bilingual typing mode, fall back to period for invalid supplied separators, and add the resolved separator to the controller layout refresh cache. Decimal plus required globe uses four .75-pitch controls within the existing three-pitch span, with unchanged gap subtraction. All ten ASCII digits, zero and delete remain. Existing nextKeyboard touch-list and AX-advance routes supply the visible accessible globe. Engine, learning/privacy/storage, host adapter, touch routing, accessibility implementation, ordinary layouts, R38 and other protected owners are unchanged. The two production candidate hashes are identical across all three rounds.

All candidate literal intermediate/final texts and cumulative callback counts pass the frozen scorer. Actual Foundation current/autoupdating identifiers are exactly en_US, es_ES, es_MX and ar_EG, with US/period, ES/comma, MX/period and EG/U+066B metadata. Requested and actually loaded en_US/es/en_es modes, host primary language and nonempty native stack identities are present. All three actual dictionary files independently match their positive byte counts and hashes: en_US 12,964,440 bytes, es 15,277,240 bytes, and en_es 27,391,648 bytes.

The mandatory scorer does not gate caret offsets or row-level post-disappear diagnostics. This review separately checked every recorded caret against the UTF-16 end of the corresponding literal before/after text. All 15 requested globe actions per variant preserve both text and caret. Candidate callbacks follow the separate one-advance AX and two-list touch contract; baseline missing routes remain failed. All 144 disabled-policy observations per variant preserve learning count and dirty flag, with continuous per-action observers. Secure standard, numeric, email and URL rows also preserve their recorded row counts through disappearance. These finite observations do not establish a lifecycle-wide privacy guarantee or change V2's retained oneTimeCode failure.

All four preflight raw hashes and exact row/action inventories were independently checked: seven rows, 64 actions, all seven supported action kinds and all four permitted generic key IDs. The secure standard preflight exercises privacy before numeric transitions, avoiding numeric-policy masking. The ordinary positive observer commits quartz followed by a space, changing count 0→1 and dirty false→true; the observer is nonvacuous. Preflight is disclosed developer evidence, separate from the fresh 12-row result.

## Geometry and supporting regression evidence

All 462 recorded candidate key views across 24 initial/final snapshots have true native keyIndex object identity, center/root routing and direct touch-routing observations. The driver records 377,637 dense sample points over these conservative rectangles, with five began/ended touch probes per key. Guaranteed rectangles use actual cap horizontal bounds and one point above/below clipped to KeysView bounds. This is sampled independently operable rectangle evidence, not exhaustive full hit-area measurement. Intermediate page geometry and arbitrary touch gestures are outside the protocol.

Every numeric snapshot retains exact digit inventory, delete, separator only for decimal, and globe iff required. Portrait numeric bottom targets have minimum observed width 71.75pt and height 44pt, with 43pt caps. The fresh landscape numeric snapshots are ASCII-number workflows: their bottom targets have minimum observed width 273.184pt and height 33pt, with 32pt caps. Decimal landscape is supporting focused-test coverage, not a fresh V3 decimal-landscape task. Existing short landscape targets are retained under the domain addendum; there is no blanket 44×44 claim. Ordinary prose has narrower targets, also retained and reported. One-handed requests/effective grid widths are recorded, including 332pt and 353pt docked grids; 852pt is a hosted width, not physical rotation.

The ordinary-validation artifact is byte-identical to V2's source-unchanged packet. It reports 445 baseline and 448 candidate core tests passing with the same five known issues: two recent-host-state ambiguity cases and three frozen multilingual completion cases. The baseline focused requirement fails the missing required numeric globe assertion. Two focused native tests pass and their source covers literal decimal/delete entry, original UIEvent/source identity, touch/AX callbacks, compact/docked/landscape geometry and largest accessibility content-size trait. These support bounded regression assessment; they do not establish model accuracy or physical performance.

## Prior rejected evidence and remaining limits

V1 remains rejected at baseline 5/18 and candidate 9/18, with nine retained failures. V2 remains rejected at baseline 6/18 and candidate 15/18, with three retained failures: fresh-v2-16-private-otp-literal-pages (allowed policy in nonsecure oneTimeCode standard observations), fresh-v2-17-private-address-return, and fresh-v2-18-url-symbols-to-prose-return (unsupported single-line-field Return behavior). All prior report digest tables, freeze artifacts and all eight raw receipt hashes per round independently remain unchanged. V3 does not turn those failures into passes. Its preregistered empty secure fixture and Return prohibition narrow the new supported protocol before new authoring.

This is actual hosted UITextField plus production controller/KeysView evidence with synthetic UITouch/UIEvent and direct accessibilityActivate. The field is manually mounted and never becomes first responder; it is not an installed UIInputViewController/UITextDocumentProxy experiment. There is no installed OS menu, spoken VoiceOver, physical rotation, real-device usability, Gboard comparison, host numeric parsing, throughput or accuracy claim. Locale-sensitive cache invalidation is supported by source inspection; a live region transition inside an already-running controller remains runtime-unverified. Invalid separator fallback has injected core evidence, not a naturally invalid native locale.

Apple's current [custom keyboard configuration documentation](https://developer.apple.com/documentation/uikit/configuring-a-custom-keyboard-interface) states that secure entry and phonePad/namePhonePad fields show the system keyboard. Secure and phone installed behavior is therefore an explicitly disclosed OS fallback; the hosted secure rows cannot prove custom extension eligibility. Accept this packet only for the bounded R43 locale-separator and required-numeric-globe repair within those evidence limits.

## Reviewed artifact SHA-256

| Artifact | SHA-256 |
| --- | --- |
| contract.md | c9e281d293e65f50465362e77d924a0af035cd67ff4e19ba56e88b1634cfef62 |
| public-protocol.md | 800a5622a95af9f237d23bbbcfc27091cd008bca7c43fb884b1460500f3a8ec4 |
| oracle-schema.md | 14557854c54a608293960500eea2acc5aa06b7cc39f821c428c4066f0b2e8c3d |
| author.md | f3721c6dce946ca170e1e3356120f1cc5f37d00538d0ecd7d75eb38123aee906 |
| source-runner-review.md | 300151846be98f4c7cffaf70f7b2e98f0fc426145839d6c984351ee5d8d6bc65 |
| oracle-review.json | 1295a78a6c41eaaf5b1038eb3630f095752589cc99bc2a03cfadfed7361c5098 |
| oracle-pre-inventory.py | d11ff21126709f41b99a2300b465d25dc9c13dd8047dcf9e8d5dc7ac6c3cda66 |
| source-manifest.json | 699be1c52b076140a57cd5bca6a3abc517b5c4733e0e19f2fc80beab25f61d3d |
| evaluation-freeze.json | 51141d1664965c23d1193304f31d7fc24094853ca439e8bb2954ce07b069650c |
| fresh-input.json | 3659d5d7801c2bd101d20bb9578092b048701cd2e46e600e42d6e05ed0ec2d3a |
| references.json | fac7d4b3676f8f04a2df40a9531edce940c9bed33e3129e5d8f03ad30a07f857 |
| oracle.py | 087bb4a9c6eda5a29cc394265dbdaddc8c6037a5344f323abab4ebd2ee35847c |
| native/R43Executor.swift | d025dfb413ac019ca75604466bcd97063f8e46218e6a3789980819639feafa31 |
| run-paired.py | 34b95ea7d2171e3045ca598af95c8de3150243f043d9717dd1be71a5ad0758d8 |
| run-smoke.py | 71fbb7fb884a19b0cf2f40d0b59cc48c26030ab276c93e4cf65db33408432970 |
| all-actions-smoke-receipt.json | 8a267c8cc4aa1cc47194774cf23ad473b2ead7fbe55fd988959f493870874c92 |
| baseline-output.json | e3ae8f256c53948b56c46b424cb447b5aa5c589b16aff34ea67efda10d28c89e |
| baseline-verdict.json | 7865ef163c7fa4ecb9e75f0be6639a426d26c4c99b6586002423f44ae95d7707 |
| candidate-output.json | 73d59fc54174e0d2fcab41afabf31822e456bd93573759074dd05beeadef7ec8 |
| candidate-verdict.json | 8381fb80817f86d7dd574e6783b8394696ef220aa98cc4d6f196b6cfd10afb54 |
| evaluation-receipt.json | 05fc5893ad8d2a41d089e6526c0b0ac7e3d4177106263e7b15ce6c21202f6d96 |
| build-status.jsonl | 724fe2c6d1a53e0ba2091f19934349c06fc01760cc40d619eca9e85010df98c0 |
| evaluation-status.jsonl | 12a2e828a13809e3201958ff7bb0dc7d0be01a33faedc68715f095429cc13306 |
| ordinary-validation.json | be3ef82eee38acb56d213e050e8f0448db1e3e22b03c85389b433cbd7bc3c6af |
