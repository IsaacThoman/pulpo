# Source-blind inserted-text spacing sweep

## Scope and blind ordering

Parent base: `0c0352a1ed07b5efe884fa8c34f54cba11dff9a8`; isolated worktree branch `t3/blind-insertion-spacing-sweep`. No parent push, physical deployment, or simulator use.

1. Before reading AGENTS.md, source, tests, or prior audits, author 28 fresh development tasks and 22 fresh held-out tasks with exact expected document strings. Commit both suites and acceptance at `f45f9bcc` (`test(keyboard): freeze blind inserted text spacing tasks`). Only `pwd`, git status, and HEAD were checked first.
2. Read AGENTS.md and inspect production `KeyboardEngine`, controller insertion entry points, test support, and language-stack setup. Do not inspect existing audits. Freeze the task driver and development baseline in `ac441b01`.
3. Diagnose development failures; implement one leading-separator decision fix in shared `insertText`. Freeze implementation, focused regressions, and development measurements before executing held-out tasks.
4. Reveal held-out results for baseline and frozen patch in one evaluation round. Make no implementation, task, expected-string, or driver changes after that reveal.

The tasks are self-authored and source-blind. Their author necessarily saw them during authoring. This is a withheld evaluation set, not an independently administered benchmark. There is no overall keyboard-quality or Gboard claim. These narrow tasks do not estimate natural-language usage frequency.

Acceptance was declared in the initial freeze: at most one coherent general fix justified by development; development gains with no regression; relevant existing core tests pass; freeze before held-out; no held-out regression versus baseline; report every failure and unavailable path. No exclusions were relaxed after measurement.

## Production routes and harness

`InsertedTextSpacingSweepTests` loads exactly one named frozen suite (development by default), constructs the actual `KeyboardEngine` with checked-in English, Spanish, or bilingual `LanguageStack`, and uses a synchronous caret-capable `MockDocument`. It does not implement substitute spacing logic or normalize output. Each case gets fresh in-memory personal learning. Mode changes share the previous stack's personal/touch objects, update settings, and call `useLanguageStack`.

The controller's transcript-delivery entry points call `insertTranscript`; frozen `snippet` tasks use that API. The emoji panel and search-result picker call `insertText` with default spacing; `emoji` tasks use that API. Suggestions must be present in `engine.suggestions` and are accepted through `select` (never fabricated). Swipes use the existing deterministic synthetic QWERTY path builder (seed 782106, zero target noise) and actual `insertGlide` decoding. Literal key sequences use the existing `type` helper, which calls engine key methods. Decoder results are recorded. Initial caret offsets count Swift Characters; no selected ranges are supplied.

This preserves actual API behavior, including transcript trimming. Thus the frozen D05 expectation that a supplied trailing space separates following host text is allowed to fail; the harness does not bypass transcript preprocessing to obtain a better score. Raw supplied whitespace is separately checked through the eligible shared `insertText` API.

Controller code was inspected only to identify routes; it is unchanged. Recording/session/dictation destinations, selected-range reconciliation, language caching, ranking/data, shift double tap, and layouts/gestures are unchanged.

## Development diagnosis and retained change

The baseline passes 20/28 exact tasks, all executable. Five failures identify the same leading-separator problem: `insertText(spacing: true)` looked only at the character before the caret. It inserted a separator before supplied comma/exclamation/colon text and after Spanish inverted opening punctuation. It also could duplicate supplied whitespace when called directly or with a swipe's owed separator.

The retained change checks both sides of the left insertion boundary: supplied whitespace and attaching closing punctuation suppress an automatic separator; opening delimiters, including ¿/¡ and contextually opening straight quotes, suppress it after the opener. Words after ordinary text or closing delimiters still receive a separator when spacing is requested. The default fixed-text route stays literal unless it consumes an owed swipe separator. The patch does not add trailing separators or new word-specific exceptions, and does not trim or rewrite inserted content.

Unchanged development failures are missing right-side separators during caret insertion (D05, D13) and emoji panel insertion/continuation without automatic spaces (D27). Those require separate evidence and scope decisions; no expectations were changed to hide them.

## Reproduction

Run from the worktree root (logs/results may use any writable temporary paths):

