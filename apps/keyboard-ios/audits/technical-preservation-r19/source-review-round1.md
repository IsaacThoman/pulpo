# Pulpo PR782 — independent R19 pre-reveal source review

Recommendation: do not treat the current Swift runner as a contract-complete acceptance gate. It silently discards unsupported state oracles. The engine also has a concrete gap in literal-component nonlearning at accepted internal punctuation. These findings precede any sealed reveal. No observed development gain establishes acceptance.

This is a read-only source review, not a runtime result. I did not run Swift, tests, devices, or deployment; did not inspect sealed material; and did not change repository files. This report is the only file I wrote. Native runtime verification is outside this task's ownership. No dictionary exceptions or tuning are proposed.

## Reviewed evidence and version limits

- Frozen contract and development cases at `c48fa63034e0986adc495d64830f4afee907d321`, including the committed contract obtained with `git show`, rather than treating later working-copy prose as originally frozen.
- Baseline engine at `c4a354f3`; its source is byte-identical to the engine committed at `c48fa630`. Both engine SHA256 values are `3f0987051ff0f176a5e1ef6396d415b0f8fe0fc2088735c75fef87f75158de97`. Thus the inspected engine diff really is against the stated baseline, with no R15 engine addition already present.
- Uncommitted `apps/keyboard-ios/PulpoKeyboardKit/Sources/KeyboardCore/Input/KeyboardEngine.swift`, SHA256 `bbeac835ed46d3dc8aa949d7e773e323b95a853cabd67a8939f3c0f200579937` at the later inspection. The inspected diff adds the helper and one OR branch; no dictionaries or correction parameters change.
- Untracked `apps/keyboard-ios/PulpoKeyboardKit/Tests/KeyboardCoreTests/AnchoredGrammarReplayTests.swift`, SHA256 `d3d6f5902c2e2043eb43189b790961c683da6ffef33909be0304ec32e4232be9`.
- Frozen `development.json`, SHA256 `4e2261314c02a14ab75c14a763bea28317b2fb4dd507c6cbae9e34bcac502da0`.
- Supporting existing engine, LanguageStack, settings, traits, personal dictionary, touch model, and test fixture source needed to trace behavior. I did not inspect baseline/candidate result JSON or any sealed author content.

The shared worktree changed during review: the helper initially used a `suffix` closure and later used `lastIndex` plus slicing (current lines 1278–1279); the contract gained a pre-reveal runner-semantics paragraph. This report addresses the later helper implementation and the unchanged Swift runner hash above. These are review fingerprints, not a candidate freeze. The later clarification is consistent with the task's stated reset/private/Undo semantics; it does not remove the frozen requirement that unknown oracles produce errors.

## Findings

### 1. P1 — unsupported state expectations can pass silently

`AnchoredGrammarReplayTests.swift:7–29,155` uses synthesized `Decodable` models. Unknown object keys are ignored. There is no validation of allowed oracle keys, and only the five operation checkpoint properties at lines 25–29 are interpreted at lines 136–139.

Minimal negative control, derived from the source and not executed:

```json
{
  "cases": [{
    "id": "unsupported-caret-oracle",
    "category": "safety",
    "before": "",
    "after": "",
    "operations": [{"op": "sync", "expectCursor": 999}],
    "expected": ""
  }]
}
```

The cursor assertion is discarded; `sync` leaves the empty document unchanged; no oracle error is generated; the row can be `correct: true` in all modes. The same problem affects `expectSelection`, `expectUndoAvailable`, `expectLearns`, `expectAutocorrects`, misspelled existing oracles, and a mode-specific state oracle such as `expectAutocorrectionByMode`.

`Snapshot` records cursor, selected count, Undo availability, and policy booleans, but recording is not assertion. There is no supported schema field to make a wrong value for these fail `correct`. A final document can be right while its caret or selection is wrong, especially when a later operation overwrites the text. Explicit state expectations were permitted by the frozen contract; silently dropping them violates its unknown-oracle rule.

Mode-map keys also have no validation. `expectedByMode: {"EN": "wrong"}` silently falls back to `expected`; an unknown-only `expectDocumentByMode` map can perform no checkpoint at all. Unknown categories are accepted as strings, which would be dangerous if an external safety gate only recognizes the five prescribed categories.

