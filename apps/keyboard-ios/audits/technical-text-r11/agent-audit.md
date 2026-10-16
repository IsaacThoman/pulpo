# R11 technical text policy audit

Development freeze, 2026-10-16, before implementation or parent audit inspection. Base `e9f5d6bb07886039c74888a9a68747b3ac89a7a4`; isolated branch `t3/r11-technical-text`. No parent edits, push, deployment, or devices.

Raw development inputs stay outside Git at `/tmp/pulpo-r11-technical-dev/dev.json`: 68 cases, SHA-256 `76bd081477faea018fc05ded8e71787168bfe8f84010e0051b04ccb547e73b20`. Exclusions SHA-256 `64560d937c89aafd5ece21f54bdf3f75a93c950d9ed9c334ec08b6717953495c`. Full frozen protocol SHA-256 `b6513140eaef137efacae60ede9d4c0112eefe11e6ba670e2e8bb07f029bb902`.

Protocol: EN/ES with bilingual mode enabled; 16 path, 8 network, 8 identifier, 8 command, 16 ordinary correction, 12 boundary/private/code-switch controls. Every case declares language, literal versus ordinary intention, accent intention, initial before/selected/after document, typed Characters, field policy, and exact full-document oracle. Fresh engine/provider/settings/document per case; bundled dictionaries; actual `insertCharacter` including space, never direct ranking as the primary oracle. Compare exact document including punctuation, suffix, accents, case, and trailing spaces, without trimming/normalization. Preserve failures and unavailable controls in denominators. Also exercise native UIKit controller where meaningful after a core change.

Eligibility: development gain and no previously passing ordinary/safety regression, then freeze candidate before one independent heldout reveal. No post-reveal tuning. Independently authored heldout must receive protocol and exclusions, use separate worktree, and withhold inputs/results until candidate freeze. Published R10 path mutation `/tmp/notes.txt` to `/tmp/notes.text` is a known regression control only, never a fresh blind gain. R10 silla/sola remains separate and excluded.

Require useful typo correction, accent/code-switch protection, private-field policy, cursor/selection regressions; preserve English dictionary bytes. No per-word or file-extension exceptions, or blanket correction disable without counterbench. Report per-case outcomes, costs, experiments rejected, and generalization limits. Raw corpora/results, build logs, and xcresult must stay outside Git. Benchmark success alone does not establish acceptance.

## Candidate freeze, before heldout reveal

One measured candidate extends the existing whitespace-token literal policy to visible `/`, backslash, `.`, and a leading `--`. No dictionary/ranking/ordinary prose rule changes. Source SHA-256 `022fa5842c3dd89ba344ad2b3b363e99a2a0350cdeabf8d1cdd5b8dfc29d6362`. Development improves **48/68 to 63/68**, 15 gains, zero regressions; raw no-autocorrect adapter reproduces all 68 exact documents on both versions. All 16 dedicated ordinary controls retain their previous outcomes, including two existing misses. All four private controls preserve exact text and learn zero words.

The actual dispatch is `insertCharacter` for letters/symbols/alternates, `insertSpace` for space, and `insertReturn` for newline, matching the controller. The adapter uses default capitalization, punctuation, and learning settings, actual Shift for capitals and centered taps, reads suggestions after every key, and gives each case a fresh language stack and physical selection-capable document. Each case has a paired autocorrection-off adapter check; those checks never remove a failed oracle from scoring. Raw results include per-key elapsed time with suggestion refresh.

Pre-reveal regression validation: **444 KeyboardCore tests plus 3 service tests pass, with five known issues**, including all five new argument-driven policy tests over EN, ES, and bilingual stacks. These cover the published R10 path, ordinary punctuation after a path, external caret move, actual selection replacement, and secure/email/URL/one-time-code traits with zero learning/calibration. Source is frozen now; subsequent heldout results may reject it but may not tune it. Native controller tests are authored for immediate and batched host reports, filename selection, and private traits; native runtime remains unavailable under this task's no-device ownership constraint.

English dictionary SHA-256 stays `168c21378b29aa7fd37838aed910d64348b5267389abfd2dacd0598247cf1e64`. No per-extension or per-word exceptions. No ranking or blanket autocorrection-disable experiment was attempted. Extension whitelist and disabling correction globally were rejected before implementation because neither follows visible syntax while retaining nearby prose correction.

## Single heldout reveal and decision

