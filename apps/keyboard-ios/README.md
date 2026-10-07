# Pulpo Keyboard

Pulpo Keyboard is a native iOS keyboard (iOS 18 and later, iPhone) with slide-to-type,
on-device autocorrect and next-word prediction, emoji, and Pulpo dictation. It is a
separate app from Pulpo Mobile and is written in Swift with no React Native, because
keyboard extensions get a small memory budget (roughly 50–70 MB) and must start instantly.

## Layout

| Path | What it is |
| --- | --- |
| `PulpoKeyboardKit/Sources/KeyboardCore` | Platform-free engine: dictionary reader, spell correction, language model, swipe decoder, typing state machine, layouts, emoji catalog, settings, and the dictation bridge. Tested on macOS with `swift test`. |
| `PulpoKeyboardKit/Sources/KeyboardUI` | UIKit keyboard: key grid and touch handling, popups, swipe trail, suggestion bar, emoji and dictation panels. Shared by the extension and the app's in-app preview. |
| `PulpoKeyboardKit/Sources/PulpoServices` | Pulpo API client (login, account, dictation upload) and Keychain session storage. App only. |
| `Extension/` | The keyboard extension (`com.isaacthoman.pulpo.keyboard.extension`). |
| `App/` | The companion app: setup, sign-in, settings, Try It, and the dictation recorder. |
| `LanguageData/` | Generated dictionary (`en_US.pkdict`) and emoji catalog (`emoji.json`). |
| `UITests/` | Simulator UI tests, including Settings automation that enables the keyboard. |
| `scripts/` | Data build script and a stub Pulpo server for dictation tests. |

The Xcode project is generated with [XcodeGen](https://github.com/yonaskolb/XcodeGen) from
`project.yml` and is not checked in.

## Develop

```bash
brew install xcodegen
cd apps/keyboard-ios
xcodegen generate
open PulpoKeyboard.xcodeproj
```

From the repository root, `npm run keyboard:test` runs the engine tests and
`npm run keyboard:build` builds the app for the simulator.

To use the keyboard on a simulator or device, run the app, then in Settings go to
General › Keyboard › Keyboards › Add New Keyboard, pick Pulpo Keyboard, open it and
turn on Allow Full Access. The app's Try It screen also has an in-app preview that runs
the same keyboard inside the app without enabling it.

## How it works

**Touch routing.** The extension paints an opaque keyboard background. Transparent
pixels in its remote view otherwise swallow gap taps before UIKit receives them.
The grid resolves gaps and outer margins by distance to the nearest visible key cap,
and unused suggestion-bar space and the preview's bottom bezel forward to the grid.

**Typing.** `KeyboardEngine` owns shift and caps lock, sentence capitalization, the
double-space period, curly quotes, automatic spaces after swipes and suggestions, and
autocorrection. It edits through a small `TextDocument` protocol, so it runs the same
against `UITextDocumentProxy`, a `UITextView`, or a test double.

**Autocorrect and prediction.** The dictionary is a memory-mapped trie of 160k words.
`SpellCorrector` runs a weighted Damerau-Levenshtein search over it where substitution
costs come from how far each touch landed from the intended key. `Suggester` combines
that with a bigram language model and the person's learned words; a typed word is only
replaced when the correction is clearly more likely. Deleting right after an
autocorrection restores the typed word and stops correcting it. Contacts' names and iOS
text replacements come from `UILexicon`.

**Slide to type.** `GlideDecoder` picks candidate words by the letters nearest the start
and end of the swipe, rejects any whose letters the finger never passed in order, and
scores the rest on letter alignment, how much of the path the word explains, unexplained
sharp turns, extra length, and the language model.

**Learning.** Words the person types twice, or keeps by undoing a correction or picking
the quoted literal, become valid. Learned words and word pairs are stored on device in
the App Group and can be cleared in the app. Nothing is learned in password, username,
one-time code, email, URL, or other private fields.

**Dictation.** iOS doesn't let keyboard extensions use the microphone, so the mic key
opens the app, which records, uploads the audio to Pulpo's
`/api/dictation/transcriptions`, and hands the transcript back through the App Group
(`DictationBridge`, with Darwin notifications as wake-ups). The person returns to their
app with the system back button and sees a live level meter in the keyboard. Afterwards
the app keeps the microphone running on standby (5 minutes by default, configurable) so
the next dictation starts without leaving the current app. The session token stays in
the app's Keychain; the keyboard extension never makes network requests.

**Full Access** is needed for dictation, haptics, and reading shared settings. Without
it the keyboard still types, corrects, predicts and swipes using defaults.

## Tests

```bash
cd apps/keyboard-ios/PulpoKeyboardKit && swift test -c release
```

Covers dictionary loading, autocorrection cases, predictions, the typing state machine,
and a synthetic swipe benchmark (600 frequent words with noisy, corner-cutting paths).

UI tests run on a simulator:

```bash
cd apps/keyboard-ios
xcodebuild -project PulpoKeyboard.xcodeproj -scheme PulpoKeyboard \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro' test
```

`KeyboardSetupTests` enables the keyboard with Full Access through the Settings app
(run it once per simulator first). `TypingTests` types, swipes, long-presses and picks
suggestions on real key views in the in-app preview; `InstalledKeyboardTests` does the
same through the installed extension in a system text field. `KeyTouchTests` drives
UIKit touch callbacks with deterministic overlapping contacts to cover rolling typing,
spaces, delete ordering, batched events, drift after a key has committed, and routing
gaps and empty keyboard padding to the closest visible key. Preview and installed
keyboard tests also tap between caps and in the surrounding margins.
`AppearanceTests` saves
screenshots of every page and field layout. `DictationTests` and `BounceDictationTests`
need the stub server (`python3 scripts/stub_pulpo_server.py`) and microphone permission
(`xcrun simctl privacy <device> grant microphone com.isaacthoman.pulpo.keyboard`).
Set `TEST_RUNNER_PK_SCREENSHOT_DIR` to also write the screenshots as PNGs.

Swipes in UI tests use XCTest's event synthesizer (`UITests/Support.swift`) because
`XCUICoordinate` only drags in straight lines.

To compare slide-to-type with another keyboard, `SwipeBenchmarkTests` decodes a JSON
file of swipe paths (`PK_BENCH_PATHS=paths.json swift test --filter SwipeBenchmark`)
so the same paths can be replayed into, for example, Gboard on an Android emulator.

## Language data

`LanguageData/` is generated by `scripts/build_language_data.py` from:

- AOSP LatinIME `en_US_wordlist.combined.gz` (Apache 2.0): words, frequencies and spelling shortcuts.
- Tatoeba English sentences, `eng_sentences.tsv.bz2` (CC-BY 2.0 FR): next-word statistics.
- Unicode `emoji-test.txt` (Unicode License v3): emoji, order and skin tones.

`scripts/extra_words.tsv` and `scripts/extra_shortcuts.tsv` add newer words and safe
contraction fixes. To rebuild:

```bash
python3 scripts/build_language_data.py \
  --wordlist en_US_wordlist.combined.gz \
  --sentences eng_sentences.tsv.bz2 \
  --emoji emoji-test.txt
```