Required before reveal: freeze an explicit state-oracle vocabulary, implement or reject every oracle, validate mode/category keys, and include deliberately impossible oracle negative controls. It is acceptable to reject unsupported assertions with an error; it is not acceptable to call their rows correct.

### 2. P1 for any final-component nonlearning claim — legal path punctuation bypasses literal learning protection

The new helper enters `composingLiteralToken` at `KeyboardEngine.swift:1263–1269`. This blocks automatic correction in `refreshSuggestions` and learning in `commitComposing` (lines 918 and 931–939). However, `insertCharacter` line 311 calls `learn(composing.text)` unconditionally when a non-word character does not use the autocorrect-separator branch.

Hyphen, tilde, and underscore are accepted component characters by the new grammar, but all take this unguarded branch. A final component containing them therefore leaks its earlier alphabetic fragment into the personal dictionary.

Minimal diagnostic, with no ordinary word or directory typed beforehand:

```json
{
  "id": "literal-hyphen-learning",
  "category": "safety",
  "before": "/tmp/",
  "after": "",
  "operations": [{
    "op": "insert",
    "text": "hello-world ",
    "expectDocument": "/tmp/hello-world ",
    "expectNoLearning": true
  }],
  "expected": "/tmp/hello-world "
}
```

Source trace: while `hello` is composed, `/tmp/hello` satisfies the helper. Typing `-` calls `learn("hello")` at line 311. `learn` at lines 949–971 checks policy and alphabetic shape, not literal status or dictionary validity, so it records `hello` in the fresh personal dictionary. `world` is then protected at the terminal space. The exact text can pass while the nonlearning checkpoint fails. This trace does not depend on English dictionary ranking and applies to all three normal-policy stacks.

Use `hello~world` and `hello_world` as sibling diagnostics. The underscore case already interacts with the pre-existing underscore literal rule, so do not credit R19 with inventing or fixing that behavior. Typing a path through a slash also learns directory fragments; those are directory components and must be distinguished from the final-component leak above.

This is an existing generic learning branch exposed by the new path promise, not evidence of a baseline-passing text regression. If the intended contract only constrains where suppression is allowed and does not promise nonlearning throughout a protected final component, explicitly disclose this limitation before reveal. Do not infer complete path nonlearning from terminal-space snapshots or correct text.

Existing `insertText` also learns the composition directly at line 468. The runner's `insert` operation never exercises that API; it simulates individual keys. This is a coverage boundary for external-text/dictation claims, not a claim that R19 newly regresses that API.

### 3. P1 acceptance-gate dependency — a successful Swift test does not reject bad outcomes

`AnchoredGrammarReplayTests.swift:151–164` asserts unique case IDs and a report path, then writes and prints outcomes. It never asserts oracle errors are absent, nor that ordinary/control/safety cases avoid baseline-relative regressions. Unsupported operations append an error, but even those errors do not make this test fail. A wrong expected document likewise only changes the report.

Minimal calibration: use one `sync` row with `before: ""`, `expected: "impossible"`. The report will contain `correct: false`, while no assertion in this runner turns that mismatch into a failing test.

This may be intentional benchmark/report behavior. It means the Swift test exit status alone cannot establish the contract's rejection rule. A separately reviewed, fail-closed comparison must pair every `(id, mode)`, reject oracle/operation errors, preserve counts, and reject each baseline-passing ordinary/control/safety row that loses correctness. Do not simply require every row to pass: the frozen set deliberately includes intentional misses and may contain mistaken normal-policy expectations. I did not inspect an outer comparison script and make no claim that none exists.

### 4. P2 — learning observations end before the implicit final flush

At lines 135–144 the runner checks `expectNoLearning` and captures its snapshot; at line 146 it calls `engine.save`, which accepts pending corrections at `KeyboardEngine.swift:995–1010,1557`. No snapshot or learning oracle is evaluated after that automatic save.

An ordinary corrected word can have empty `usedEntries` and zero touch weight immediately after its terminal space because the correction is pending. The final save can then learn it. Consequently, an immediate `expectNoLearning` checkpoint only proves “not learned yet”; it cannot by itself prove nonlearning through dismissal/persistence. A generic calibration is the exposed English `/tmp/file;` + `teh ` case with an immediate `expectNoLearning` assertion and then an explicit `save` + the same assertion. The two checkpoints should differ if the normal English correction occurs. This is a calibration of oracle timing, not a requested grammar change.