Candidate commit `858225da` was frozen before any heldout inputs were read. The first independent author returned a 40-case draft with a request to clarify schema, not execution results. A second isolated author task changed only 11 `intention` enum values (`correction` to `ordinary`), preserving all targets/oracles; there were zero runs, removals, or static-invalid cases. The final heldout was frozen read-only outside Git, then revealed once. No source or runner tuning followed the reveal.

Author task IDs (each round tracked separately):

- `node:delegated-task:command%3Amcp%3Ae052de91-177f-438a-867c-d7ba3ca1de60%3Adelegate-task%3Apr782-r11-independent-technical-heldout-v1`
- `node:delegated-task:command%3Amcp%3Ae052de91-177f-438a-867c-d7ba3ca1de60%3Adelegate-task%3Apr782-r11-independent-technical-heldout-freeze-schema-v2`

Artifacts in `/tmp/pulpo-r11-heldout-author/`:

- Draft: SHA-256 `267569fc428a987c1c669cbefd9eab3bee4fde3667d871c4aee2021fc14efab8`.
- Final `heldout.json`: SHA-256 `e09f79099e2079245b37a24fccf730025eb978fd333b1ea8b26da19edaa79e89`.
- `authorship.json`: SHA-256 `8c8151da633c923fe2269aace4d78c9a85b8bd9427495ef06ec295f2ecb657f3`.
- `protocol.freeze.txt`: SHA-256 `d68ed6b7da5681a2b0403f23a1b44acf0d2f63a42e927403dafef0fdee60bc20`.

Heldout **27/40 → 30/40** exact, three gains, zero regressions, no other output changes. Gains are `h01` (preserve deliberate path segment before `.log`), `h06` (preserve unaccented segment of a Windows network path ending `.flac`), and `h07` (preserve `.db` path insertion before a newline). These use extensions not targeted by development and do not count the R10 published path. Keep the bounded syntax policy: development gains and safety nonregression hold, with limited independent corroboration. This is not broad accuracy or complete native UX acceptance.

Heldout ordinary category remains **1/8**, and all ordinary-intent cases including accents remain **3/11**. Those poor rates remain in the reported denominator. All 40 execute; no core field/selection controls are unavailable. `h38` fails its lowercase literal oracle on both versions: default sentence capitalization produces an initial capital in a secure field. The paired autocorrection-off adapter shows the same mismatch (39/40 raw matches); retain the failure without changing the oracle or subtracting it. All four private controls learn zero words; three match exact text.

Development paired raw checks match **68/68** on both versions. Dedicated ordinary correction stays **14/16**; including the boundary/code-switch ordinary category, **16/19**. Meaningful ordinary gains are not asserted: the candidate protects literals while preserving the useful corrections already present.

## Validation and remaining limits

- Release package: baseline with the added opt-in runner **439 core + 3 service tests**, candidate **444 core + 3 service tests**. Both retain the same five known issues: three multilingual offered-target expectations, plus composing-desync seed 227 and word-delete seed 440 host-revert ambiguities. Opt-in benchmark tests returning successfully are report generation, not acceptance verdicts.
- Published R10 exact English path: **0/1 → 1/1**, separately replayed using the actual engine; regression-only evidence, excluded from both fresh sets. Candidate regression test also covers all three language modes. R10 silla/sola was not changed or evaluated as this task's gain.
- iOS generic simulator `build-for-testing`: **TEST BUILD SUCCEEDED**, including compilation of `TechnicalTokenControllerTests.swift`. No device or simulator was listed, booted, driven, installed on, or tested. Three native test methods are **unexecuted/unavailable in this task**, retained as outstanding controller runtime validation (the first method has six mode/host combinations). Parsing and typechecking do not prove those scenarios passed. Parent must coordinate its own simulator ownership before native execution. No iPhone 17, Android, or E1C6B89D access occurred.
- The source stays at the frozen SHA-256 above and English dictionary bytes are unchanged. Parent checkout was read only. No push or deployment.

Remaining development misses: `n01`, `n02` mutate a bare domain's first fragment at its first dot, before literal syntax has become visible; `o02` does not recover its English typo; `o08` does not restore its Spanish accent; `b04` does not correct a selection replacement immediately before following text. Remaining heldout misses: `h09` has the same pre-dot domain limitation; `h23`, `h24`, `h26`–`h31` are existing typo/accent misses immediately before a following word; `h38` is the secure-field capitalization mismatch described above. No miss was repaired after reveal.

