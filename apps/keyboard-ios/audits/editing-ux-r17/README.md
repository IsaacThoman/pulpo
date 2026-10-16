# R17 multilingual editing UX sweep

Fix: the Try It preview now moves its caret by Swift Characters rather than UTF-16 units. A real Spanish preview gesture on `A🍕b` followed by `x` previously produced exact UTF-16 `[65,55356,120,57173,98]`, splitting the pizza's surrogate pair. The same gesture now produces valid `Ax🍕b`. Combining accents, emoji sequences and CRLF remain intact, and overshoot reaches the document edge. This fixes the app's `PreviewHost`; the installed extension proxy is unchanged.

Started from committed parent `8aeb5998`, with no uncommitted files. Read AGENTS.md. Initial UI tasks were frozen before relevant implementation inspection. Exploration used visible keys and native selection controls through repository XCTest on iPhone 18 Pro `7E1D7979-7307-4C53-8466-BB41154B383C`. T3 `device_list` and `device_open` both failed with `Device list failed: The device command failed (exit code 127).` CoreSimulator/XCTest fallback used only that UUID; hardware keyboard preparation was likewise UUID-specific. No iPhone 17, protected simulator, unrelated checkout, physical device, deployment or push was used.

## Evidence and unchanged misses

- Four original editing/navigation tasks: selected Spanish replacement across language switch, bilingual emoji-search round trip, and Clear during search produced the expected full documents. The English multiline task produced `Hello\nWorld\nOk` against frozen `Hello\nworld\nOk`; retain that capitalization expectation miss. All AX selections remain unavailable, rather than inferred. The first attempt stopped at a mistaken picker locator; its unreached task and corrected harness replay remain recorded.
- Largest Dynamic Type exploration retained `Hola team` and opened Tips. Segmented mode/field labels stayed small while editor and Tips text scaled. Dismissal/final append stages were not run; this accessibility observation is deferred, with no product change.
- Original frozen cursor gesture expectations assumed one character of movement. The ASCII drag actually moved two, producing `XAb`; after the fix the emoji drag produces `Ax🍕b`. Both original exact displacement expectations still miss. No v1 oracle was rewritten. Initial malformed UTF-16 caused the recorder's UTF-8 serialization to fail; the subsequent recorder preserves every UTF-16 unit.
- The separate v2 native development contract was frozen after discovery/source inspection and before implementation. Four full-document and four exact-selection checks: baseline 0/4 each, initial and final candidate 4/4 each. This is a developer reproduction, not independent held-out evidence.
- Independent source review round 1 found one P2: Foundation composed ranges split CRLF, violating the promised Character contract. Native reviewer case was red for both document and selection. Switched to Swift Character traversal before unsealing; native reviewer case is green. Round 2 reported no blocking findings after 2,808 standalone Swift checks. These diagnostics are not independent UIKit validation. Both reviewers avoided devices, native tests and held-out files.
- Existing DraftEditorTests: initial candidate 7/9, with unowned-reference crashes in `testEmojiCaretAndSelectedRangeSurviveRecreationBeforeEditing` and `testFocusedSwitchingRetainsEmojiSelectionAndCanReplaceIt`; untouched baseline 9/9; revised candidate 9/9. The intermittent initial crashes remain unresolved and retained. No lifecycle code or test disablement changed. Final report includes the separate reviewer case as a tenth passing test.

## Held-out accounting

Two separate author tasks read only their supplied briefs and AGENTS.md, with no source/audit/device access. Each wrote six synthetic cases and returned only paths/count/hash before freeze. First broad suite SHA256: `ec2dca24e445fa2d9993d9b8dfd516f76859cf8b49a2c182cb824ea6a1421d02`. Targeted cursor suite SHA256: `17bb56224c82db0b4bbe58c83a55d30555eecac4236b0695f64326044daf252b`.

Final source review and commit `85e7158a` preceded reveal. Each cursor case ran once against the immutable baseline archive and once against the candidate. Exact documents: 1/6 → 5/6. Exact UTF-16 selections: 2/6 → 6/6. Four improved document cases, no regressions. Remaining document failure `r17-cursor-02`: baseline and candidate both produce `Send the notesdraft.` instead of `Send the notes.` because zero movement collapses an existing selection. The author's no-op expectation was retained. No product edits or expected-value repairs followed reveal; the checked-in schema adapter copies every authored expectation unchanged and verifies the source hash.

The initial six broader UI cases were not executed after narrowing this round to the cursor adapter; they are explicitly counted as six not-run, not six passes or platform failures. Full starting documents, ranges, language/UI expectations and per-case non-execution are retained. Some proposed semantic controls (such as an onboarding next step after Try It) were authored without product inspection and would require separate binding/adjudication. They do not justify product changes here.

Targeted native held-out tests use real `UITextView` and production `PreviewHost`, with literal insertion and exact UTF-16 capture. They do not invoke the keyboard engine, so language labels describe the document, not an engine-language test. Real UI exploration separately used English, Español and bilingual modes. Installed-extension behavior, visual RTL movement, VoiceOver, live Dynamic Type changes and marked-text composition are unproven. No overall accuracy or Gboard superiority claim is supported.

## Reproduce and costs

Run from this checkout while exclusively owning the named simulator:

```sh
apps/keyboard-ios/audits/editing-ux-r17/run.sh development
apps/keyboard-ios/audits/editing-ux-r17/run.sh cursor
python3 apps/keyboard-ios/audits/editing-ux-r17/normalize_heldout.py
apps/keyboard-ios/audits/editing-ux-r17/run.sh heldout
apps/keyboard-ios/audits/editing-ux-r17/run.sh regression
```

`heldout` intentionally exits nonzero on the retained failure. All native runs use `-parallel-testing-enabled NO -collect-test-diagnostics never`. Build logs were inspected only following an indicated nonzero result. Reports are small JSON files; raw logs, xcresults, screenshots and build products stay outside Git in `/tmp/pulpo-r17`. The baseline was archived from `d87f48c8` into that temporary directory, generated with XcodeGen, and built separately. Both versions used the same native fixture and the same normalized held-out input.

Four child tasks total: two independent authors and two source-review rounds. Native cursor fixtures take under a tenth of a second per suite, excluding build/launch overhead. This is not a latency benchmark. Two derived-data caches total about 821 MB. No language data or persistent learning cost changed. Character traversal is bounded by the document and requested movement; conversion cost and large-document performance have not been benchmarked. Token/currency costs were not exposed by task tooling. PR782 was linked; parent integration/push remains separate from this local implementation handoff.