The explicit `save` operation permits a pre-reveal case-authoring workaround: put the nonlearning assertion on `save`, after the final relevant transition, rather than only on `insert`. The current automatic final flush remains absent from reported final state. Any nonlearning acceptance claim needs to account for it.

`expectNoLearning` is also absolute: it means no personal entries ever and zero accumulated touch weight in the row. `reset` intentionally keeps the stack and learned data. A case that first learns ordinary text and then enters a private field cannot assert “private segment added no learning” with this oracle; a healthy implementation already fails it. Snapshots list spellings but not per-word counts or pair counts, so repeating a previously learned word in private would be invisible in that list. Use a stable before/after learning-state comparison (including counts and touch state), or limit the claim explicitly to fresh-empty-stack private cases. This is a limitation, not an objection to the clarified reset semantics.

### 5. P2 — some malformed operations become successful no-ops

Unknown operation names do append errors at line 133, which is good. But a missing move offset defaults to zero at line 119; a negative backspace count is clamped to zero at line 116. Both malformed requests can leave the document unchanged and report success. Arguments inappropriate to an operation, including unknown state assertions, are ignored.

Minimal negative controls: `{"op":"move"}` and `{"op":"backspace","count":-1}` against a row whose expected document is unchanged. Preserve those requests as errors rather than silently turning them into no-ops. The frozen schema explicitly grants only backspace's count default; reset's blank/default and private's secure semantics were separately clarified by the task.

## Grammar challenges to settle before reveal

The later helper has a plausible narrow structure: it slices after the last listed separator, rejects quote/backtick characters in the whole whitespace token, rejects double-root and empty components, requires a non-dot Unix directory component, checks UNC server/share structure, and limits drive letters to ASCII. This is a source assessment, not a native acceptance claim.

Challenge its ambiguity explicitly rather than treating all matched syntax as proven filesystem intent:

1. Ordinary slash-delimited prose such as a literal quotation of `/and/teh` is indistinguishable from the accepted path shape. `before: "the notation /and/"`, insert `teh ` is a minimal ordinary-intent challenge. Candidate suppression is expected from the source; the baseline result must be measured per mode. The frozen contract acknowledges this ambiguity, so it is not automatically a grammar-implementation defect. If such a case is designated ordinary before reveal and loses a baseline pass, the frozen rejection rule still applies.
2. Comment-like text can regain an anchor after a separator: `before: "//(./"`, insert `teh `, or `before: "//(/tmp/"`, insert `teh `. The fragment after `(` is anchored, so the initial `//` does not veto it. A simple leading `//teh` remains excluded. Decide whether these are ordinary comment intent before reveal; do not broaden a comment heuristic after seeing outcomes. The contract's fragment boundaries plausibly allow these matches, so this is an intent-risk diagnostic rather than an asserted parser violation.
3. Exhaust the separator reset behavior using `& < > ( ) [ ] { } ? = , + #`, not only the already exposed semicolon, exclamation, and pipe cases. `/tmp/file&teh`, for example, must not recover `/tmp/` across `&`. Conversely, `x;/tmp/teh` has a newly anchored fragment and is a deliberate positive under this grammar. Do not confuse “never recover an earlier anchor across a separator” with “no anchor may begin after a separator.”
4. Structural negatives should include `/../teh`, `/.../teh`, `/a//teh`, `./a//teh`, `C:teh`, `1:\\teh`, UNC missing a share, mixed slash/backslash components, and `/a:b/teh`. Positives should include `~/teh`, `./teh`, `../../teh`, both drive separators, and a complete UNC server/share/final component. These are predicate expectations; correction/text outcomes still require all actual stacks. Dot-only Unix directories should fail when no other real directory exists; `/a/../teh` has real directory evidence under the frozen wording.
5. Quote/backtick vetoes should be challenged both before an anchor and earlier in the same whitespace token before a separator, e.g. `"x";/tmp/teh`. The helper intentionally vetoes the whole whitespace token. Ordinary punctuation outside the listed separators, including colon, should not silently become an alternative anchor boundary.
6. The helper reads only `before`; `cursorInsideWord` separately checks only the next word character. It does not validate a complete right-hand path/quote suffix. Challenge a caret before an existing `.ext`, slash plus another component, and a closing quote/backtick. For example, `before: "/tmp/"`, `after: "\" tail"`, insert `teh ` ignores the quote on the right while classifying the typed prefix. Likewise a caret before `/tail` can protect a component that is not the full path's final component. The frozen “complete token”/“at the caret” wording needs an explicit pre-reveal interpretation for these cases. R16 before-existing-text policy is out of scope; do not quietly widen R19's acceptance claim to resolve it.

