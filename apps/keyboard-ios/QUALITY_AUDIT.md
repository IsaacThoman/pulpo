# Keyboard validation and known limitations

The keyboard has regression coverage for typing and editing, English/Spanish/
bilingual dictionaries, privacy mapping, learning persistence, account lifecycle,
emoji, and native appearance. Synthetic benchmarks establish specific behaviors;
they do not establish an overall accuracy or usability lead over Gboard.

## Run maintained checks

From `apps/keyboard-ios/PulpoKeyboardKit`:

```sh
swift test -c release --no-parallel
```

Run serially on an otherwise idle machine: several existing assertions measure
per-keystroke and swipe responsiveness. The last pre-cleanup ordinary run covered
491 Core definitions (472 executed, 19 opt-in skips) and three Services tests,
with five existing known-issue events. These are historical counts, not a claim
that every optional or native suite passed.

Native tests use the XcodeGen project described in [README.md](README.md).
[Tests/Fixtures](Tests/Fixtures/README.md) contains the fixed JSON inputs used by
Core, AppTests and UITests. The completion and multilingual Gboard comparison
runners remain under `benchmarks/`. Human gesture corpora and opt-in benchmark
outputs are supplied through external paths documented by their test suites.
Repeated fixed inputs are regression checks, not new blind evaluations.

## Findings and limits

- English, Spanish and bilingual typing are supported offline. Short-prefix
  greeting recall and several swipe/completion misses remain known. Recorded
  human gestures perform worse than synthetic center paths; population accuracy
  and Gboard on iOS have not been established.
- Observable document changes invalidate stale editing ownership. A host returning
  to an identical recent state can still be mistaken for proxy lag; formatting
  ownership and host Undo ordering are not universally solved.
- Learning/reset coverage includes cross-process coordination, fault injection,
  retries, result-aware Settings/Remove UI and memory-only touch-model
  compatibility. This does not prove erasure of an inaccessible extension-local
  fallback or durability under every iOS suspension/crash schedule.
- Private content-type mapping and guarded account publication have focused
  component/native checks. These do not prove safety across every host app.
- The native appearance pass covers light/dark key styling, prediction colors,
  Delete/Return feedback and trackpad fading. Focused installed-extension input
  checks passed; simulator observations do not establish physical-device latency
  or extension memory budgets.
- An existing native preview-lifetime test can fail because UIKit retains the
  preview view. Latest physical iPhone behavior, iPad, production audio/upload/
  return flow and physical memory limits remain unverified. Return-to-host uses
  guarded private UIKit/LaunchServices APIs and remains an App Review risk.
- Rejected sentence-backoff, prefix-recall, Spanish-emoji, transcript-boundary,
  preference and glide-timestamp experiments were not promoted. In particular,
  a Spanish-emoji candidate exceeded its retained-memory budget, and the final
  glide-timestamp pair produced no word-choice gains. Their exploratory results
  must not be presented as shipped improvements.

## Historical evidence

The complete pre-cleanup experiment record is associated with commit
`7fff81401e026581ae6f08ae6e726a7a99aaa9a7` on PR 782 and was backed up outside the
repository before removal. It is historical evidence, not a runtime dependency or
part of the maintained test suite. The cleanup removes logs, raw outputs, source
copies, rejected prototypes and review receipts from the final PR tree; it does
not rewrite that branch's history.

For future work, keep necessary regression inputs and baselines plus concise
findings in Git. Store full experiment packets and native receipts as external
artifacts. Retain failures and unavailable outcomes there alongside successes.