```sh
PULPO_SPACING_RESULTS=/tmp/development.json swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --filter 'InsertedTextSpacingSweepTests|ExternalTextSpacingTests'
PULPO_SPACING_SUITE=held-out PULPO_SPACING_RESULTS=/tmp/held-out.json swift test --package-path apps/keyboard-ios/PulpoKeyboardKit --filter InsertedTextSpacingSweepTests
```

The sweep test deliberately records all exact mismatches rather than asserting every aspirational task passes. Inspect the JSON `passed` and `completed` fields and summary counts; a green test invocation alone is not a passing accuracy sweep. `ExternalTextSpacingTests` uses normal assertions for retained behavior and controls. Baseline runs use the frozen driver at `ac441b01`; expected-text inputs and driver are identical across baseline and patch.

## Development exact outcomes (before held-out reveal)

20/28 → 25/28; five gains, zero regressions, zero unavailable routes. Full exact outputs for every pass and failure are retained in the adjacent JSON results. Failed baseline tasks:

| Task | Frozen expected | Baseline actual | Patched actual | Result |
| --- | --- | --- | --- | --- |
| D05 | `"[hello remaining]"` | `"[helloremaining]"` | `"[helloremaining]"` | unchanged failure |
| D07 | `"hello,"` | `"hello ,"` | `"hello,"` | gain |
| D08 | `"hello!"` | `"hello !"` | `"hello!"` | gain |
| D13 | `"hello brave world"` | `"hello braveworld"` | `"hello braveworld"` | unchanged failure |
| D20 | `"¿qué tal?"` | `"¿ qué tal?"` | `"¿qué tal?"` | gain |
| D21 | `"¡hola!"` | `"¡ hola!"` | `"¡hola!"` | gain |
| D24 | `"hello:"` | `"hello :"` | `"hello:"` | gain |
| D27 | `"hello 🙂 world"` | `"hello🙂world"` | `"hello🙂world"` | unchanged failure |

## Validation frozen before held-out

- Development + new focused regression tests: 8 tests in 2 suites pass (0.183 s test runtime). Exact sweep result: 25/28. Parameterized controls cover attaching punctuation, preserved supplied spaces/tabs/newlines, opening versus closing delimiters, literal `.com`/emoji insertion, and consuming a swipe's owed separator exactly once.
- Existing relevant editing regressions plus new focused assertions: 150 tests in 15 suites pass, 26.495 s, with two pre-existing known issues for host reverting to a recent own state (fuzz seeds 227 and 440). Suites: KeyboardEngine, EditingRegression, AccuracyEditing, ContextVisibility, SuggestionFreshness, EmojiSelection, SwipeWorkflow, LanguageSwitchEditing, SpanishEntry, SpanishEntryAcceptance, ExternalSelectionWordDeletion, ExternalTextSpacing, EngineFuzzRegression, EngineFuzz, BlindInputStress. No selected-range implementation was edited.
- Broad unpatched baseline: 415 tests in 59 suites, 216.277 s; failed with four unexpected latency-threshold issues plus five known issues. Unexpected failures: `SuggesterTests.suggestionsStayResponsiveWithAFullPersonalDictionary` and `suggestionsAreFastEnoughForEveryKeystroke` (25 ms limits), `GlideDecoderTests.accuracyOnNoisySwipes` and `GlideTimingTests.timedNoisySwipesStayAccurateAndFast` (60 ms limits). Five known issues: two host-revert ambiguity cases and three frozen multilingual suggestion expectations. This was a parallel debug host run; it does not establish device performance or a clean full suite. No threshold was changed and no timing failure was relabeled as a passing check.
- `git diff --check` passes.

The implementation and driver are now frozen for held-out evaluation. No held-out file or results have been reopened or executed since initial authoring.
## Held-out reveal and retention

Implementation freeze: `acf5cf6210341c37b7e3c2d1fd48edba808e792b`. Only after that commit, create a detached baseline checkout at `ac441b01` and execute the held-out driver there and in the patched checkout. Inspect their exact outputs together once. Neither run changed the driver, task input, expected output, dictionary, or implementation. No held-out tuning followed.

14/22 → 19/22 exact; five gains, zero regressions, one unavailable task in both versions. The unavailable task counts as a non-pass in both denominators. All held-out outcomes:

| Task | Frozen expected | Baseline actual | Patched actual | Result |
| --- | --- | --- | --- | --- |
| H01 | `"buenos días"` | `"buenos días"` | `"buenos días"` | pass |
| H02 | `"one two"` | `"one two"` | `"one two"` | pass |
| H03 | `"{value}"` | `"{value}"` | `"{value}"` | pass |
| H04 | `"‘yes’"` | `"‘yes’"` | `"‘yes’"` | pass |
| H05 | `"yes?"` | `"yes ?"` | `"yes?"` | gain |
| H06 | `"yes;"` | `"yes ;"` | `"yes;"` | gain |
| H07 | `"first, second"` | `"first, second"` | `"first, second"` | pass |
| H08 | `"first\n\nsecond"` | `"first\n\nsecond"` | `"first\n\nsecond"` | pass |
| H09 | `"first second third"` | `"first second third"` | `"first second third"` | pass |
| H10 | `"first second third"` | `"first secondthird"` | `"first secondthird"` | unchanged failure |
| H11 | `"say [yes] now"` | `"say [yes] now"` | `"say [yes] now"` | pass |
| H12 | `"first second\nthird"` | `"first second\nthird"` | `"first second\nthird"` | pass |
| H13 | `"first second!"` | `"first second!"` | `"first second!"` | pass |
| H14 | `"bueno amigo"` | `"bue"` | `"bue"` | unavailable (unchanged) |
| H15 | `"hola mundo bonito"` | `"hola mundo bonito"` | `"hola mundo bonito"` | pass |
| H16 | `"¿ready ya?"` | `"¿ ready ya?"` | `"¿ready ya?"` | gain |
| H17 | `"hello amigo today"` | `"hello amigo today"` | `"hello amigo today"` | pass |
| H18 | `"hola)"` | `"hola )"` | `"hola)"` | gain |
| H19 | `"first 🎉 next"` | `"first🎉next"` | `"first🎉next"` | unchanged failure |
| H20 | `"literal!"` | `"literal!"` | `"literal!"` | pass |
| H21 | `"hello..."` | `"hello ..."` | `"hello..."` | gain |
| H22 | `"prefix middle suffix"` | `"prefix middle suffix"` | `"prefix middle suffix"` | pass |

H14 cannot accept the requested `bueno` because actual visible choices are `bue | buen | buena`; the task stops there rather than fabricating a suggestion or choosing another target. H15's real swipe decoder returns `mundo`. H10 still joins inserted `second` to right-side `third`. H19 still joins panel emoji to adjacent text. These remain future sweep evidence, not newly passing cases.

The five held-out gains are H05 (question mark), H06 (semicolon), H16 (bilingual inverted question opener), H18 (closing parenthesis after mode switch), and H21 (ellipsis). The fix meets the predeclared narrow acceptance and is retained. The scope is external-text leading spacing; suggestion and swipe acceptance are controls, not claimed gains.

## Costs and limits

Host: Apple Swift 6.4, arm64 macOS target; debug SwiftPM production-core tests. The patch adds bounded character/delimiter checks to external insertion, with no model lookup, extra file I/O, language-cache work, or per-word exception. No measured device latency, energy, memory, or UIKit interaction claim is made.

The development baseline driver took 0.144 s test runtime; patched development plus focused assertions took 0.183 s. Held-out baseline took 0.122 s and patch took 0.129 s. These short host task runs include stack setup and do not establish a performance delta; concurrent build activity also makes the comparison unsuitable as a latency benchmark. The relevant regression run cost 26.495 s; the broad baseline cost 216.277 s and exposed timing failures under parallel load. A fresh detached baseline checkout/build was needed to keep the current frozen implementation intact during held-out comparison. No external service or paid evaluation API was used.

No simulator ownership was available and none was taken. Core tests exercise production engine behavior through an in-memory synchronous document, not a real app's asynchronous UITextDocumentProxy. Existing context-visibility, stale-suggestion, selection guard, host-lag/editing, language-switch, and fuzz regressions provide related coverage but do not certify every host. Synthetic swipes do not prove physical gesture accuracy. Frozen casing/whitespace expectations are narrow user tasks; raw snippets and transcript preprocessing are not interchangeable. Paired ambiguous straight quotes and every Unicode punctuation convention are not exhaustively evaluated.

This sweep does not resolve right-side insertion spacing, transcript trimming, emoji panel spacing, unavailable completions, known host-revert ambiguity, or baseline timing failures. Relevant regression tests passed, but the full broad suite is explicitly not reported as green. Future sweeps should author and commit new tasks before inspection; these development/held-out cases are now exposed regression evidence and must not be reused as a fresh blind evaluation.