Avoid false attribution: the pre-existing full-whitespace-token checks for `_`, `@`, `#`, and `://` still run before the new helper. `/tmp/a_b;teh` or a URL-like token can remain literal even when the R19 helper rejects its final fragment. That is not a new R19 regression unless the exact baseline/candidate comparison says so. “Outside narrow grammar unchanged” does not mean every such case necessarily corrects in the baseline.

## State diagnostics needed before reveal

These are proposed diagnostics, not executed results. Freeze mode-dependent expectations from the normal baseline behavior; do not assume English `the` in Spanish or disable normal capitalization to make examples pass.

- Delete the actual marker while keeping the typo: start with `say /tmp/teh`, select absolute Character offsets `[4,9)`, backspace, move `+3`, then inspect suggestions and type a delimiter. Immediately after marker deletion/move the full text is `say teh` and caret is 7. A new literal decision must not survive without its anchor. This tests more than deleting an entire path and starting over.
- Replace just the final component while retaining suffix: start with before `/tmp/teh`, after ` tail`; select `[5,8)`, insert `world `. The exact document should be `/tmp/world  tail`, caret 11, and selection length 0. Text correctness already asserts the suffix, but the runner currently cannot assert the latter two state values.
- Delete or replace the anchor using a selection, then move away and back; cross a separator and back; add a separator after a path and continue ordinary text. Snapshot observations alone must not be called state-oracle passes.
- Distinguish Backspace behavior after a literal terminal space (remove the space; no correction Undo available) from Backspace immediately after an ordinary correction (restore the original spelling and remove its delimiter). A checkpoint on actual Undo availability is needed, including before and after sync. The frozen delete-anchor case's final string alone cannot establish this across all stacks.
- With an outstanding correction, reset to `say ` with a new document identity, type ordinary text, and check that old Undo and pending learning are gone. Reset retains personal data by design. A blank reset also reintroduces normal automatic capitalization; account for it rather than revising normal policy.
- Enter private mode before typing, exercise path punctuation and ordinary typo delimiters, explicitly save, and assert no learning. Also test public-to-private with pending correction, then private-to-public. The public-restoration segment must recover normal correction rather than keeping a sticky literal/private state.
- A private test in this runner means `isSecure` with fully visible synchronous host context. It does not cover unavailable proxy context, private content types, delayed callbacks, or actual device behavior. The task explicitly scopes private to `isSecure`; do not report broader privacy acceptance.

## Baseline fairness and acceptance limits

The Swift runner does choose three actual LanguageStack dictionary files, fresh personal/touch state per case, and normal KeyboardSettings defaults (autocorrect, learning, capitalization, punctuation, predictions enabled). It iterates all KeyboardLanguage cases and retains a full-document expected/output pair for each completed row. It does not use dictionary exceptions. Those are sound ingredients.

The frozen development set has 22 rows: 7 literal, 12 ordinary, 2 intentional-miss, 1 control, hence 66 mode rows when every stack loads. Its operations are 23 inserts, one backspace, and one Undo. There are no operation checkpoints at all, and no move, select, reset, private, sync, or save operation. Therefore that set does not establish the frozen state/safety requirements, regardless of text gains. R11/R15 and parent examples are exposed development and earn no fresh generalization credit.

For a fair eventual comparison, freeze the exact same input and runner for both engines, identify the engine commit and dictionary assets, pair every id/mode, keep intentional misses and mistakes in the denominator, and retain unsupported-operation/oracle errors. A dictionary-load/replay throw currently aborts the report rather than emitting remaining unavailable rows; an empty case list can print 0/0 without constructing any stack. The outer acceptance process must preserve the expected denominator and treat incomplete execution as failure/unavailable, not a gain.

The engine source comparison establishes that the stated baseline has no candidate helper. It does not establish how any external baseline run was actually built. I did not inspect reports, run an outer comparison, reveal sealed cases, or run the full core/services checks. The five-known-failures condition remains unverified here. Freeze candidate plus runner only after the above pre-reveal objections have concrete dispositions; do not tune from a later sealed reveal.