The policy uses visible syntax, not intent recognition. It cannot retroactively undo a correction made before a dot is typed, identify a bare command or lowercase identifier without syntax, or infer that an ordinary-looking word is a literal slug. Dots, slashes, or leading `--` can also occur in prose: unspaced sentences, slash-separated natural words, and prose following ellipses without whitespace may lose correction after the marker. The finite controls establish only the tested whitespace/punctuation contexts; they are not a population-weighted safety study. No delayed-dot, speculative rollback, or broad ranking experiment was tried. Such changes need new independently frozen tasks, not reuse of this revealed heldout.

## Reproduction and costs

All raw corpora, full-document per-case reports, logs, and xcresult remain outside Git. Frozen external inputs must be retained with the hashes above. Baseline scratch worktree `/tmp/pulpo-r11-baseline` uses `e9f5d6bb` plus the identical unmodified benchmark runner. Primary runs:

```sh
PK_TECHNICAL_CASES=/tmp/pulpo-r11-technical-dev/dev.json \
PK_TECHNICAL_REPORT=/tmp/pulpo-r11-technical-dev/candidate.json \
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release --filter TechnicalEntryBenchmarkTests

PK_TECHNICAL_CASES=/tmp/pulpo-r11-heldout-author/heldout.json \
PK_TECHNICAL_REPORT=/tmp/pulpo-r11-technical-dev/heldout-candidate.json \
swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release --skip-build --filter TechnicalEntryBenchmarkTests

swift test --package-path apps/keyboard-ios/PulpoKeyboardKit -c release

xcodegen generate --spec apps/keyboard-ios/project.yml
xcodebuild -project apps/keyboard-ios/PulpoKeyboard.xcodeproj -scheme PulpoKeyboard \
  -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath /tmp/pulpo-r11-native -resultBundlePath /tmp/pulpo-r11-native-build.xcresult \
  CODE_SIGNING_ALLOWED=NO build-for-testing
```

For baseline heldout, substitute the baseline scratch package path and `heldout-baseline.json`. The baseline development replay was before source editing in this isolated checkout. The R10 regression has its own external `known-r10.json` and baseline/candidate reports, never pooled into either set.

One source-policy experiment was measured, with one baseline/candidate run per split. Two isolated author tasks were used because of schema clarification; the second preserved all case contents. No device minutes or network/model inference in the keyboard benchmark; provider billing/token cost is not exposed. Build/test wall time and per-key numbers are local developer-machine observations, not extension memory, physical-device performance, or a Gboard comparison. The development protocol was frozen at 05:23 UTC; final evidence was collected around 05:33 UTC.

Key timing includes insertion plus suggestion access; paired raw replay time is excluded. Single-run samples include cold/warm mixing and no statistical performance acceptance is claimed:

- development baseline: 755 keys; median 0.071 ms; p95 1.653 ms; maximum 2.205 ms.
- development candidate: 755 keys; median 0.025 ms; p95 1.495 ms; maximum 3.389 ms.
- heldout heldout-baseline: 537 keys; median 0.034 ms; p95 1.441 ms; maximum 2.759 ms.
- heldout heldout-candidate: 537 keys; median 0.006 ms; p95 0.765 ms; maximum 2.517 ms.

External execution artifact hashes (SHA-256):

- `baseline.json`: `426891b0afbc1bb988a0700cb87c9ab8fad03a725c9ed13c73a1f8e08b82329e`.
- `candidate.json`: `74f2c944648308a115719fade65ea1fbe8ba68005f679c17bdd4d57c9dd6ab0c`.
- `heldout-baseline.json`: `86eb7dafe25bd07f2aba59e2d2f6f5858b4cd935c8ea51b23cdd3f677e073fe3`.
- `heldout-candidate.json`: `c82d7ccd883c016754f98e5be399a8b95cdf69f432c290930e69037b8084c801`.
- `known-r10.json`: `87813cdac7fe7d15f8c5f07a149c6c15e56a1efbf060b8bf768e0622e79d2fef`.
- `known-r10-baseline.json`: `45c5071024e1b46d5f925f8fe32a90675ac82ab3ece10af79d56fc2da1943339`.
- `known-r10-candidate.json`: `e06acd98728c8c18a0559c8a69bcbd23c8570a465deafca67cffa783da2dc3a7`.

Benchmark runner SHA-256 `ea0c7bf0352b2306d506969270168bc215012b04aee4ebe9be5616bff1d8aea0`, identical in baseline and candidate.

## Per-case exact outcomes

Each entry is baseline → frozen candidate; 1 means exact full-document match, 0 means miss. Raw full outputs and frozen input/expected documents are in external artifacts above. All failures remain in the denominator.

Development:

- `p01` (path): 0 → 1.
- `p02` (path): 0 → 1.
- `p03` (path): 1 → 1.
- `p04` (path): 1 → 1.
- `p05` (path): 0 → 1.
- `p06` (path): 0 → 1.
- `p07` (path): 0 → 1.
- `p08` (path): 0 → 1.
- `p09` (path): 0 → 1.
- `p10` (path): 1 → 1.
- `p11` (path): 0 → 1.
- `p12` (path): 0 → 1.
- `p13` (path): 1 → 1.
- `p14` (path): 1 → 1.
- `p15` (path): 0 → 1.
- `p16` (path): 0 → 1.
- `n01` (network): 0 → 0.
- `n02` (network): 0 → 0.
- `n03` (network): 1 → 1.
- `n04` (network): 1 → 1.
- `n05` (network): 1 → 1.
- `n06` (network): 1 → 1.
- `n07` (network): 1 → 1.
- `n08` (network): 1 → 1.
- `i01` (identifier): 1 → 1.
- `i02` (identifier): 1 → 1.
- `i03` (identifier): 1 → 1.
- `i04` (identifier): 1 → 1.
- `i05` (identifier): 1 → 1.
- `i06` (identifier): 1 → 1.
- `i07` (identifier): 1 → 1.
- `i08` (identifier): 1 → 1.
- `c01` (command): 1 → 1.
- `c02` (command): 1 → 1.
- `c03` (command): 0 → 1.
- `c04` (command): 0 → 1.
- `c05` (command): 0 → 1.
- `c06` (command): 0 → 1.
- `c07` (command): 1 → 1.
- `c08` (command): 1 → 1.
- `o01` (ordinary): 1 → 1.
- `o02` (ordinary): 0 → 0.
- `o03` (ordinary): 1 → 1.
- `o04` (ordinary): 1 → 1.
- `o05` (ordinary): 1 → 1.
- `o06` (ordinary): 1 → 1.
- `o07` (ordinary): 1 → 1.
- `o08` (ordinary): 0 → 0.
- `o09` (ordinary): 1 → 1.
- `o10` (ordinary): 1 → 1.
- `o11` (ordinary): 1 → 1.
- `o12` (ordinary): 1 → 1.
- `o13` (ordinary): 1 → 1.
- `o14` (ordinary): 1 → 1.
- `o15` (ordinary): 1 → 1.
- `o16` (ordinary): 1 → 1.
- `b01` (path): 1 → 1.
- `b02` (network): 1 → 1.
- `b03` (path): 1 → 1.
- `b04` (ordinary): 0 → 0.
- `b05` (path): 1 → 1.
- `b06` (identifier): 1 → 1.
- `b07` (ordinary): 1 → 1.
- `b08` (ordinary): 1 → 1.
- `b09` (private): 1 → 1.
- `b10` (private): 1 → 1.
- `b11` (private): 1 → 1.
- `b12` (private): 1 → 1.

Heldout:

- `h01` (paths): 0 → 1.
- `h02` (paths): 1 → 1.
- `h03` (paths): 1 → 1.
- `h04` (paths): 1 → 1.
- `h05` (paths): 1 → 1.
- `h06` (paths): 0 → 1.
- `h07` (paths): 0 → 1.
- `h08` (paths): 1 → 1.
- `h09` (network): 0 → 0.
- `h10` (network): 1 → 1.
- `h11` (network): 1 → 1.
- `h12` (network): 1 → 1.
- `h13` (network): 1 → 1.
- `h14` (network): 1 → 1.
- `h15` (identifiers): 1 → 1.
- `h16` (identifiers): 1 → 1.
- `h17` (identifiers): 1 → 1.
- `h18` (identifiers): 1 → 1.
- `h19` (commands): 1 → 1.
- `h20` (commands): 1 → 1.
- `h21` (commands): 1 → 1.
- `h22` (commands): 1 → 1.
- `h23` (ordinary): 0 → 0.
- `h24` (ordinary): 0 → 0.
- `h25` (ordinary): 1 → 1.
- `h26` (ordinary): 0 → 0.
- `h27` (ordinary): 0 → 0.
- `h28` (ordinary): 0 → 0.
- `h29` (ordinary): 0 → 0.
- `h30` (ordinary): 0 → 0.
- `h31` (intent): 0 → 0.
- `h32` (intent): 1 → 1.
- `h33` (intent): 1 → 1.
- `h34` (intent): 1 → 1.
- `h35` (intent): 1 → 1.
- `h36` (intent): 1 → 1.
- `h37` (policy): 1 → 1.
- `h38` (policy): 0 → 0.
- `h39` (policy): 1 → 1.
- `h40` (policy): 1 → 1.
